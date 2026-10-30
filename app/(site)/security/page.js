import Link from "next/link";
import CtaBand from "../_components/CtaBand";

export const metadata = { title: "Security & data protection", description: "How Variaq isolates, encrypts and audits company finance data: multi-tenancy, envelope encryption, tamper-evident audit log, roles, 2FA, AI consent and how the hosted service is operated." };

const PILLARS = [
  ["Tenant isolation", "Every company is its own workspace. Every query is scoped by the workspace resolved from your membership, and records loaded by id are re-checked against it. Non-members get a 404, so other companies can't even be discovered."],
  ["Per-company encryption", "Each workspace has its own 256-bit data key, wrapped by a master key held outside the database. Sensitive fields are sealed with AES-256-GCM and bound to the workspace and field, so ciphertext copied elsewhere won't decrypt."],
  ["Tamper-evident audit log", "Imports, matches, approvals, role changes, period locks, key rotations, syncs and API writes are logged with user, time and IP, and sealed into a per-workspace SHA-256 hash chain that the app verifies."],
  ["Least-privilege roles", "Owner, Admin/CFO, Accountant, External auditor (read-only plus queries) and Viewer. Permissions are checked on the server for every action — the UI only hides buttons."],
];

const SECTIONS = [
  ["Authentication", [
    "Passwords hashed with bcrypt (cost 12); minimum 12 characters, common passwords and your own name/email blocked.",
    "Sign-in rate-limited per IP and per IP+email; accounts lock for 15 minutes after 5 failed attempts.",
    "Two-step verification (TOTP, any authenticator app) with replay protection and 8 one-time recovery codes.",
    "Session tokens are 256-bit random values in HttpOnly, SameSite=Lax cookies (Secure + __Host- prefix in production); only a hash is stored. Idle timeout 8 h, absolute lifetime 7 days by default.",
    "Users can see their active sessions and sign the others out; changing a password signs out every other session.",
  ]],
  ["Encryption", [
    "In transit: HTTPS, with an HSTS header in production.",
    "At rest (database): libSQL page encryption for a local database file when DATABASE_ENCRYPTION_KEY is set; hosted libSQL/Turso uses the provider's at-rest encryption.",
    "Field-level envelope encryption for ERP connector credentials and tokens, KRA PINs, auditor queries and responses, TOTP seeds, AI conversations, reports and agent artifacts.",
    "Owners can rotate their workspace key; deleting a workspace deletes its keys (crypto-shredding), making leftover ciphertext in backups unreadable.",
  ]],
  ["Data integrity", [
    "Period locks reject imports, connector syncs and API pushes into a closed month.",
    "Optimistic locking on budgets, forecasts, close tasks and board packs: concurrent edits get a clear conflict instead of silently overwriting.",
    "Server-side re-validation of every import; idempotent ingestion keyed by source and external id; control totals on every sync.",
  ]],
  ["Web application security", [
    "Strict Content-Security-Policy with no third-party scripts, frame-ancestors 'none', plus X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy and COOP/CORP headers.",
    "Server Actions are POST-only and origin-checked against APP_URL (CSRF protection).",
    "Outbound connector requests go through an SSRF guard: HTTPS only, DNS re-checked on every redirect, private and cloud-metadata ranges blocked, timeouts and size caps.",
    "All SQL uses bound parameters; uploads are normalised and length-capped; app and API responses are Cache-Control: no-store.",
    "API keys are scoped per workspace, stored hashed, rate-limited, with optional HMAC request signing.",
  ]],
  ["AI and your data", [
    "Two gates: Variaq must enable AI for your company, and your company owner must consent. Without both, nothing is sent to the model.",
    "The model reads data only through read-only tools scoped to your workspace; the workspace id comes from the session, never from the model.",
    "Agents can only propose tasks and reports — a person approves each one.",
    "Tool results are labelled as data to defend against prompt injection through journal narrations or other records.",
    "AI-generated HTML is sanitised against an allow-list and shown in a sandboxed frame; share links are random, hashed, time-limited and revocable.",
    "The AI provider key is held by Variaq administrators (2FA required), stored encrypted, tested before activation, and every admin action is logged.",
    "Usage is metered per company, user and feature with monthly allowances and rate limits.",
  ]],
  ["Mobile and offline", [
    "The installable app's service worker caches only static assets and an offline page — never company data, API responses or reports — and clears its cache on sign-out.",
  ]],
];

export default function SecurityPage() {
  return (
    <>
      <section className="container page-hero">
        <div className="eyebrow">Security & data protection</div>
        <h1>Your ledger is <em>your business.</em></h1>
        <p className="lede">Variaq holds ledgers, tax data and ERP credentials for many companies at once. Here's exactly how that data is isolated, encrypted and audited — written from what the product actually does.</p>
        <div className="row" style={{ marginTop: "1.5rem" }}>
          <Link href="/signup" className="btn primary">Get started</Link>
          <Link href="/contact?topic=security" className="btn">Request a security review call</Link>
        </div>
      </section>

      <section className="section alt">
        <div className="container grid grid-2">
          {PILLARS.map(([t, d]) => <div className="card flat" key={t}><h3>{t}</h3><p className="muted" style={{ margin: 0 }}>{d}</p></div>)}
        </div>
      </section>

      <section className="section">
        <div className="container doc" style={{ maxWidth: 900 }}>
          {SECTIONS.map(([h, items]) => (
            <div key={h}>
              <h2>{h}</h2>
              <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}

          <h2>Data residency & ownership</h2>
          <ul>
            <li><strong>You own your data.</strong> Variaq processes it to provide the service. Reports download as PDF/HTML, correcting journals and iTax schedules as CSV, and deleting a workspace deletes its encryption keys. Ask us about a full export of your workspace data.</li>
            <li><strong>Where it lives.</strong> Variaq is a hosted service: your data is stored on Variaq-operated cloud infrastructure, encrypted per company. Ask us for the current hosting region.</li>
            <li><strong>AI processing.</strong> When AI is enabled and consented to, the data the agent reads for a request is sent to the AI provider (Anthropic) for processing. Turn AI off and none of your data is sent to an AI provider.</li>
            <li><strong>Kenya Data Protection Act, 2019.</strong> Variaq provides controls (access roles, encryption, audit trail, deletion) that support your obligations as a data controller. Compliance depends on how you configure and use it; we don't claim a certification.</li>
          </ul>

          <h2>Certifications</h2>
          <p className="muted">Variaq does not currently hold ISO 27001, SOC 2 or similar certifications. We'll share this page, the security architecture document and answers to your security questionnaire on request.</p>

          <h2>How we operate the service</h2>
          <ul>
            <li>Encryption master keys are kept in a secrets manager and backed up separately from the database.</li>
            <li>The service is served only over HTTPS.</li>
            <li>The database is backed up, with point-in-time recovery where the provider supports it.</li>
            <li>Two-step verification is available for every user and required for our platform administrators. We recommend owners and admins turn it on.</li>
            <li>Tax rates and deadlines shipped in the product should be checked by your own tax adviser.</li>
          </ul>
          
        </div>
      </section>
      <CtaBand title={<>Questions from your <em>IT or audit team?</em></>} text="We'll walk your reviewers through the architecture, tenancy model and controls." />
    </>
  );
}
