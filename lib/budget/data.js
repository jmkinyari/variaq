// Database loaders for KPIs, budgets and BvA. Server-only; the maths lives in pure modules.
import "server-only";
import db from "../db";
import { loadChart, balancesAt } from "../statements-data";
import { monthRange, addMonths } from "../kpi";
import { toNatural, fyMonths, BUDGET_CLASSES } from "./engine";

export const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** Map(code -> Map(ym -> cents)) for months in [fromYm, toYm]. */
export async function monthlyMovements(wsId, fromYm, toYm) {
  const rows = await db.all(
    "SELECT account_code, substr(date,1,7) ym, SUM(amount_cents) amt FROM ledger_entries WHERE workspace_id = ? AND date BETWEEN ? AND ? GROUP BY account_code, ym",
    [wsId, `${fromYm}-01`, monthEnd(toYm)]);
  const mov = new Map();
  for (const r of rows) { const c = String(r.account_code); if (!mov.has(c)) mov.set(c, new Map()); mov.get(c).set(r.ym, r.amt || 0); }
  return mov;
}

/** Everything the KPI engine needs, ending at endYm (defaults to the latest ledger month). */
export async function loadKpiInputs(wsId, endYm, n = 24) {
  const range = await db.get("SELECT MIN(date) mn, MAX(date) mx, COUNT(*) n FROM ledger_entries WHERE workspace_id = ?", [wsId]);
  if (!range?.n) return null;
  const end = endYm || range.mx.slice(0, 7);
  const months = monthRange(end, n);
  const [{ chart }, mov, opening, ar, ap] = await Promise.all([
    loadChart(wsId),
    monthlyMovements(wsId, months[0], end),
    balancesAt(wsId, monthEnd(addMonths(months[0], -1))),
    db.get("SELECT as_at, SUM(total_cents) total, SUM(d90_cents) d90 FROM aging_lines WHERE workspace_id = ? AND side = 'AR' AND as_at = (SELECT MAX(as_at) FROM aging_lines WHERE workspace_id = ? AND side = 'AR')", [wsId, wsId]),
    db.get("SELECT as_at, SUM(total_cents) total, SUM(d90_cents) d90 FROM aging_lines WHERE workspace_id = ? AND side = 'AP' AND as_at = (SELECT MAX(as_at) FROM aging_lines WHERE workspace_id = ? AND side = 'AP')", [wsId, wsId]),
  ]);
  // Only use an ageing snapshot for the KPI month it belongs to.
  const aging = {};
  if (ar?.as_at && ar.as_at.slice(0, 7) === end) aging.AR = { total: ar.total || 0, d90: ar.d90 || 0, asAt: ar.as_at };
  if (ap?.as_at && ap.as_at.slice(0, 7) === end) aging.AP = { total: ap.total || 0, d90: ap.d90 || 0, asAt: ap.as_at };
  // Trim leading months before the ledger starts so averages aren't diluted.
  const firstYm = range.mn.slice(0, 7);
  const start = Math.max(0, months.findIndex((m) => m >= firstYm));
  const trimmed = months.slice(start);
  return { chart, months: trimmed, mov, opening, aging, range, end };
}

/** Latest AR/AP ageing buckets for charts. */
export async function latestAging(wsId) {
  const out = {};
  for (const side of ["AR", "AP"]) {
    out[side] = await db.get("SELECT as_at, SUM(current_cents) cur, SUM(d30_cents) d30, SUM(d60_cents) d60, SUM(d90_cents) d90, SUM(total_cents) total, COUNT(*) n FROM aging_lines WHERE workspace_id = ? AND side = ? AND as_at = (SELECT MAX(as_at) FROM aging_lines WHERE workspace_id = ? AND side = ?)", [wsId, side, wsId, side]);
    if (!out[side]?.as_at) out[side] = null;
  }
  return out;
}

/** Natural-sign monthly history (24 months before fyStart) for P&L accounts. */
export async function budgetHistory(wsId, fyStart) {
  const { chart } = await loadChart(wsId);
  const end = addMonths(fyStart, -1);
  const months = monthRange(end, 24);
  const mov = await monthlyMovements(wsId, months[0], end);
  const history = new Map();
  for (const [code, acct] of chart) {
    if (!BUDGET_CLASSES.includes(acct.cls)) continue;
    const m = mov.get(code);
    history.set(code, months.map((ym) => toNatural(acct.cls, m?.get(ym) || 0)));
  }
  return { chart, history, months };
}

