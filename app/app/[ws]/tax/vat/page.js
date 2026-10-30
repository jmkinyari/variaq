import Link from "next/link";
import { agentHref } from "@/lib/ai/deep-links";
import "@/styles/tax.css";
import db from "@/lib/db";
import { requireWorkspace, can } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { STATUS } from "@/lib/tax/vat-recon";
import { VAT3_ROW_LABELS } from "@/lib/tax/vat3";
import { getRun, latestRun, runItems, dataStatus, ledgerChecks, getProfile } from "@/lib/tax/data";
import { runRecon, reviewItem, acceptAllMatched } from "./actions";
export const metadata = { title: "VAT reconciliation" };

const SIDES = [["SALES", "Sales (output VAT)"], ["PURCHASES", "Purchases (input VAT)"], ["WHT_VAT", "Withholding VAT"]];
const CERT = { CERT_MATCHED: ["Certificate matched", "good"], CERT_AMOUNT_DIFF: ["Not 2% of invoice", "bad"], CERT_NO_INVOICE: ["No matching invoice", "warn"] };
const REVIEW = { OPEN: ["Open", ""], ACTIONED: ["Actioned", "info"], ACCEPTED: ["Accepted", "good"] };
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

function StatusBadge({ s }) {
  const [label, tone] = STATUS[s] ? [STATUS[s].label, STATUS[s].tone] : CERT[s] || [s, ""];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export default async function VatPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const sp = searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period || "") ? sp.period : lastMonth();
  const side = SIDES.some(([k]) => k === sp.side) ? sp.side : "PURCHASES";
  const run = sp.run ? await getRun(ws.id, sp.run) : await latestRun(ws.id, period);
  const [status, runs, profile] = await Promise.all([
    dataStatus(ws.id, period),
    db.all("SELECT r.id, r.created_at, r.stats, u.name by_name FROM tax_recon_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.workspace_id = ? AND r.kind = 'VAT' AND r.period = ? ORDER BY r.created_at DESC LIMIT 10", [ws.id, period]),
    getProfile(ws.id),
  ]);
  const items = run ? await runItems(ws.id, run.id, { side, status: sp.status || undefined, review: sp.review || undefined }) : [];
  const checks = run ? await ledgerChecks(ws, period, profile, run) : null;
  const edit = can(ws.role, "data.edit");
  const base = `/app/${ws.slug}/tax/vat`;
  const q = (o) => `${base}?${new URLSearchParams(Object.fromEntries(Object.entries({ period, side, run: run?.id, status: sp.status, review: sp.review, ...o }).filter(([, v]) => v)))}`;
  const here = q({});
  const m = (c) => formatMoney(c || 0, ws.currency);
  const s = run?.stats || {};
  const sideStats = side === "SALES" ? s.sales : side === "PURCHASES" ? s.purchases : null;
  const counts = side === "WHT_VAT" ? (s.whvat?.counts || {}) : Object.fromEntries(Object.entries(sideStats?.byStatus || {}).map(([k, v]) => [k, v.count]));

  return (
    <>
      <PageHead title="VAT reconciliation" crumbs={<Link href={`/app/${ws.slug}/tax`}>Tax centre</Link>}
        desc="Your ERP's sales and purchase registers against KRA's iTax/eTIMS auto-populated return: what will be declared, what you can claim, and what to fix before filing.">
        <form className="row"><input type="month" name="period" defaultValue={period} style={{ width: "auto" }} /><input type="hidden" name="side" value={side} /><button className="btn">View</button></form>
        <Link className="btn ghost ai-ask-link" href={agentHref(ws.slug, "kra-tax", { period, q: `Explain the VAT reconciliation for ${period}: the exceptions to clear and the VAT payable.` })}>Ask KRA Tax</Link>
      </PageHead>
      <Flash searchParams={sp} />

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row between"><h3 style={{ margin: 0 }}>Data for {period}</h3><Link className="btn sm" href={`/app/${ws.slug}/data`}>Open Data hub</Link></div>
        <div className="table-wrap" style={{ marginTop: ".6rem" }}><table>
          <thead><tr><th>Dataset</th><th className="num">Documents</th><th>Last upload</th><th></th></tr></thead>
          <tbody>{status.map((d) => (
            <tr key={d.dataset}><td>{d.label}</td><td className="num">{d.count ? d.count.toLocaleString() : <span className="badge warn">Missing</span>}</td>
              <td className="small">{d.batch ? <>{d.batch.file_name} · {formatDateTime(d.batch.at)}</> : "—"}</td>
              <td className="num">{edit && <Link className="btn sm" href={`/app/${ws.slug}/data?kind=${d.dataset}`}>{d.count ? "Replace" : "Upload"}</Link>}</td></tr>))}</tbody>
        </table></div>
        <p className="help">Download the auto-populated VAT return from iTax (Returns → File Return → VAT → “Download Auto populated VAT return”). Upload <code>SEC_B_WITH_VAT_PIN*.csv</code> as iTax sales and <code>SEC_F_WITH_VAT_PIN*.csv</code> / <code>SEC_F_IMPORT*.csv</code> as iTax purchases.</p>
        {edit && <form action={runRecon} className="stack" style={{ marginTop: ".5rem" }}>
          <input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="period" value={period} />
          <details><summary className="small">Return adjustments (optional, KES) — credit b/f, apportionment, imported services, payments</summary>
            <div className="form-row" style={{ marginTop: ".6rem" }}>
              {[["creditBfCents", "Credit brought forward (row 21)"], ["importedServicesVatCents", "VAT on imported services (row 15)"], ["exemptSalesCents", "Exempt sales (for apportionment)"], ["zeroRatedSalesCents", "Zero-rated sales"],
                ["exemptOnlyInputCents", "Input VAT only for exempt supplies (row 16)"], ["commonInputCents", "Input VAT for taxable + exempt (row 17)"], ["refundClaimCents", "Refund claim lodged (row 23)"], ["vatPaidCents", "VAT already paid (row 25)"]].map(([k, l]) => (
                <div key={k} className="field"><label>{l}</label><input name={k} defaultValue={run?.adjustments?.[k] ? (run.adjustments[k] / 100).toFixed(2) : ""} inputMode="decimal" placeholder="0.00" /></div>))}
            </div>
          </details>
          <div><Submit>{run ? "Re-run reconciliation" : "Run reconciliation"}</Submit> <span className="faint small">Reviewers' decisions carry over to the new run.</span></div>
        </form>}
      </div>

      {!run ? <div className="card empty"><h3>No reconciliation for {period} yet</h3><p>Upload the ERP registers and the iTax/eTIMS files, then run the reconciliation.</p></div> : <>
        <div className="row between small muted" style={{ margin: "1.5rem 0 .5rem" }}>
          <span>Run {formatDateTime(run.created_at)} by {run.by_name}{runs.length > 1 && <> · Other runs: {runs.filter((r) => r.id !== run.id).slice(0, 4).map((r) => <Link key={r.id} href={q({ run: r.id, status: "", review: "" })} style={{ marginRight: 6 }}>{formatDateTime(r.created_at)}</Link>)}</>}</span>
          <span className="row">
            <a className="btn sm" href={`${base}/export?run=${run.id}&type=exceptions`}>Exceptions CSV</a>
            <a className="btn sm" href={`${base}/export?run=${run.id}&type=B`}>Section B CSV</a>
            <a className="btn sm" href={`${base}/export?run=${run.id}&type=F`}>Section F CSV</a>
            <a className="btn sm" href={`${base}/export?run=${run.id}&type=L`}>Sheet L CSV</a>
            <a className="btn sm" href={`${base}/export?run=${run.id}&type=O`}>VAT due CSV</a>
          </span>
        </div>

        <div className="grid grid-4">
          <div className="stat"><div className="label">Sales match rate</div><div className="value">{s.sales?.matchRate ?? 0}%</div><div className="faint small">{s.sales?.documents || 0} documents</div></div>
          <div className="stat"><div className="label">Purchases match rate</div><div className="value">{s.purchases?.matchRate ?? 0}%</div><div className="faint small">{s.purchases?.documents || 0} documents</div></div>
          <div className="stat"><div className="label">Input VAT claimable (eTIMS)</div><div className="value" style={{ color: "var(--good)" }}>{m(s.purchases?.claimableVatCents)}</div><div className="faint small">expired {m(s.purchases?.expiredVatCents)}</div></div>
          <div className="stat"><div className="label">Input VAT blocked (not on eTIMS)</div><div className="value" style={{ color: s.purchases?.atRiskVatCents ? "var(--bad)" : undefined }}>{m(s.purchases?.atRiskVatCents)}</div><div className="faint small">chase suppliers to transmit</div></div>
          <div className="stat"><div className="label">Sales on eTIMS not in ERP</div><div className="value" style={{ color: s.sales?.unrecordedVatCents ? "var(--bad)" : undefined }}>{m(s.sales?.unrecordedVatCents)}</div><div className="faint small">VAT on possibly unrecorded revenue</div></div>
          <div className="stat"><div className="label">ERP sales not on eTIMS</div><div className="value" style={{ color: s.sales?.atRiskVatCents ? "var(--warn)" : undefined }}>{m(s.sales?.atRiskVatCents)}</div><div className="faint small">VAT — transmit before filing</div></div>
          <div className="stat"><div className="label">WHVAT credits (sheet L)</div><div className="value">{m(s.whvat?.totalCreditCents)}</div><div className="faint small">{s.whvat?.certificates || 0} certificates</div></div>
          <div className="stat"><div className="label">{run.vat3?.netCents > 0 ? "Net VAT payable" : "Credit carried forward"}</div><div className="value">{m(Math.abs(run.vat3?.netCents || 0))}</div><div className="faint small">row 28, estimate</div></div>
        </div>

        <div className="grid grid-2" style={{ marginTop: "1rem" }}>
          <div className="card">
            <h3>VAT3 — VAT due (sheet O)</h3>
            <table className="tax-vat3"><tbody>{Object.entries(run.vat3?.rows || {}).map(([k, v]) => (
              <tr key={k} className={["19", "20", "24", "28"].includes(k) ? "total" : ""}><td className="faint">{k}</td><td>{VAT3_ROW_LABELS[k]}</td><td className="num">{m(v)}</td></tr>))}</tbody></table>
            <p className="help">Output VAT uses the higher of ERP and eTIMS per invoice (iTax rejects returns below eTIMS). Input VAT counts only eTIMS-backed, unexpired invoices, at the lower of ERP and eTIMS. Exempt share {(run.vat3?.exemptShare * 100 || 0).toFixed(1)}%.</p>
          </div>
          <div className="card">
            <h3>Ledger cross-checks</h3>
            {!checks.control.configured ? <p className="muted small">Set your output and input VAT ledger accounts in the <Link href={`/app/${ws.slug}/tax#profile`}>Tax centre</Link> to reconcile the VAT control accounts.</p> : null}
            <table className="tax-checks"><tbody>{[...checks.control.lines, ...checks.revenue].map((l) => (
              <tr key={l.label}><td><div>{l.label}</div><div className="faint small">{l.aLabel} {m(l.a)} · {l.bLabel} {m(l.b)}</div>{!l.ok && <div className="small" style={{ marginTop: ".2rem" }}>{l.action}</div>}</td>
                <td className="num">{l.ok ? <span className="badge good">Agrees</span> : <span className="badge bad">{m(l.diffCents)}</span>}</td></tr>))}</tbody></table>
            <p className="help">Revenue accounts used: {checks.revenueAccounts.join(", ") || "none found"}.</p>
          </div>
        </div>

        <div className="tabs" style={{ marginTop: "1.5rem" }}>
          {SIDES.map(([k, l]) => <Link key={k} href={q({ side: k, status: "", review: "" })} className={side === k ? "active" : ""}>{l}</Link>)}
        </div>
        <div className="row" style={{ margin: ".8rem 0", flexWrap: "wrap" }}>
          <Link href={q({ status: "" })} className={`badge ${!sp.status ? "accent" : ""}`}>All</Link>
          {Object.entries(counts).filter(([, n]) => n).map(([k, n]) => <Link key={k} href={q({ status: k })} className={`badge ${sp.status === k ? "accent" : ""}`}>{STATUS[k]?.label || CERT[k]?.[0] || k} ({n})</Link>)}
          <span className="spacer" />
          {Object.entries(REVIEW).map(([k, [l]]) => <Link key={k} href={q({ review: sp.review === k ? "" : k })} className={`badge ${sp.review === k ? "accent" : ""}`}>{l}</Link>)}
          {edit && <form action={acceptAllMatched}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="run" value={run.id} /><input type="hidden" name="return" value={here} /><Submit className="btn sm">Accept all matched</Submit></form>}
        </div>

        <div className="table-wrap"><table className="tax-items">
          <thead><tr><th>Status</th><th>Counterparty</th><th>Invoice</th><th>Date</th><th className="num">{side === "WHT_VAT" ? "Expected 2%" : "ERP VAT"}</th><th className="num">{side === "WHT_VAT" ? "Withheld" : "eTIMS VAT"}</th><th>Issues & action</th><th>Review</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.id} className={i.review_status !== "OPEN" ? "reviewed" : ""}>
              <td><StatusBadge s={i.status} />{i.pass ? <div className="faint small">pass {i.pass}</div> : null}</td>
              <td className="wrap">{i.counterparty || "—"}<div className="faint small mono">{i.pin || "no PIN"}</div></td>
              <td className="wrap mono small">{i.invoice_no || "—"}{i.itax_invoice_no && i.itax_invoice_no !== i.invoice_no && <div className="faint">eTIMS {i.itax_invoice_no}</div>}</td>
              <td className="small">{i.doc_date || "—"}{i.itax_date && i.itax_date !== i.doc_date && <div className="faint">eTIMS {i.itax_date}</div>}</td>
              <td className="num">{i.erp_vat_cents === null ? "—" : m(i.erp_vat_cents)}</td>
              <td className="num">{i.itax_vat_cents === null ? "—" : m(i.itax_vat_cents)}</td>
              <td className="wrap small tax-action">
                {i.issues.map((x, k) => <div key={k}><span className={`badge ${x.severity === "bad" ? "bad" : x.severity === "warn" ? "warn" : ""}`}>{x.code.replace(/_/g, " ").toLowerCase()}</span> {x.text}</div>)}
                {!["MATCHED", "CERT_MATCHED"].includes(i.status) && <div className="tax-next"><strong>Action:</strong> {i.action}</div>}
              </td>
              <td style={{ minWidth: 190 }}>
                {edit ? <form action={reviewItem} className="stack tax-review">
                  <input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="return" value={here} />
                  <select name="review_status" defaultValue={i.review_status}>{Object.entries(REVIEW).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input name="note" defaultValue={i.note || ""} placeholder="Note (required to accept an exception)" />
                  <Submit className="btn sm" pendingText="…">Save</Submit>
                </form> : <><span className={`badge ${REVIEW[i.review_status]?.[1]}`}>{REVIEW[i.review_status]?.[0]}</span>{i.note && <div className="small">{i.note}</div>}</>}
              </td>
            </tr>))}
            {items.length === 0 && <tr><td colSpan={8} className="empty">Nothing matches these filters.</td></tr>}
          </tbody>
        </table></div>
        {items.length >= 2000 && <p className="faint small">Showing the first 2,000 items — filter by status or download the CSV for everything.</p>}
      </>}
      <p className="faint small" style={{ marginTop: "1.5rem" }}>Rules applied: 16% standard / 8% fuel rate checks, 6-month input VAT window (VAT Act s.17(2)), KRA PIN format, invoice numbers ≤ 40 characters, credit notes need the original invoice. Sources and verification status are listed in the <Link href={`/app/${ws.slug}/tax#reference`}>Tax centre</Link>. Confirm with your tax adviser before filing.</p>
    </>
  );
}
