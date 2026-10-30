import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import { StatementTable, Empty, fmt } from "@/components/Statement";
import { balanceSheet } from "@/lib/statements";
import { formatDate } from "@/lib/dates";
import { loadChart, balancesAt, ledgerRange, monthBounds, ISO_RE, shiftYears } from "@/lib/statements-data";
export const metadata = { title: "Balance sheet" };

const prevMonthEnd = (d) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10); };

export default async function BalanceSheetPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const sp = searchParams;
  const range = await ledgerRange(ws.id);
  const base = `/app/${ws.slug}`;
  if (!range.n) return <Empty base={base} title="Balance sheet" />;

  const asAt = ISO_RE.test(sp.asAt || "") ? sp.asAt : monthBounds(range.mx.slice(0, 7))[1];
  const compare = ["none", "month", "year", "custom"].includes(sp.compare) ? sp.compare : "month";
  const compareAt = compare === "month" ? prevMonthEnd(asAt) : compare === "year" ? shiftYears(asAt, -1) : compare === "custom" && ISO_RE.test(sp.compareAt || "") ? sp.compareAt : null;

  const { chart } = await loadChart(ws.id);
  const [b1, b2] = await Promise.all([balancesAt(ws.id, asAt), compareAt ? balancesAt(ws.id, compareAt) : null]);
  const cur = balanceSheet(chart, b1);
  const cmp = b2 ? balanceSheet(chart, b2) : null;

  const columns = [formatDate(asAt), ...(cmp ? [formatDate(compareAt)] : [])];
  const v = (a, b) => (cmp ? [a, b] : [a]);
  const href = (code) => `${base}/ledger?account=${encodeURIComponent(code)}&to=${asAt}`;
  const sectionRows = (key) => {
    const s1 = cur.sections.find((s) => s.key === key), s2 = cmp?.sections.find((s) => s.key === key);
    const codes = new Map();
    for (const l of [...s1.lines, ...(s2 ? s2.lines : [])]) codes.set(l.code || l.name, l);
    const find = (s, l) => s?.lines.find((x) => (x.code || x.name) === (l.code || l.name))?.amount || 0;
    const lines = [...codes.values()].map((l) => ({ type: "line", code: l.code, name: l.name, note: l.isCash ? "cash" : l.computed ? "from income statement" : "", href: l.code ? href(l.code) : null, values: v(find(s1, l), find(s2, l)) }));
    return { lines, total: v(s1.total, s2?.total) };
  };
  const S = Object.fromEntries(["CA", "NCA", "CL", "NCL", "EQ"].map((k) => [k, sectionRows(k)]));
  const rows = [
    { type: "head", label: "Assets" },
    ...(S.NCA.lines.length ? [{ type: "head", label: "Non-current assets" }, ...S.NCA.lines, { type: "total", label: "Total non-current assets", values: S.NCA.total }] : []),
    { type: "head", label: "Current assets" }, ...S.CA.lines, { type: "total", label: "Total current assets", values: S.CA.total },
    { type: "total", grand: true, label: "Total assets", values: v(cur.totalAssets, cmp?.totalAssets) },
    { type: "gap" },
    { type: "head", label: "Liabilities" },
    { type: "head", label: "Current liabilities" }, ...S.CL.lines, { type: "total", label: "Total current liabilities", values: S.CL.total },
    ...(S.NCL.lines.length ? [{ type: "head", label: "Non-current liabilities" }, ...S.NCL.lines, { type: "total", label: "Total non-current liabilities", values: S.NCL.total }] : []),
    { type: "total", label: "Total liabilities", values: v(cur.totalLiabilities, cmp?.totalLiabilities) },
    { type: "gap" },
    { type: "head", label: "Equity" }, ...S.EQ.lines, { type: "total", label: "Total equity", values: S.EQ.total },
    { type: "gap" },
    { type: "total", grand: true, label: "Total liabilities and equity", values: v(cur.totalLiabilities + cur.totalEquity, cmp ? cmp.totalLiabilities + cmp.totalEquity : null) },
  ];
  const netCurrent = cur.sections[0].total - cur.sections[2].total;
  return (
    <>
      <PageHead title="Balance sheet" desc={`${ws.name} · as at ${formatDate(asAt)} · built from the ledger`} />
      <form className="card filters no-print" style={{ marginBottom: "1rem" }}>
        <div className="form-row">
          <div><label>As at</label><input type="date" name="asAt" defaultValue={asAt} /></div>
          <div><label>Compare with</label><select name="compare" defaultValue={compare}><option value="month">Previous month end</option><option value="year">Same date last year</option><option value="custom">Custom date…</option><option value="none">No comparison</option></select></div>
          <div><label>Custom comparison date</label><input type="date" name="compareAt" defaultValue={compare === "custom" ? compareAt || "" : ""} /></div>
          <div className="row"><button className="btn primary">Update</button><Link href={`${base}/statements/balance-sheet`} className="btn ghost">Reset</Link></div>
        </div>
      </form>
      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        <div className="card stat"><div className="label">Total assets</div><div className="value">{fmt(cur.totalAssets)}</div></div>
        <div className="card stat"><div className="label">Net current assets</div><div className="value" style={{ color: netCurrent < 0 ? "var(--bad)" : undefined }}>{fmt(netCurrent)}</div></div>
        <div className="card stat"><div className="label">Current ratio</div><div className="value">{cur.sections[2].total ? (cur.sections[0].total / cur.sections[2].total).toFixed(2) : "—"}</div></div>
        <div className="card stat"><div className="label">Check</div><div className="value" style={{ fontSize: "1.2rem", marginTop: ".6rem" }}>{cur.difference === 0 ? <span className="badge good">Balanced</span> : <span className="badge bad">Out by {fmt(cur.difference)}</span>}</div></div>
      </div>
      {cur.difference !== 0 && <div className="alert warn">Assets don&apos;t equal liabilities plus equity by {fmt(cur.difference)} {ws.currency}. This usually means an imported journal doesn&apos;t balance — check the ledger import for one-sided entries.</div>}
      <StatementTable columns={columns} rows={rows} currency={ws.currency} />
      <p className="faint small" style={{ marginTop: "1rem" }}>Balances are cumulative from the first ledger entry ({formatDate(range.mn)}). If your import doesn&apos;t include opening balances, import an opening balance journal first. Account groupings follow the <Link href={`${base}/statements/accounts`}>account mapping</Link>. Click an account to see its entries.</p>
    </>
  );
}

