import Link from "next/link";
import PageHead from "./PageHead";

/** Accounting number format: 1,234.00 / (1,234.00) / – */
export function fmt(cents, { dash = true } = {}) {
  if (cents === null || cents === undefined) return "";
  if (cents === 0 && dash) return "–";
  const s = (Math.abs(cents) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `(${s})` : s;
}

/**
 * rows: [{type:"head",label} | {type:"line",code,name,values,href,note} | {type:"total",label,values,grand} | {type:"gap"}]
 * columns: header labels for each value column. When there are exactly two, a change column is added.
 */
export function StatementTable({ columns, rows, currency, firstLabel = "Account" }) {
  const withChange = columns.length === 2;
  const nCols = 1 + columns.length + (withChange ? 2 : 0);
  const change = (v) => (v[0] ?? 0) - (v[1] ?? 0);
  const pct = (v) => (v[1] ? Math.round((change(v) / Math.abs(v[1])) * 1000) / 10 : null);
  return (
    <div className="table-wrap stmt">
      <table>
        <thead>
          <tr>
            <th>{firstLabel}<span className="faint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}> · {currency}</span></th>
            {columns.map((c) => <th key={c} className="num">{c}</th>)}
            {withChange && <><th className="num">Change</th><th className="num">%</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.type === "gap") return <tr key={i} className="gap"><td colSpan={nCols} /></tr>;
            if (r.type === "head") return <tr key={i} className="head"><td colSpan={nCols}>{r.label}</td></tr>;
            const total = r.type === "total";
            const p = withChange ? pct(r.values) : null;
            return (
              <tr key={i} className={total ? (r.grand ? "total grand" : "total") : "line"}>
                <td>
                  {total ? r.label : <>
                    {r.code && <span className="code">{r.code}</span>}
                    {r.href ? <Link href={r.href}>{r.name || r.code}</Link> : (r.name || r.code)}
                    {r.note && <span className="faint small"> · {r.note}</span>}
                  </>}
                </td>
                {r.values.map((v, j) => <td key={j} className="num">{fmt(v)}</td>)}
                {withChange && <><td className="num">{fmt(change(r.values))}</td><td className="num faint">{p === null ? "" : `${p > 0 ? "+" : ""}${p}%`}</td></>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ base, title }) {
  return (<><PageHead title={title} /><div className="card empty"><h3>No ledger data yet</h3><p>Financial statements are built from your general ledger. Import a ledger CSV to see them.</p><Link href={`${base}/ledger/import`} className="btn primary">Import ledger</Link></div></>);
}
