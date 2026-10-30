import db from "@/lib/db";
import { requireWorkspace, canAdmin, can } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import AiSettingsCard from "../ai/AiSettingsCard";
import { formatDateTime } from "@/lib/dates";
import { EXPORT_TABLES } from "./export/tables";
import { updateWorkspace, deleteWorkspace, lockPeriod, unlockPeriod, rotateEncryptionKey } from "./actions";
export const metadata = { title: "Workspace & security" };

export default async function SettingsPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const admin = canAdmin(ws.role);
  const [locks, keys, members] = await Promise.all([
    db.all("SELECT l.*, u.name FROM period_locks l LEFT JOIN users u ON u.id = l.locked_by WHERE l.workspace_id = ? ORDER BY l.period DESC", [ws.id]),
    db.all("SELECT key_version, active, created_at FROM workspace_keys WHERE workspace_id = ? ORDER BY key_version DESC", [ws.id]),
    db.all("SELECT u.name, u.mfa_enabled, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name", [ws.id]),
  ]);
  const activeKey = keys.find((k) => k.active);
  const noMfa = members.filter((m) => !m.mfa_enabled);
  const H = () => <input type="hidden" name="slug" value={ws.slug} />;
  return (
    <>
      <PageHead title="Workspace & security" />
      <Flash searchParams={searchParams} />
      <form action={updateWorkspace} className="card" style={{ maxWidth: 760 }}>
        <H />
        <div className="field"><label>Company name</label><input name="name" defaultValue={ws.name} disabled={!admin} required /></div>
        <div className="form-row">
          <div className="field"><label>Country</label><input value={ws.country} disabled /></div>
          <div className="field"><label>Currency</label><input value={ws.currency} disabled /></div>
          <div className="field"><label>Industry</label><input name="industry" defaultValue={ws.industry || ""} disabled={!admin} /></div>
        </div>
        {admin && <Submit>Save</Submit>}
      </form>

      <div className="card" style={{ maxWidth: 760, marginTop: "1rem" }}>
        <h3>Period locks</h3>
        <p className="muted small">A locked month is closed for posting: Data hub imports, ERP syncs and API pushes dated in it are rejected, and changes need an admin to unlock with a recorded reason.</p>
        {locks.length > 0 ? <div className="table-wrap"><table>
          <thead><tr><th>Period</th><th>Locked by</th><th>When</th><th>Note</th>{can(ws.role, "period.lock") && <th>Unlock</th>}</tr></thead>
          <tbody>{locks.map((l) => <tr key={l.period}><td><strong>{l.period}</strong></td><td>{l.name || "—"}</td><td className="small">{formatDateTime(l.locked_at)}</td><td className="small">{l.note || "—"}</td>
            {can(ws.role, "period.lock") && <td><form action={unlockPeriod} className="row" style={{ flexWrap: "nowrap" }}><H /><input type="hidden" name="period" value={l.period} /><input name="reason" placeholder="Reason" required style={{ minWidth: 140 }} /><Submit className="btn sm danger" confirm={`Unlock ${l.period}?`}>Unlock</Submit></form></td>}</tr>)}</tbody>
        </table></div> : <p className="muted small">No periods are locked.</p>}
        {can(ws.role, "period.lock") && <form action={lockPeriod} className="row" style={{ marginTop: ".8rem", alignItems: "end" }}><H />
          <div><label>Month</label><input type="month" name="period" required /></div>
          <div style={{ flex: 1 }}><label>Note</label><input name="note" placeholder="e.g. Management accounts issued" /></div>
          <Submit>Lock period</Submit></form>}
      </div>

      <div className="card" style={{ maxWidth: 760, marginTop: "1rem" }}>
        <h3>Data protection</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: "1.1rem" }}>
          <li><strong>Encryption:</strong> sensitive fields (ERP credentials, API signing secrets, KRA PINs, auditor correspondence) are sealed with AES-256-GCM using this company's own key, which is itself wrapped by the server master key. Active key version: <strong>{activeKey?.key_version ?? "—"}</strong>{activeKey ? ` (since ${formatDateTime(activeKey.created_at)})` : ""}{keys.length > 1 ? `; ${keys.length - 1} older version(s) kept for decryption` : ""}.</li>
          <li><strong>Sessions:</strong> sign-in tokens are stored hashed; sessions end after {process.env.SESSION_IDLE_MINUTES || 480} minutes idle or {process.env.SESSION_DAYS || 7} days. Accounts lock for 15 minutes after 5 failed sign-ins.</li>
          <li><strong>Two-step verification:</strong> {noMfa.length ? <span style={{ color: "var(--warn)" }}>{noMfa.length} of {members.length} member(s) haven't turned it on ({noMfa.slice(0, 5).map((m) => m.name).join(", ")}{noMfa.length > 5 ? "…" : ""}).</span> : "every member has it on."}</li>
          <li><strong>Audit trail:</strong> every change is recorded in a hash-chained log; tampering is detected on the Audit log page.</li>
        </ul>
        {ws.role === "OWNER" && <form action={rotateEncryptionKey} style={{ marginTop: ".8rem" }}><H /><Submit className="btn sm" confirm="Create a new encryption key version for this company?">Rotate encryption key</Submit> <span className="faint small">Do this if you suspect a key exposure, or on a regular schedule.</span></form>}
      </div>

      {ws.role === "OWNER" && <div className="card" style={{ maxWidth: 760, marginTop: "1rem" }}>
        <h3>Export your data</h3>
        <p className="muted small">Download any table as CSV, or everything as one JSON file. Credentials, key material and password hashes are never exported. Downloads are recorded in the audit log.</p>
        <div className="row" style={{ gap: ".4rem" }}>
          <a className="btn sm primary" href={`/app/${ws.slug}/settings/export?format=json`}>Everything (JSON)</a>
          {Object.entries(EXPORT_TABLES).map(([t, d]) => <a key={t} className="btn sm" href={`/app/${ws.slug}/settings/export?table=${t}`}>{d.label}</a>)}
        </div>
      </div>}

      <AiSettingsCard ws={ws} />
      {ws.role === "OWNER" && (
        <form action={deleteWorkspace} className="card" style={{ maxWidth: 760, marginTop: "1rem", borderColor: "var(--bad)" }}>
          <h3 style={{ color: "var(--bad)" }}>Delete workspace</h3>
          <p className="muted small">Permanently deletes all ledger data, statements, reconciliations, reports, integrations and the audit log for {ws.name}, and destroys its encryption keys. This can't be undone.</p>
          <H />
          <div className="field"><label>Type <strong>{ws.name}</strong> to confirm</label><input name="confirm" autoComplete="off" /></div>
          <Submit className="btn danger" confirm="Permanently delete this workspace?">Delete workspace</Submit>
        </form>
      )}
    </>
  );
}
