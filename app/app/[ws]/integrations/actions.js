"use server";
import { cookies } from "next/headers";
import db from "@/lib/db";
import { requirePerm, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { ADAPTERS, loadConfig, sealConfig, mergeConfig, missingRequired } from "@/lib/connectors";
import { testConnection } from "@/lib/connectors/sync";
import { enqueue } from "@/lib/jobs";
import { assertSafeUrl } from "@/lib/security/net";
import { generateKey, SCOPES } from "@/lib/api";
import { sealGlobal, randomToken } from "@/lib/security/crypto";
import vault from "@/lib/vault";

const path = (slug, q = "") => `/app/${slug}/integrations${q}`;

async function ctx(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "connectors.manage");
  return { user, ws, slug };
}
async function loadConn(ws, id) {
  const c = await db.get("SELECT * FROM connectors WHERE id = ? AND workspace_id = ?", [String(id), ws.id]);
  return c;
}
function formValues(adapter, formData) {
  return Object.fromEntries(adapter.fields.map((f) => [f.key, formData.get(f.key) ?? undefined]).filter(([, v]) => v !== undefined && v !== null));
}
async function checkUrls(adapter, cfg) {
  for (const f of adapter.fields) if (f.type === "url" && cfg[f.key]) await assertSafeUrl(cfg[f.key]);
  if (adapter.type === "GENERIC_REST" && cfg.fieldMap) adapter.parseFieldMap(cfg.fieldMap);
}
const schedule = (formData) => { const n = parseInt(String(formData.get("schedule_minutes") || "0"), 10); return n >= 15 ? Math.min(n, 10080) : null; };

export async function saveConnector(formData) {
  const { user, ws, slug } = await ctx(formData);
  const id = String(formData.get("id") || "");
  const existing = id ? await loadConn(ws, id) : null;
  if (id && !existing) back(path(slug), { err: "Connector not found." });
  const type = existing ? existing.type : String(formData.get("type"));
  const adapter = ADAPTERS[type];
  if (!adapter) back(path(slug), { err: "Choose a connector type." });
  const name = String(formData.get("name") || "").trim().slice(0, 60) || adapter.label;
  const cfg = mergeConfig(adapter, existing ? await loadConfig(existing) : {}, formValues(adapter, formData));
  const back2 = path(slug, existing ? `?edit=${id}` : `?new=${type}`);
  const missing = missingRequired(adapter, cfg);
  if (missing.length) back(back2, { err: `Fill in: ${missing.join(", ")}.` });
  try { await checkUrls(adapter, cfg); } catch (e) { back(back2, { err: e.message }); }
  const sealed = await sealConfig(ws.id, cfg);
  const t = db.now();
  if (existing) {
    await db.batch([
      { sql: "UPDATE connectors SET name = ?, config = ?, schedule_minutes = ?, updated_at = ? WHERE id = ?", args: [name, sealed, schedule(formData), t, id] },
      auditStmt(ws.id, user.id, "connector.updated", "connector", id, { name, type }),
    ]);
    back(path(slug), { ok: `Saved ${name}. Credentials are stored encrypted.` });
  }
  const newId = db.id();
  await db.batch([
    { sql: "INSERT INTO connectors (id, workspace_id, type, name, config, status, schedule_minutes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?)", args: [newId, ws.id, type, name, sealed, schedule(formData), user.id, t, t] },
    auditStmt(ws.id, user.id, "connector.created", "connector", newId, { name, type }),
  ]);
  back(path(slug), { ok: `Added ${name}. Test the connection, then run the first sync.` });
}

export async function testConnector(formData) {
  const { user, ws, slug } = await ctx(formData);
  const conn = await loadConn(ws, formData.get("id"));
  if (!conn) back(path(slug), { err: "Connector not found." });
  let result;
  try { result = await testConnection(conn); }
  catch (e) { result = { ok: false, message: e.message }; }
  await db.batch([auditStmt(ws.id, user.id, "connector.tested", "connector", conn.id, { ok: !!result.ok })]);
  back(path(slug), result.ok ? { ok: `${conn.name}: ${result.message}` } : { err: `${conn.name}: ${result.message}` });
}

