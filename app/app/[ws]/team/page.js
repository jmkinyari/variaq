import db from "@/lib/db";
import { requireWorkspace, canAdmin, ROLE_LABELS } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatDateTime } from "@/lib/dates";
import { invite, revokeInvite, changeRole, removeMember } from "./actions";
export const metadata = { title: "Team" };

const ROLE_HELP = { OWNER: "Full control, including roles and security", ADMIN: "CFO / finance lead: approve budgets and board packs, manage team, connectors, period locks", MEMBER: "Accountant: import, reconcile, close tasks, audit findings, tax work", AUDITOR: "External auditor: read-only, can raise and follow up audit queries", VIEWER: "Read-only access" };
const ASSIGNABLE = ["ADMIN", "MEMBER", "AUDITOR", "VIEWER"];

export default async function TeamPage({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const [members, invites] = await Promise.all([
    db.all("SELECT m.id, m.role, m.created_at, u.id user_id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at", [ws.id]),
    db.all("SELECT * FROM invites WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC", [ws.id, db.now()]),
  ]);
  const admin = canAdmin(ws.role); const owner = ws.role === "OWNER";
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  return (
    <>
      <PageHead title="Team" desc="People who can access this workspace, and what they can do." />
      <Flash searchParams={searchParams} />
      {searchParams.link && admin && <div className="alert success">Invitation created for {searchParams.invited}. Copy this link now and send it to them — for security it is shown only once:<input readOnly value={`${appUrl}/invite/${searchParams.link}`} style={{ marginTop: ".5rem" }} /></div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th>{admin && <th></th>}</tr></thead>
        <tbody>{members.map((m) => (
          <tr key={m.id}><td>{m.name}{m.user_id === user.id && <span className="faint"> (you)</span>}</td><td>{m.email}</td>
            <td>{owner && m.role !== "OWNER" ? (
              <form action={changeRole} className="row" style={{ flexWrap: "nowrap" }}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={m.id} />
                <select name="role" defaultValue={m.role} style={{ width: "auto" }}>{ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select><Submit className="btn sm">Save</Submit></form>
            ) : <span className="badge">{ROLE_LABELS[m.role]}</span>}<div className="faint small">{ROLE_HELP[m.role]}</div></td>
            <td className="small">{formatDateTime(m.created_at)}</td>
            {admin && <td className="num">{m.role !== "OWNER" && m.user_id !== user.id && <form action={removeMember}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={m.id} /><Submit className="btn sm danger" confirm={`Remove ${m.email} from ${ws.name}?`}>Remove</Submit></form>}</td>}
          </tr>))}</tbody>
      </table></div>

      {admin && <>
        <h2 style={{ marginTop: "2rem" }}>Invite someone</h2>
        <form action={invite} className="card row" style={{ alignItems: "end" }}>
          <input type="hidden" name="slug" value={ws.slug} />
          <div style={{ flex: 2, minWidth: 220 }}><label>Email</label><input name="email" type="email" required /></div>
          <div style={{ flex: 1, minWidth: 140 }}><label>Role</label><select name="role" defaultValue="MEMBER">{(owner ? ASSIGNABLE : ASSIGNABLE.slice(1)).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
          <Submit>Create invitation</Submit>
        </form>
        <p className="faint small">Email sending isn't set up yet, so copy the invitation link and send it yourself. Links expire after 7 days and only work for the invited email address.</p>
        {invites.length > 0 && <div className="table-wrap" style={{ marginTop: "1rem" }}><table>
          <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th></th></tr></thead>
          <tbody>{invites.map((i) => (
            <tr key={i.id}><td>{i.email}</td><td>{ROLE_LABELS[i.role]}</td><td className="small">{formatDateTime(i.expires_at)}</td>
              <td><form action={revokeInvite}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={i.id} /><Submit className="btn sm">Revoke</Submit></form></td></tr>))}</tbody>
        </table></div>}
      </>}
    </>
  );
}
