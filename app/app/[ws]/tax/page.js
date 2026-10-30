import Link from "next/link";
import { agentHref } from "@/lib/ai/deep-links";
import "@/styles/tax.css";
import db from "@/lib/db";
import { requireWorkspace, can } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatMoney, parseAmount } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { obligationsFor, estimatePenalty } from "@/lib/tax/calendar";
import { VAT, WHVAT, WHT_RATES, PAYE, PAYROLL, OTHER, PENALTIES, ETIMS, OBLIGATIONS, PIN_SOURCE } from "@/lib/tax/kenya";
import { getProfile, latestRun } from "@/lib/tax/data";
import { saveProfile, recordFiling } from "./actions";
export const metadata = { title: "Tax centre" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const Src = ({ href, unverified, note }) => <div className="tax-src">{href && <a href={href} target="_blank" rel="noreferrer">source</a>}{unverified && <> · <span className="badge warn">unverified</span></>}{note ? <> · {note}</> : null}</div>;

export default async function TaxCentre({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const sp = searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const profile = await getProfile(ws.id);
  const flags = { vat: !!profile.vat_registered, paye: !!profile.paye_registered, wht: !!profile.wht_registered, whvatAgent: !!profile.wht_vat_agent, tot: !!profile.tot_registered };
  const periods = [addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth];
  const [filings, run, accounts, recentRuns] = await Promise.all([
    db.all(`SELECT * FROM tax_filings WHERE workspace_id = ? AND period IN (${periods.map(() => "?").join(",")})`, [ws.id, ...periods]),
    latestRun(ws.id),
    db.all("SELECT account_code, MAX(account_name) account_name FROM ledger_entries WHERE workspace_id = ? GROUP BY account_code ORDER BY account_code", [ws.id]),
    db.all("SELECT period, vat3 FROM tax_recon_runs WHERE workspace_id = ? AND kind = 'VAT' ORDER BY created_at DESC LIMIT 24", [ws.id]),
  ]);
  const netByPeriod = new Map();
  for (const r of recentRuns) if (!netByPeriod.has(r.period)) netByPeriod.set(r.period, JSON.parse(r.vat3 || "{}").netCents || 0);
  const calendar = periods.flatMap((p) => obligationsFor(p, { fyEndMonth: profile.fy_end_month || 12, flags }));
  const filingOf = (o) => filings.find((f) => f.code === o.code && f.period === o.period);
  const edit = can(ws.role, "data.edit"), admin = can(ws.role, "admin");
  const m = (c) => formatMoney(c || 0, ws.currency);
  const s = run?.stats || {};

  // Penalty estimator (GET form).
  let estimate = null;
  if (sp.pen_code && PENALTIES[sp.pen_code] && /^\d{4}-\d{2}-\d{2}$/.test(sp.pen_due || "")) {
    estimate = estimatePenalty(sp.pen_code, { taxCents: Math.abs(parseAmount(sp.pen_tax || "0") || 0), due: sp.pen_due, filedOn: sp.pen_filed || null, paidOn: sp.pen_paid || null, today });
  }

  return (
    <>
      <PageHead title="Tax centre" desc="KRA compliance in one place: filing calendar, VAT position from iTax/eTIMS, penalties exposure and the rules the engine applies.">
        <Link className="btn primary" href={`/app/${ws.slug}/tax/vat`}>VAT reconciliation</Link>
        <Link className="btn" href={`/app/${ws.slug}/tax/etims`}>eTIMS deductibility</Link>
        <Link className="btn ghost ai-ask-link" href={agentHref(ws.slug, "kra-tax", { period: run?.period || thisMonth })}>Ask KRA Tax</Link>
      </PageHead>
      <Flash searchParams={sp} />
      <div className="alert warn small">Kenyan tax rules change with every Finance Act. Each rate and deadline below shows its source; items marked <span className="badge warn">unverified</span> could not be confirmed from a primary KRA source. Confirm with your tax adviser before filing. Research snapshot: October 2026.</div>
      {!profile.exists && admin && <div className="alert info">Start by completing the <a href="#profile">KRA profile</a> (PIN, VAT accounts, financial year end) so the calendar and control-account checks are accurate.</div>}

      {run && <>
        <h2>Latest VAT position — {run.period}</h2>
        <div className="grid grid-4">
          <div className="stat"><div className="label">{run.vat3?.netCents > 0 ? "Net VAT payable (est.)" : "Credit c/f (est.)"}</div><div className="value">{m(Math.abs(run.vat3?.netCents))}</div></div>
          <div className="stat"><div className="label">Input VAT claimable</div><div className="value" style={{ color: "var(--good)" }}>{m(s.purchases?.claimableVatCents)}</div></div>
          <div className="stat"><div className="label">Input VAT blocked / expired</div><div className="value" style={{ color: "var(--bad)" }}>{m((s.purchases?.atRiskVatCents || 0) + (s.purchases?.expiredVatCents || 0))}</div></div>
          <div className="stat"><div className="label">Exceptions to clear</div><div className="value">{(s.sales?.documents || 0) + (s.purchases?.documents || 0) - (s.sales?.byStatus?.MATCHED?.count || 0) - (s.purchases?.byStatus?.MATCHED?.count || 0)}</div><Link className="small" href={`/app/${ws.slug}/tax/vat?period=${run.period}&run=${run.id}`}>Review →</Link></div>
        </div>
      </>}

      <h2 style={{ marginTop: "2rem" }}>Compliance calendar</h2>
      <div className="table-wrap"><table className="tax-cal">
        <thead><tr><th>Obligation</th><th>Period</th><th>Due</th><th>Status</th><th className="num">Exposure if late</th>{edit && <th>Update</th>}</tr></thead>
        <tbody>{calendar.map((o, i) => {
          const f = filingOf(o);
          const st = f?.status || "DUE";
          const overdue = o.due && o.due < today && st === "DUE";
          const taxCents = o.code === "VAT3" ? Math.max(0, netByPeriod.get(o.period) || 0) : f?.amount_cents || 0;
          const pen = overdue ? estimatePenalty(o.code, { taxCents, due: o.due, today }) : null;
          return (
            <tr key={i}>
              <td><strong>{o.name}</strong><Src href={o.source} unverified={o.unverified} note={o.note} /></td>
              <td>{MONTHS[+o.period.slice(5) - 1]} {o.period.slice(0, 4)}</td>
              <td className={overdue ? "overdue" : ""}>{o.due ? formatDate(o.due) : o.rule}{o.rolled && <div className="faint small">moved from {formatDate(o.statutory)} (weekend/holiday)</div>}</td>
              <td>{st === "PAID" ? <span className="badge good">Paid</span> : st === "FILED" ? <span className="badge info">Filed</span> : overdue ? <span className="badge bad">Overdue</span> : <span className="badge">Due</span>}{f?.reference && <div className="faint small">{f.reference}</div>}</td>
              <td className="num">{pen ? <>{m(pen.totalCents)}<div className="faint small">{pen.lines[0]}</div></> : "—"}</td>
              {edit && <td>{o.due && <form action={recordFiling} className="row" style={{ flexWrap: "nowrap" }}>
                <input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="code" value={o.code} /><input type="hidden" name="period" value={o.period} />
                <select name="status" defaultValue={st} style={{ width: "auto" }}><option value="DUE">Due</option><option value="FILED">Filed</option><option value="PAID">Paid</option></select>
                <input name="reference" placeholder="Ack / PRN no." defaultValue={f?.reference || ""} style={{ width: 120 }} />
                <Submit className="btn sm" pendingText="…">Save</Submit></form>}</td>}
            </tr>);
        })}</tbody>
      </table></div>
      <p className="help">Deadlines falling on a weekend or Kenyan public holiday roll forward to the next working day. Exposure uses the latest VAT reconciliation for the period (VAT) or the amount you recorded.</p>

      <div className="grid grid-2" style={{ marginTop: "2rem" }}>
        <form className="card">
          <h3>Penalty & interest estimator</h3>
          <div className="form-row">
            <div className="field"><label>Tax</label><select name="pen_code" defaultValue={sp.pen_code || "VAT3"}>{Object.keys(PENALTIES).map((k) => <option key={k} value={k}>{OBLIGATIONS.find((o) => o.code === k)?.name || k}</option>)}</select></div>
            <div className="field"><label>Tax due (KES)</label><input name="pen_tax" defaultValue={sp.pen_tax || ""} inputMode="decimal" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Due date</label><input type="date" name="pen_due" defaultValue={sp.pen_due || ""} required /></div>
            <div className="field"><label>Filed on</label><input type="date" name="pen_filed" defaultValue={sp.pen_filed || ""} /></div>
            <div className="field"><label>Paid on</label><input type="date" name="pen_paid" defaultValue={sp.pen_paid || ""} /></div>
          </div>
          <button className="btn">Estimate</button>
          {estimate && <div className="alert info" style={{ marginTop: "1rem" }}>
            <strong>Estimated total: {m(estimate.totalCents)}</strong>
            <div className="small">Late filing {m(estimate.lateFilingCents)} · late payment {m(estimate.latePaymentCents)} · interest {m(estimate.interestCents)}</div>
            <ul className="small" style={{ margin: ".3rem 0 0", paddingLeft: "1.1rem" }}>{estimate.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <Src href={estimate.source} unverified={estimate.unverified} />
            <div className="faint small">Finance Act 2026 offers an amnesty on penalties and interest for periods up to 31 Dec 2025 if the principal is paid by 31 Dec 2026 (EY summary) — check eligibility.</div>
          </div>}
          {!estimate && <p className="help">Blank “filed/paid” means not yet — estimated as at today.</p>}
        </form>

        <div className="card">
          <h3>Upload tax data</h3>
          <p className="muted small">Uploads go through the Data hub, which cleans and validates any CSV or Excel layout.</p>
          <div className="stack">
            {[["sales_invoices", "ERP sales register"], ["purchase_invoices", "ERP purchase register"], ["itax_sales", "iTax / eTIMS sales (SEC_B)"], ["itax_purchases", "iTax / eTIMS purchases (SEC_F)"], ["wht_vat", "Withholding VAT certificates"]].map(([k, l]) => (
              <Link key={k} className="btn sm" style={{ justifyContent: "flex-start" }} href={`/app/${ws.slug}/data?kind=${k}`}>{l}</Link>))}
          </div>
          <p className="help">Sample files to practise with are in <code>samples/tax/</code>.</p>
        </div>
      </div>

      <h2 id="profile" style={{ marginTop: "2rem" }}>KRA profile</h2>
      <datalist id="tax-accts">{accounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_name}</option>)}</datalist>
      <form action={saveProfile} className="card">
        <input type="hidden" name="slug" value={ws.slug} />
        <div className="form-row">
          <div className="field"><label>Company KRA PIN</label><input name="kra_pin" defaultValue={profile.kraPin || ""} placeholder="P051234567X" disabled={!admin} autoComplete="off" /><div className="help">Encrypted with this workspace's key. Used to detect self-supply and on exports.</div></div>
          <div className="field"><label>Financial year ends</label><select name="fy_end_month" defaultValue={profile.fy_end_month || 12} disabled={!admin}>{MONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}</select></div>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: "1rem", margin: ".3rem 0 .8rem" }}>
          {[["vat_registered", "VAT registered"], ["paye_registered", "PAYE employer"], ["wht_registered", "Withholds income tax"], ["wht_vat_agent", "Appointed WHVAT agent"], ["tot_registered", "Turnover tax"]].map(([k, l]) => (
            <label key={k} className="row" style={{ fontWeight: 400, color: "var(--text)" }}><input type="checkbox" name={k} defaultChecked={!!profile[k]} disabled={!admin} style={{ width: "auto" }} /> {l}</label>))}
        </div>
        <div className="form-row">
          {[["output_vat_account", "Output VAT account"], ["input_vat_account", "Input VAT account"], ["wht_vat_account", "WHVAT receivable account"], ["wht_account", "WHT payable account"], ["paye_account", "PAYE payable account"]].map(([k, l]) => (
            <div key={k} className="field"><label>{l}</label><input name={k} list="tax-accts" defaultValue={profile[k] || ""} disabled={!admin} /></div>))}
        </div>
        <div className="field"><label>Revenue accounts (optional)</label><input name="revenue_accounts" defaultValue={profile.revenue_accounts || ""} placeholder="Blank = all accounts classified as revenue, e.g. 4000, 4010" disabled={!admin} /></div>
        {admin ? <Submit>Save profile</Submit> : <p className="faint small">Only admins can change the tax profile.</p>}
        {profile.updated_at && <p className="faint small">Last updated {formatDateTime(profile.updated_at)}.</p>}
      </form>

      <h2 id="reference" style={{ marginTop: "2rem" }}>Rules & rates the engine applies</h2>
      <div className="grid grid-2 tax-ref">
        <div className="card">
          <h4>VAT</h4>
          <ul className="small">
            <li>Standard rate {VAT.standardRate.value}%, fuel {VAT.fuelRate.value}%, zero-rated 0%, exempt outside the charge. <Src href={VAT.standardRate.source} note={VAT.zeroRate.note} /></li>
            <li>Registration threshold KES 5m taxable supplies in 12 months. <Src href={VAT.registrationThresholdCents.source} /></li>
            <li>{VAT.inputClaimMonths.note} <Src href={VAT.inputClaimMonths.source} /></li>
            <li>{VAT.creditNoteMonths.note} <Src href={VAT.creditNoteMonths.source} /></li>
            <li>Only transmitted eTIMS/TIMS invoices carrying your PIN, validated import entries and non-resident digital-supplier invoices are claimable; pre-populated purchase values can be reduced but not increased. <Src href={VAT.inputClaimMonths.source} /></li>
            <li>Prohibited input: {VAT.prohibitedInput.value.join(", ")}. <Src href={VAT.prohibitedInput.source} note={VAT.prohibitedInput.note} /></li>
            <li>Invoice numbers up to {VAT.invoiceNoMaxLen.value} characters; max {VAT.maxRowsPerCsv.value.toLocaleString()} rows per CSV. <Src href={VAT.invoiceNoMaxLen.source} /></li>
            <li>Withholding VAT {WHVAT.rate.value}%: {WHVAT.rate.note} <Src href={WHVAT.rate.source} /></li>
            <li>KRA PIN format: A (individual) or P (non-individual), 9 digits, a letter. Format only — use the iTax PIN Checker to confirm a PIN exists. <Src href={PIN_SOURCE} /></li>
          </ul>
          <h4>eTIMS and deductibility</h4>
          <ul className="small">
            <li>From {formatDate(ETIMS.deductibilityFrom)} expenses must be backed by an eTIMS/TIMS invoice to be deductible (ITA s.16(1)(c)); full validation against eTIMS at filing from {formatDate(ETIMS.fullValidationFrom)} — KRA uses the higher of declared/eTIMS income and the lower of declared/eTIMS expenses. <Src href={ETIMS.source} /></li>
            <li>Exempt: {ETIMS.exemptCategories.map((c) => c.label).join("; ")}. {ETIMS.notExempt} <Src href={ETIMS.validationSource} /></li>
            <li>eTIMS non-compliance penalty (Finance Act 2026): higher of 5% of tax, KES 100,000 (companies) or KES 10,000 (individuals). <Src href={PENALTIES.ETIMS.source} /></li>
          </ul>
        </div>
        <div className="card">
          <h4>Withholding income tax (resident / non-resident)</h4>
          <table className="tax-checks small"><tbody>{WHT_RATES.map((r) => <tr key={r.payment}><td>{r.payment}</td><td className="num">{r.resident ?? "—"}{r.resident !== null ? "%" : ""}</td><td className="num">{r.nonResident ?? "—"}{r.nonResident !== null ? "%" : ""}</td></tr>)}</tbody></table>
          <Src href={WHT_RATES[0].source} note={`PwC table reviewed ${WHT_RATES[0].reviewed}`} />
          <h4>Payroll</h4>
          <ul className="small">
            <li>PAYE monthly bands: {PAYE.monthlyBands.map(([b, r]) => `${b === Infinity ? "above" : b.toLocaleString()} @ ${r}%`).join(", ")}; personal relief KES {PAYE.personalReliefMonthly.toLocaleString()}/month. <Src href={PAYE.source} /></li>
            <li>{PAYE.deductibleBeforePaye.note} <Src href={PAYE.deductibleBeforePaye.source} /></li>
            <li>SHIF {PAYROLL.shif.rate}% of gross, no cap. AHL {PAYROLL.ahl.employee}% employee + {PAYROLL.ahl.employer}% employer. <Src href={PAYROLL.shif.source} /></li>
            <li>NSSF from Feb 2026: {PAYROLL.nssf.rate}% each side, LEL KES {PAYROLL.nssf.lel.toLocaleString()}, UEL KES {PAYROLL.nssf.uel.toLocaleString()}, max KES {PAYROLL.nssf.maxPerSide.toLocaleString()} per side. <Src href={PAYROLL.nssf.source} /></li>
          </ul>
          <h4>Other</h4>
          <ul className="small">
            <li>Corporation tax {OTHER.corporationTax.rate}% (resident). <Src href={OTHER.corporationTax.source} /></li>
            <li>Turnover tax {OTHER.turnoverTax.rate}% for turnover KES 1m–25m. <Src href={OTHER.turnoverTax.source} unverified={OTHER.turnoverTax.unverified} /></li>
            <li>Significant Economic Presence tax: effective {OTHER.sep.effectiveRate}% of turnover. <Src href={OTHER.sep.source} note={OTHER.sep.note} /></li>
          </ul>
          <h4>Penalties</h4>
          <ul className="small">
            <li>VAT: late filing higher of 5% or KES 10,000; late payment 5% + 1% interest per month. PAYE late filing higher of 25% or KES 10,000. <Src href={PENALTIES.VAT3.source} /></li>
            <li>WHVAT late remittance: 10% + 1% per month; failure to deduct 10%. <Src href={PENALTIES.WHVAT.source} /></li>
          </ul>
        </div>
      </div>
      <p className="faint small"><Link href={`/app/${ws.slug}/tax/mappings`}>Tax codes & ledger accounts →</Link></p>
    </>
  );
}
