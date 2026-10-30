import Link from "next/link";
import "@/styles/tax.css";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { ETIMS } from "@/lib/tax/kenya";
import { deductibility } from "@/lib/tax/data";
export const metadata = { title: "eTIMS deductibility" };

export default async function EtimsPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const thisYear = new Date().getUTCFullYear();
  const year = /^\d{4}$/.test(searchParams.year || "") ? +searchParams.year : thisYear;
  const r = await deductibility(ws, year);
  const m = (c) => formatMoney(c || 0, ws.currency);
  const t = r.totals;
  return (
    <>
      <PageHead title="eTIMS deductibility" crumbs={<Link href={`/app/${ws.slug}/tax`}>Tax centre</Link>}
        desc="Expenses in the ledger that aren't backed by eTIMS purchase invoices risk being disallowed for income tax.">
        <form className="row"><select name="year" defaultValue={year} style={{ width: "auto" }}>{[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y}>{y}</option>)}</select><button className="btn">View</button></form>
      </PageHead>
      <div className="alert info small">Since {formatDate(ETIMS.deductibilityFrom)} an expense is deductible only if supported by an eTIMS/TIMS invoice (ITA s.16(1)(c), Finance Act 2023). From {formatDate(ETIMS.fullValidationFrom)} iTax validates returns against eTIMS and uses the <strong>lower</strong> of declared and eTIMS-backed expenses. <a href={ETIMS.source} target="_blank" rel="noreferrer">Source (KPMG)</a> · <a href={ETIMS.validationSource} target="_blank" rel="noreferrer">KRA notice</a>. Matching here is by supplier name across the year — an estimate to direct follow-up, not a tax computation.</div>
      <div className="grid grid-4">
        <div className="stat"><div className="label">Expenses & cost of sales</div><div className="value">{m(t.expensesCents)}</div></div>
        <div className="stat"><div className="label">Exempt from eTIMS</div><div className="value">{m(t.exemptCents)}</div><div className="faint small">payroll, imports, bank/insurance, internal journals</div></div>
        <div className="stat"><div className="label">Not backed by eTIMS</div><div className="value" style={{ color: t.unsupportedCents ? "var(--bad)" : undefined }}>{m(t.unsupportedCents)}</div><div className="faint small">incl. {m(t.noCounterpartyCents)} with no supplier on the entry</div></div>
        <div className="stat"><div className="label">Tax at risk (30%)</div><div className="value" style={{ color: t.taxAtRiskCents ? "var(--bad)" : undefined }}>{m(t.taxAtRiskCents)}</div></div>
      </div>
      {Object.keys(r.exemptByCat).length > 0 && <p className="small muted" style={{ marginTop: ".8rem" }}>Treated as exempt: {Object.entries(r.exemptByCat).map(([k, v]) => `${k} ${m(v)}`).join(" · ")}</p>}
      <h2 style={{ marginTop: "1.5rem" }}>By supplier</h2>
      {r.rows.length === 0 ? <div className="card empty">No expense entries with a supplier for {year}. Make sure ledger imports map the counterparty column, and upload iTax purchases (Section F) for each month.</div> :
        <div className="table-wrap"><table>
          <thead><tr><th>Supplier</th><th>Accounts</th><th className="num">Entries</th><th className="num">Expensed</th><th className="num">eTIMS invoices</th><th className="num">Not backed</th><th>Action</th></tr></thead>
          <tbody>{r.rows.slice(0, 300).map((x) => (
            <tr key={x.counterparty}><td className="wrap">{x.counterparty}</td><td className="small">{x.accounts}</td><td className="num">{x.entries}</td><td className="num">{m(x.expenseCents)}</td><td className="num">{m(x.etimsCents)}</td>
              <td className="num">{x.unsupportedCents > 100 ? <span className="badge bad">{m(x.unsupportedCents)}</span> : <span className="badge good">Covered</span>}</td><td className="wrap small">{x.action}</td></tr>))}</tbody>
        </table></div>}
      <p className="faint small" style={{ marginTop: "1rem" }}>{ETIMS.notExempt} Confirm categorisation with your tax adviser.</p>
    </>
  );
}
