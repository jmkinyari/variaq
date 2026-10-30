import Link from "next/link";
import CtaBand from "./_components/CtaBand";
import { MODULES, AGENTS, PLAN } from "./_components/content";

export const metadata = {
  title: { absolute: "Variaq — AI finance agents for close, tax and audit, with your team in control" },
  description: "Five specialist AI agents help Kenyan finance teams close the month, reconcile bank and M-Pesa, test journals, reconcile VAT against KRA and build board packs — online, $40/month for 5 users.",
};

const ICONS = { close: "⇄", tax: "%", audit: "◎", reporting: "▤", ai: "✦" };
const AGENT_COLORS = ["#14e3c5", "#ffc24b", "#a78bfa", "#ff8a73", "#5ee0ff"];

// Illustrative activity — sample data, labelled as such in the UI.
const FEED = [
  ["MC", "#14e3c5", "Month-End Close", "12 of 16 close tasks done · 2 blockers flagged", "On track", "teal"],
  ["KT", "#5ee0ff", "KRA Tax", "VAT vs KRA return: 1 eTIMS invoice missing from ERP", "Review", "sun"],
  ["JA", "#ff8a73", "Journal Audit", "Self-approved round-sum entry posted on a Sunday", "High risk", "coral"],
  ["BF", "#ffc24b", "Budget Forecast", "Opex 8% over budget — suggested cause: timing", "Draft", "violet"],
  ["CR", "#a78bfa", "CFO Reporting", "April board pack drafted — awaiting your approval", "Approve", "teal"],
];

// Product facts only (from the codebase) — not customer claims.
const METRICS = [
  ["5", "specialist AI agents, routed by page"],
  ["21", "automated journal-entry tests"],
  ["12", "data types auto-detected on import"],
  ["$40", "per month · 5 users included"],
];

const SYSTEMS = ["QuickBooks", "Sage", "Xero", "Odoo", "Dynamics 365 BC", "Zoho Books", "M-Pesa statements", "KRA iTax exports", "eTIMS", "CSV & Excel"];

const FLOW = [
  ["Ask in context", "From the tax, close or audit page — Variaq routes you to the right specialist."],
  ["Agent does the legwork", "Reads your workspace through read-only tools, scoped to your company and period."],
  ["Runs in the background", "Board packs, audit packs and VAT recon summaries queue as jobs and save as artifacts."],
  ["You approve", "Agents only propose. A person signs off, and every action is in the audit log."],
];

