import Link from "next/link";
import ContactForm from "./ContactForm";
export const metadata = { title: "Contact & demo", description: "Request a Variaq demo, ask about pricing and billing, or talk to us about security." };

const TOPICS = ["demo", "sales", "security", "partner", "support", "other"];
const PLANS = ["variaq"];

export default function ContactPage({ searchParams }) {
  const topic = TOPICS.includes(searchParams?.topic) ? searchParams.topic : "demo";
  const plan = PLANS.includes(searchParams?.plan) ? searchParams.plan : "";
  return (
    <section className="container grid grid-2" style={{ padding: "48px 20px 80px", gap: "48px", alignItems: "start" }}>
      <div>
        <div className="eyebrow">Contact & demo</div>
        <h1>Request a <em>demo.</em></h1>
        <p className="lede">Tell us about your finance team and the work you'd like to simplify. No account needed.</p>
        <div className="card flat" style={{ marginTop: "1.5rem" }}>
          <h3>What a demo covers</h3>
          <ol className="steps" style={{ marginTop: ".6rem" }}>
            <li><strong>Your workflow</strong><span className="muted small">Your ERP, entities, banks and month-end pain points.</span></li>
            <li><strong>Live walkthrough</strong><span className="muted small">A demo company with a bank reconciliation, planted audit issues, a VAT reconciliation and a board pack.</span></li>
            <li><strong>AI specialists</strong><span className="muted small">How the five agents work, with consent and approval controls.</span></li>
            <li><strong>Pricing & sign-up</strong><span className="muted small">One plan: $40/month for 5 users, $5 per extra user. Sign up and use Variaq online — nothing to install.</span></li>
          </ol>
        </div>
        <p className="muted small" style={{ marginTop: "1.2rem" }}>We typically reply within one business day (Monday–Friday, East Africa Time). Demos run about 30–45 minutes online or at your office in Nairobi.</p>
        <p className="faint small">Prefer to explore first? <Link href="/signup">Create a workspace</Link> or read the <Link href="/faq">FAQ</Link>.</p>
      </div>
      <ContactForm topic={topic} plan={plan} />
    </section>
  );
}
