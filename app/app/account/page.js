import Link from "next/link";
import { cookies } from "next/headers";
import db from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { openGlobal } from "@/lib/security/crypto";
import { otpauthUrl } from "@/lib/security/totp";
import { formatDateTime } from "@/lib/dates";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import Logo from "@/components/Logo";
import { startMfa, confirmMfa, disableMfa, changePassword, signOutOthers } from "./actions";
export const metadata = { title: "Account security" };

export default async function AccountPage({ searchParams }) {
  const user = await requireUser("/app/account");
  const pendingSecret = !user.mfaEnabled ? openGlobal("mfa-setup", cookies().get("nq_mfa_setup")?.value) : null;
  const sessions = await db.all("SELECT created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? AND mfa_pending = 0 ORDER BY last_seen_at DESC LIMIT 20", [user.id]);
  return (
    <div className="container" style={{ maxWidth: 760, padding: "48px 20px" }}>
      <div className="row between" style={{ marginBottom: "2rem" }}>
        <Link href="/app" aria-label="Back to workspaces"><Logo size={24} /></Link>
        <Link href="/app" className="btn sm">← Workspaces</Link>
      </div>
      <h1>Account security</h1>
      <p className="muted">{user.name} · {user.email}</p>
      <Flash searchParams={searchParams} />
      {(() => { const rc = openGlobal("recovery", cookies().get("nq_recovery")?.value); return rc && <div className="alert warn"><strong>Save your recovery codes now.</strong> Each works once if you lose your phone. They won't be shown again after you leave this page.<div className="mono" style={{ marginTop: ".5rem", wordSpacing: ".6rem" }}>{rc}</div></div>; })()}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3>Two-step verification {user.mfaEnabled ? <span className="badge good">On</span> : <span className="badge warn">Off</span>}</h3>
        {user.mfaEnabled ? (
          <form action={disableMfa} className="row" style={{ alignItems: "end" }}>
            <div style={{ flex: 1 }}><label>Confirm your password to turn it off</label><input type="password" name="password" required autoComplete="current-password" /></div>
            <Submit className="btn danger" confirm="Turn off two-step verification?">Turn off</Submit>
          </form>
        ) : pendingSecret ? (
          <div className="stack">
            <p className="muted small">Add this key to Google Authenticator, Microsoft Authenticator, 1Password or similar (choose “enter a setup key”, time-based):</p>
            <input readOnly value={pendingSecret.replace(/(.{4})/g, "$1 ").trim()} className="mono" />
            <details className="small"><summary>Setup link (otpauth)</summary><input readOnly value={otpauthUrl(pendingSecret, user.email)} /></details>
            <form action={confirmMfa} className="row" style={{ alignItems: "end" }}>
              <div style={{ flex: 1 }}><label>Enter the 6-digit code it shows</label><input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} /></div>
              <Submit>Confirm and turn on</Submit>
            </form>
          </div>
        ) : (
          <form action={startMfa}><p className="muted small">Protects your account with a code from your phone in addition to your password. Strongly recommended for owners, admins and anyone with access to tax or bank data.</p><Submit>Set up two-step verification</Submit></form>
        )}
      </div>

      <form action={changePassword} className="card" style={{ marginBottom: "1rem" }}>
        <h3>Change password</h3>
        <div className="form-row">
          <div className="field"><label>Current password</label><input type="password" name="current" required autoComplete="current-password" /></div>
          <div className="field"><label>New password</label><input type="password" name="password" required minLength={12} autoComplete="new-password" /><div className="help">At least 12 characters. A short phrase works well.</div></div>
        </div>
        <Submit>Change password</Submit>
      </form>

      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Active sessions</h3><form action={signOutOthers}><Submit className="btn sm">Sign out other sessions</Submit></form></div>
        <div className="table-wrap" style={{ marginTop: ".8rem" }}><table>
          <thead><tr><th>Started</th><th>Last active</th><th>IP</th><th>Device</th></tr></thead>
          <tbody>{sessions.map((s, i) => <tr key={i}><td className="small">{formatDateTime(s.created_at)}</td><td className="small">{formatDateTime(s.last_seen_at)}</td><td className="small">{s.ip}</td><td className="small wrap">{(s.user_agent || "").slice(0, 70)}</td></tr>)}</tbody>
        </table></div>
      </div>
    </div>
  );
}
