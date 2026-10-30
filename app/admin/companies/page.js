import db from "@/lib/db";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { getAiConfig } from "@/lib/ai/config";
import { formatDateTime } from "@/lib/dates";
import { updateCompany, setSuspended } from "../actions";
export const metadata = { title: "Companies" };

export default async function AdminCompanies({ searchParams }) {
  const q = String(searchParams.q || "").trim();
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const [cfg, rows] = await Promise.all([
    getAiConfig(),
    db.all(`SELECT w.id, w.name, w.slug, w.industry, w.created_at, w.suspended_at,
        (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id) members,
        (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'OWNER' LIMIT 1) owner,
        (SELECT COUNT(*) FROM ledger_entries l WHERE l.workspace_id = w.id) lines,
        e.enabled ai_enabled, e.monthly_token_limit, e.consent_at,
        (SELECT COALESCE(SUM(input_tokens + output_tokens),0) FROM ai_usage a WHERE a.workspace_id = w.id AND a.created_at >= ?) used
      FROM workspaces w LEFT JOIN ai_entitlements e ON e.workspace_id = w.id
      ${q ? "WHERE w.name LIKE ? OR w.slug LIKE ?" : ""} ORDER BY w.created_at DESC LIMIT 200`, q ? [month, `%${q}%`, `%${q}%`] : [month]),
  ]);
  return (
    <>
      <h1>Companies</h1>
      <p className="muted">Every company (workspace) on the platform. Control AI access and monthly allowances, or suspend a company. Company data itself isn't visible here.</p>
      <Flash searchParams={searchParams} />
      <form className="row" style={{ marginBottom: "1rem" }}><input name="q" defaultValue={q} placeholder="Search companies" style={{ maxWidth: 320 }} /><button className="btn">Search</button></form>
      <div className="table-wrap"><table>
        <thead><tr><th>Company</th><th>Owner</th><th className="num">Users</th><th className="num">Ledger lines</th><th>AI (consent)</th><th>AI access &amp; monthly allowance</th><th>Status</th></tr></thead>
        <tbody>{rows.map((w) => {
          const entitled = w.ai_enabled === null ? cfg.newCompaniesEnabled : !!w.ai_enabled;
          const limit = w.monthly_token_limit ?? cfg.defaultMonthlyTokens;
          return (
            <tr key={w.id}>
              <td><strong>{w.name}</strong><div className="faint small">{w.industry || "—"} · since {formatDateTime(w.created_at)}</div></td>
              <td className="small">{w.owner}</td>
              <td className="num">{w.members}</td>
              <td className="num">{Number(w.lines).toLocaleString()}</td>
              <td className="small">{w.consent_at ? <span className="badge good">Owner consented</span> : <span className="badge">No consent yet</span>}
                <div className="faint">{Number(w.used).toLocaleString()} / {limit ? Number(limit).toLocaleString() : "∞"} tokens</div>
                {limit > 0 && <div className="progress" style={{ marginTop: 4 }}><span style={{ width: `${Math.min(100, (w.used / limit) * 100)}%` }} /></div>}</td>
              <td><form action={updateCompany} className="row" style={{ flexWrap: "nowrap" }}>
                <input type="hidden" name="id" value={w.id} />
                <label className="row small" style={{ fontWeight: 400, gap: 4 }}><input type="checkbox" name="aiEnabled" defaultChecked={entitled} style={{ width: "auto" }} /> AI</label>
                <input name="limit" defaultValue={w.monthly_token_limit ?? ""} placeholder={`default ${Number(cfg.defaultMonthlyTokens).toLocaleString()}`} style={{ width: 150 }} aria-label="Monthly token allowance" />
                <Submit className="btn sm">Save</Submit></form></td>
              <td>{w.suspended_at ? <span className="badge bad">Suspended</span> : <span className="badge good">Active</span>}
                <form action={setSuspended} style={{ marginTop: 4 }}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="suspend" value={w.suspended_at ? "0" : "1"} />
                  <Submit className="btn sm ghost" confirm={w.suspended_at ? `Reactivate ${w.name}?` : `Suspend ${w.name}? Its users won't be able to open it.`}>{w.suspended_at ? "Reactivate" : "Suspend"}</Submit></form></td>
            </tr>);
        })}
          {!rows.length && <tr><td colSpan={7} className="empty">No companies found.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
