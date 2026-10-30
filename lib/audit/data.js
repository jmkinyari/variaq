// Database loaders and persistence for the audit engines. Server-only.
import "server-only";
import db from "../db";
import { loadChart } from "../statements-data";
import { runJournalTests, RULES } from "./journal-rules";
import { runCompleteness } from "./completeness";

const LINE_SQL = `SELECT id, date, journal_no journalNo, reference, description, account_code accountCode, account_name accountName,
  amount_cents amountCents, counterparty, posted_by postedBy, approved_by approvedBy, posted_at postedAt, entry_type entryType, source
  FROM ledger_entries WHERE workspace_id = ? AND date BETWEEN ? AND ? ORDER BY date, journal_no, line_no`;

const shiftDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Run journal tests for a period, persist findings (upsert by fingerprint) and the run. */
export async function runAndSaveJournalAudit(ws, user, { from, to, params = {} }) {
  const historyFrom = shiftDays(from, -400);
  // Include up to 6 days after the period end so cut-off reversals in the next month are visible.
  const [lines, { chart }, lockRows] = await Promise.all([
    db.all(LINE_SQL, [ws.id, historyFrom, shiftDays(to, 6)]),
    loadChart(ws.id),
    db.all("SELECT period, locked_at FROM period_locks WHERE workspace_id = ?", [ws.id]),
  ]);
  const locks = new Map(lockRows.map((l) => [l.period, l.locked_at]));
  // Cut-off needs next-month reversals, but the other rules must stop at `to`.
  const enabled = (params.enabled || Object.keys(RULES)).filter((r) => r !== "CUTOFF");
  const tested = runJournalTests(lines.filter((l) => l.date <= to), { periodFrom: from, periodTo: to, chart, locks, params: { ...params, enabled } });
  const cut = (params.enabled && !params.enabled.includes("CUTOFF")) ? { findings: [] } : runJournalTests(lines, { periodFrom: from, periodTo: shiftDays(to, 6), chart, params: { ...params, enabled: ["CUTOFF"] } });
  const findings = [...tested.findings, ...cut.findings.filter((f) => f.entryDate <= to)];

  const runId = db.id(), t = db.now();
  const stats = { ...tested.stats, findings: findings.length, benford: tested.benford, cutoff: cut.findings.length };
  const stmts = [{ sql: "INSERT INTO audit_runs (id, workspace_id, period_from, period_to, params, stats, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)", args: [runId, ws.id, from, to, JSON.stringify(params), JSON.stringify(stats), user.id, t] }];
  for (const f of findings) {
    stmts.push({
      sql: `INSERT INTO audit_findings (id, workspace_id, run_id, rule, severity, title, detail, journal_no, entry_ids, account_code, amount_cents, entry_date, suggestion, corrective, status, fingerprint, first_seen_at, last_seen_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?)
            ON CONFLICT(workspace_id, fingerprint) DO UPDATE SET run_id = excluded.run_id, severity = excluded.severity, title = excluded.title, detail = excluded.detail,
              entry_ids = excluded.entry_ids, amount_cents = excluded.amount_cents, suggestion = excluded.suggestion, corrective = excluded.corrective, last_seen_at = excluded.last_seen_at,
              status = CASE WHEN audit_findings.status = 'CLEARED' THEN 'OPEN' ELSE audit_findings.status END`,
      args: [db.id(), ws.id, runId, f.rule, f.severity, f.title, JSON.stringify(f.detail), f.journalNo, JSON.stringify(f.entryIds), f.accountCode, f.amountCents, f.entryDate, f.suggestion, f.corrective ? JSON.stringify(f.corrective) : null, f.fingerprint, t, t],
    });
  }
  // Open findings in this range that no longer reproduce (e.g. corrected in the ERP and re-imported) are cleared.
  stmts.push({ sql: "UPDATE audit_findings SET status = 'CLEARED', resolution_note = 'No longer detected on re-run', resolved_at = ? WHERE workspace_id = ? AND status = 'OPEN' AND entry_date BETWEEN ? AND ? AND last_seen_at < ?", args: [t, ws.id, from, to, t] });
  await db.batch(stmts);
  return { runId, stats };
}

