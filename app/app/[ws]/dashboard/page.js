import Link from "next/link";
import { agentHref } from "@/lib/ai/deep-links";
import "@/styles/planning.css";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import { Empty } from "@/components/Statement";
import { LineChart, BarChart, StackedBars, KpiTile } from "@/components/charts";
import { fmtFull } from "@/components/charts/format";
import { buildSeries, computeKpis, topMovers, projectLinear, addMonths } from "@/lib/kpi";
import { loadKpiInputs, latestAging } from "@/lib/budget/data";
import { loadAlerts } from "@/lib/boardpack/alerts";
import { CLASSES } from "@/lib/statements";
import { formatDate } from "@/lib/dates";
export const metadata = { title: "CFO dashboard" };
export const dynamic = "force-dynamic";

const mLabel = (ym) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const HEADLINE = ["revenue", "gross_margin", "ebitda", "net_profit", "cash", "runway", "current_ratio", "dso"];
const GROUPS = [
  ["Profitability", ["revenue_growth", "revenue_yoy", "ebitda_margin", "net_margin", "opex_ratio", "payroll_pct"]],
  ["Liquidity & working capital", ["working_capital", "quick_ratio", "burn", "dpo", "dio", "ccc"]],
  ["Leverage", ["debt_equity"]],
];

