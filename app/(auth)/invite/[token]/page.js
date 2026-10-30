import Link from "next/link";
import Logo from "@/components/Logo";
import db from "@/lib/db";
import { getUser, ROLE_LABELS } from "@/lib/auth";
import { sha256 } from "@/lib/security/crypto";
import { acceptInvite } from "../../actions";
export const metadata = { title: "Workspace invitation" };

export default async function InvitePage({ params, searchParams }) {
  const inv = await db.get("SELECT i.*, w.name AS ws_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = ?", [sha256(params.token)]);
  const user = await getUser();
  const invalid = !inv || inv.revoked_at || inv.accepted_at || inv.expires_at < db.now();
  return (
    <div className="auth"><div className="card">
      <Link href="/" aria-label="Variaq home"><Logo size={24} /></Link>
      {invalid || searchParams.error === "invalid" ? <>
        <h2 style={{ marginTop: "1.2rem" }}>This invitation isn't valid</h2>
        <p className="muted">It may have expired, been revoked, or already been used. Ask the person who invited you to send a new one.</p>
      </> : <>
        <h2 style={{ marginTop: "1.2rem" }}>Join {inv.ws_name}</h2>
        <p className="muted">You've been invited as <strong>{ROLE_LABELS[inv.role] || inv.role}</strong> using <strong>{inv.email}</strong>.</p>
        {searchParams.error === "email" && <div className="alert error">You're signed in as {user?.email}. Sign in with {inv.email} to accept.</div>}
        {user ? (
          <form action={acceptInvite}><input type="hidden" name="token" value={params.token} /><button className="btn primary" style={{ width: "100%" }}>Accept invitation</button></form>
        ) : (
          <div className="stack">
            <Link className="btn primary" style={{ width: "100%" }} href={`/signup?next=/invite/${params.token}&email=${encodeURIComponent(inv.email)}`}>Create an account</Link>
            <Link className="btn" style={{ width: "100%" }} href={`/login?next=/invite/${params.token}`}>I already have an account</Link>
          </div>
        )}
      </>}
    </div></div>
  );
}
