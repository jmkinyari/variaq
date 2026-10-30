"use server";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, requirePerm, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { rotateKey } from "@/lib/vault";
import { forgetDeks } from "@/lib/security/crypto";

const PERIOD = /^\d{4}-\d{2}$/;

export async function updateWorkspace(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const name = String(formData.get("name") || "").trim().slice(0, 80);
  if (!name) back(`/app/${slug}/settings`, { err: "Name is required." });
  const industry = String(formData.get("industry") || "").trim().slice(0, 80) || null;
  await db.batch([
    { sql: "UPDATE workspaces SET name = ?, industry = ? WHERE id = ?", args: [name, industry, ws.id] },
    auditStmt(ws.id, user.id, "workspace.updated", "workspace", ws.id, { name, industry }),
  ]);
  back(`/app/${slug}/settings`, { ok: "Saved." });
}

export async function lockPeriod(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "period.lock");
  const period = String(formData.get("period") || "");
  if (!PERIOD.test(period)) back(`/app/${slug}/settings`, { err: "Choose a month to lock." });
  const note = String(formData.get("note") || "").slice(0, 300) || null;
  await db.batch([
    { sql: "INSERT OR IGNORE INTO period_locks (workspace_id, period, locked_by, locked_at, note) VALUES (?,?,?,?,?)", args: [ws.id, period, user.id, db.now(), note] },
    auditStmt(ws.id, user.id, "period.locked", "period", period, { note }),
  ]);
  back(`/app/${slug}/settings`, { ok: `${period} is locked. Imports, ERP syncs and API pushes dated in it are now rejected.` });
}

export async function unlockPeriod(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "period.lock");
  const period = String(formData.get("period") || "");
  const reason = String(formData.get("reason") || "").trim().slice(0, 300);
  if (!reason) back(`/app/${slug}/settings`, { err: "Give a reason for unlocking — it's recorded in the audit log." });
  await db.batch([
    { sql: "DELETE FROM period_locks WHERE workspace_id = ? AND period = ?", args: [ws.id, period] },
    auditStmt(ws.id, user.id, "period.unlocked", "period", period, { reason }),
  ]);
  back(`/app/${slug}/settings`, { ok: `${period} unlocked.` });
}

export async function rotateEncryptionKey(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "owner");
  const v = await rotateKey(ws.id);
  await db.batch([auditStmt(ws.id, user.id, "security.key_rotated", "workspace", ws.id, { newVersion: v })]);
  back(`/app/${slug}/settings`, { ok: `New encryption key (version ${v}) is active. New and updated secrets use it; existing values stay readable with their original key.` });
}

export async function deleteWorkspace(formData) {
  const slug = String(formData.get("slug"));
  const { ws } = await requireWorkspace(slug, "OWNER");
  if (String(formData.get("confirm") || "").trim() !== ws.name) back(`/app/${slug}/settings`, { err: "Type the workspace name exactly to confirm." });
  // Destroy the wrapped data keys first (crypto-shredding: encrypted values become unrecoverable
  // even in backups), then the rows. Tables with ON DELETE CASCADE go with the workspace row.
  const tables = ["workspace_keys WHERE workspace_id = ?", "task_comments WHERE workspace_id = ?", "matches WHERE reconciliation_id IN (SELECT id FROM reconciliations WHERE workspace_id = ?)", "recon_exceptions WHERE reconciliation_id IN (SELECT id FROM reconciliations WHERE workspace_id = ?)",
    "reconciliations WHERE workspace_id = ?", "bank_transactions WHERE workspace_id = ?", "bank_statements WHERE workspace_id = ?", "bank_accounts WHERE workspace_id = ?", "ledger_entries WHERE workspace_id = ?", "ledger_imports WHERE workspace_id = ?",
    "reports WHERE workspace_id = ?", "tax_mappings WHERE workspace_id = ?", "account_settings WHERE workspace_id = ?", "cash_forecasts WHERE workspace_id = ?", "close_tasks WHERE workspace_id = ?", "audit_events WHERE workspace_id = ?",
    "invites WHERE workspace_id = ?", "api_keys WHERE workspace_id = ?", "connectors WHERE workspace_id = ?", "jobs WHERE workspace_id = ?", "memberships WHERE workspace_id = ?", "workspaces WHERE id = ?"];
  await db.batch(tables.map((t) => ({ sql: `DELETE FROM ${t}`, args: [ws.id] })));
  forgetDeks(ws.id);
  redirect("/app?ok=" + encodeURIComponent(`Deleted ${ws.name}. Its encryption keys were destroyed.`));
}
