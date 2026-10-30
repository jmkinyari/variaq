import Link from "next/link";
import db from "@/lib/db";
import Submit from "@/components/Submit";
import { aiStatus } from "@/lib/ai/config";
import { formatDateTime } from "@/lib/dates";
import { setAiConsent } from "./actions";

/** Company-side AI settings: status, monthly usage, and the owner's data-processing consent. */
export default async function AiSettingsCard({ ws }) {
  const s = await aiStatus(ws.id);
  const ent = await db.get("SELECT e.consent_at, u.name FROM ai_entitlements e LEFT JOIN users u ON u.id = e.consent_by WHERE e.workspace_id = ?", [ws.id]);
  const pct = s.limit ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 0;
  return (
    <div className="card" style={{ maxWidth: 760, marginTop: "1rem" }} id="ai">
      <div className="row between"><h3 style={{ margin: 0 }}>Variaq AI</h3>{s.ok ? <span className="badge good">Available</span> : <span className="badge">{s.needsConsent ? "Needs consent" : "Unavailable"}</span>}</div>
      <p className="muted small" style={{ marginTop: ".6rem" }}>The AI assistant answers questions about your figures, explains pages, proposes follow-up tasks and writes HTML reports. It reads your company's data through read-only tools; it can't post, approve or delete anything, and every proposal needs a person to approve it. Variaq manages the AI service and its key.</p>
      {!s.ok && <div className="alert info small">{s.reason}</div>}
      <div className="small">This month: <strong>{s.used.toLocaleString()}</strong> of {s.limit ? s.limit.toLocaleString() : "unlimited"} tokens{s.limit ? ` (${pct}%)` : ""}.</div>
      {s.limit > 0 && <div className="progress" style={{ margin: ".4rem 0 1rem" }}><span style={{ width: `${pct}%` }} /></div>}
      <p className="small">Data processing consent: {ent?.consent_at ? <>given by {ent.name} on {formatDateTime(ent.consent_at)}.</> : "not given."} When consent is given, the data needed to answer each request (for example account balances, journals and findings) is sent to Anthropic's Claude API for processing.</p>
      {ws.role === "OWNER" ? (
        <form action={setAiConsent} className="row">
          <input type="hidden" name="slug" value={ws.slug} />
          <input type="hidden" name="consent" value={ent?.consent_at ? "0" : "1"} />
          {ent?.consent_at ? <Submit className="btn" confirm="Withdraw consent? AI stops working for everyone in this company.">Withdraw consent</Submit>
            : <Submit className="btn primary" confirm="Allow Variaq AI to process this company's data?">Allow AI for this company</Submit>}
          {s.ok && <Link className="btn ghost" href={`/app/${ws.slug}/ai`}>Open AI workspace</Link>}
        </form>
      ) : <p className="faint small">Only the workspace owner can give or withdraw consent.</p>}
    </div>
  );
}
