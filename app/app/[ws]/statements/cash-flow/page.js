import Link from "next/link";
import "@/styles/planning.css";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import { Empty } from "@/components/Statement";
import { classifyCashFlows } from "@/lib/statements";
import { weekStart, weekList, addDays, bucketFlows, defaultAnchor, normalizeSettings } from "@/lib/cashflow";
import { formatDate } from "@/lib/dates";
import { loadChart, balancesAt, entriesBetween, ledgerRange, ISO_RE } from "@/lib/statements-data";
import { monthRange, addMonths, roles } from "@/lib/kpi";
import { monthlyMovements, loadBudget, approvedBudgetFor, monthEnd } from "@/lib/budget/data";
import { fyMonths, PAYROLL_RE } from "@/lib/budget/engine";
import CashFlowForecast from "./CashFlowForecast";
import MonthlyForecast from "./MonthlyForecast";
export const metadata = { title: "Cash flow forecast" };
export const dynamic = "force-dynamic";

const HISTORY_WEEKS = 13; // loaded for the run-rate; the last 3 are shown as actuals
const HISTORY_MONTHS = 6;

export default async function CashFlowPage({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const base = `/app/${ws.slug}`;
  const range = await ledgerRange(ws.id);
  if (!range.n) return <Empty base={base} title="Cash flow forecast" />;
  const view = searchParams.view === "monthly" ? "monthly" : "weekly";
  const { chart } = await loadChart(ws.id);
  const cashCodes = [...chart.values()].filter((a) => a.isCash).map((a) => a.code);
  const saved = await db.get("SELECT f.settings, f.updated_at, f.version, u.name by_name FROM cash_forecasts f LEFT JOIN users u ON u.id = f.updated_by WHERE f.workspace_id = ?", [ws.id]);
  let settings = {};
  try { settings = normalizeSettings(saved ? JSON.parse(saved.settings) : {}); } catch { settings = normalizeSettings({}); }
  const version = saved?.version || 0;
  const Tabs = () => (
    <div className="tabs no-print" style={{ marginBottom: "1rem" }}>
      <Link href={`${base}/statements/cash-flow`} className={view === "weekly" ? "active" : ""}>13-week (weekly)</Link>
      <Link href={`${base}/statements/cash-flow?view=monthly`} className={view === "monthly" ? "active" : ""}>12-month (monthly)</Link>
    </div>
  );

  if (view === "monthly") {
    const lastYm = range.mx.slice(0, 7);
    const histMonths = monthRange(lastYm, HISTORY_MONTHS).filter((m) => m >= range.mn.slice(0, 7));
    const months = Array.from({ length: 12 }, (_, i) => addMonths(lastYm, i + 1));
    const [entries, cashBal, mov] = await Promise.all([
      entriesBetween(ws.id, `${histMonths[0]}-01`, monthEnd(lastYm)),
      balancesAt(ws.id, monthEnd(lastYm)),
      monthlyMovements(ws.id, histMonths[0], lastYm),
    ]);
    const flows = classifyCashFlows(entries, chart);
    const hist = {};
    for (const f of flows) { const i = histMonths.indexOf(f.date.slice(0, 7)); if (i < 0) continue; (hist[f.category] ||= new Array(histMonths.length).fill(0))[i] += f.amount; }
    const histRevenue = histMonths.map((ym) => [...chart.values()].filter((a) => a.cls === "REVENUE").reduce((s, a) => s - (mov.get(a.code)?.get(ym) || 0), 0));
    const histCogs = histMonths.map((ym) => [...chart.values()].filter((a) => a.cls === "COGS").reduce((s, a) => s + (mov.get(a.code)?.get(ym) || 0), 0));
    // Budget drivers from approved budget(s) covering the forecast months.
    const budget = { revenue: {}, cogs: {}, payroll: {}, opex: {} };
    const used = new Map();
    for (const ym of months) {
      const ref = await approvedBudgetFor(ws.id, ym);
      if (!ref) continue;
      if (!used.has(ref.id)) used.set(ref.id, await loadBudget(ws.id, ref.id));
      const { budget: b, lines } = used.get(ref.id);
      const idx = fyMonths(b.fy_start).indexOf(ym);
      let rev = 0, cogs = 0, pay = 0, opex = 0;
      for (const [code, row] of lines) {
        const a = chart.get(code) || { code, name: code, cls: "EXPENSE" };
        const v = row[idx] || 0;
        const r = roles(a);
        if (a.cls === "REVENUE") rev += v;
        else if (a.cls === "COGS") { if (PAYROLL_RE.test(a.name || "")) pay += v; else cogs += v; }
        else if (a.cls === "EXPENSE" && !r.da) { if (PAYROLL_RE.test(a.name || "")) pay += v; else if (!r.interest && !r.incomeTax) opex += v; }
      }
      budget.revenue[ym] = rev; budget.cogs[ym] = cogs; budget.payroll[ym] = pay; budget.opex[ym] = opex;
    }
    const model = { histMonths, hist, histRevenue, histCogs, openingCash: cashCodes.reduce((s, c) => s + (cashBal.get(c) || 0), 0), months, budget: used.size ? budget : null };
    const budgetName = [...used.values()].map((x) => x.budget.name).join(", ");
    return (
      <>
        <PageHead title="Cash flow forecast" desc={`${ws.name} · 12 months from ${formatDate(months[0] + "-01")} · opening cash at ${formatDate(range.mx)}`} />
        <Tabs />
        <MonthlyForecast key={lastYm} slug={ws.slug} model={model} initialSettings={settings} currency={ws.currency} canEdit={canEdit(ws.role)} version={version} budgetName={budgetName} />
      </>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const auto = defaultAnchor(range.mx, today);
  const anchor = ISO_RE.test(searchParams.start || "") ? weekStart(searchParams.start) : auto;
  const historyStart = addDays(anchor, -7 * HISTORY_WEEKS);
  const history = weekList(historyStart, HISTORY_WEEKS);
  const forecastWeeks = weekList(anchor, 13);
  const [entries, opening] = await Promise.all([
    entriesBetween(ws.id, historyStart, addDays(anchor, -1)),
    balancesAt(ws.id, addDays(historyStart, -1)),
  ]);
  const flows = classifyCashFlows(entries, chart);
  const model = {
    history,
    forecastWeeks,
    actuals: bucketFlows(flows, history),
    openingBeforeHistory: cashCodes.reduce((s, c) => s + (opening.get(c) || 0), 0),
  };
  const actualFrom = addDays(anchor, -21), actualTo = addDays(anchor, -1);
  const dataAfter = range.mx >= anchor;
  return (
    <>
      <PageHead title="13-week cash flow forecast" desc={`${ws.name} · 3 weeks of actuals (${formatDate(actualFrom)} – ${formatDate(actualTo)}) and 13 weeks forward from ${formatDate(anchor)}`} />
      <Tabs />
      <form className="card filters no-print" style={{ marginBottom: "1rem" }}>
        <div className="form-row">
          <div><label>First forecast week (any day — snaps to Monday)</label><input type="date" name="start" defaultValue={anchor} /></div>
          <div className="row"><button className="btn primary">Update</button>{anchor !== auto && <Link className="btn ghost" href={`${base}/statements/cash-flow`}>Back to default</Link>}</div>
          <div className="small muted" style={{ alignSelf: "center" }}>
            {cashCodes.length ? <>Cash accounts: {cashCodes.join(", ")} · <Link href={`${base}/statements/accounts`}>change</Link></> : <>No cash accounts found — <Link href={`${base}/statements/accounts`}>mark them in the account mapping</Link>.</>}
          </div>
        </div>
      </form>
      {anchor !== weekStart(today) && !searchParams.start && <div className="alert info">Your ledger runs to {formatDate(range.mx)}, so the forecast starts the week after the latest data rather than this week. Import newer ledger data to roll it forward, or pick another start week above.</div>}
      {dataAfter && <div className="alert warn">The ledger already has entries on or after {formatDate(anchor)} (up to {formatDate(range.mx)}). Those weeks are treated as forecast here — move the start week later to use them as actuals.</div>}
      <CashFlowForecast
        key={anchor}
        slug={ws.slug}
        model={model}
        initialSettings={settings}
        currency={ws.currency}
        canEdit={canEdit(ws.role)}
        savedInfo={saved ? { at: saved.updated_at, by: saved.by_name } : null}
        latestLedger={formatDate(range.mx)}
        version={version}
      />
      <p className="faint small" style={{ marginTop: "1.5rem" }}>Viewing as {user.name}. Saved assumptions are shared by everyone in this workspace and recorded in the audit log.</p>
    </>
  );
}