export async function syncNow(formData) {
  const { user, ws, slug } = await ctx(formData);
  const conn = await loadConn(ws, formData.get("id"));
  if (!conn) back(path(slug), { err: "Connector not found." });
  if (conn.status !== "ACTIVE") back(path(slug), { err: "Enable the connector first." });
  if (formData.get("full") === "1") await db.run("UPDATE connectors SET cursor = NULL WHERE id = ?", [conn.id]);
  const j = await enqueue("connector.sync", { connectorId: conn.id, userId: user.id }, { workspaceId: ws.id, createdBy: user.id, dedupeKey: `sync:${conn.id}` });
  await db.batch([auditStmt(ws.id, user.id, "connector.sync_requested", "connector", conn.id, { full: formData.get("full") === "1" })]);
  back(path(slug), { ok: j.deduped ? `A sync of ${conn.name} is already queued or running.` : `Sync of ${conn.name} queued. Refresh in a moment to see progress.` });
}

export async function toggleConnector(formData) {
  const { user, ws, slug } = await ctx(formData);
  const conn = await loadConn(ws, formData.get("id"));
  if (!conn) back(path(slug), { err: "Connector not found." });
  const status = conn.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  await db.batch([{ sql: "UPDATE connectors SET status = ?, updated_at = ? WHERE id = ?", args: [status, db.now(), conn.id] }, auditStmt(ws.id, user.id, `connector.${status === "ACTIVE" ? "enabled" : "disabled"}`, "connector", conn.id, { name: conn.name })]);
  back(path(slug), { ok: `${conn.name} ${status === "ACTIVE" ? "enabled" : "disabled"}.` });
}

export async function deleteConnector(formData) {
  const { user, ws, slug } = await ctx(formData);
  const conn = await loadConn(ws, formData.get("id"));
  if (!conn) back(path(slug), { err: "Connector not found." });
  await db.batch([
    { sql: "DELETE FROM connectors WHERE id = ? AND workspace_id = ?", args: [conn.id, ws.id] },
    auditStmt(ws.id, user.id, "connector.deleted", "connector", conn.id, { name: conn.name, type: conn.type }),
  ]);
  back(path(slug), { ok: `Deleted ${conn.name} and its stored credentials. Ledger lines it imported are kept (delete them from Ledger → Import history if needed).` });
}

// ---- API keys ----
const KEY_COOKIE = "nq_new_api_key";

export async function createApiKey(formData) {
  const { user, ws, slug } = await ctx(formData);
  const name = String(formData.get("name") || "").trim().slice(0, 60);
  const scopes = Object.keys(SCOPES).filter((s) => formData.get(`scope_${s}`) === "on");
  if (!name) back(path(slug), { err: "Name the key after the system that will use it." });
  if (!scopes.length) back(path(slug), { err: "Choose at least one scope." });
  const days = parseInt(String(formData.get("expires_days") || "365"), 10);
  const expires = days > 0 ? new Date(Date.now() + Math.min(days, 730) * 86400000).toISOString() : null;
  const k = generateKey();
  const signing = formData.get("signing") === "on" ? randomToken(32) : null;
  const id = db.id();
  await db.batch([
    { sql: "INSERT INTO api_keys (id, workspace_id, name, prefix, key_hash, scopes, created_by, expires_at, created_at, signing_secret) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [id, ws.id, name, k.prefix, k.hash, JSON.stringify(scopes), user.id, expires, db.now(), signing ? await vault.seal(ws.id, "apikey.signing", signing) : null] },
    auditStmt(ws.id, user.id, "api_key.created", "api_key", id, { name, scopes, expires }),
  ]);
  // Shown exactly once via a sealed, short-lived cookie (never in the URL or logs).
  cookies().set(KEY_COOKIE, sealGlobal("api-key-reveal", JSON.stringify({ key: k.key, signing, name })), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: path(slug), maxAge: 120 });
  back(path(slug), { ok: `API key “${name}” created.` });
}

export async function revokeApiKey(formData) {
  const { user, ws, slug } = await ctx(formData);
  const id = String(formData.get("id"));
  const k = await db.get("SELECT name FROM api_keys WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!k) back(path(slug), { err: "Key not found." });
  await db.batch([{ sql: "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND workspace_id = ?", args: [db.now(), id, ws.id] }, auditStmt(ws.id, user.id, "api_key.revoked", "api_key", id, { name: k.name })]);
  back(path(slug), { ok: `Revoked “${k.name}”. Requests using it now fail immediately.` });
}