export default function Home() {
  return (
    <>
      <section className="v-dark v-mesh v-hero">
        <div className="v-grid-bg" aria-hidden="true" />
        <div className="container hero">
          <div className="reveal">
            <div className="v-chip"><b>NEW</b> Five AI finance specialists, built in</div>
            <h1>AI agents run your close, tax &amp; audit. <em>Your team stays in control.</em></h1>
            <p className="lede">Variaq is the online finance workspace for Kenyan teams: reconcile bank and M-Pesa, test every journal, reconcile VAT against KRA and ship board packs — with specialist agents doing the legwork and people approving every step.</p>
            <div className="row" style={{ marginTop: "1.8rem" }}>
              <Link href="/signup" className="btn glow">Get started — $40/mo</Link>
              <Link href="/contact?topic=demo" className="btn light">Book a demo</Link>
            </div>
            <p className="faint small" style={{ marginTop: "1rem" }}>5 users included · +$5 per extra user · runs in your browser, nothing to install</p>
          </div>
          <div className="glass reveal d2" aria-label="Sample agent activity">
            <div className="console-head"><i /><i /><i />Variaq · April 2026 close · Demo Supplies Ltd</div>
            <div className="feed">
              {FEED.map(([ab, c, n, d, tag, tone]) => (
                <div className="feed-item" key={n}>
                  <span className="av" style={{ background: c }}>{ab}</span>
                  <span><strong>{n}</strong><small>{d}</small></span>
                  <span className={`pill ${tone}`}>{tag}</span>
                </div>
              ))}
            </div>
            <div className="console-foot"><span>Close progress</span><div className="bar"><span /></div><span style={{ marginLeft: ".8rem" }}>75%</span></div>
            <p className="faint small" style={{ margin: ".8rem 0 0" }}>Sample data for illustration.</p>
          </div>
        </div>
        <div className="container">
          <div className="ticker-label">Works with exports from</div>
          <div className="ticker" aria-label="Supported systems">
            <div className="ticker-track">{[...SYSTEMS, ...SYSTEMS].map((s, i) => <span key={i} aria-hidden={i >= SYSTEMS.length}>{s}</span>)}</div>
          </div>
        </div>
      </section>

      <div className="container">
        <div className="metrics">
          {METRICS.map(([n, l]) => <div className="metric" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>)}
        </div>
      </div>

      <section id="platform" className="section">
        <div className="container">
          <div className="row between on-scroll" style={{ alignItems: "flex-end" }}>
            <div>
              <div className="eyebrow">The Variaq platform</div>
              <h2>One workspace for the <em>whole finance month.</em></h2>
              <p className="lede" style={{ margin: 0 }}>Every module is included in the one plan.</p>
            </div>
            <Link href="/product" className="btn sm">Explore the platform →</Link>
          </div>
          <div className="module-strip" style={{ marginTop: "2rem" }}>
            {MODULES.map((m) => (
              <Link key={m.slug} href={m.href} className={`module-tile m-${m.slug} on-scroll`}>
                <span className="ico" aria-hidden="true">{ICONS[m.slug]}</span>
                <span className="eyebrow" style={{ marginBottom: ".2rem" }}>{m.eyebrow}</span>
                <strong>{m.title}</strong>
                <p className="muted">{m.blurb}</p>
                <span className="arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="ai" className="section v-dark v-mesh">
        <div className="v-grid-bg" aria-hidden="true" />
        <div className="container">
          <div className="on-scroll" style={{ maxWidth: 760 }}>
            <div className="eyebrow">Variaq AI specialists</div>
            <h2>Five finance specialists. <em>Zero autopilot.</em></h2>
            <p className="lede">Each agent knows one job deeply and only sees what it needs. AI is optional, runs only after your company owner consents, and can only <strong>propose</strong> — never approve.</p>
          </div>
          <div className="agents-grid">
            {AGENTS.map(([n, d], i) => (
              <div className="agent-card on-scroll" key={n}>
                <div className="av" style={{ background: AGENT_COLORS[i % AGENT_COLORS.length] }}>{n.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
                <strong>{n}</strong>
                <p className="muted">{d}</p>
              </div>
            ))}
          </div>
          <div className="flow">
            {FLOW.map(([t, d]) => <div key={t} className="on-scroll"><strong>{t}</strong>{d}</div>)}
          </div>
          <div style={{ marginTop: "2rem" }}><Link href="/product/ai" className="btn light">How the agents work →</Link></div>
        </div>
      </section>

      <section id="kenya" className="section">
        <div className="container grid grid-2" style={{ alignItems: "center", gap: "56px" }}>
          <div className="on-scroll">
            <div className="eyebrow">Built for Kenya</div>
            <h2>Local by default. <em>Ready to grow.</em></h2>
            <p className="lede">KES reporting, bank and M-Pesa statements, KRA's auto-populated VAT return, eTIMS deductibility and a filing calendar that rolls past weekends and Kenyan public holidays.</p>
            <p className="muted">Tax rates and deadlines are listed with their sources and an "unverified" flag where a KRA source couldn't be confirmed — your tax adviser stays in control.</p>
          </div>
          <div className="grid">
            {[["Local requirements", "VAT, withholding tax, PAYE, NSSF, SHIF and the Housing Levy, each with its source and a 'verified' flag."],
              ["Bank and M-Pesa in one place", "Reconcile KCB, Equity, NCBA, M-Pesa and other statements against your ledger, with one view of what still needs attention."],
              ["Human oversight", "Matches, exceptions, budgets and board packs are confirmed by people, and every action goes into a tamper-evident audit log."]].map(([t, d]) => (
              <div className="tile-c card on-scroll" key={t}><h3><span className="dot" />{t}</h3><p className="muted" style={{ margin: 0 }}>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt" id="pricing">
        <div className="container">
          <div className="price-band v-dark v-mesh on-scroll">
            <div>
              <div className="eyebrow">Pricing</div>
              <div className="big">{PLAN.price}<small> /month</small></div>
              <p className="lede" style={{ marginTop: ".8rem" }}>One plan, every module and all five AI specialists. <strong>Includes 5 users</strong>; additional users are <strong>$5 per user per month</strong>.</p>
              <div className="row" style={{ marginTop: "1.2rem" }}>
                <Link href={PLAN.cta[1]} className="btn glow">{PLAN.cta[0]}</Link>
                <Link href="/pricing" className="btn light">See pricing details</Link>
              </div>
              <p className="faint small" style={{ marginTop: "1rem", marginBottom: 0 }}>{PLAN.taxNote}</p>
            </div>
            <ul>
              <li>Close, bank &amp; M-Pesa reconciliation</li>
              <li>VAT vs KRA reconciliation &amp; eTIMS checks</li>
              <li>Journal audit, auditor queries &amp; evidence packs</li>
              <li>KPIs, budgets, forecasts &amp; board packs</li>
              <li>Five AI specialists (fair-use allowance)</li>
              <li>Online — sign up and start in minutes</li>
            </ul>
          </div>
        </div>
      </section>

      <CtaBand text="Create your workspace and start with your own data today — or book a 30-minute walkthrough of a demo company with planted audit issues, a VAT reconciliation and a board pack." />
    </>
  );
}
