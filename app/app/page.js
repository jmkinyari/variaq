import Link from "next/link";
import db from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createWorkspaceAction } from "./actions";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import Logo from "@/components/Logo";
export const metadata = { title: "Your workspaces" };

const CURRENCIES = ["KES", "USD", "EUR", "GBP"];

export default async function AppHome({ searchParams }) {
  const user = await requireUser("/app");
  const wss = await db.all("SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at", [user.id]);
  return (
    <div className="container" style={{ maxWidth: 760, padding: "48px 20px" }}>
      <div className="row between" style={{ marginBottom: "2rem" }}>
        <Link href="/" aria-label="Variaq home"><Logo size={24} /></Link>
        <form action="/logout" method="post"><span className="muted small" style={{ marginRight: 8 }}>{user.email}</span>{user.platformAdmin && <Link href="/admin" className="btn sm" style={{ marginRight: 6 }}>Variaq admin</Link>}<Link href="/app/account" className="btn sm" style={{ marginRight: 6 }}>Account security{!user.mfaEnabled && <span className="badge warn" style={{ marginLeft: 6 }}>2FA off</span>}</Link><button className="btn sm">Sign out</button></form>
      </div>
      <Flash searchParams={searchParams} />
      {wss.length > 0 && <>
        <h2>Your workspaces</h2>
        <div className="grid" style={{ marginBottom: "2.5rem" }}>
          {wss.map((w) => (
            <Link key={w.id} href={`/app/${w.slug}`} className="card row between" style={{ textDecoration: "none", color: "var(--text)" }}>
              <div><strong>{w.name}</strong><div className="muted small">Kenya · {w.currency}{w.industry ? ` · ${w.industry}` : ""}</div></div>
              <span className="badge">{w.role.toLowerCase()}</span>
            </Link>
          ))}
        </div>
      </>}
      <h2>{wss.length ? "Create another workspace" : `Welcome, ${user.name.split(" ")[0]}. Set up your company workspace.`}</h2>
      <form action={createWorkspaceAction} className="card">
        <div className="field"><label htmlFor="name">Company name</label><input id="name" name="name" required placeholder="e.g. Kilimani Supplies Ltd" /></div>
        <div className="form-row">
          <div className="field"><label htmlFor="currency">Reporting currency</label>
            <select id="currency" name="currency" defaultValue="KES">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="industry">Industry (optional)</label><input id="industry" name="industry" placeholder="Retail, services, distribution…" /></div>
        </div>
        <p className="help" style={{ marginTop: 0 }}>You'll be the owner. A month-end close checklist for this month is created for you, and you can edit it.</p>
        <Submit>Create workspace</Submit>
      </form>
    </div>
  );
}