/** Gather everything the completeness suite needs. */
export async function loadCompletenessData(ws, { targetYm, tbOpeningId, tbClosingId, chartLabel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [journalNos, refs, monthlyRows, monthStats, future, accounts, banks] = await Promise.all([
    db.all("SELECT DISTINCT journal_no n FROM ledger_entries WHERE workspace_id = ? AND journal_no IS NOT NULL", [ws.id]),
    db.all("SELECT DISTINCT reference n FROM ledger_entries WHERE workspace_id = ? AND reference IS NOT NULL AND reference <> '' LIMIT 200000", [ws.id]),
    db.all("SELECT account_code code, substr(date,1,7) ym, COUNT(*) n, SUM(amount_cents) cents FROM ledger_entries WHERE workspace_id = ? AND date >= ? GROUP BY account_code, ym", [ws.id, `${shiftYmStr(targetYm, -5)}-01`]),
    db.all("SELECT substr(date,1,7) ym, COUNT(*) n, SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) drCents FROM ledger_entries WHERE workspace_id = ? GROUP BY ym ORDER BY ym", [ws.id]),
    db.all("SELECT date, journal_no journalNo, description FROM ledger_entries WHERE workspace_id = ? AND date > ? ORDER BY date LIMIT 50", [ws.id, today]),
    db.all("SELECT account_code code, MAX(account_name) name FROM ledger_entries WHERE workspace_id = ? GROUP BY account_code", [ws.id]),
    db.all(`SELECT b.name, b.ledger_account_code code,
              (SELECT SUM(amount_cents) FROM ledger_entries l WHERE l.workspace_id = b.workspace_id AND l.account_code = b.ledger_account_code AND l.date <= s.period_end) ledger,
              (SELECT balance_cents FROM bank_transactions t WHERE t.statement_id = s.id AND t.balance_cents IS NOT NULL ORDER BY t.date DESC, t.rowid DESC LIMIT 1) stmt, s.period_end
            FROM bank_accounts b LEFT JOIN bank_statements s ON s.id = (SELECT id FROM bank_statements WHERE bank_account_id = b.id ORDER BY period_end DESC LIMIT 1)
            WHERE b.workspace_id = ? AND b.ledger_account_code IS NOT NULL`, [ws.id]),
  ]);
  const names = new Map(accounts.map((a) => [String(a.code), a.name || ""]));
  const monthly = new Map();
  for (const r of monthlyRows) { if (!monthly.has(r.code)) monthly.set(r.code, new Map()); monthly.get(r.code).set(r.ym, { n: r.n, cents: r.cents }); }

  let tb = null;
  if (tbOpeningId && tbClosingId) {
    const [o, c] = await Promise.all([tbImport(ws.id, tbOpeningId), tbImport(ws.id, tbClosingId)]);
    if (o && c && o.as_at < c.as_at) {
      const mv = await db.all("SELECT account_code code, SUM(amount_cents) cents FROM ledger_entries WHERE workspace_id = ? AND date > ? AND date <= ? GROUP BY account_code", [ws.id, o.as_at, c.as_at]);
      tb = { opening: o.map, closing: c.map, movements: new Map(mv.map((m) => [String(m.code), m.cents])), names, label: `${o.chart} ${o.as_at} → ${c.as_at}` };
    }
  }
  let glNotInChart = [], chartNotInGl = [];
  if (chartLabel) {
    const chartRows = await db.all("SELECT code, name FROM coa_accounts WHERE workspace_id = ? AND chart = ?", [ws.id, chartLabel]);
    const cs = new Set(chartRows.map((r) => String(r.code)));
    glNotInChart = accounts.filter((a) => !cs.has(String(a.code))).map((a) => `${a.code} ${a.name || ""}`);
    const gl = new Set(accounts.map((a) => String(a.code)));
    chartNotInGl = chartRows.filter((r) => !gl.has(String(r.code))).map((r) => `${r.code} ${r.name}`);
  }
  const outsideYear = await db.all("SELECT date, journal_no journalNo, description FROM ledger_entries WHERE workspace_id = ? AND (date < '2000-01-01' OR date > ?) LIMIT 20", [ws.id, `${new Date().getUTCFullYear() + 1}-12-31`]);
  return {
    journalNumbers: journalNos.map((r) => r.n),
    invoiceNumbers: refs.map((r) => r.n).filter((x) => /\d{3,}$/.test(x)),
    tb, monthly, names, targetYm, monthStats, futureDated: future, outsideYear,
    chartLabel: chartLabel || null, glNotInChart, chartNotInGl,
    bank: banks.map((b) => ({ name: b.name, code: b.code, ledgerBalanceCents: b.ledger || 0, stmtBalanceCents: b.stmt ?? null, stmtDate: b.period_end })),
  };
}

async function tbImport(wsId, id) {
  const imp = await db.get("SELECT * FROM tb_imports WHERE id = ? AND workspace_id = ?", [id, wsId]);
  if (!imp) return null;
  const lines = await db.all("SELECT account_code, balance_cents FROM tb_lines WHERE import_id = ?", [id]);
  imp.map = new Map(lines.map((l) => [String(l.account_code), l.balance_cents]));
  return imp;
}
function shiftYmStr(ym, k) { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); }

export { runCompleteness };
