// Evidence pack for an auditor query: everything an auditor usually asks for about an account or a
// journal, assembled from the ledger in one go so the accountant starts from facts, not a blank page.
import "server-only";
import db from "../db";
import { loadChart } from "../statements-data";

const shiftMonths = (ym, k) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); };

export async function buildEvidence(ws, { accountCode, journalNo, from, to }) {
  const range = await db.get("SELECT MIN(date) mn, MAX(date) mx FROM ledger_entries WHERE workspace_id = ?", [ws.id]);
  to = to || range?.mx || new Date().toISOString().slice(0, 10);
  from = from || `${to.slice(0, 4)}-01-01`;
  const { chart } = await loadChart(ws.id);
  const ev = { generatedAt: new Date().toISOString(), from, to, account: null, journal: null, findings: [], locks: [], reconciliations: [] };

  if (accountCode) {
    const a = String(accountCode);
    const [open, mov, trend, parties, journals] = await Promise.all([
      db.get("SELECT COALESCE(SUM(amount_cents),0) v FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date < ?", [ws.id, a, from]),
      db.get("SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END),0) dr, COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents END),0) cr, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ?", [ws.id, a, from, to]),
      db.all("SELECT substr(date,1,7) ym, SUM(amount_cents) net, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date >= ? AND date <= ? GROUP BY ym ORDER BY ym", [ws.id, a, `${shiftMonths(to.slice(0, 7), -11)}-01`, to]),
      db.all("SELECT COALESCE(counterparty,'(none)') party, SUM(amount_cents) net, COUNT(*) n, MAX(ABS(amount_cents)) mx FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ? GROUP BY party ORDER BY ABS(SUM(amount_cents)) DESC LIMIT 10", [ws.id, a, from, to]),
      db.all(`SELECT COALESCE(journal_no, date || ' ' || COALESCE(reference, description)) jk, MIN(date) date, SUM(amount_cents) net, MAX(description) description, MAX(posted_by) posted_by, MAX(approved_by) approved_by
              FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ? GROUP BY jk ORDER BY ABS(SUM(amount_cents)) DESC LIMIT 15`, [ws.id, a, from, to]),
    ]);
    ev.account = {
      code: a, name: chart.get(a)?.name || "", class: chart.get(a)?.cls || null,
      openingCents: open.v, debitsCents: mov.dr, creditsCents: mov.cr, lines: mov.n, closingCents: open.v + mov.dr - mov.cr,
      trend: trend.map((t) => ({ ym: t.ym, netCents: t.net, n: t.n })),
      counterparties: parties.map((p) => ({ name: p.party, netCents: p.net, n: p.n, largestCents: p.mx })),
      largestJournals: journals.map((j) => ({ ref: j.jk, date: j.date, netCents: j.net, description: j.description, postedBy: j.posted_by, approvedBy: j.approved_by })),
    };
    const recs = await db.all(`SELECT r.name, r.status, s.period_end, r.completed_at FROM reconciliations r JOIN bank_accounts b ON b.id = r.bank_account_id JOIN bank_statements s ON s.id = r.statement_id
                               WHERE r.workspace_id = ? AND b.ledger_account_code = ? ORDER BY s.period_end DESC LIMIT 6`, [ws.id, a]);
    ev.reconciliations = recs.map((r) => ({ name: r.name, status: r.status, periodEnd: r.period_end, completedAt: r.completed_at }));
  }
  if (journalNo) {
    const lines = await db.all("SELECT date, account_code, account_name, description, reference, counterparty, amount_cents, posted_by, approved_by, posted_at, entry_type, source FROM ledger_entries WHERE workspace_id = ? AND journal_no = ? ORDER BY line_no LIMIT 300", [ws.id, String(journalNo)]);
    ev.journal = {
      journalNo: String(journalNo), lines: lines.map((l) => ({ date: l.date, accountCode: l.account_code, accountName: l.account_name || chart.get(String(l.account_code))?.name || "", description: l.description, reference: l.reference, counterparty: l.counterparty, amountCents: l.amount_cents })),
      postedBy: lines[0]?.posted_by || null, approvedBy: lines[0]?.approved_by || null, postedAt: lines[0]?.posted_at || null, entryType: lines[0]?.entry_type || null, source: lines[0]?.source || null,
      balanced: lines.reduce((s, l) => s + l.amount_cents, 0) === 0,
    };
  }
  const fw = ["workspace_id = ?"], fa = [ws.id];
  const ors = [];
  if (accountCode) { ors.push("account_code = ?"); fa.push(String(accountCode)); }
  if (journalNo) { ors.push("journal_no = ?"); fa.push(String(journalNo)); }
  if (ors.length) {
    fw.push(`(${ors.join(" OR ")})`);
    ev.findings = (await db.all(`SELECT id, rule, severity, title, status, entry_date, amount_cents, resolution_note FROM audit_findings WHERE ${fw.join(" AND ")} ORDER BY CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END LIMIT 30`, fa))
      .map((f) => ({ id: f.id, rule: f.rule, severity: f.severity, title: f.title, status: f.status, date: f.entry_date, amountCents: f.amount_cents, resolution: f.resolution_note }));
  }
  ev.locks = (await db.all("SELECT period, locked_at FROM period_locks WHERE workspace_id = ? AND period BETWEEN ? AND ? ORDER BY period", [ws.id, from.slice(0, 7), to.slice(0, 7)])).map((l) => ({ period: l.period, lockedAt: l.locked_at }));
  return ev;
}
