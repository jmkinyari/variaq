import db from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
export const metadata = { title: "Admin log" };

export default async function AdminAudit() {
  const rows = await db.all("SELECT a.*, u.email FROM platform_audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 300");
  return (
    <>
      <h1>Admin log</h1>
      <p className="muted">Every action taken in the Variaq admin console: AI settings, key renewals, company access changes and suspensions.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="small">{formatDateTime(r.created_at)}</td><td>{r.email}</td><td>{r.action}</td><td className="small mono">{r.target}</td><td className="small wrap">{r.detail.slice(0, 200)}</td><td className="small">{r.ip}</td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="empty">Nothing yet.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
