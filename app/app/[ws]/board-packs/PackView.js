// Renders a board pack from its frozen snapshot. Used by the editor (with commentary editors)
// and by the print view (static commentary). Server component.
import { LineChart, BarChart, Waterfall, KpiTile } from "@/components/charts";
import { fmtFull } from "@/components/charts/format";
import { SECTIONS } from "@/lib/boardpack/build";
import CommentaryEditor from "./CommentaryEditor";

const mLabel = (ym) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const longMonth = (ym) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const pctTxt = (a, b) => (b ? `${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%` : "—");
const SUMMARY_KPIS = ["revenue", "gross_margin", "ebitda", "net_profit", "cash", "runway", "current_ratio", "dso"];

function Comment({ k, pack, editable, slug, aiOn }) {
  const c = pack.commentary[k];
  if (editable) return <CommentaryEditor slug={slug} packId={pack.id} sectionKey={k} initial={c || null} version={pack.version} aiOn={aiOn} />;
  if (!c?.text) return null;
  return <div className="bp-commentary" style={{ marginTop: ".8rem" }}>{c.ai && <span className="bp-ai">AI-assisted draft, reviewed by {c.by}</span>} {c.text}</div>;
}

function Head({ k, snap, n }) {
  const title = SECTIONS.find(([x]) => x === k)?.[1];
  return <div className="bp-section-head"><h2>{n}. {title}</h2><span className="faint small">{snap.company} · {longMonth(snap.period)}</span></div>;
}

