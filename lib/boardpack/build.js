// Board pack snapshot builder. Gathers every number the pack shows at one moment so an approved
// pack never changes afterwards, even if the ledger is re-imported. Server-only.
import "server-only";
import db from "../db";
import { balanceSheet, incomeStatement, classifyCashFlows, cashFlowByActivity } from "../statements";
import { loadChart, balancesAt, movements, entriesBetween } from "../statements-data";
import { buildSeries, computeKpis, projectLinear, addMonths } from "../kpi";
import { loadKpiInputs, loadBudget, budgetActuals, varianceContext, monthEnd } from "../budget/data";
import { computeBva, explainAll } from "../budget/variance";
import { fyMonths } from "../budget/engine";
import { loadAlerts } from "./alerts";

export const SECTIONS = [
  ["cover", "Cover"],
  ["summary", "Executive summary"],
  ["pl", "Profit & loss vs budget and prior year"],
  ["bs", "Balance sheet"],
  ["cash", "Cash flow & outlook"],
  ["kpis", "KPI trends"],
  ["bva", "Budget variance commentary & actions"],
  ["close", "Month-end close status"],
  ["controls", "Audit & control highlights"],
  ["tax", "Tax compliance (KRA)"],
  ["risks", "Risks & decisions required"],
];

const yearAgo = (ym) => addMonths(ym, -12);
const plLines = (is) => ({
  revenue: is.revenue.total, cogs: is.cogs.total, grossProfit: is.grossProfit, opex: is.opex.total, operatingProfit: is.operatingProfit,
  other: is.other.total, netProfit: is.netProfit, grossMargin: is.grossMargin, netMargin: is.netMargin,
  topRevenue: is.revenue.lines.slice().sort((a, b) => b.amount - a.amount).slice(0, 6),
  topExpenses: [...is.cogs.lines, ...is.opex.lines].sort((a, b) => b.amount - a.amount).slice(0, 8),
});

export async function buildSnapshot(ws, period, budgetId) {
  const [y] = period.split("-").map(Number);
  const from = `${period}-01`, to = monthEnd(period);
  const { chart } = await loadChart(ws.id);
  const inputs = await loadKpiInputs(ws.id, period, 24);
  const snap = { period, company: ws.name, currency: ws.currency, generatedAt: new Date().toISOString(), sections: {} };
  if (!inputs) return { ...snap, empty: true };
  const series = buildSeries(inputs);
  const kpis = computeKpis(series, inputs.months, { aging: inputs.aging });
  const last12 = (arr) => arr.slice(-12);
  snap.months = last12(inputs.months);
  snap.series = { revenue: last12(series.revenue), expenses: last12(series.expenses), netProfit: last12(series.netProfit), ebitda: last12(series.ebitda), cash: last12(series.cash), grossMargin: last12(kpis.find((k) => k.key === "gross_margin").series || []) };
  snap.kpis = kpis.map(({ series: s, ...k }) => ({ ...k, spark: s ? s.slice(-12) : null }));

  // P&L: month, prior-year same month, year to date.
  const [movM, movPY, movYTD] = await Promise.all([
    movements(ws.id, from, to),
    movements(ws.id, `${yearAgo(period)}-01`, monthEnd(yearAgo(period))),
    movements(ws.id, `${y}-01-01`, to),
  ]);
  snap.pl = { month: plLines(incomeStatement(chart, movM)), priorYear: plLines(incomeStatement(chart, movPY)), ytd: plLines(incomeStatement(chart, movYTD)) };

  // Balance sheet now vs prior year end.
  const [balNow, balPrior] = await Promise.all([balancesAt(ws.id, to), balancesAt(ws.id, `${y - 1}-12-31`)]);
  const bsNow = balanceSheet(chart, balNow), bsPrior = balanceSheet(chart, balPrior);
  snap.bs = { asAt: to, priorAsAt: `${y - 1}-12-31`, sections: bsNow.sections.map((s, i) => ({ key: s.key, title: s.title, total: s.total, prior: bsPrior.sections[i]?.total || 0, lines: s.lines.slice(0, 12).map((l) => ({ code: l.code, name: l.name, amount: l.amount })) })), totalAssets: bsNow.totalAssets, totalLiabilities: bsNow.totalLiabilities, totalEquity: bsNow.totalEquity, difference: bsNow.difference, priorTotals: { assets: bsPrior.totalAssets, liabilities: bsPrior.totalLiabilities, equity: bsPrior.totalEquity } };

  // Cash: month movement by activity + 3-month trend outlook + saved 13-week summary.
  const flows = classifyCashFlows(await entriesBetween(ws.id, from, to), chart);
  const byAct = cashFlowByActivity(flows);
  snap.cash = { activities: byAct.activities.map((a) => ({ title: a.title, total: a.total, lines: a.lines })), net: byAct.net, closing: series.cash[series.cash.length - 1], outlook: projectLinear(series.cash, 3), outlookMonths: [1, 2, 3].map((k) => addMonths(period, k)) };

  // Budget vs actual.
  if (budgetId) {
    const loaded = await loadBudget(ws.id, budgetId);
    if (loaded) {
      const { budget: b, lines } = loaded;
      const months = fyMonths(b.fy_start);
      const monthIdx = months.indexOf(period);
      if (monthIdx >= 0) {
        const { actuals, closedMonths } = await budgetActuals(ws.id, chart, b.fy_start);
        const materiality = { pct: 10, cents: 5000000 };
        const bva = computeBva({ chart, budget: lines, actuals, closedMonths: Math.max(closedMonths, monthIdx + 1), monthIdx, materiality, reforecast: b.assumptions.reforecast || {}, actualOverrides: b.assumptions.actualOverrides || {}, landingBasis: b.assumptions.landingBasis || "BUDGET" });
        const codes = bva.rows.filter((r) => r.month.material || r.ytd.material).map((r) => r.code).slice(0, 40);
        const ctx = await varianceContext(ws.id, chart, codes, period);
        const notes = await db.all("SELECT n.account_code, n.note, n.action, o.name owner_name FROM budget_notes n LEFT JOIN users o ON o.id = n.owner_id WHERE n.budget_id = ? AND n.period = ?", [budgetId, period]);
        snap.bva = {
          budgetName: b.name, status: b.status, classes: Object.fromEntries(Object.entries(bva.classes).map(([k, v]) => [k, { month: v.month, ytd: v.ytd, fy: v.fy }])), netProfit: bva.netProfit,
          variances: explainAll(bva, { ...ctx, materiality }).slice(0, 10).map((e) => ({ code: e.code, name: e.row.name, cls: e.row.cls, month: e.row.month, ytd: e.row.ytd, headline: e.headline, types: e.types.map((t) => t.label), actions: e.actions, notes: notes.filter((n) => n.account_code === e.code) })),
        };
      }
    }
  }

  // Close, controls, tax.
  const [close, alerts, findings, taxRuns] = await Promise.all([
    db.all("SELECT category, COUNT(*) n, SUM(status = 'DONE') done, SUM(status <> 'DONE' AND due_date IS NOT NULL AND due_date < ?) overdue FROM close_tasks WHERE workspace_id = ? AND period = ? GROUP BY category", [new Date().toISOString().slice(0, 10), ws.id, period]),
    loadAlerts(ws.id),
    db.all("SELECT rule, severity, title, amount_cents, journal_no, entry_date, suggestion FROM audit_findings WHERE workspace_id = ? AND status = 'OPEN' ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, ABS(COALESCE(amount_cents,0)) DESC LIMIT 8", [ws.id]).catch(() => []),
    db.all("SELECT kind, period, stats, created_at FROM tax_recon_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 6", [ws.id]).catch(() => []),
  ]);
  snap.close = { categories: close, total: close.reduce((a, c) => a + c.n, 0), done: close.reduce((a, c) => a + (c.done || 0), 0), overdue: close.reduce((a, c) => a + (c.overdue || 0), 0) };
  snap.controls = { bySeverity: Object.fromEntries(Object.entries(alerts.findings).map(([k, v]) => [k, { n: v.n, amt: v.amt }])), top: findings, reconExceptions: alerts.reconEx, openQueries: alerts.queries?.n || 0 };
  snap.tax = { runs: taxRuns.map((r) => { let s = {}; try { s = JSON.parse(r.stats || "{}"); } catch { s = {}; } return { kind: r.kind, period: r.period, at: r.created_at, stats: s }; }), openItems: alerts.taxOpen, openAmount: alerts.taxAmt };
  // Risks: alerts + KPIs at "bad" status, as a starting list for the board.
  snap.risks = [
    ...alerts.list.map((a) => a.text),
    ...snap.kpis.filter((k) => k.status === "bad").map((k) => `${k.label} is outside the healthy range (${k.definition})`),
  ];
  return snap;
}

