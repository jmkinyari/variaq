import Link from "next/link";
import CtaBand from "../_components/CtaBand";
import { PLAN, monthlyPrice } from "../_components/content";

export const metadata = { title: "Pricing", description: "One simple Variaq plan: $40 per month per company, 5 users included, $5 per additional user per month. Every module and the five AI specialists, online in your browser." };

const EXAMPLES = [5, 8, 12, 20];

const QA = [
  ["What exactly does $40/month include?", "One company workspace with 5 users and every module — close, reconciliations, tax, journal audit, budgets, board packs, connectors and the AI specialists. You sign up and use Variaq in your browser; there's nothing to install."],
  ["How do extra users work?", `Each user beyond the 5 included costs $${PLAN.extraUserPrice} per month. Read-only viewers and board members don't count. Example: 8 users = $40 + 3 × $5 = $${monthlyPrice(8)}/month.`],
  ["We have more than one company.", "Each company workspace is its own $40/month subscription with 5 users included. You can switch between workspaces with the same login."],
  ["What currency, and are taxes included?", "Prices are in US dollars. Local taxes (for example 16% Kenyan VAT) may apply on top."],
  ["How do I pay?", "There's no online checkout on this site yet. Create your workspace, then contact us and we'll invoice you; payment methods (card, bank transfer, M-Pesa) are confirmed on the invoice."],
  ["What does the AI 'fair-use allowance' mean?", "AI usage is metered per company per month. If the allowance is used up, the AI pauses until it resets; everything else keeps working. AI is optional and can be switched off."],
  ["Do I need to host or install anything?", "No. Variaq is delivered online as a service — we run the servers, backups, upgrades and monitoring. Your team just signs in at the website."],
];

export default function PricingPage() {
  return (
    <>
      <section className="container page-hero" style={{ textAlign: "center", margin: "0 auto" }}>
        <div className="eyebrow">Pricing</div>
        <h1>One plan. <em>Every module.</em></h1>
        <p className="lede" style={{ margin: "0 auto" }}>$40 a month includes 5 users. Add more users at $5 each. Sign up and use Variaq online — nothing to install.</p>
      </section>

      <section className="container reveal d1" style={{ paddingBottom: 72 }}>
        <div className="pricing" style={{ maxWidth: 520, margin: "0 auto", gridTemplateColumns: "1fr" }}>
          <div className="price-card featured" id={PLAN.id}>
            <div className="row between"><h3 style={{ margin: 0 }}>{PLAN.name}</h3><span className="badge accent">The only plan</span></div>
            <div className="price">{PLAN.price}<span className="faint small" style={{ fontFamily: "var(--body)" }}> /month</span></div>
            <div className="faint small">{PLAN.per}</div>
            <div style={{ marginTop: ".5rem", fontWeight: 600 }}>{PLAN.extra}</div>
            <p className="muted small" style={{ margin: ".8rem 0 0" }}>{PLAN.tagline}</p>
            <ul>{PLAN.items.map((i) => <li key={i}>{i}</li>)}</ul>
            <div className="meta"><div><strong>AI:</strong> {PLAN.ai}</div><div><strong>Support:</strong> {PLAN.sla}</div><div><strong>Access:</strong> Online in your browser, on desktop or mobile — hosted and maintained by Variaq.</div></div>
            <div className="row" style={{ gap: ".6rem" }}>
              <Link href={PLAN.cta[1]} className="btn primary">{PLAN.cta[0]}</Link>
              <Link href={PLAN.cta2[1]} className="btn">{PLAN.cta2[0]}</Link>
            </div>
          </div>
        </div>
        <p className="faint small" style={{ textAlign: "center", marginTop: "1rem" }}>{PLAN.taxNote}</p>
      </section>

      <section className="section alt">
        <div className="container on-scroll" style={{ maxWidth: 860, textAlign: "center" }}>
          <div className="eyebrow">Simple maths</div>
          <h2>What your team would pay</h2>
          <div className="calc">
            {EXAMPLES.map((n) => {
              const extra = Math.max(0, n - PLAN.includedUsers);
              return <div key={n}><b>${monthlyPrice(n)}</b><span>{n} users / month</span><div className="faint small" style={{ marginTop: ".3rem" }}>{extra ? `$${PLAN.basePrice} + ${extra} × $${PLAN.extraUserPrice}` : "5 included"}</div></div>;
            })}
          </div>
          <p className="faint small" style={{ marginTop: "1rem" }}>Per company workspace. Read-only viewers and board members are free. {PLAN.taxNote}</p>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="eyebrow">Pricing questions</div>
          <h2>Before you ask</h2>
          <div className="faq" style={{ marginTop: "1rem" }}>
            {QA.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
          <p className="muted" style={{ marginTop: "1.5rem" }}>More answers in the <Link href="/faq">FAQ</Link>, or <Link href="/contact?topic=sales&plan=variaq">contact us</Link>.</p>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