export default function PackView({ pack, editable = false, slug, aiOn = false }) {
  const s = pack.snapshot;
  if (!s || s.empty) return <div className="card empty"><h3>No ledger data for this period</h3><p>Import ledger data, then refresh the numbers.</p></div>;
  const cur = s.currency;
  const sections = pack.sections.filter((k) => k !== "cover");
  const labels = s.months.map(mLabel);
  const kpi = Object.fromEntries(s.kpis.map((x) => [x.key, x]));
  const P = ({ k, children }) => { const n = sections.indexOf(k) + 1; return <section className="bp-page viz-root" id={`s-${k}`}><Head k={k} snap={s} n={n} />{children}<Comment k={k} pack={pack} editable={editable} slug={slug} aiOn={aiOn} /></section>; };
  const R = (label, m, py, ytd, bud) => <tr><td>{label}</td><td className="num">{fmtFull(m)}</td>{bud !== undefined && <td className="num">{fmtFull(bud)}</td>}<td className="num">{fmtFull(py)}</td><td className="num faint">{pctTxt(m, py)}</td><td className="num">{fmtFull(ytd)}</td></tr>;
  const bvaM = (c) => s.bva?.classes?.[c]?.month?.budget;
  return (
    <>
      {pack.sections.includes("cover") && <section className="bp-page bp-cover">
        <div className="eyebrow">Board of directors</div>
        <h1 style={{ marginTop: ".4rem" }}>{pack.title}</h1>
        <p className="lede muted">{s.company} · management accounts for {longMonth(s.period)}</p>
        <p className="small muted">Prepared {new Date(s.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}{pack.approved_by_name ? ` · approved by ${pack.approved_by_name}` : ""} · status: {pack.status.replace("_", " ").toLowerCase()} · amounts in {cur}</p>
        <ol className="small" style={{ marginTop: "2rem", columns: 2 }}>{sections.map((k) => <li key={k}>{SECTIONS.find(([x]) => x === k)?.[1]}</li>)}</ol>
        <Comment k="cover" pack={pack} editable={editable} slug={slug} aiOn={aiOn} />
      </section>}

      {sections.includes("summary") && <P k="summary">
        <div className="kpi-grid">{SUMMARY_KPIS.map((k) => kpi[k] && <KpiTile key={k} kpi={{ ...kpi[k], series: kpi[k].spark }} currency={cur} />)}</div>
        <div className="grid grid-2" style={{ marginTop: "1rem" }}>
          <LineChart title={`Revenue and net profit · ${cur}`} labels={labels} series={[{ label: "Revenue", values: s.series.revenue }, { label: "Net profit", values: s.series.netProfit }]} height={200} />
          <LineChart title={`Cash · ${cur}`} labels={[...labels, ...s.cash.outlookMonths.map(mLabel)]} series={[{ label: "Cash", values: [...s.series.cash, ...s.cash.outlook], area: true }]} forecastFrom={labels.length} height={200} />
        </div>
      </P>}

      {sections.includes("pl") && <P k="pl">
        <div className="table-wrap"><table>
          <thead><tr><th>{cur}</th><th className="num">{mLabel(s.period)}</th>{s.bva && <th className="num">Budget</th>}<th className="num">Same month LY</th><th className="num">vs LY</th><th className="num">Year to date</th></tr></thead>
          <tbody>
            {R("Revenue", s.pl.month.revenue, s.pl.priorYear.revenue, s.pl.ytd.revenue, s.bva ? bvaM("REVENUE") : undefined)}
            {R("Cost of sales", -s.pl.month.cogs, -s.pl.priorYear.cogs, -s.pl.ytd.cogs, s.bva ? -bvaM("COGS") : undefined)}
            {R("Gross profit", s.pl.month.grossProfit, s.pl.priorYear.grossProfit, s.pl.ytd.grossProfit, s.bva ? bvaM("REVENUE") - bvaM("COGS") : undefined)}
            {R("Operating expenses", -s.pl.month.opex, -s.pl.priorYear.opex, -s.pl.ytd.opex, s.bva ? -bvaM("EXPENSE") : undefined)}
            {R("Other income / (expense)", s.pl.month.other, s.pl.priorYear.other, s.pl.ytd.other, s.bva ? bvaM("OTHER_INCOME") : undefined)}
            <tr style={{ fontWeight: 700 }}><td>Net profit</td><td className="num">{fmtFull(s.pl.month.netProfit)}</td>{s.bva && <td className="num">{fmtFull(s.bva.netProfit.month.budget)}</td>}<td className="num">{fmtFull(s.pl.priorYear.netProfit)}</td><td className="num faint">{pctTxt(s.pl.month.netProfit, s.pl.priorYear.netProfit)}</td><td className="num">{fmtFull(s.pl.ytd.netProfit)}</td></tr>
            <tr><td className="faint">Gross margin / net margin</td><td className="num faint">{s.pl.month.grossMargin ?? "—"}% / {s.pl.month.netMargin ?? "—"}%</td>{s.bva && <td />}<td className="num faint">{s.pl.priorYear.grossMargin ?? "—"}% / {s.pl.priorYear.netMargin ?? "—"}%</td><td /><td className="num faint">{s.pl.ytd.grossMargin ?? "—"}% / {s.pl.ytd.netMargin ?? "—"}%</td></tr>
          </tbody>
        </table></div>
        {s.bva && <div style={{ marginTop: "1rem" }}><Waterfall title={`Profit vs budget, year to date · ${cur}`} steps={[
          { label: "Budget profit", value: s.bva.netProfit.ytd.budget, total: true },
          { label: "Revenue", value: s.bva.classes.REVENUE.ytd.actual - s.bva.classes.REVENUE.ytd.budget },
          { label: "Cost of sales", value: -(s.bva.classes.COGS.ytd.actual - s.bva.classes.COGS.ytd.budget) },
          { label: "Operating exp.", value: -(s.bva.classes.EXPENSE.ytd.actual - s.bva.classes.EXPENSE.ytd.budget) },
          { label: "Other income", value: s.bva.classes.OTHER_INCOME.ytd.actual - s.bva.classes.OTHER_INCOME.ytd.budget },
          { label: "Actual profit", value: s.bva.netProfit.ytd.actual, total: true }]} height={210} /></div>}
        <div className="grid grid-2" style={{ marginTop: "1rem" }}>
          <div><h3>Largest revenue lines</h3><table className="small"><tbody>{s.pl.month.topRevenue.map((l) => <tr key={l.code}><td>{l.code} {l.name}</td><td className="num">{fmtFull(l.amount)}</td></tr>)}</tbody></table></div>
          <div><h3>Largest cost lines</h3><table className="small"><tbody>{s.pl.month.topExpenses.map((l) => <tr key={l.code}><td>{l.code} {l.name}</td><td className="num">{fmtFull(l.amount)}</td></tr>)}</tbody></table></div>
        </div>
      </P>}

      {sections.includes("bs") && <P k="bs">
        <div className="table-wrap"><table>
          <thead><tr><th>{cur}</th><th className="num">{s.bs.asAt}</th><th className="num">{s.bs.priorAsAt}</th><th className="num">Change</th></tr></thead>
          <tbody>{s.bs.sections.map((sec) => [
            <tr key={sec.key} style={{ fontWeight: 600 }}><td>{sec.title}</td><td className="num">{fmtFull(sec.total)}</td><td className="num">{fmtFull(sec.prior)}</td><td className="num">{fmtFull(sec.total - sec.prior)}</td></tr>,
            ...sec.lines.slice(0, 6).map((l) => <tr key={sec.key + l.code + l.name} className="small"><td style={{ paddingLeft: "1.2rem" }}>{l.code} {l.name}</td><td className="num">{fmtFull(l.amount)}</td><td /><td /></tr>),
          ])}
            <tr style={{ fontWeight: 700 }}><td>Total assets</td><td className="num">{fmtFull(s.bs.totalAssets)}</td><td className="num">{fmtFull(s.bs.priorTotals.assets)}</td><td className="num">{fmtFull(s.bs.totalAssets - s.bs.priorTotals.assets)}</td></tr>
            <tr style={{ fontWeight: 700 }}><td>Total liabilities + equity</td><td className="num">{fmtFull(s.bs.totalLiabilities + s.bs.totalEquity)}</td><td className="num">{fmtFull(s.bs.priorTotals.liabilities + s.bs.priorTotals.equity)}</td><td /></tr>
          </tbody>
        </table></div>
        {s.bs.difference !== 0 && <div className="alert warn" style={{ marginTop: ".6rem" }}>The balance sheet doesn&apos;t balance by {cur} {fmtFull(s.bs.difference)} — check unmapped or suspense accounts before issuing.</div>}
      </P>}

      {sections.includes("cash") && <P k="cash">
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <div><table>
            <thead><tr><th>Cash flow in {mLabel(s.period)} · {cur}</th><th className="num">Amount</th></tr></thead>
            <tbody>{s.cash.activities.map((a) => [
              <tr key={a.title} style={{ fontWeight: 600 }}><td>{a.title}</td><td className="num">{fmtFull(a.total)}</td></tr>,
              ...a.lines.map((l) => <tr key={a.title + l.key} className="small"><td style={{ paddingLeft: "1rem" }}>{l.label}</td><td className="num">{fmtFull(l.amount)}</td></tr>)])}
              <tr style={{ fontWeight: 700 }}><td>Net cash flow</td><td className="num">{fmtFull(s.cash.net)}</td></tr>
              <tr style={{ fontWeight: 700 }}><td>Closing cash</td><td className="num">{fmtFull(s.cash.closing)}</td></tr></tbody>
          </table></div>
          <LineChart title={`Cash outlook · ${cur}`} subtitle="Month-end cash and a 3-month trend continuation (dashed). See the 13-week and 12-month forecasts for scenarios." labels={[...labels.slice(-6), ...s.cash.outlookMonths.map(mLabel)]} series={[{ label: "Cash", values: [...s.series.cash.slice(-6), ...s.cash.outlook], area: true }]} forecastFrom={Math.min(6, labels.length)} refLine={{ value: 0, label: "Zero" }} zeroLine={false} height={210} />
        </div>
      </P>}

      {sections.includes("kpis") && <P k="kpis">
        <div className="grid grid-2">
          <LineChart title="Margins (%)" unit="pct" labels={labels} series={[{ label: "Gross margin", values: s.series.grossMargin }]} height={190} />
          <BarChart title={`EBITDA · ${cur}`} labels={labels} series={[{ label: "EBITDA", values: s.series.ebitda }]} height={190} />
        </div>
        <table className="small" style={{ marginTop: "1rem" }}><thead><tr><th>KPI</th><th className="num">Value</th><th>Status</th><th>Definition</th></tr></thead>
          <tbody>{s.kpis.map((k) => <tr key={k.key}><td>{k.label}</td><td className="num">{k.unit === "money" ? fmtFull(k.value) : k.value === null ? "—" : `${k.value}${k.unit === "pct" ? "%" : k.unit === "x" ? "×" : k.unit === "days" ? " days" : k.unit === "months" ? " months" : ""}`}</td><td>{k.status ? <span className={`badge ${k.status}`}>{k.status === "good" ? "On track" : k.status === "warn" ? "Watch" : "Action"}</span> : ""}</td><td className="wrap faint">{k.definition}</td></tr>)}</tbody></table>
      </P>}

      {sections.includes("bva") && <P k="bva">
        {!s.bva ? <p className="muted">No budget was selected for this pack.</p> : <>
          <p className="small muted">Budget: {s.bva.budgetName} ({s.bva.status.toLowerCase()}). Material variances (≥10% and ≥ {cur} 50,000), largest first, with the system&apos;s classification and agreed actions.</p>
          {s.bva.variances.length === 0 && <p>No material variances this month.</p>}
          {s.bva.variances.map((v) => <div key={v.code} className={`explain ${v.month.favourable ? "fav" : "adv"}`}>
            <strong>{v.code} {v.name}</strong> — actual {fmtFull(v.month.actual)} vs budget {fmtFull(v.month.budget)} ({v.month.favourable ? "favourable" : "adverse"} {fmtFull(v.month.variance)}; YTD {fmtFull(v.ytd.variance)})
            <div className="small muted">{v.types.join(" · ")}</div>
            {v.notes.length > 0 ? v.notes.map((n, i) => <div key={i} className="small"><strong>Explanation:</strong> {n.note}{n.action && <> · <strong>Action:</strong> {n.action}{n.owner_name ? ` (${n.owner_name})` : ""}</>}</div>) : <div className="small"><strong>Suggested action:</strong> {v.actions[0]}</div>}
          </div>)}
          <p className="small"><strong>Full-year landing:</strong> net profit {fmtFull(s.bva.netProfit.fy.landing)} vs budget {fmtFull(s.bva.netProfit.fy.budget)} ({fmtFull(s.bva.netProfit.fy.landing - s.bva.netProfit.fy.budget)}).</p>
        </>}
      </P>}

      {sections.includes("close") && <P k="close">
        <p><strong>{s.close.done} of {s.close.total}</strong> close tasks complete for {longMonth(s.period)}{s.close.overdue ? <>, <span style={{ color: "var(--bad)" }}>{s.close.overdue} overdue</span></> : ""}.</p>
        {s.close.total > 0 && <div className="progress"><span style={{ width: `${(s.close.done / s.close.total) * 100}%` }} /></div>}
        <table className="small" style={{ marginTop: ".8rem" }}><thead><tr><th>Area</th><th className="num">Done</th><th className="num">Total</th><th className="num">Overdue</th></tr></thead><tbody>{s.close.categories.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{c.done || 0}</td><td className="num">{c.n}</td><td className="num">{c.overdue || 0}</td></tr>)}</tbody></table>
      </P>}

      {sections.includes("controls") && <P k="controls">
        <div className="grid grid-4">{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((sv) => <div key={sv} className="card stat"><div className="label">{sv.toLowerCase()} findings open</div><div className="value">{s.controls.bySeverity[sv]?.n || 0}</div></div>)}</div>
        <p className="small" style={{ marginTop: ".6rem" }}>Open bank reconciliation exceptions: {s.controls.reconExceptions} · open auditor queries: {s.controls.openQueries}</p>
        {s.controls.top.length > 0 && <table className="small"><thead><tr><th>Finding</th><th>Severity</th><th className="num">Amount</th><th>Suggested correction</th></tr></thead><tbody>{s.controls.top.map((f, i) => <tr key={i}><td className="wrap">{f.title}{f.journal_no ? ` (${f.journal_no})` : ""}</td><td>{f.severity}</td><td className="num">{fmtFull(f.amount_cents)}</td><td className="wrap faint">{f.suggestion}</td></tr>)}</tbody></table>}
      </P>}

      {sections.includes("tax") && <P k="tax">
        <p>Open VAT reconciliation items (iTax/eTIMS vs ERP): <strong>{s.tax.openItems}</strong>{s.tax.openAmount ? ` · total difference ${cur} ${fmtFull(s.tax.openAmount)}` : ""}.</p>
        {s.tax.runs.length ? <table className="small"><thead><tr><th>Reconciliation</th><th>Period</th><th>Results</th></tr></thead><tbody>{s.tax.runs.map((r, i) => <tr key={i}><td>{r.kind}</td><td>{r.period}</td><td className="wrap faint">{Object.entries(r.stats).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k}: ${v}`).join(" · ")}</td></tr>)}</tbody></table> : <p className="muted small">No VAT reconciliations have been run yet.</p>}
        <p className="faint small">VAT returns are due by the 20th of the following month; PAYE by the 9th. Input VAT must be claimed within six months of the end of the period of supply, and only on invoices transmitted through eTIMS.</p>
      </P>}

      {sections.includes("risks") && <P k="risks">
        {s.risks.length ? <ul>{s.risks.map((r, i) => <li key={i}>{r}</li>)}</ul> : <p className="muted">No automatic risk flags this month.</p>}
        <p className="faint small">Automatic flags from controls and KPIs. Use the commentary to set out the decisions the board is asked to take.</p>
      </P>}
    </>
  );
}
