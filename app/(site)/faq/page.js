import Link from "next/link";
export const metadata = { title: "FAQ", description: "What Variaq does, who it's for, pricing, online access, AI agents, data ownership and local tax requirements." };

const GROUPS = [
  ["Product", [
    ["Who is Variaq for?", "Finance teams at growing businesses in Kenya, in any industry — from a two-person finance function to a team closing the books for several entities — plus the external auditors who work with them."],
    ["What can it do today?", "Import ledgers, bank and M-Pesa statements from CSV/Excel or ERP connectors; reconcile and review exceptions; run a month-end close checklist with period locks; run 21 journal-audit tests and completeness checks; answer auditor queries with evidence packs; reconcile VAT against KRA's auto-populated return; build budgets, cash forecasts and board packs; and use five optional AI specialists. See the platform pages for detail."],
    ["Does it replace my accounting system?", "No. Variaq works alongside QuickBooks, Sage, Odoo, Xero, Dynamics, Zoho, ERPNext and others. Your ERP stays the book of record; Variaq gives you correcting journals as CSV to post back."],
    ["Is bank matching done by AI?", "No. Bank-to-ledger matching is rule-based: it compares amounts, dates, references and descriptions and shows the reasons for every suggestion. A person confirms each match."],
    ["Does it handle KRA tax rules or eTIMS?", "Variaq reconciles your ERP registers against the auto-populated VAT return files you download from iTax, prepares VAT3 sheet O and iTax-format schedules, and estimates eTIMS-related non-deductible expenses. It doesn't file with KRA or connect to KRA systems directly — there's no public KRA API for that data. Rates and deadlines list their sources and unverified items are flagged; have your tax adviser confirm them."],
    ["What file formats can I import?", "CSV and Excel (.xlsx, .xls, .ods, including multi-sheet files). Variaq detects the data type, cleans title and total rows, and lets you map columns with any names."],
  ]],
  ["AI agents", [
    ["What are the AI specialists?", "Five agents embedded in the app: CFO Reporting, Budget Forecast, Month-End Close, Journal Audit and KRA Tax. An Auto mode routes your question to the right one based on the page you're on and what you ask. Heavy work like board packs or tax recon summaries runs in the background and is saved as an artifact in your workspace."],
    ["Can the AI change my books?", "No. Agents read your data through read-only tools and can only propose tasks and reports. A person has to approve each one. They can't post, approve or delete anything."],
    ["Is AI required?", "No. Every module works without AI. AI only runs when it's enabled for your company and your company owner has consented. The Month-End Close summary works even without an AI key."],
    ["Where does AI processing happen?", "Requests are processed by a third-party model provider (Anthropic) configured by Variaq administrators. Conversations and reports are stored encrypted with your company's own key, and usage is metered against a monthly allowance."],
  ]],
  ["Data & security", [
    ["Who owns the data?", "You do. Variaq processes your company's data to provide the service. Deleting a workspace deletes its encryption keys, so leftover copies in backups become unreadable."],
    ["Who can see my data?", "Only people you invite to your workspace, with the role you give them: Owner, Admin/CFO, Accountant, External auditor (read-only plus queries) or Viewer. Every change is recorded in a tamper-evident audit log."],
    ["How is data protected?", "Per-company encryption keys for sensitive fields, HTTPS, two-step verification, rate-limited sign-in, strict security headers and a hash-chained audit log. Read the Security page for the full picture."],
    ["Are you ISO 27001 or SOC 2 certified?", "Not at this time. We'll share our security architecture and answer your security questionnaire."],
  ]],
  ["Pricing & access", [
    ["How much does it cost?", "One plan: $40 USD per month per company workspace, which includes 5 users. Additional users are $5 per user per month (e.g. 8 users = $55/month). Every module and the AI specialists are included. Local taxes (e.g. Kenyan VAT) may apply. See the pricing page."],
    ["How do we pay?", "There's no online checkout yet: create your workspace and we'll invoice you. Payment methods (card, bank transfer, M-Pesa) are confirmed on the invoice."],
    ["Do we need to install or host anything?", "No. Variaq is software as a service: sign up on the website and use it in your browser on desktop or mobile. We run the servers, backups, upgrades and monitoring."],
    ["Where is our data hosted?", "On Variaq-operated cloud infrastructure, encrypted per company. Ask us for the current hosting region if your policies require it."],
  ]],
];

export default function FaqPage() {
  return (
    <section className="container" style={{ maxWidth: 820, padding: "48px 20px 80px" }}>
      <div className="eyebrow">FAQ</div>
      <h1>Questions finance teams ask</h1>
      <p className="lede">A clear picture of what Variaq does — and what it doesn't — before you sign up.</p>
      {GROUPS.map(([g, items], gi) => (
        <div key={g} style={{ marginTop: "2.2rem" }}>
          <h2 style={{ fontSize: "1.4rem" }}>{g}</h2>
          <div className="faq">
            {items.map(([q, a], i) => <details key={q} open={gi === 0 && i === 0}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </div>
      ))}
      <div className="card flat" style={{ marginTop: "2.5rem" }}>
        <strong>Still have questions?</strong>
        <p className="muted" style={{ margin: ".3rem 0 .8rem" }}>Read about <Link href="/pricing">pricing</Link>, and <Link href="/security">security</Link>, or talk to us.</p>
        <Link href="/contact?topic=demo" className="btn primary sm">Book a demo</Link>
      </div>
    </section>
  );
}
