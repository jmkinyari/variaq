// Server-side reconciliation engine: loads data, runs rule-based matching, persists results.
const db = require("./db");
const { matchTransactions } = require("./matching");

function shiftDate(d, days) { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); }

const mapBt = (t) => ({ id: t.id, date: t.date, description: t.description, reference: t.reference, amountCents: t.amount_cents });
const mapLe = (e) => ({ id: e.id, date: e.date, description: e.description, reference: e.reference, amountCents: e.amount_cents, counterparty: e.counterparty });

/** Candidate ledger entries for a reconciliation (bank's ledger account, around the period, not confirmed elsewhere). */
async function candidateLedger(rec, st, acct) {
  const pad = Math.max(rec.date_window * 4, 7);
  return db.all(
    `SELECT * FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ?
     AND id NOT IN (SELECT ledger_entry_id FROM matches WHERE status = 'CONFIRMED' AND reconciliation_id != ?)`,
    [rec.workspace_id, acct.ledger_account_code, shiftDate(st.period_start, -pad), shiftDate(st.period_end, pad), rec.id]
  );
}

/** (Re)run matching. Keeps confirmed matches, rejected pairs and resolved/dismissed exceptions. */
async function runMatching(recId) {
  const rec = await db.get("SELECT * FROM reconciliations WHERE id = ?", [recId]);
  const st = await db.get("SELECT * FROM bank_statements WHERE id = ?", [rec.statement_id]);
  const acct = await db.get("SELECT * FROM bank_accounts WHERE id = ?", [rec.bank_account_id]);
  const bank = await db.all("SELECT * FROM bank_transactions WHERE statement_id = ? ORDER BY date, rowid", [st.id]);
  const ledger = await candidateLedger(rec, st, acct);
  const existing = await db.all("SELECT * FROM matches WHERE reconciliation_id = ?", [recId]);
  const confirmed = existing.filter((m) => m.status === "CONFIRMED");
  const rejected = new Set(existing.filter((m) => m.status === "REJECTED").map((m) => `${m.bank_transaction_id}|${m.ledger_entry_id}`));
  const closed = await db.all("SELECT * FROM recon_exceptions WHERE reconciliation_id = ? AND status != 'OPEN'", [recId]);
  const closedKey = new Set(closed.map((e) => `${e.type}|${e.bank_transaction_id || ""}|${e.ledger_entry_id || ""}`));
  const closedBank = new Set(closed.filter((e) => ["UNMATCHED_BANK", "AMOUNT_MISMATCH"].includes(e.type)).map((e) => e.bank_transaction_id));
  const closedLedger = new Set(closed.filter((e) => e.type === "UNMATCHED_LEDGER").map((e) => e.ledger_entry_id));

  const { matches, exceptions } = matchTransactions(bank.map(mapBt), ledger.map(mapLe), {
    dateWindow: rec.date_window, largeAmountCents: rec.large_amount_cents,
    periodStart: st.period_start, periodEnd: st.period_end,
    lockedBankIds: new Set(confirmed.map((m) => m.bank_transaction_id)),
    lockedLedgerIds: new Set(confirmed.map((m) => m.ledger_entry_id)),
    rejectedPairs: rejected,
  });
  const t = db.now();
  const keepEx = exceptions.filter((e) => {
    if (closedKey.has(`${e.type}|${e.bankTransactionId || ""}|${e.ledgerEntryId || ""}`)) return false;
    // An item someone already resolved as "unmatched, explained" shouldn't reappear under another type.
    if ((e.type === "UNMATCHED_BANK" || e.type === "AMOUNT_MISMATCH") && closedBank.has(e.bankTransactionId)) return false;
    if (e.type === "UNMATCHED_LEDGER" && closedLedger.has(e.ledgerEntryId)) return false;
    return true;
  });
  await db.batch([
    { sql: "DELETE FROM matches WHERE reconciliation_id = ? AND status = 'SUGGESTED'", args: [recId] },
    { sql: "DELETE FROM recon_exceptions WHERE reconciliation_id = ? AND status = 'OPEN'", args: [recId] },
    ...matches.map((m) => ({ sql: "INSERT INTO matches (id, reconciliation_id, bank_transaction_id, ledger_entry_id, status, method, confidence, reasons, created_at) VALUES (?,?,?,?,?,?,?,?,?)", args: [db.id(), recId, m.bankTransactionId, m.ledgerEntryId, "SUGGESTED", m.method, m.confidence, JSON.stringify(m.reasons), t] })),
    ...keepEx.map((e) => ({ sql: "INSERT INTO recon_exceptions (id, reconciliation_id, bank_transaction_id, ledger_entry_id, type, detail, status, created_at) VALUES (?,?,?,?,?,?,?,?)", args: [db.id(), recId, e.bankTransactionId || null, e.ledgerEntryId || null, e.type, e.detail, "OPEN", t] })),
    { sql: "UPDATE reconciliations SET updated_at = ? WHERE id = ?", args: [t, recId] },
  ]);
  return { suggested: matches.length, exceptions: keepEx.length, bank: bank.length, ledger: ledger.length };
}

module.exports = { runMatching, candidateLedger, shiftDate };
