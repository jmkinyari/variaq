"use server";
import { randomToken, sha256 } from "@/lib/security/crypto";
import db from "@/lib/db";
import { requireWorkspace, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { redirect } from "next/navigation";

const ROLES = ["ADMIN", "MEMBER", "AUDITOR", "VIEWER"];

export async function invite(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role"));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back(`/app/${slug}/team`, { err: "Enter a valid email address." });
  if (!ROLES.includes(role)) back(`/app/${slug}/team`, { err: "Choose a role." });
  if (role === "ADMIN" && ws.role !== "OWNER") back(`/app/${slug}/team`, { err: "Only the owner can invite admins." });
  const member = await db.get("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.email = ?", [ws.id, email]);
  if (member) back(`/app/${slug}/team`, { err: `${email} is already a member.` });
  const id = db.id(); const t = db.now(); const token = randomToken(24);
  await db.batch([
    { sql: "UPDATE invites SET revoked_at = ? WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL", args: [t, ws.id, email] },
    { sql: "INSERT INTO invites (id, workspace_id, email, role, token, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)", args: [id, ws.id, email, role, sha256(token), user.id, new Date(Date.now() + 7 * 86400000).toISOString(), t] },
    auditStmt(ws.id, user.id, "invite.created", "invite", id, { email, role }),
  ]);
  redirect(`/app/${slug}/team?invited=${encodeURIComponent(email)}&link=${encodeURIComponent(token)}`);
}

export async function revokeInvite(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const id = String(formData.get("id"));
  await db.batch([{ sql: "UPDATE invites SET revoked_at = ? WHERE id = ? AND workspace_id = ?", args: [db.now(), id, ws.id] }, auditStmt(ws.id, user.id, "invite.revoked", "invite", id, {})]);
  back(`/app/${slug}/team`, { ok: "Invitation revoked." });
}

export async function changeRole(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "OWNER");
  const mId = String(formData.get("id")); const role = String(formData.get("role"));
  const m = await db.get("SELECT m.*, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = ? AND m.workspace_id = ?", [mId, ws.id]);
  if (!m || m.role === "OWNER") back(`/app/${slug}/team`, { err: "The owner's role can't be changed here." });
  if (!ROLES.includes(role)) back(`/app/${slug}/team`, { err: "Choose a role." });
  await db.batch([{ sql: "UPDATE memberships SET role = ? WHERE id = ?", args: [role, mId] }, auditStmt(ws.id, user.id, "member.role_changed", "membership", mId, { email: m.email, from: m.role, to: role })]);
  back(`/app/${slug}/team`, { ok: `${m.email} is now ${role.toLowerCase()}.` });
}

export async function removeMember(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const mId = String(formData.get("id"));
  const m = await db.get("SELECT m.*, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = ? AND m.workspace_id = ?", [mId, ws.id]);
  if (!m || m.role === "OWNER") back(`/app/${slug}/team`, { err: "The owner can't be removed." });
  if (m.role === "ADMIN" && ws.role !== "OWNER") back(`/app/${slug}/team`, { err: "Only the owner can remove admins." });
  if (m.user_id === user.id) back(`/app/${slug}/team`, { err: "You can't remove yourself." });
  await db.batch([{ sql: "DELETE FROM memberships WHERE id = ?", args: [mId] }, auditStmt(ws.id, user.id, "member.removed", "membership", mId, { email: m.email })]);
  back(`/app/${slug}/team`, { ok: `Removed ${m.email}.` });
}
