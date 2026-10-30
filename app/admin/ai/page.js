import db from "@/lib/db";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { getAiConfig, MODELS, EFFORTS } from "@/lib/ai/config";
import { formatDateTime } from "@/lib/dates";
import { saveAiSettings, renewAiKey, retestAiKey, revokeAiKey } from "../actions";
export const metadata = { title: "AI service" };

export default async function AdminAi({ searchParams }) {
  const cfg = await getAiConfig({ fresh: true });
  const [events, byFeature] = await Promise.all([
    db.all("SELECT e.*, u.email FROM ai_key_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.created_at DESC LIMIT 20"),
    db.all("SELECT feature, model, COUNT(*) calls, SUM(input_tokens) i, SUM(output_tokens) o, SUM(cost_micros) cost FROM ai_usage WHERE created_at >= ? GROUP BY feature, model ORDER BY cost DESC", [new Date().toISOString().slice(0, 7) + "-01"]),
  ]);
  const suggestRenew = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const stateText = { OK: ["Active", "good"], RENEW_SOON: ["Due for renewal", "warn"], EXPIRED: ["Renewal overdue — AI paused", "bad"], MISSING: ["No key configured", "bad"] }[cfg.keyState];
  return (
    <>
      <h1>AI service</h1>
      <p className="muted">One AI service for all companies on Variaq. Companies can't see or change the key; they only see whether AI is available and their own usage. Each company's owner must also allow AI to process their data.</p>
      <Flash searchParams={searchParams} />

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <form action={saveAiSettings} className="card">
          <h3>Settings</h3>
          <label className="row" style={{ fontWeight: 500 }}><input type="checkbox" name="enabled" defaultChecked={cfg.enabled} style={{ width: "auto" }} /> AI enabled for the platform</label>
          <div className="field" style={{ marginTop: ".8rem" }}><label>Model</label><select name="model" defaultValue={cfg.model}>{Object.entries(MODELS).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}</select>
            <div className="help">Per million tokens: {Object.entries(MODELS).map(([id, m]) => `${id} $${m.inUsd} in / $${m.outUsd} out`).join(" · ")}</div></div>
          <div className="form-row">
            <div className="field"><label>Effort</label><select name="effort" defaultValue={cfg.effort}>{EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}</select><div className="help">Higher = more thorough answers, more tokens.</div></div>
            <div className="field"><label>Default monthly allowance (tokens per company)</label><input name="defaultMonthlyTokens" type="number" min="0" step="1000" defaultValue={cfg.defaultMonthlyTokens} /><div className="help">0 = unlimited. Override per company under Companies.</div></div>
          </div>
          <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" name="newCompaniesEnabled" defaultChecked={cfg.newCompaniesEnabled} style={{ width: "auto" }} /> Include AI for companies by default (they still need their owner's consent)</label>
          <div style={{ marginTop: "1rem" }}><Submit>Save settings</Submit></div>
        </form>

        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>API key</h3><span className={`badge ${stateText[1]}`}>{stateText[0]}</span></div>
          <dl className="ai-dl">
            <dt>Current key</dt><dd>{cfg.keyMeta?.hint || (cfg.keySource === "environment" ? "Set in the server environment (ANTHROPIC_API_KEY)" : "None")}</dd>
            <dt>Renewed</dt><dd>{cfg.keyMeta?.renewedAt ? formatDateTime(cfg.keyMeta.renewedAt) : "—"}</dd>
            <dt>Renew by</dt><dd>{cfg.renewBy || "No date set"}</dd>
            <dt>Last test</dt><dd>{cfg.keyMeta?.lastTestAt ? `${formatDateTime(cfg.keyMeta.lastTestAt)} — ${cfg.keyMeta.lastTestOk ? "passed" : "failed"}` : "—"}</dd>
          </dl>
          <form action={renewAiKey} className="stack" style={{ marginTop: ".8rem" }}>
            <div className="field"><label>{cfg.key ? "Renew with a new key" : "Add a key"}</label><input name="apiKey" type="password" autoComplete="off" placeholder="sk-ant-…" required /><div className="help">Tested live before it replaces the current key. Stored encrypted with the platform master key and never shown again.</div></div>
            <div className="form-row">
              <div className="field"><label>Renew by</label><input name="renewBy" type="date" defaultValue={suggestRenew} /><div className="help">Reminders start 14 days before; AI pauses after this date until renewed.</div></div>
              <div className="field"><label>Note (optional)</label><input name="note" maxLength={200} placeholder="e.g. Q4 rotation" /></div>
            </div>
            <Submit pendingText="Testing key…">Test and activate</Submit>
          </form>
          {cfg.key && <div className="row" style={{ marginTop: ".8rem" }}>
            <form action={retestAiKey}><Submit className="btn sm" pendingText="Testing…">Test current key</Submit></form>
            {cfg.keySource === "console" && <form action={revokeAiKey}><Submit className="btn sm danger" confirm="Remove the platform AI key? AI stops for every company immediately.">Remove key</Submit></form>}
          </div>}
        </div>
      </div>

      <h2 style={{ marginTop: "2rem" }}>Usage this month by feature</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Feature</th><th>Model</th><th className="num">Calls</th><th className="num">Input tokens</th><th className="num">Output tokens</th><th className="num">Cost (USD)</th></tr></thead>
        <tbody>{byFeature.map((r) => <tr key={r.feature + r.model}><td>{r.feature}</td><td>{r.model}</td><td className="num">{r.calls}</td><td className="num">{Number(r.i).toLocaleString()}</td><td className="num">{Number(r.o).toLocaleString()}</td><td className="num">${(r.cost / 1e6).toFixed(2)}</td></tr>)}
          {!byFeature.length && <tr><td colSpan={6} className="empty">No usage yet this month.</td></tr>}</tbody>
      </table></div>

      <h2 style={{ marginTop: "2rem" }}>Key history</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Action</th><th>Key</th><th>Result</th><th>By</th></tr></thead>
        <tbody>{events.map((e) => <tr key={e.id}><td className="small">{formatDateTime(e.created_at)}</td><td>{e.action}</td><td className="mono small">{e.key_hint || "—"}</td><td className="small wrap"><span className={`badge ${e.ok ? "good" : "bad"}`}>{e.ok ? "ok" : "failed"}</span> {e.note}</td><td className="small">{e.email}</td></tr>)}
          {!events.length && <tr><td colSpan={5} className="empty">No key changes yet.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
