// Database access for chart mapping. "LEDGER" is a virtual chart: the accounts in Variaq's own
// general ledger (imported or synced from the ERP). Server-only.
import "server-only";
import db from "../db";
import { loadChart, balancesAt } from "../statements-data";
import { defaultClass } from "../statements";
import { translateTb } from "./consolidate";

export const LEDGER = "LEDGER";

export async function listCharts(wsId) {
  const [charts, ledger, tbs] = await Promise.all([
    db.all("SELECT chart, COUNT(*) n, MAX(created_at) updated FROM coa_accounts WHERE workspace_id = ? GROUP BY chart ORDER BY chart", [wsId]),
    db.get("SELECT COUNT(DISTINCT account_code) n FROM ledger_entries WHERE workspace_id = ?", [wsId]),
    db.all("SELECT id, chart, as_at, file_name, row_count, created_at FROM tb_imports WHERE workspace_id = ? ORDER BY as_at DESC, created_at DESC", [wsId]),
  ]);
  return { charts: [...(ledger?.n ? [{ chart: LEDGER, n: ledger.n, virtual: true }] : []), ...charts.filter((c) => c.chart !== LEDGER)], tbs };
}

/** [{code, name, cls}] for a chart. */
export async function chartAccounts(wsId, chart) {
  if (chart === LEDGER) {
    const { chart: c } = await loadChart(wsId);
    return [...c.values()].map((a) => ({ code: a.code, name: a.name, cls: a.cls }));
  }
  const rows = await db.all("SELECT code, name, class FROM coa_accounts WHERE workspace_id = ? AND chart = ? ORDER BY code", [wsId, chart]);
  return rows.map((r) => ({ code: String(r.code), name: r.name, cls: r.class || defaultClass(r.code, r.name) }));
}

export async function loadMappings(wsId, source, target) {
  const rows = await db.all("SELECT * FROM coa_mappings WHERE workspace_id = ? AND source_chart = ? AND target_chart = ?", [wsId, source, target]);
  return new Map(rows.map((r) => [String(r.source_code), r]));
}

/** Confirmed mappings across all charts → training signal for the matcher. */
export async function confirmedMappings(wsId, target) {
  const rows = await db.all(`SELECT m.source_chart, m.source_code, m.target_code, a.name source_name FROM coa_mappings m
    LEFT JOIN coa_accounts a ON a.workspace_id = m.workspace_id AND a.chart = m.source_chart AND a.code = m.source_code
    WHERE m.workspace_id = ? AND m.target_chart = ? AND m.status IN ('CONFIRMED','OVERRIDDEN') AND m.target_code IS NOT NULL`, [wsId, target]);
  return rows.map((r) => ({ sourceCode: null, sourceName: r.source_name, targetCode: r.target_code, chart: r.source_chart, code: r.source_code }));
}

/** A trial balance source: a tb_imports id, or "LEDGER:YYYY-MM-DD" for the GL at a date. */
export async function loadTb(wsId, src) {
  if (!src) return null;
  if (src.startsWith(`${LEDGER}:`)) {
    const asAt = src.slice(LEDGER.length + 1);
    const [bal, accts] = await Promise.all([balancesAt(wsId, asAt), chartAccounts(wsId, LEDGER)]);
    const names = new Map(accts.map((a) => [a.code, a.name]));
    return { chart: LEDGER, asAt, label: `Variaq ledger at ${asAt}`, lines: [...bal].filter(([, v]) => v).map(([code, v]) => ({ code, name: names.get(code) || "", balanceCents: v })) };
  }
  const imp = await db.get("SELECT * FROM tb_imports WHERE id = ? AND workspace_id = ?", [src, wsId]);
  if (!imp) return null;
  const lines = await db.all("SELECT account_code, account_name, balance_cents FROM tb_lines WHERE import_id = ? ORDER BY account_code", [imp.id]);
  return { chart: imp.chart, asAt: imp.as_at, label: `${imp.chart} TB at ${imp.as_at}`, lines: lines.map((l) => ({ code: String(l.account_code), name: l.account_name || "", balanceCents: l.balance_cents })) };
}

/** Translate a TB source into `target` chart using saved mappings (identity if same chart). */
export async function translated(wsId, tb, target) {
  const targetAccts = await chartAccounts(wsId, target);
  const tmap = new Map(targetAccts.map((a) => [a.code, a]));
  if (tb.chart === target) return translateTb(tb.lines, null, tmap);
  const maps = await loadMappings(wsId, tb.chart, target);
  const m = new Map([...maps].filter(([, r]) => r.target_code).map(([k, r]) => [k, String(r.target_code)]));
  return translateTb(tb.lines, m, tmap);
}
