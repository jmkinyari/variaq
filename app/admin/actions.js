"use server";
import db from "@/lib/db";
import { requirePlatformAdmin, platformAuditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { saveAiConfig, renewKey, retestKey, revokeKey, setEntitlement } from "@/lib/ai/config";
import { hit } from "@/lib/security/rate-limit";

export async function saveAiSettings(formData) {
  const user = await requirePlatformAdmin();
  const next = await saveAiConfig({
    enabled: formData.get("enabled") === "on",
    model: String(formData.get("model") || ""),
    effort: String(formData.get("effort") || ""),
    defaultMonthlyTokens: Number(formData.get("defaultMonthlyTokens")),
    newCompaniesEnabled: formData.get("newCompaniesEnabled") === "on",
  }, user.id);
  await db.batch([platformAuditStmt(user.id, "ai.settings_saved", "ai", next)]);
  back("/admin/ai", { ok: `AI settings saved. AI is ${next.enabled ? "on" : "off"} for the platform using ${next.model}.` });
}

export async function renewAiKey(formData) {
  const user = await requirePlatformAdmin();
  if (!hit("mfa", `aikey|${user.id}`).ok) back("/admin/ai", { err: "Too many key attempts. Wait a few minutes." });
  const r = await renewKey(String(formData.get("apiKey") || ""), { renewBy: String(formData.get("renewBy") || ""), note: String(formData.get("note") || ""), userId: user.id });
  await db.batch([platformAuditStmt(user.id, r.ok ? "ai.key_renewed" : "ai.key_rejected", "ai", { message: r.message })]);
  back("/admin/ai", r.ok ? { ok: r.message } : { err: r.message });
}

export async function retestAiKey() {
  const user = await requirePlatformAdmin();
  const r = await retestKey(user.id);
  back("/admin/ai", r.ok ? { ok: r.message } : { err: r.message });
}

export async function revokeAiKey(formData) {
  const user = await requirePlatformAdmin();
  await revokeKey(user.id, String(formData.get("note") || ""));
  await db.batch([platformAuditStmt(user.id, "ai.key_revoked", "ai", {})]);
  back("/admin/ai", { ok: "The platform key was removed. AI is unavailable until a new key is added." });
}

export async function updateCompany(formData) {
  const user = await requirePlatformAdmin();
  const wsId = String(formData.get("id"));
  const ws = await db.get("SELECT id, name FROM workspaces WHERE id = ?", [wsId]);
  if (!ws) back("/admin/companies", { err: "Company not found." });
  const raw = String(formData.get("limit") || "").replace(/[, ]/g, "");
  const limit = raw === "" ? null : Number(raw);
  if (limit !== null && !(Number.isFinite(limit) && limit >= 0)) back("/admin/companies", { err: "Monthly token allowance must be a number (or blank for the platform default)." });
  const enabled = formData.get("aiEnabled") === "on";
  await setEntitlement(wsId, { enabled, monthlyTokenLimit: limit }, user.id);
  await db.batch([platformAuditStmt(user.id, "company.ai_updated", wsId, { name: ws.name, enabled, limit })]);
  back("/admin/companies", { ok: `Saved AI access for ${ws.name}.` });
}

export async function setSuspended(formData) {
  const user = await requirePlatformAdmin();
  const wsId = String(formData.get("id"));
  const suspend = formData.get("suspend") === "1";
  const ws = await db.get("SELECT id, name FROM workspaces WHERE id = ?", [wsId]);
  if (!ws) back("/admin/companies", { err: "Company not found." });
  await db.batch([
    { sql: "UPDATE workspaces SET suspended_at = ? WHERE id = ?", args: [suspend ? db.now() : null, wsId] },
    platformAuditStmt(user.id, suspend ? "company.suspended" : "company.reactivated", wsId, { name: ws.name }),
  ]);
  back("/admin/companies", { ok: `${ws.name} ${suspend ? "suspended — its users can't open it" : "reactivated"}.` });
}
