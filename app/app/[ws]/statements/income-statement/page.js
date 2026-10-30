import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import { StatementTable, Empty, fmt } from "@/components/Statement";
import { incomeStatement } from "@/lib/statements";
import { formatDate } from "@/lib/dates";
import { loadChart, movements, ledgerRange, monthBounds, ISO_RE, previousPeriod, shiftYears } from "@/lib/statements-data";
export const metadata = { title: "Income statement" };

export default async function IncomeStatementPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const sp = searchParams;
  const base = `/app/${ws.slug}`;
  const range = await ledgerRange(ws.id);
  if (!range.n) return <Empty base={base} title="Income statement" />;

  const [ms, me] = monthBounds(range.mx.slice(0, 7));
  let from = ISO_RE.test(sp.from || "") ? sp.from : ms;
  let to = ISO_RE.test(sp.to || "") ? sp.to : me;
  if (from > to) [from, to] = [to, from];
  const compare = ["none", "prev", "year"].includes(sp.compare) ? sp.compare : "prev";
  const [cf, ct] = compare === "prev" ? previousPeriod(from, to) : compare === "year" ? [shiftYears(from, -1), shiftYears(to, -1)] : [null, null];

  const { chart } = await loadChart(ws.id);
  const [m1, m2] = await Promise.all([movements(ws.id, from, to), cf ? movements(ws.id, cf, ct) : null]);
  const a = incomeStatement(chart, m1);
  const b = m2 ? incomeStatement(chart, m2) : null;
  const v = (x, y) => (b ? [x, y] : [x]);
  const label = (f, t) => (f.slice(0, 7) === t.slice(0, 7) && f.endsWith("-01") && monthBounds(f.slice(0, 7))[1] === t ? new Date(f + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : `${formatDate(f)} – ${formatDate(t)}`);
  const columns = [label(from, to), ...(b ? [label(cf, ct)] : [])];
  const href = (code) => `${base}/ledger?account=${encodeURIComponent(code)}&from=${from}&to=${to}`;
  const section = (key) => {
    const map = new Map();
    for (const l of [...a[key].lines, ...(b ? b[key].lines : [])]) map.set(l.code, l);
    const amt = (s, code) => s?.[key].lines.find((x) => x.code === code)?.amount || 0;
    return [...map.values()].sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }))
      .map((l) => ({ type: "line", code: l.code, name: l.name, href: href(l.code), values: v(amt(a, l.code), amt(b, l.code)) }));
  };
  const rows = [
    { type: "head", label: "Revenue" }, ...section("revenue"), { type: "total", label: "Total revenue", values: v(a.revenue.total, b?.revenue.total) },
    { type: "head", label: "Cost of sales" }, ...section("cogs"), { type: "total", label: "Total cost of sales", values: v(a.cogs.total, b?.cogs.total) },
    { type: "total", grand: true, label: "Gross profit", values: v(a.grossProfit, b?.grossProfit) },
    { type: "gap" },
    { type: "head", label: "Operating expenses" }, ...section("opex"), { type: "total", label: "Total operating expenses", values: v(a.opex.total, b?.opex.total) },
    { type: "total", grand: true, label: "Operating profit", values: v(a.operatingProfit, b?.operatingProfit) },
    ...(a.other.lines.length || b?.other.lines.length ? [{ type: "gap" }, { type: "head", label: "Other income / (expenses)" }, ...section("other"), { type: "total", label: "Net other income", values: v(a.other.total, b?.other.total) }] : []),
    { type: "gap" },
    { type: "total", grand: true, label: "Net profit / (loss)", values: v(a.netProfit, b?.netProfit) },
  ];
  const ytdFrom = `${range.mx.slice(0, 4)}-01-01`;
  return (
    <>
      <PageHead title="Income statement" desc={`${ws.name} · ${formatDate(from)} – ${formatDate(to)} · built from the ledger`} />
      <form className="card filters no-print" style={{ marginBottom: "1rem" }}>
        <div className="form-row">
          <div><label>From</label><input type="date" name="from" defaultValue={from} /></div>
          <div><label>To</label><input type="date" name="to" defaultValue={to} /></div>
          <div><label>Compare with</label><select name="compare" defaultValue={compare}><option value="prev">Previous period</option><option value="year">Same period last year</option><option value="none">No comparison</option></select></div>
          <div className="row"><button className="btn primary">Update</button></div>
        </div>
        <div className="row small" style={{ marginTop: ".6rem" }}>
          <span className="faint">Quick:</span>
          <Link href={`?from=${ms}&to=${me}&compare=${compare}`}>Latest month</Link>
          <Link href={`?from=${ytdFrom}&to=${range.mx}&compare=year`}>Year to date</Link>
          <Link href={`?from=${range.mn}&to=${range.mx}&compare=none`}>All ledger data</Link>
        </div>
      </form>
      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        <div className="card stat"><div className="label">Revenue</div><div className="value">{fmt(a.revenue.total)}</div></div>
        <div className="card stat"><div className="label">Gross margin</div><div className="value">{a.grossMargin === null ? "—" : `${a.grossMargin}%`}</div></div>
        <div className="card stat"><div className="label">Net profit</div><div className="value" style={{ color: a.netProfit < 0 ? "var(--bad)" : "var(--good)" }}>{fmt(a.netProfit)}</div></div>
        <div className="card stat"><div className="label">Net margin</div><div className="value">{a.netMargin === null ? "—" : `${a.netMargin}%`}</div></div>
      </div>
      <StatementTable columns={columns} rows={rows} currency={ws.currency} />
      <p className="faint small" style={{ marginTop: "1rem" }}>Costs are shown as positive amounts; brackets mean a reduction. Account groupings follow the <Link href={`${base}/statements/accounts`}>account mapping</Link>. Click an account to see its entries for the period.</p>
    </>
  );
}
