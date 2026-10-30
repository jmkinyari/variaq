"use server";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword, burnPasswordCheck, getUser, getPendingMfaUser, completeMfa, auditStmt, clientIp, MAX_FAILED_LOGINS, LOCK_MINUTES } from "@/lib/auth";
import { checkPassword } from "@/lib/security/password";
import { hit, reset } from "@/lib/security/rate-limit";
import { openGlobal, sha256 } from "@/lib/security/crypto";
import { verify as verifyTotp } from "@/lib/security/totp";

const safeNext = (n) => (typeof n === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(n) ? n : "/app");
const GENERIC_LOGIN_ERROR = "That email and password don't match an account.";

export async function signup(prev, formData) {
  const ip = clientIp();
  if (!hit("signup", ip).ok) return { error: "Too many sign-ups from this network. Try again later." };
  const name = String(formData.get("name") || "").trim().slice(0, 100);
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") || "");
  if (!name || !email || !password) return { error: "Please fill in every field." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Please enter a valid email address." };
  const weak = checkPassword(password, { email, name });
  if (weak) return { error: weak };
  if (await db.get("SELECT id FROM users WHERE email = ?", [email])) return { error: "An account with that email already exists. Try signing in." };
  const id = db.id();
  await db.run("INSERT INTO users (id, email, name, password_hash, created_at, password_changed_at) VALUES (?,?,?,?,?,?)", [id, email, name, await hashPassword(password), db.now(), db.now()]);
  await createSession(id);
  redirect(safeNext(formData.get("next")));
}

export async function login(prev, formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") || "");
  const ip = clientIp();
  const rl = hit("login", `${ip}|${email}`);
  if (!rl.ok || !hit("login", `ip|${ip}`).ok) return { error: `Too many sign-in attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60) || 15} minutes.` };
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) { await burnPasswordCheck(password); return { error: GENERIC_LOGIN_ERROR }; }
  if (user.locked_until && user.locked_until > db.now()) {
    await burnPasswordCheck(password);
    return { error: `This account is temporarily locked after repeated failed sign-ins. Try again after ${new Date(user.locked_until).toLocaleTimeString("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit" })}.` };
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const fails = (user.failed_logins || 0) + 1;
    const lock = fails >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await db.run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", [lock ? 0 : fails, lock, user.id]);
    return { error: GENERIC_LOGIN_ERROR };
  }
  await db.run("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", [db.now(), user.id]);
  reset("login", `${ip}|${email}`);
  await createSession(user.id, { mfaPending: !!user.mfa_enabled });
  const next = safeNext(formData.get("next"));
  if (user.mfa_enabled) redirect(`/mfa?next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function verifyMfa(prev, formData) {
  const pending = await getPendingMfaUser();
  if (!pending) redirect("/login");
  if (!hit("mfa", pending.id).ok) { await destroySession(); return { error: "Too many attempts. Sign in again." }; }
  const code = String(formData.get("code") || "").trim();
  const user = await db.get("SELECT mfa_secret, mfa_last_step, recovery_codes FROM users WHERE id = ?", [pending.id]);
  let ok = false;
  if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
    const step = verifyTotp(openGlobal("mfa", user.mfa_secret), code);
    // Replay protection: a code's time-step can only be used once.
    if (step !== null && step > (user.mfa_last_step || 0)) { ok = true; await db.run("UPDATE users SET mfa_last_step = ? WHERE id = ?", [step, pending.id]); }
  } else if (code) {
    const codes = JSON.parse(user.recovery_codes || "[]");
    const h = sha256(code.toLowerCase());
    if (codes.includes(h)) { ok = true; await db.run("UPDATE users SET recovery_codes = ? WHERE id = ?", [JSON.stringify(codes.filter((c) => c !== h)), pending.id]); }
  }
  if (!ok) return { error: "That code isn't valid. Use the current 6-digit code from your authenticator app, or a recovery code." };
  await completeMfa(pending.sid);
  redirect(safeNext(formData.get("next")));
}

export async function acceptInvite(formData) {
  const token = String(formData.get("token") || "");
  const user = await getUser();
  if (!user) redirect(`/login?next=/invite/${encodeURIComponent(token)}`);
  const inv = await db.get("SELECT i.*, w.slug FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = ?", [sha256(token)]);
  if (!inv || inv.revoked_at || inv.accepted_at || inv.expires_at < db.now()) redirect(`/invite/${token}?error=invalid`);
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) redirect(`/invite/${token}?error=email`);
  const existing = await db.get("SELECT id FROM memberships WHERE user_id = ? AND workspace_id = ?", [user.id, inv.workspace_id]);
  await db.batch([
    ...(existing ? [] : [{ sql: "INSERT INTO memberships (id, user_id, workspace_id, role, created_at) VALUES (?,?,?,?,?)", args: [db.id(), user.id, inv.workspace_id, inv.role, db.now()] }]),
    { sql: "UPDATE invites SET accepted_at = ? WHERE id = ?", args: [db.now(), inv.id] },
    auditStmt(inv.workspace_id, user.id, "invite.accepted", "invite", inv.id, { email: inv.email, role: inv.role }),
  ]);
  redirect(`/app/${inv.slug}`);
}
