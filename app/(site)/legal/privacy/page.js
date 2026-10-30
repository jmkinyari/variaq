import Link from "next/link";
export const metadata = { title: "Privacy notice (draft)", description: "Draft privacy notice template for Variaq — for review by legal counsel.", robots: { index: false } };

export default function PrivacyDraft() {
  return (
    <section className="container doc" style={{ maxWidth: 820, padding: "48px 20px 80px" }}>
      <div className="eyebrow">Legal · Draft</div>
      <h1>Privacy notice</h1>
      <div className="draft-banner"><strong>Template for counsel review.</strong> This is a working draft, not final legal advice or a binding notice. It must be reviewed by a qualified Kenyan advocate against the Data Protection Act, 2019 and its regulations before publication.</div>
      <h2>1. Who we are</h2>
      <p className="muted">Variaq ("we") provides accounting operations software from Nairobi, Kenya. [Insert registered company name, address and Data Protection Commissioner registration details.]</p>
      <h2>2. Roles</h2>
      <p className="muted">For company finance data uploaded to a workspace, the customer is the data controller and Variaq acts as data processor. For website visitors, account holders and contact-form submissions, Variaq is the controller.</p>
      <h2>3. Data we collect</h2>
      <ul>
        <li>Account data: name, email, password hash, two-step verification settings, session and sign-in records (including IP address).</li>
        <li>Workspace data uploaded by customers: ledgers, bank and M-Pesa statements, tax files, budgets and related records, which may include personal data of counterparties.</li>
        <li>Contact and demo requests: name, email, company and message.</li>
        <li>Audit and usage records: actions taken in the app, AI usage metering.</li>
      </ul>
      <h2>4. How we use it</h2>
      <p className="muted">To provide and secure the service, authenticate users, keep audit trails, respond to enquiries and meet legal obligations. [Confirm lawful bases with counsel.]</p>
      <h2>5. AI processing</h2>
      <p className="muted">AI features are off unless enabled for a company and consented to by its owner. When used, data needed for a request is sent to our AI provider (Anthropic) for processing. [Insert provider terms, data-transfer safeguards and retention.]</p>
      <h2>6. Storage, security and transfers</h2>
      <p className="muted">Data is encrypted in transit and sensitive fields are encrypted per company. Hosting location is [insert region]. See our <Link href="/security">Security page</Link>. [Describe cross-border transfer safeguards.]</p>
      <h2>7. Retention</h2>
      <p className="muted">[Insert retention periods for accounts, workspace data, backups, logs and contact messages.]</p>
      <h2>8. Your rights</h2>
      <p className="muted">Data subjects have rights under the Data Protection Act, 2019, including access, correction, deletion and objection. Contact [insert privacy contact email].</p>
      <h2>9. Changes</h2>
      <p className="muted">[Insert how changes are notified and the effective date.]</p>
    </section>
  );
}
