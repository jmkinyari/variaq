import Link from "next/link";
import db from "@/lib/db";
import Flash from "@/components/Flash";
import { getAiConfig, MODELS } from "@/lib/ai/config";
import { formatDateTime } from "@/lib/dates";
export const metadata = { title: "Overview" };

const usd = (micros) => `$${(micros / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function AdminHome({ searchParams }) {
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const [cfg, counts, usage, top, recent] = await Promise.all([
    getAiConfig({ fresh: true }),
    db.get(`SELECT (SELECT COUNT(*) FROM workspaces) companies, (SELECT COUNT(*) FROM workspaces WHERE suspended_at IS NOT NULL) suspended,
      (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM users WHERE mfa_enabled = 1) mfa,
      (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_seen_at >= ?) active`, [new Date(Date.now() - 86400000).toISOString()]),
    db.get("SELECT COUNT(*) calls, COALESCE(SUM(input_tokens + output_tokens),0) tokens, COALESCE(SUM(cost_micros),0) cost, COALESCE(SUM(CASE WHEN ok = 0 THEN 1 END),0) failed FROM ai_usage WHERE created_at >= ?", [month]),
    db.all("SELECT w.name, COUNT(*) calls, SUM(u.input_tokens + u.output_tokens) tokens, SUM(u.cost_micros) cost FROM ai_usage u JOIN workspaces w ON w.id = u.workspace_id WHERE u.created_at >= ? GROUP BY u.workspace_id ORDER BY tokens DESC LIMIT 8", [month]),
    db.all("SELECT a.*, u.email FROM platform_audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 8"),
  ]);
  const keyBadge = { OK: ["Active", "good"], RENEW_SOON: ["Renew soon", "warn"], EXPIRED: ["Renewal overdue", "bad"], MISSING: ["No key", "bad"] }[cfg.keyState];
  return (
    <>
      <h1>Platform overview</h1>
      <Flash searchParams={searchParams} />
      {cfg.keyState !== "OK" && <div className={`alert ${cfg.keyState === "RENEW_SOON" ? "warn" : "error"}`}>
        {cfg.keyState === "MISSING" ? "No AI key is configured, so AI is unavailable to every company." : cfg.keyState === "EXPIRED" ? `The AI key's renewal date (${cfg.renewBy}) has passed — AI is paused for all companies until it's renewed.` : `The AI key is due for renewal on ${cfg.renewBy}.`} <Link href="/admin/ai">Manage the AI key →</Link></div>}
      <div className="grid grid-4" style={{ marginBottom: "1.2rem" }}>
        <div className="card stat"><div className="label">Companies</div><div className="value">{counts.companies}</div><div className="small muted">{counts.suspended} suspended</div></div>
        <div className="card stat"><div className="label">Users</div><div className="value">{counts.users}</div><div className="small muted">{counts.active} active in 24 h · {counts.mfa} with 2FA</div></div>
        <div className="card stat"><div className="label">AI this month</div><div className="value">{Number(usage.tokens).toLocaleString()}</div><div className="small muted">tokens · {usage.calls} calls · {usage.failed} failed</div></div>
        <div className="card stat"><div className="label">AI cost this month</div><div className="value">{usd(usage.cost)}</div><div className="small muted">at list prices</div></div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>AI service</h3><span className={`badge ${keyBadge[1]}`}>{keyBadge[0]}</span></div>
          <p className="small muted" style={{ marginTop: ".6rem" }}>{cfg.enabled ? "On" : "Off"} for the platform · {MODELS[cfg.model]?.label} · effort {cfg.effort}<br />
            Key {cfg.keyMeta?.hint || (cfg.keySource === "environment" ? "from server environment" : "—")}{cfg.renewBy ? ` · renew by ${cfg.renewBy}` : ""}{cfg.keyMeta?.lastTestAt ? ` · last tested ${formatDateTime(cfg.keyMeta.lastTestAt)} (${cfg.keyMeta.lastTestOk ? "ok" : "failed"})` : ""}</p>
          <Link href="/admin/ai" className="btn sm">Manage AI</Link>
        </div>
        <div className="card">
          <h3>Top AI users this month</h3>
          {top.length ? <table className="small"><tbody>{top.map((t) => <tr key={t.name}><td>{t.name}</td><td className="num">{Number(t.tokens).toLocaleString()} tokens</td><td className="num">{usd(t.cost)}</td></tr>)}</tbody></table> : <p className="muted small">No AI usage yet this month.</p>}
        </div>
      </div>
      <h2 style={{ marginTop: "2rem" }}>Recent admin activity</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>{recent.map((r) => <tr key={r.id}><td className="small">{formatDateTime(r.created_at)}</td><td>{r.email}</td><td>{r.action}</td><td className="small wrap">{r.detail.slice(0, 140)}</td></tr>)}
          {!recent.length && <tr><td colSpan={4} className="empty">No admin activity yet.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
