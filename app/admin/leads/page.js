import db from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

/** Read-only list of contact / demo requests submitted on the public website (/contact). */
export default async function AdminLeads({ searchParams }) {
  const q = String(searchParams?.q || "").trim();
  const rows = await db.all(
    `SELECT id, name, email, company, message, created_at FROM contact_messages
     ${q ? "WHERE name LIKE ? OR email LIKE ? OR company LIKE ? OR message LIKE ?" : ""}
     ORDER BY created_at DESC LIMIT 300`,
    q ? Array(4).fill(`%${q}%`) : []);
  return (
    <>
      <h1>Leads</h1>
      <p className="muted">Demo and contact requests from the public website. There's no email delivery yet, so check here and reply from your own mailbox.</p>
      <form className="row" style={{ marginBottom: "1rem" }}><input name="q" defaultValue={q} placeholder="Search name, email, company or message" style={{ maxWidth: 360 }} /><button className="btn">Search</button></form>
      {rows.length === 0 ? <div className="empty">No requests yet.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Received</th><th>From</th><th>Company</th><th>Message</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="small" style={{ whiteSpace: "nowrap" }}>{formatDateTime(r.created_at)}</td>
              <td className="small"><strong>{r.name}</strong><div><a href={`mailto:${r.email}`}>{r.email}</a></div></td>
              <td className="small">{r.company || "—"}</td>
              <td className="small" style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>{r.message}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
