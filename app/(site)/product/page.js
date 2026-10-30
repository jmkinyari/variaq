import Link from "next/link";
import CtaBand from "../_components/CtaBand";
import { MODULES } from "../_components/content";

export const metadata = { title: "Platform", description: "The Variaq platform: close and reconciliations, VAT and KRA compliance, journal audit, CFO reporting and specialist AI agents in one workspace." };

const FOUNDATION = [
  ["Data hub", "Upload CSV or Excel exports from any system. Variaq detects 12 data types, cleans page headers and totals, maps columns and re-validates everything on the server before import."],
  ["ERP connectors & REST API", "Incremental, idempotent sync from Odoo, Xero, QuickBooks Online, Dynamics 365 Business Central, Zoho Books, generic REST/JSON or files at an HTTPS URL. Scoped API keys for pushing journals."],
  ["Ledger & statements", "Journal-level ledger with drill-down, balance sheet, income statement and cash, all calculated from your imported data."],
  ["Chart of accounts mapping", "Map a subsidiary's or legacy chart to your group chart, translate trial balances and reconcile two ledgers to spot probable mispostings."],
  ["Team, roles & audit log", "Owner, Admin/CFO, Accountant, External auditor and Viewer roles per company. Every change goes into a hash-chained audit log."],
  ["Web & mobile", "Responsive on phones and tablets and installable to the home screen. Company data is never cached offline."],
];

export default function ProductOverview() {
  return (
    <>
      <section className="container page-hero">
        <div className="eyebrow">Platform</div>
        <h1>Everything between the ledger <em>and the board.</em></h1>
        <p className="lede">Variaq runs alongside your accounting system. You bring the data; Variaq gives your team a reviewable workflow for close, tax, audit and reporting — plus specialist AI agents when you want them.</p>
        <div className="row" style={{ marginTop: "1.5rem" }}>
          <Link href="/signup" className="btn primary">Create your workspace</Link>
          <Link href="/pricing" className="btn">See pricing</Link>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="eyebrow">Modules</div>
          <h2>Pick a workflow to explore</h2>
          <div className="module-strip" style={{ marginTop: "1.5rem" }}>
            {MODULES.map((m) => (
              <Link key={m.slug} href={m.href} className={`module-tile m-${m.slug}`}>
                <span className="eyebrow" style={{ marginBottom: ".3rem" }}>{m.eyebrow}</span>
                <strong>{m.title}</strong>
                <p className="muted">{m.blurb}</p>
                <span className="arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <div className="eyebrow">Foundation</div>
          <h2>Shared by every module</h2>
          <div className="grid grid-3" style={{ marginTop: "1.5rem" }}>
            {FOUNDATION.map(([t, d]) => <div className="card flat" key={t}><h3>{t}</h3><p className="muted" style={{ margin: 0 }}>{d}</p></div>)}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid grid-2" style={{ gap: "48px", alignItems: "center" }}>
          <div>
            <div className="eyebrow">How it fits</div>
            <h2>Your ERP stays the <em>book of record.</em></h2>
            <p className="muted">Variaq doesn't replace QuickBooks, Sage, Xero, Odoo or Dynamics. It reads their exports or APIs, does the reconciliation, review, testing and reporting work, and gives you correcting journals (as CSV) to post back in your ERP.</p>
            <p className="muted">There is no public KRA API for iTax data, so VAT reconciliation uses the auto-populated return files you download from iTax. Variaq doesn't file returns on your behalf.</p>
          </div>
          <div className="card flat">
            <h3>Typical month in Variaq</h3>
            <ol className="steps" style={{ marginTop: ".8rem" }}>
              <li><strong>Import</strong><span className="muted small">Ledger, bank and M-Pesa statements, KRA VAT files.</span></li>
              <li><strong>Reconcile & test</strong><span className="muted small">Bank matching, journal audit, completeness, VAT recon.</span></li>
              <li><strong>Close</strong><span className="muted small">Checklist sign-off, then lock the period.</span></li>
              <li><strong>Report</strong><span className="muted small">KPIs, budget vs actual, board pack for approval.</span></li>
            </ol>
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
