import Link from "next/link";
import { notFound } from "next/navigation";
import "@/styles/planning.css";
import db from "@/lib/db";
import { requireWorkspace, can, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { Waterfall, BarChart } from "@/components/charts";
import { fmtFull } from "@/components/charts/format";
import { METHOD_LABELS, BUDGET_CLASSES, fyMonths } from "@/lib/budget/engine";
import { computeBva, explainAll } from "@/lib/budget/variance";
import { loadBudget, budgetActuals, budgetHistory, varianceContext } from "@/lib/budget/data";
import { loadChart } from "@/lib/statements-data";
import { formatDateTime, formatDate } from "@/lib/dates";
import BudgetStatus from "../BudgetStatus";
import BudgetGrid from "./BudgetGrid";
import ReforecastGrid from "./ReforecastGrid";
import { changeBudgetStatus, addBudgetNote, deleteBudget, copyBudget } from "../actions";
export const metadata = { title: "Budget" };
export const dynamic = "force-dynamic";

const mLabel = (ym) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const CLASS_LABEL = { REVENUE: "Revenue", COGS: "Cost of sales", EXPENSE: "Operating expenses", OTHER_INCOME: "Other income" };

export default async function BudgetPage({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const base = `/app/${ws.slug}`;
  const loaded = await loadBudget(ws.id, params.id);
  if (!loaded) notFound();
  const { budget: b, lines } = loaded;
  const tab = ["plan", "bva", "reforecast"].includes(searchParams.tab) ? searchParams.tab : "plan";
  const months = fyMonths(b.fy_start);
  const labels = months.map(mLabel);
  const { chart } = await loadChart(ws.id);
  // Budget lines can reference accounts that have no ledger activity yet.
  for (const code of lines.keys()) if (!chart.has(code)) chart.set(code, { code, name: code, cls: "EXPENSE" });
  const editable = b.status === "DRAFT" && canEdit(ws.role);
  const path = `${base}/budgets/${b.id}`;
  const H = ({ action, children, cls = "btn sm", confirm, note }) => (
    <form action={changeBudgetStatus} className="row" style={{ gap: ".4rem" }}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={b.id} /><input type="hidden" name="action" value={action} />{note && <input name="note" placeholder="Note (optional)" style={{ width: 180 }} />}<Submit className={cls} confirm={confirm}>{children}</Submit></form>
  );
  const Tab = ({ k, children }) => <Link href={`${path}?tab=${k}`} className={tab === k ? "active" : ""}>{children}</Link>;

  return (
    <>
      <PageHead title={b.name} crumbs={<Link href={`${base}/budgets`}>Budgets</Link>}
        desc={`${months[0]} → ${months[11]} · ${METHOD_LABELS[b.method] || b.method} · created by ${b.created_by_name}${b.approved_by_name ? ` · approved by ${b.approved_by_name} ${formatDateTime(b.approved_at)}` : ""}`}>
        <BudgetStatus status={b.status} />
      </PageHead>
      <Flash searchParams={searchParams} />
      <div className="row between no-print" style={{ marginBottom: "1rem" }}>
        <div className="tabs" style={{ marginBottom: 0 }}><Tab k="plan">Budget</Tab><Tab k="bva">Budget vs actual</Tab><Tab k="reforecast">Reforecast</Tab></div>
        <div className="row">
          {b.status === "DRAFT" && canEdit(ws.role) && <H action="submit" cls="btn sm primary">Submit for approval</H>}
          {b.status === "SUBMITTED" && can(ws.role, "approve") && <><H action="approve" cls="btn sm primary" confirm="Approve this budget? It will drive forecasts and board packs.">Approve</H><H action="reject" note>Return to draft</H></>}
          {b.status === "APPROVED" && can(ws.role, "approve") && <><H action="lock" confirm="Lock this budget? Only the owner can unlock it.">Lock</H><H action="reject" note>Return to draft</H></>}
          {b.status === "LOCKED" && can(ws.role, "owner") && <H action="unlock">Unlock</H>}
          {canEdit(ws.role) && <form action={copyBudget}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={b.id} /><Submit className="btn sm ghost">Copy</Submit></form>}
          {can(ws.role, "admin") && <form action={deleteBudget}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={b.id} /><Submit className="btn sm danger" confirm={`Delete “${b.name}” permanently?`}>Delete</Submit></form>}
        </div>
      </div>
      {b.status === "SUBMITTED" && <div className="alert info">Waiting for approval by an admin or the owner. The grid is read-only until it's approved or returned to draft.</div>}

      {tab === "plan" && <PlanTab ws={ws} b={b} lines={lines} chart={chart} labels={labels} editable={editable} />}
      {tab === "bva" && <BvaTab ws={ws} user={user} b={b} lines={lines} chart={chart} months={months} labels={labels} searchParams={searchParams} path={path} />}
      {tab === "reforecast" && <ReforecastTab ws={ws} user={user} b={b} lines={lines} chart={chart} months={months} labels={labels} />}
    </>
  );
}

async function PlanTab({ ws, b, lines, chart, labels, editable }) {
  const { history } = await budgetHistory(ws.id, b.fy_start);
  const prior = Object.fromEntries([...history].map(([code, arr]) => [code, arr.slice(-12).reduce((a, x) => a + x, 0)]));
  const accounts = [...lines.keys()].map((code) => chart.get(code)).filter(Boolean).map((a) => ({ code: a.code, name: a.name, cls: a.cls }))
    .sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
  const other = [...chart.values()].filter((a) => BUDGET_CLASSES.includes(a.cls) && !lines.has(a.code)).map((a) => ({ code: a.code, name: a.name, cls: a.cls }));
  return <BudgetGrid slug={ws.slug} budgetId={b.id} version={b.version} monthLabels={labels} accounts={accounts} lines={Object.fromEntries(lines)} prior={prior} editable={editable} otherAccounts={other} />;
}

async function ReforecastTab({ ws, user, b, lines, chart, labels }) {
  const { actuals, closedMonths } = await budgetActuals(ws.id, chart, b.fy_start);
  const codes = new Set([...lines.keys(), ...actuals.keys()]);
  const accounts = [...codes].map((c) => chart.get(c)).filter((a) => a && BUDGET_CLASSES.includes(a.cls)).map((a) => ({ code: a.code, name: a.name, cls: a.cls }));
  return <ReforecastGrid slug={ws.slug} budgetId={b.id} version={b.version} monthLabels={labels} accounts={accounts}
    budget={Object.fromEntries(lines)} actuals={Object.fromEntries(actuals)} closedMonths={closedMonths}
    initial={{ reforecast: b.assumptions.reforecast || {}, actualOverrides: b.assumptions.actualOverrides || {}, landingBasis: b.assumptions.landingBasis || "BUDGET" }}
    editable={canEdit(ws.role)} userName={user.name} />;
}

async function BvaTab({ ws, b, lines, chart, months, labels, searchParams, path }) {
  const { actuals, closedMonths } = await budgetActuals(ws.id, chart, b.fy_start);
  if (!closedMonths) return <div className="card empty"><h3>No actuals yet for this financial year</h3><p>Budget vs actual starts once the ledger has entries from {formatDate(months[0] + "-01")}.</p></div>;
  const picked = months.indexOf(searchParams.month);
  const monthIdx = picked >= 0 && picked < closedMonths ? picked : closedMonths - 1;
  const materiality = { pct: Math.max(0, +searchParams.mpct || 10), cents: Math.max(0, Math.round((+searchParams.mamt || 50000) * 100)) };
  const bva = computeBva({ chart, budget: lines, actuals, closedMonths, monthIdx, materiality, reforecast: b.assumptions.reforecast || {}, actualOverrides: b.assumptions.actualOverrides || {}, landingBasis: b.assumptions.landingBasis || "BUDGET" });
  const materialCodes = bva.rows.filter((r) => r.month.material || r.ytd.material).map((r) => r.code);
  const ctx = await varianceContext(ws.id, chart, materialCodes.slice(0, 60), months[monthIdx]);
  const explained = explainAll(bva, { ...ctx, materiality });
  const [notes, members] = await Promise.all([
    db.all("SELECT n.*, u.name by_name, o.name owner_name FROM budget_notes n LEFT JOIN users u ON u.id = n.created_by LEFT JOIN users o ON o.id = n.owner_id WHERE n.budget_id = ? ORDER BY n.created_at DESC", [b.id]),
    db.all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name", [ws.id]),
  ]);
  const ym = months[monthIdx];
  const np = bva.netProfit;
  const cv = (c, k) => { const x = bva.classes[c][k]; return k === "fy" ? x.landing - x.budget : x.actual - x.budget; };
  // YTD profit bridge: budget NP → class variances (profit effect) → actual NP.
  const bridge = [
    { label: "Budget profit (YTD)", value: np.ytd.budget, total: true },
    { label: "Revenue", value: cv("REVENUE", "ytd") },
    { label: "Cost of sales", value: -cv("COGS", "ytd") },
    { label: "Operating expenses", value: -cv("EXPENSE", "ytd") },
    { label: "Other income", value: cv("OTHER_INCOME", "ytd") },
    { label: "Actual profit (YTD)", value: np.ytd.actual, total: true },
  ];
  const canNote = canEdit(ws.role);
  return (
    <div className="stack">
      <form className="card row no-print" style={{ alignItems: "end" }}>
        <input type="hidden" name="tab" value="bva" />
        <div><label>Month</label><select name="month" defaultValue={ym} style={{ width: "auto" }}>{months.slice(0, closedMonths).map((m) => <option key={m} value={m}>{mLabel(m)}</option>)}</select></div>
        <div><label>Materiality %</label><input type="number" name="mpct" defaultValue={materiality.pct} style={{ width: 90 }} /></div>
        <div><label>and at least ({ws.currency})</label><input type="number" name="mamt" defaultValue={materiality.cents / 100} style={{ width: 130 }} /></div>
        <button className="btn">Update</button>
      </form>
      <div className="grid grid-4">
        <div className="card stat"><div className="label">Net profit — {mLabel(ym)}</div><div className="value">{fmtFull(np.month.actual)}</div><div className="small muted">budget {fmtFull(np.month.budget)} · <span style={{ color: np.month.actual >= np.month.budget ? "var(--good)" : "var(--bad)" }}>{fmtFull(np.month.actual - np.month.budget)}</span></div></div>
        <div className="card stat"><div className="label">Net profit — year to date</div><div className="value">{fmtFull(np.ytd.actual)}</div><div className="small muted">budget {fmtFull(np.ytd.budget)} · <span style={{ color: np.ytd.actual >= np.ytd.budget ? "var(--good)" : "var(--bad)" }}>{fmtFull(np.ytd.actual - np.ytd.budget)}</span></div></div>
        <div className="card stat"><div className="label">Full-year landing</div><div className="value">{fmtFull(np.fy.landing)}</div><div className="small muted">budget {fmtFull(np.fy.budget)} · <Link href={`${path}?tab=reforecast`}>reforecast</Link></div></div>
        <div className="card stat"><div className="label">Material variances</div><div className="value" style={{ color: explained.length ? "var(--warn)" : "var(--good)" }}>{explained.length}</div><div className="small muted">≥{materiality.pct}% and ≥{ws.currency} {(materiality.cents / 100).toLocaleString("en-KE")}</div></div>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Waterfall title={`Profit bridge, year to date · ${ws.currency}`} subtitle="How each part of the P&L moved profit away from budget" steps={bridge} />
        <BarChart title={`Revenue: budget vs actual · ${ws.currency}`} labels={labels.slice(0, closedMonths)} series={[{ label: "Budget", values: bva.classes.REVENUE.budgetByMonth.slice(0, closedMonths) }, { label: "Actual", values: bva.classes.REVENUE.actualByMonth.slice(0, closedMonths) }]} />
      </div>

      <h2>Variance explanations — {mLabel(ym)}</h2>
      {explained.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No material variances at this threshold.</p></div>}
      {explained.map((e) => {
        const r = e.row, accNotes = notes.filter((n) => n.account_code === r.code && n.period === ym);
        return (
          <div key={r.code} className={`card explain ${r.month.favourable ? "fav" : "adv"}`}>
            <div className="row between" style={{ alignItems: "flex-start" }}>
              <div><strong>{r.code} {r.name}</strong> <span className="faint small">· {CLASS_LABEL[r.cls]}</span>
                <div className="small muted">Month: actual {fmtFull(r.month.actual)} vs budget {fmtFull(r.month.budget)} → <span className={`var-badge ${r.month.favourable ? "fav" : "adv"}`}>{fmtFull(r.month.variance)} {r.month.favourable ? "favourable" : "adverse"}</span> · YTD {fmtFull(r.ytd.variance)}{r.ytd.pct !== null ? ` (${r.ytd.pct > 0 ? "+" : ""}${r.ytd.pct}%)` : ""} · full-year landing {fmtFull(r.fy.landing)} vs {fmtFull(r.fy.budget)}</div></div>
              <div className="row" style={{ gap: ".3rem" }}>{e.types.map((t) => <span key={t.key} className="badge info" title={t.detail}>{t.label}</span>)}</div>
            </div>
            <ul className="small" style={{ margin: ".5rem 0" }}>{e.types.map((t) => <li key={t.key}>{t.detail}</li>)}</ul>
            {e.priceVolume && <p className="small muted">Price/volume vs the 3-month base: volume effect {fmtFull(e.priceVolume.volume)} ({e.priceVolume.count} vs {e.priceVolume.baseCount} transactions), price effect {fmtFull(e.priceVolume.price)}.</p>}
            <div className="small"><strong>Suggested actions</strong><ol style={{ margin: ".2rem 0 .6rem", paddingLeft: "1.2rem" }}>{e.actions.map((a) => <li key={a}>{a}</li>)}</ol></div>
            {e.drivers.length > 0 && <details className="small"><summary>Top transactions driving this account in {mLabel(ym)}</summary>
              <div className="table-wrap" style={{ marginTop: 6 }}><table><thead><tr><th>Date</th><th>Journal</th><th>Description</th><th>Counterparty</th><th className="num">Amount</th></tr></thead>
                <tbody>{e.drivers.map((t) => <tr key={t.id}><td>{t.date}</td><td>{t.journalNo || t.reference || "—"}</td><td className="wrap">{t.description}</td><td>{t.counterparty || "—"}</td><td className="num">{fmtFull(t.amount)}</td></tr>)}</tbody></table></div>
              <Link href={`/app/${ws.slug}/ledger?account=${encodeURIComponent(r.code)}&from=${ym}-01&to=${ym}-31`}>Open in ledger →</Link></details>}
            {accNotes.map((n) => <div key={n.id} className="panel small" style={{ marginTop: ".5rem" }}><strong>{n.by_name}</strong> · {formatDateTime(n.created_at)}<div>{n.note}</div>{n.action && <div><span className="badge warn">Action</span> {n.action}{n.owner_name ? ` — owner: ${n.owner_name}` : ""}</div>}</div>)}
            {canNote && <form action={addBudgetNote} className="row no-print" style={{ marginTop: ".6rem", alignItems: "end" }}>
              <input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={b.id} /><input type="hidden" name="account_code" value={r.code} /><input type="hidden" name="period" value={ym} />
              <div style={{ flex: 2, minWidth: 200 }}><label>Explanation</label><input name="note" required maxLength={2000} placeholder="What happened?" /></div>
              <div style={{ flex: 2, minWidth: 180 }}><label>Action point</label><input name="action" maxLength={500} defaultValue={e.actions[0] || ""} /></div>
              <div style={{ flex: 1, minWidth: 140 }}><label>Owner</label><select name="owner_id" defaultValue=""><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
              <Submit className="btn sm">Save</Submit>
            </form>}
          </div>);
      })}

      <h2>All accounts</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Account</th><th className="num">Budget {mLabel(ym)}</th><th className="num">Actual</th><th className="num">Variance</th><th className="num">%</th><th className="num">YTD budget</th><th className="num">YTD actual</th><th className="num">YTD variance</th><th className="num">FY landing</th></tr></thead>
        <tbody>{BUDGET_CLASSES.map((c) => {
          const rows = bva.rows.filter((r) => r.cls === c);
          if (!rows.length) return null;
          const k = bva.classes[c];
          return [
            <tr key={c} className="head"><td colSpan={9}><strong>{CLASS_LABEL[c]}</strong></td></tr>,
            ...rows.map((r) => <tr key={r.code} style={r.month.material ? { fontWeight: 600 } : undefined}><td className="wrap">{r.code} {r.name}</td><td className="num">{fmtFull(r.month.budget)}</td><td className="num">{fmtFull(r.month.actual)}{r.overridden[monthIdx] ? " *" : ""}</td>
              <td className="num"><span className={r.month.favourable ? "fav" : "adv"} style={{ color: r.month.variance === 0 ? undefined : r.month.favourable ? "var(--good)" : "var(--bad)" }}>{fmtFull(r.month.variance)}</span></td><td className="num faint">{r.month.pct === null ? "" : `${r.month.pct}%`}</td>
              <td className="num">{fmtFull(r.ytd.budget)}</td><td className="num">{fmtFull(r.ytd.actual)}</td><td className="num" style={{ color: r.ytd.variance === 0 ? undefined : r.ytd.favourable ? "var(--good)" : "var(--bad)" }}>{fmtFull(r.ytd.variance)}</td><td className="num">{fmtFull(r.fy.landing)}</td></tr>),
            <tr key={c + "t"} style={{ fontWeight: 600 }}><td>Total {CLASS_LABEL[c].toLowerCase()}</td><td className="num">{fmtFull(k.month.budget)}</td><td className="num">{fmtFull(k.month.actual)}</td><td className="num">{fmtFull(k.month.actual - k.month.budget)}</td><td /><td className="num">{fmtFull(k.ytd.budget)}</td><td className="num">{fmtFull(k.ytd.actual)}</td><td className="num">{fmtFull(k.ytd.actual - k.ytd.budget)}</td><td className="num">{fmtFull(k.fy.landing)}</td></tr>,
          ];
        })}
          <tr style={{ fontWeight: 700 }}><td>Net profit</td><td className="num">{fmtFull(np.month.budget)}</td><td className="num">{fmtFull(np.month.actual)}</td><td className="num">{fmtFull(np.month.actual - np.month.budget)}</td><td /><td className="num">{fmtFull(np.ytd.budget)}</td><td className="num">{fmtFull(np.ytd.actual)}</td><td className="num">{fmtFull(np.ytd.actual - np.ytd.budget)}</td><td className="num">{fmtFull(np.fy.landing)}</td></tr>
        </tbody>
      </table></div>
      <p className="faint small">Green = favourable (income above budget or costs below). * = actual corrected in the reforecast (with a note). Amounts in {ws.currency}, natural sign.</p>
    </div>
  );
}