export default async function Dashboard({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const base = `/app/${ws.slug}`;
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || "") ? searchParams.month : null;
  const span = [12, 24].includes(+searchParams.span) ? +searchParams.span : 12;
  const inputs = await loadKpiInputs(ws.id, month, 24);
  if (!inputs) return <Empty base={base} title="CFO dashboard" />;
  const [aging, alerts] = await Promise.all([latestAging(ws.id), loadAlerts(ws.id)]);
  const series = buildSeries(inputs);
  const { months } = inputs;
  const kpis = Object.fromEntries(computeKpis(series, months, { aging: inputs.aging }).map((k) => [k.key, k]));
  const movers = topMovers(inputs, { limit: 8 });
  const show = Math.min(span, months.length);
  const cut = (arr) => arr.slice(-show);
  const labels = cut(months).map(mLabel);
  const ahead = 3;
  const cashProj = projectLinear(series.cash, ahead);
  const cashLabels = [...labels, ...Array.from({ length: ahead }, (_, i) => mLabel(addMonths(inputs.end, i + 1)))];
  const cur = ws.currency;
  const pickMonths = Array.from({ length: Math.min(24, months.length) }, (_, i) => months[months.length - 1 - i]);
  const st = (k) => kpis[k];
  return (
    <>
      <PageHead title="CFO dashboard" desc={`${ws.name} · month ending ${formatDate(`${inputs.end}-01`).replace(/^1 /, "")} · built live from the ledger`}>
        <form className="row no-print">
          <select name="month" defaultValue={inputs.end} style={{ width: "auto" }} aria-label="Month">{pickMonths.map((m) => <option key={m} value={m}>{mLabel(m)}</option>)}</select>
          <select name="span" defaultValue={String(span)} style={{ width: "auto" }} aria-label="Trend length"><option value="12">12-month trend</option><option value="24">24-month trend</option></select>
          <button className="btn">Update</button>
          <Link className="btn primary" href={`${base}/board-packs`}>Board pack</Link>
          <Link className="btn ghost ai-ask-link" href={agentHref(ws.slug, "cfo-reporting", { period: inputs.end })}>Ask CFO Reporting</Link>
        </form>
      </PageHead>

      {alerts.list.length > 0 && <div className="card" style={{ marginBottom: "1rem" }}>
        <ul className="alert-list">{alerts.list.map((a) => <li key={a.text}><span className={`badge ${a.level}`}>{a.level === "bad" ? "Action" : "Review"}</span><Link href={base + a.href}>{a.text}</Link></li>)}</ul>
      </div>}

      <div className="kpi-grid" style={{ marginBottom: "1rem" }}>
        {HEADLINE.map((k) => <KpiTile key={k} kpi={st(k)} currency={cur} href={k === "cash" ? `${base}/statements/cash` : k === "revenue" || k.includes("margin") || k === "ebitda" || k === "net_profit" ? `${base}/statements/income-statement` : undefined} />)}
      </div>

      <div className="grid grid-2" style={{ marginBottom: "1rem", alignItems: "start" }}>
        <LineChart title={`Revenue, expenses and net profit · ${cur}`} subtitle="Monthly, from the ledger" labels={labels}
          series={[{ label: "Revenue", values: cut(series.revenue) }, { label: "Total expenses", values: cut(series.expenses) }, { label: "Net profit", values: cut(series.netProfit) }]} />
        <LineChart title={`Cash balance · ${cur}`} subtitle={`Month-end cash with a ${ahead}-month trend continuation (dashed)`} labels={cashLabels}
          series={[{ label: "Cash", values: [...cut(series.cash), ...cashProj], area: true }]} forecastFrom={labels.length} refLine={{ value: 0, label: "Zero cash" }} zeroLine={false} />
      </div>
      <div className="grid grid-2" style={{ marginBottom: "1rem", alignItems: "start" }}>
        <LineChart title="Margins" subtitle="Gross, EBITDA and net margin, % of revenue" unit="pct" labels={labels}
          series={[{ label: "Gross margin", values: cut(st("gross_margin").series) }, { label: "EBITDA margin", values: cut(st("ebitda_margin").series) }, { label: "Net margin", values: cut(st("net_margin").series) }]} />
        <BarChart title={`Working capital components · ${cur}`} subtitle="Month-end balances" labels={labels.slice(-6)}
          series={[{ label: "Receivables", values: cut(series.receivables).slice(-6) }, { label: "Inventory", values: cut(series.inventory).slice(-6) }, { label: "Payables", values: cut(series.payables).slice(-6) }]} />
      </div>

      {GROUPS.map(([title, keys]) => (
        <div key={title} style={{ marginBottom: "1rem" }}>
          <h3>{title}</h3>
          <div className="kpi-grid">{keys.map((k) => <KpiTile key={k} kpi={st(k)} currency={cur} />)}</div>
        </div>
      ))}

      <div className="grid grid-2" style={{ alignItems: "start", marginBottom: "1rem" }}>
        {aging.AR || aging.AP ? (
          <StackedBars title={`Receivables & payables ageing · ${cur}`} subtitle={`Latest ageing upload${aging.AR ? ` · AR as at ${aging.AR.as_at}` : ""}${aging.AP ? ` · AP as at ${aging.AP.as_at}` : ""}`}
            partLabels={["Current", "31–60 days", "61–90 days", "Over 90 days"]}
            rows={[aging.AR && { label: "Receivables", parts: [aging.AR.cur, aging.AR.d30, aging.AR.d60, aging.AR.d90] }, aging.AP && { label: "Payables", parts: [aging.AP.cur, aging.AP.d30, aging.AP.d60, aging.AP.d90] }].filter(Boolean)} />
        ) : (
          <div className="card"><h3>Receivables & payables ageing</h3><p className="muted small">Upload an AR or AP ageing report in the <Link href={`${base}/data?kind=ar_aging`}>Data hub</Link> to see ageing buckets here and use it for DSO/DPO.</p></div>
        )}
        <div className="card">
          <h3>Top movers this month</h3>
          <p className="muted small" style={{ marginTop: "-.3rem" }}>Income-statement accounts with the biggest change vs last month.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Account</th><th className="num">This month</th><th className="num">Last month</th><th className="num">Change</th></tr></thead>
            <tbody>{movers.map((m) => (
              <tr key={m.code}><td className="wrap"><Link href={`${base}/ledger?account=${encodeURIComponent(m.code)}&from=${inputs.end}-01&to=${inputs.end}-31`}>{m.code} {m.name}</Link><div className="faint small">{CLASSES[m.cls]}</div></td>
                <td className="num">{fmtFull(m.current)}</td><td className="num">{fmtFull(m.prior)}</td>
                <td className="num">{fmtFull(m.change)}{m.changePct !== null && <div className="faint small">{m.changePct > 0 ? "+" : ""}{m.changePct}%</div>}</td></tr>))}
              {!movers.length && <tr><td colSpan={4} className="empty">No movement.</td></tr>}</tbody>
          </table></div>
        </div>
      </div>

      <details className="card small">
        <summary><strong>KPI definitions</strong></summary>
        <dl style={{ columns: 2, columnGap: "2rem" }}>{Object.values(kpis).map((k) => <div key={k.key} style={{ breakInside: "avoid", marginBottom: ".5rem" }}><dt><strong>{k.label}</strong></dt><dd style={{ margin: 0 }} className="muted">{k.definition}</dd></div>)}</dl>
        <p className="faint">Status thresholds are general guides for growing businesses; compare against your own sector. Classifications come from the account mapping in Statements → Accounts.</p>
      </details>
    </>
  );
}
