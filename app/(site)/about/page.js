import Link from "next/link";
import CtaBand from "../_components/CtaBand";

export const metadata = { title: "About", description: "Variaq is accounting operations software built in Nairobi for Kenyan finance teams." };

const PRINCIPLES = [
  ["People approve, software assists", "Every match, finding, budget and board pack is confirmed by a person. AI drafts and proposes; it never approves."],
  ["Show the reasons", "Suggested matches, audit findings and variance explanations always show why — so reviewers can trust or challenge them."],
  ["Local by default", "KES, M-Pesa, KRA VAT, eTIMS and Kenyan public holidays are first-class, not afterthoughts."],
  ["Honest about limits", "Tax rules cite their sources, unverified items are flagged, and we say clearly what Variaq doesn't do yet."],
];

export default function AboutPage() {
  return (
    <>
      <section className="container page-hero">
        <div className="eyebrow">About Variaq</div>
        <h1>Built in Nairobi for <em>Kenyan finance teams.</em></h1>
        <p className="lede">Finance teams in Kenya juggle ERP exports, bank and M-Pesa statements, eTIMS and iTax files and board deadlines — mostly in spreadsheets. Variaq exists to turn that month into one reviewable workflow, so accountants spend less time chasing numbers and CFOs get decisions out of them.</p>
      </section>
      <section className="section alt">
        <div className="container grid grid-2" style={{ gap: "48px" }}>
          <div>
            <div className="eyebrow">What we're building</div>
            <h2>Accounting operations, <em>not another ledger.</em></h2>
            <p className="muted">Your accounting system stays the book of record. Variaq sits alongside it and handles the work around the ledger: reconciliation, the close, journal testing, VAT reconciliation against KRA data, budgeting, forecasting and board reporting — with specialist AI agents for the heavy lifting.</p>
            <p className="muted">We serve growing SMEs and mid-market finance teams, groups with several entities, and the auditors and advisers who work with them.</p>
          </div>
          <div className="grid">
            {PRINCIPLES.map(([t, d]) => <div className="card flat" key={t}><h3>{t}</h3><p className="muted" style={{ margin: 0 }}>{d}</p></div>)}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="eyebrow">Work with us</div>
          <h2>Pilots, partners and <em>early customers</em></h2>
          <p className="muted">We're looking for early customers and accounting partners to help shape the roadmap. If you run a finance team, an audit or advisory practice, or host business software in East Africa, we'd like to hear from you.</p>
          <div className="row"><Link href="/contact?topic=partner" className="btn">Partner with us</Link><Link href="/product" className="btn ghost">Explore the platform →</Link></div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
