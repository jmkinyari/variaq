import Link from "next/link";
export const metadata = { title: "Terms of service (draft)", description: "Draft terms of service template for Variaq — for review by legal counsel.", robots: { index: false } };

export default function TermsDraft() {
  return (
    <section className="container doc" style={{ maxWidth: 820, padding: "48px 20px 80px" }}>
      <div className="eyebrow">Legal · Draft</div>
      <h1>Terms of service</h1>
      <div className="draft-banner"><strong>Template for counsel review.</strong> This outline is a starting point only — not final legal advice or binding terms. Have a qualified Kenyan advocate prepare the final agreement.</div>
      <h2>1. The service</h2>
      <p className="muted">Variaq provides software for reconciliation, month-end close, journal testing, tax reconciliation, budgeting, forecasting and reporting. It works alongside, and does not replace, the customer's accounting system.</p>
      <h2>2. Not professional advice</h2>
      <p className="muted">Outputs — including tax computations, audit findings, variance explanations and AI-generated drafts — support the customer's own review. They are not accounting, audit, tax or legal advice. Variaq does not file returns with KRA. Customers remain responsible for their filings and financial statements.</p>
      <h2>3. Accounts and access</h2>
      <p className="muted">Customers control who they invite and their roles, and are responsible for keeping credentials secure. [Insert acceptable-use rules.]</p>
      <h2>4. Customer data</h2>
      <p className="muted">Customers own their data. Variaq processes it to provide the service under a data processing agreement. [Insert DPA reference, export and deletion terms.]</p>
      <h2>5. Plans, fees and payment</h2>
      <p className="muted">Fees follow the customer's order form or quote. Current pricing is on the <Link href="/pricing">pricing page</Link>: $40 USD per month per company workspace including 5 users, plus $5 per additional user per month; local taxes may apply. [Insert billing cycle, VAT, late payment and renewal terms.]</p>
      <h2>6. Availability and support</h2>
      <p className="muted">[Insert SLA, maintenance windows and support hours, or reference a separate SLA schedule.]</p>
      <h2>7. Liability</h2>
      <p className="muted">[Insert limitation of liability, indemnities and warranties.]</p>
      <h2>8. Term and termination</h2>
      <p className="muted">[Insert term, termination rights and data return period.]</p>
      <h2>9. Governing law</h2>
      <p className="muted">[Insert governing law and dispute resolution — e.g. laws of Kenya.]</p>
    </section>
  );
}
