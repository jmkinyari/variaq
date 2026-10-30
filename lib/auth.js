import "server-only";
import { cookies, headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import bcrypt from "bcryptjs";
import db from "./db";
import { sha256, randomToken } from "./security/crypto";
import { sealWorkspace } from "./audit-chain";

// Sessions: the browser holds a random 256-bit token; the database stores only SHA-256(token),
// so a database leak doesn't hand out live sessions. Sessions expire after an idle period and
// an absolute lifetime, and a session created before MFA is completed can't reach the app.
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-nq_session" : "nq_session";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 480);
const BCRYPT_COST = 12;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export async function hashPassword(pw) { return bcrypt.hash(pw, BCRYPT_COST); }
export async function verifyPassword(pw, hash) { return bcrypt.compare(pw, hash); }
// Constant-time-ish path for unknown emails so response timing doesn't reveal which emails exist.
let dummyHash = null;
export async function burnPasswordCheck(pw) {
  dummyHash ||= await bcrypt.hash("variaq-timing-equaliser", BCRYPT_COST);
  await bcrypt.compare(String(pw || "x"), dummyHash);
}

export function clientIp() {
  const h = headers();
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}

export async function createSession(userId, { mfaPending = false } = {}) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  const t = db.now();
  await db.run("INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at, ip, user_agent, mfa_pending) VALUES (?,?,?,?,?,?,?,?)",
    [sha256(token), userId, expires.toISOString(), t, t, clientIp(), (headers().get("user-agent") || "").slice(0, 200), mfaPending ? 1 : 0]);
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
}

export async function destroySession() {
  const token = cookies().get(COOKIE)?.value;
  if (token) await db.run("DELETE FROM sessions WHERE id = ?", [sha256(token)]);
  cookies().delete(COOKIE);
}

export async function revokeOtherSessions(userId) {
  const token = cookies().get(COOKIE)?.value;
  await db.run("DELETE FROM sessions WHERE user_id = ? AND id <> ?", [userId, token ? sha256(token) : ""]);
}

async function loadSession() {
  const token = cookies().get(COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const sid = sha256(token);
  const row = await db.get("SELECT u.id, u.email, u.name, u.mfa_enabled, u.is_platform_admin, s.expires_at, s.last_seen_at, s.mfa_pending FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?", [sid]);
  if (!row) return null;
  const nowMs = Date.now();
  if (row.expires_at < db.now() || nowMs - Date.parse(row.last_seen_at || row.expires_at) > IDLE_MINUTES * 60000) {
    await db.run("DELETE FROM sessions WHERE id = ?", [sid]);
    return null;
  }
  // Touch at most every 5 minutes to keep write load low under heavy traffic.
  if (nowMs - Date.parse(row.last_seen_at) > 300000) db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [db.now(), sid]).catch(() => {});
  return { sid, row };
}

export async function getUser() {
  const s = await loadSession();
  if (!s || s.row.mfa_pending) return null;
  const r = s.row;
  return { id: r.id, email: r.email, name: r.name, mfaEnabled: !!r.mfa_enabled, platformAdmin: !!r.is_platform_admin };
}

/** The user behind a session that still needs its MFA code. */
export async function getPendingMfaUser() {
  const s = await loadSession();
  if (!s || !s.row.mfa_pending) return null;
  return { id: s.row.id, email: s.row.email, sid: s.sid };
}
export async function completeMfa(sid) { await db.run("UPDATE sessions SET mfa_pending = 0, last_seen_at = ? WHERE id = ?", [db.now(), sid]); }

export async function requireUser(next) {
  const user = await getUser();
  if (!user) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return user;
}

// ---------------------------------------------------------------------------------------------
// Roles and permissions. AUDITOR is a read-only external role that can also raise and follow up
// audit queries. Permissions are checked on the server in every action; the UI only hides buttons.
export const ROLES = ["OWNER", "ADMIN", "MEMBER", "AUDITOR", "VIEWER"];
const ROLE_RANK = { VIEWER: 0, AUDITOR: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };
export const ROLE_LABELS = { OWNER: "Owner", ADMIN: "Admin / CFO", MEMBER: "Accountant", AUDITOR: "External auditor", VIEWER: "Viewer" };
const PERMS = {
  "data.edit": ["OWNER", "ADMIN", "MEMBER"],
  "approve": ["OWNER", "ADMIN"],
  "admin": ["OWNER", "ADMIN"],
  "owner": ["OWNER"],
  "query.raise": ["OWNER", "ADMIN", "MEMBER", "AUDITOR"],
  "query.respond": ["OWNER", "ADMIN", "MEMBER"],
  "connectors.manage": ["OWNER", "ADMIN"],
  "period.lock": ["OWNER", "ADMIN"],
};
export const can = (role, perm) => (PERMS[perm] || []).includes(role);
export const canEdit = (role) => ROLE_RANK[role] >= ROLE_RANK.MEMBER;
export const canAdmin = (role) => ROLE_RANK[role] >= ROLE_RANK.ADMIN;