export async function loadBudget(wsId, id) {
  const b = await db.get("SELECT b.*, u.name created_by_name, a.name approved_by_name FROM budgets b LEFT JOIN users u ON u.id = b.created_by LEFT JOIN users a ON a.id = b.approved_by WHERE b.id = ? AND b.workspace_id = ?", [id, wsId]);
  if (!b) return null;
  const rows = await db.all("SELECT account_code, month_idx, amount_cents FROM budget_lines WHERE budget_id = ?", [id]);
  const lines = new Map();
  for (const r of rows) { if (!lines.has(r.account_code)) lines.set(r.account_code, new Array(12).fill(0)); lines.get(r.account_code)[r.month_idx] = r.amount_cents; }
  let assumptions = {};
  try { assumptions = JSON.parse(b.assumptions || "{}"); } catch { assumptions = {}; }
  return { budget: { ...b, assumptions }, lines };
}

/** Natural-sign actuals per account for the 12 FY months, and how many months are closed (have data). */
export async function budgetActuals(wsId, chart, fyStart) {
  const months = fyMonths(fyStart);
  const mov = await monthlyMovements(wsId, months[0], months[11]);
  const actuals = new Map();
  for (const [code, acct] of chart) {
    if (!BUDGET_CLASSES.includes(acct.cls)) continue;
    const m = mov.get(code);
    if (!m) continue;
    actuals.set(code, months.map((ym) => toNatural(acct.cls, m.get(ym) || 0)));
  }
  const latest = await db.get("SELECT MAX(date) mx FROM ledger_entries WHERE workspace_id = ? AND date <= ?", [wsId, monthEnd(months[11])]);
  const lastYm = latest?.mx ? latest.mx.slice(0, 7) : null;
  const closedMonths = lastYm ? Math.max(0, months.filter((ym) => ym <= lastYm).length) : 0;
  return { actuals, months, closedMonths };
}

/** Transactions for given accounts in a month (natural sign) and 3-month base counts for price/volume. */
export async function varianceContext(wsId, chart, codes, ym) {
  if (!codes.length) return { txnsByCode: new Map(), historyByCode: new Map() };
  const ph = codes.map(() => "?").join(",");
  const from3 = `${addMonths(ym, -3)}-01`, prevEnd = monthEnd(addMonths(ym, -1));
  const [txns, hist] = await Promise.all([
    db.all(`SELECT id, account_code, date, description, counterparty, reference, journal_no, amount_cents FROM ledger_entries WHERE workspace_id = ? AND account_code IN (${ph}) AND date BETWEEN ? AND ? ORDER BY ABS(amount_cents) DESC LIMIT 2000`, [wsId, ...codes, `${ym}-01`, monthEnd(ym)]),
    db.all(`SELECT account_code, substr(date,1,7) ym, COUNT(*) n, SUM(amount_cents) total FROM ledger_entries WHERE workspace_id = ? AND account_code IN (${ph}) AND date BETWEEN ? AND ? GROUP BY account_code, ym`, [wsId, ...codes, from3, prevEnd]),
  ]);
  const txnsByCode = new Map(), historyByCode = new Map();
  for (const t of txns) {
    const cls = chart.get(String(t.account_code))?.cls;
    const arr = txnsByCode.get(t.account_code) || []; txnsByCode.set(t.account_code, arr);
    arr.push({ id: t.id, date: t.date, description: t.description, counterparty: t.counterparty, reference: t.reference, journalNo: t.journal_no, amount: toNatural(cls, t.amount_cents) });
  }
  for (const h of hist) {
    const cls = chart.get(String(h.account_code))?.cls;
    const arr = historyByCode.get(h.account_code) || []; historyByCode.set(h.account_code, arr);
    arr.push({ ym: h.ym, count: h.n, total: toNatural(cls, h.total || 0) });
  }
  return { txnsByCode, historyByCode };
}

/** The most recent APPROVED (or LOCKED) budget covering a month. */
export async function approvedBudgetFor(wsId, ym) {
  const rows = await db.all("SELECT id, fy_start FROM budgets WHERE workspace_id = ? AND status IN ('APPROVED','LOCKED') ORDER BY updated_at DESC", [wsId]);
  return rows.find((b) => fyMonths(b.fy_start).includes(ym)) || null;
}
