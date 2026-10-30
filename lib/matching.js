// Rule-based bank-to-ledger matching. This is deterministic, explainable matching —
// it is NOT AI, and the UI labels it that way.
const { daysBetween } = require("./dates");

const normRef = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const tokens = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !/^\d+$/.test(t)));
function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function refRelation(bt, le) {
  const br = normRef(bt.reference), lr = normRef(le.reference);
  if (br && lr && br === lr) return "exact";
  const bdesc = normRef(bt.description), ldesc = normRef(le.description);
  if (lr.length >= 4 && (bdesc.includes(lr) || br.includes(lr))) return "contains";
  if (br.length >= 4 && (ldesc.includes(br) || lr.includes(br))) return "contains";
  return null;
}

/** Score a bank transaction against a ledger entry. Returns null if not a candidate. */
function scorePair(bt, le, { dateWindow = 3 } = {}) {
  if (bt.amountCents !== le.amountCents) return null;
  const reasons = [];
  let score = 60;
  reasons.push("Amounts are identical");
  const ref = refRelation(bt, le);
  const d = Math.abs(daysBetween(bt.date, le.date));
  if (d <= dateWindow) {
    score += Math.round(20 * (1 - d / (dateWindow + 1)));
    reasons.push(d === 0 ? "Same date" : `Dates ${d} day${d === 1 ? "" : "s"} apart`);
  } else if (ref && d <= dateWindow * 4) {
    score += 3;
    reasons.push(`Dates ${d} days apart (outside the ${dateWindow}-day window, kept because the reference matches)`);
  } else return null;
  if (ref === "exact") { score += 15; reasons.push("References match"); }
  else if (ref === "contains") { score += 11; reasons.push("Reference appears in the description"); }
  const sim = jaccard(bt.description, `${le.description} ${le.counterparty || ""}`);
  if (sim > 0) { score += Math.round(10 * sim); if (sim >= 0.2) reasons.push("Descriptions share key words"); }
  const method = ref && d === 0 ? "EXACT" : ref ? "REFERENCE" : "FUZZY";
  return { score: Math.min(100, score), reasons, method };
}

/**
 * Match bank transactions to ledger entries one-to-one (greedy, highest score first).
 * bankTxns: [{id,date,description,reference,amountCents}]
 * ledgerEntries: candidate ledger entries for the bank's ledger account (already excluding confirmed matches elsewhere)
 * Returns { matches: [{bankTransactionId, ledgerEntryId, confidence, method, reasons}], exceptions: [...] }
 */
function matchTransactions(bankTxns, ledgerEntries, { dateWindow = 3, largeAmountCents = 100000000, periodStart, periodEnd, lockedBankIds = new Set(), lockedLedgerIds = new Set(), rejectedPairs = new Set() } = {}) {
  const pairs = [];
  for (const bt of bankTxns) {
    if (lockedBankIds.has(bt.id)) continue;
    for (const le of ledgerEntries) {
      if (lockedLedgerIds.has(le.id) || rejectedPairs.has(`${bt.id}|${le.id}`)) continue;
      const s = scorePair(bt, le, { dateWindow });
      if (s) pairs.push({ bt, le, ...s });
    }
  }
  pairs.sort((a, b) => b.score - a.score || Math.abs(daysBetween(a.bt.date, a.le.date)) - Math.abs(daysBetween(b.bt.date, b.le.date)));
  const usedB = new Set(lockedBankIds), usedL = new Set(lockedLedgerIds);
  const matches = [];
  for (const p of pairs) {
    if (usedB.has(p.bt.id) || usedL.has(p.le.id)) continue;
    usedB.add(p.bt.id); usedL.add(p.le.id);
    matches.push({ bankTransactionId: p.bt.id, ledgerEntryId: p.le.id, confidence: p.score, method: p.method, reasons: p.reasons });
  }

  const exceptions = [];
  // Duplicates on the statement
  const seen = new Map();
  for (const bt of bankTxns) {
    const key = `${bt.date}|${bt.amountCents}|${normRef(bt.reference) || normRef(bt.description)}`;
    if (seen.has(key)) exceptions.push({ type: "DUPLICATE", bankTransactionId: bt.id, detail: `Looks like a duplicate of another line on ${bt.date} with the same amount and reference/description.` });
    else seen.set(key, bt.id);
  }
  const unmatchedLedger = ledgerEntries.filter((le) => !usedL.has(le.id) && (!periodStart || (le.date >= periodStart && le.date <= periodEnd)));
  for (const bt of bankTxns) {
    if (Math.abs(bt.amountCents) >= largeAmountCents) exceptions.push({ type: "LARGE_AMOUNT", bankTransactionId: bt.id, detail: "Amount is above the review threshold for this reconciliation — confirm it is supported by an invoice, contract or approval." });
    if (usedB.has(bt.id)) continue;
    const near = unmatchedLedger.find((le) => refRelation(bt, le) && Math.sign(le.amountCents) === Math.sign(bt.amountCents));
    if (near) {
      exceptions.push({ type: "AMOUNT_MISMATCH", bankTransactionId: bt.id, ledgerEntryId: near.id, detail: `Reference matches a ledger entry but the amounts differ by ${(Math.abs(bt.amountCents - near.amountCents) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}. Check for discounts, charges or a posting error.` });
    } else {
      exceptions.push({ type: "UNMATCHED_BANK", bankTransactionId: bt.id, detail: "No ledger entry with the same amount within the date window." });
    }
  }
  const mismatchLedger = new Set(exceptions.filter((e) => e.type === "AMOUNT_MISMATCH").map((e) => e.ledgerEntryId));
  for (const le of unmatchedLedger) {
    if (mismatchLedger.has(le.id)) continue;
    exceptions.push({ type: "UNMATCHED_LEDGER", ledgerEntryId: le.id, detail: "Recorded in the ledger but not found on this bank statement (timing difference, outstanding cheque, or missing entry)." });
  }
  return { matches, exceptions };
}

module.exports = { matchTransactions, scorePair, jaccard, normRef };