/** Load a workspace by slug and the current user's membership. 404s if not a member (no tenant enumeration). */
export async function requireWorkspace(slug, minRole = "VIEWER") {
  const user = await requireUser(`/app/${slug}`);
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,60}$/.test(slug)) notFound();
  const ws = await db.get(
    "SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ? WHERE w.slug = ?",
    [user.id, slug]
  );
  if (!ws) notFound();
  if (ws.suspended_at) redirect(`/app?err=${encodeURIComponent(`${ws.name} is suspended. Contact Variaq support.`)}`);
  if (minRole === "AUDITOR" ? !can(ws.role, "query.raise") : ROLE_RANK[ws.role] < ROLE_RANK[minRole]) denied(slug);
  return { user, ws };
}

// Insufficient role: send the user to the workspace home with an explanation (works from pages and actions).
function denied(slug) {
  redirect(`/app/${slug}?err=${encodeURIComponent("Your role in this workspace doesn't allow that. Ask an admin if you need access.")}`);
}

/** Same as requireWorkspace but checks a named permission. */
export async function requirePerm(slug, perm) {
  const r = await requireWorkspace(slug);
  if (!can(r.ws.role, perm)) denied(slug);
  return r;
}

/**
 * Variaq system administrators (platform staff, not company admins). Two-step verification is
 * required unless ADMIN_REQUIRE_MFA=0 (local development only). Non-admins get a 404.
 */
export async function requirePlatformAdmin() {
  const user = await requireUser("/admin");
  if (!user.platformAdmin) notFound();
  if (process.env.ADMIN_REQUIRE_MFA !== "0" && !user.mfaEnabled) redirect(`/app/account?err=${encodeURIComponent("Turn on two-step verification to use the Variaq admin console.")}`);
  return user;
}
export function platformAuditStmt(userId, action, target, detail = {}) {
  return { sql: "INSERT INTO platform_audit (id, user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)", args: [db.id(), userId, action, target || null, JSON.stringify(detail), safeIp(), db.now()] };
}

/** Reject writes dated inside a locked accounting period. */
export async function assertPeriodOpen(workspaceId, dates) {
  const periods = [...new Set(dates.filter(Boolean).map((d) => String(d).slice(0, 7)))];
  if (!periods.length) return;
  const locked = await db.all(`SELECT period FROM period_locks WHERE workspace_id = ? AND period IN (${periods.map(() => "?").join(",")})`, [workspaceId, ...periods]);
  if (locked.length) throw new Error(`These periods are locked: ${locked.map((l) => l.period).join(", ")}. An admin must unlock them first.`);
}

export async function audit(workspaceId, userId, action, entityType, entityId, detail = {}) {
  await db.run(
    "INSERT INTO audit_events (id, workspace_id, user_id, action, entity_type, entity_id, detail, created_at, ip) VALUES (?,?,?,?,?,?,?,?,?)",
    [db.id(), workspaceId, userId, action, entityType, entityId || null, JSON.stringify(detail), db.now(), safeIp()]
  );
  sealWorkspace(workspaceId).catch(() => {});
}
export function auditStmt(workspaceId, userId, action, entityType, entityId, detail = {}) {
  queueMicrotask(() => setTimeout(() => sealWorkspace(workspaceId).catch(() => {}), 50));
  return { sql: "INSERT INTO audit_events (id, workspace_id, user_id, action, entity_type, entity_id, detail, created_at, ip) VALUES (?,?,?,?,?,?,?,?,?)", args: [db.id(), workspaceId, userId, action, entityType, entityId || null, JSON.stringify(detail), db.now(), safeIp()] };
}
function safeIp() { try { return clientIp(); } catch { return null; } }

/** Statement creating an in-app notification (include it in the action's batch). */
export function notifyStmt(workspaceId, userId, kind, title, link) {
  if (!userId) return null;
  return { sql: "INSERT INTO notifications (id, workspace_id, user_id, kind, title, link, created_at) VALUES (?,?,?,?,?,?,?)", args: [db.id(), workspaceId, userId, kind, String(title).slice(0, 200), link || null, db.now()] };
}