/** Plain-text digest of a section's numbers for an AI commentary prompt. */
export function sectionDigest(snap, key) {
  const f = (c) => (c === null || c === undefined ? "n/a" : `${snap.currency} ${(Math.round(c / 100)).toLocaleString("en-KE")}`);
  switch (key) {
    case "summary": return snap.kpis.map((k) => `${k.label}: ${k.unit === "money" ? f(k.value) : k.value ?? "n/a"}${k.status ? ` (${k.status})` : ""}`).join("\n");
    case "pl": return `Month: revenue ${f(snap.pl.month.revenue)}, gross profit ${f(snap.pl.month.grossProfit)} (${snap.pl.month.grossMargin}%), net profit ${f(snap.pl.month.netProfit)}.\nSame month last year: revenue ${f(snap.pl.priorYear.revenue)}, net profit ${f(snap.pl.priorYear.netProfit)}.\nYTD: revenue ${f(snap.pl.ytd.revenue)}, net profit ${f(snap.pl.ytd.netProfit)}.${snap.bva ? `\nBudget: month net profit ${f(snap.bva.netProfit.month.budget)}, YTD ${f(snap.bva.netProfit.ytd.budget)}.` : ""}`;
    case "bs": return snap.bs.sections.map((s) => `${s.title}: ${f(s.total)} (prior year-end ${f(s.prior)})`).join("\n");
    case "cash": return `Closing cash ${f(snap.cash.closing)}; net movement in month ${f(snap.cash.net)}; ${snap.cash.activities.map((a) => `${a.title} ${f(a.total)}`).join(", ")}; trend outlook ${snap.cash.outlook.map(f).join(", ")}.`;
    case "bva": return (snap.bva?.variances || []).map((v) => `${v.headline} Actions: ${v.actions.join(" ")}`).join("\n") || "No budget selected.";
    case "controls": return `Open findings by severity: ${JSON.stringify(snap.controls.bySeverity)}. Top: ${snap.controls.top.map((t) => t.title).join("; ")}`;
    case "close": return `${snap.close.done}/${snap.close.total} close tasks done, ${snap.close.overdue} overdue.`;
    case "tax": return `${snap.tax.openItems} open VAT reconciliation items. Recent runs: ${snap.tax.runs.map((r) => `${r.kind} ${r.period} ${JSON.stringify(r.stats)}`).join("; ")}`;
    case "risks": return snap.risks.join("\n");
    default: return "";
  }
}
