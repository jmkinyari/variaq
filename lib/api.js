// REST API plumbing: API keys (hashed, scoped, expiring, revocable), optional HMAC request
// signing, per-key rate limiting, and JSON responses. Keys belong to exactly one workspace, so a
// key can never read or write another tenant's data.
const crypto = require("crypto");
const db = require("./db");
const vault = require("./vault");
const { sha256, randomToken, safeEqual } = require("./security/crypto");
const { hit } = require("./security/rate-limit");

const SCOPES = {
  "journals:write": "Push journal lines (ERP → Variaq)",
  "journals:read": "Read journal lines",
  "tb:read": "Read trial balances",
  "reports:read": "Read accounts and statements",
  "agents:read": "List specialist agents, agent jobs and artifacts",
  "agents:run": "Chat with specialist agents and queue agent jobs (acts as the key's creator)",
};
const MAX_BODY = 5 * 1024 * 1024;

/** New key: "nq_<prefix>_<secret>". Returns { key (show once), prefix, hash }. Pure apart from randomness. */
function generateKey() {
  const prefix = crypto.randomBytes(4).toString("hex");
  const key = `nq_${prefix}_${randomToken(32)}`;
  return { key, prefix, hash: sha256(key) };
}
const parseScopes = (raw) => { try { const s = JSON.parse(raw || "[]"); return Array.isArray(s) ? s.filter((x) => SCOPES[x]) : []; } catch { return []; } };
const hasScope = (scopes, needed) => scopes.includes(needed);

/** Verify "t=<unix>,v1=<hex hmac(secret, `${t}.${body}`)>" within 5 minutes. Pure (unit-tested). */
function verifySignature(header, body, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(nowSec - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return safeEqual(expected, parts.v1);
}
function sign(body, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

class ApiError extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });
}
function errorResponse(e) {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message, ...(e.extra || {}) } }, e.status, e.status === 429 ? { "retry-after": String(e.extra?.retryAfterSec || 60) } : {});
  console.error("[api]", e);
  return json({ error: { code: "internal_error", message: "Something went wrong." } }, 500);
}

/** Authenticate a request; returns { key, ws, body (raw text for POST) }. */
async function authenticate(req, scope) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(nq_[a-f0-9]{8}_[A-Za-z0-9_-]{20,})$/);
  if (!m) throw new ApiError(401, "unauthorized", "Send an API key: Authorization: Bearer nq_…");
  const key = await db.get("SELECT k.*, w.slug, w.name ws_name, w.currency FROM api_keys k JOIN workspaces w ON w.id = k.workspace_id WHERE k.key_hash = ?", [sha256(m[1])]);
  if (!key || key.revoked_at || (key.expires_at && key.expires_at < db.now())) throw new ApiError(401, "unauthorized", "The API key is invalid, revoked or expired.");
  const rl = hit("api", key.id);
  if (!rl.ok) throw new ApiError(429, "rate_limited", "Too many requests for this key.", { retryAfterSec: rl.retryAfterSec });
  const scopes = parseScopes(key.scopes);
  if (scope && !hasScope(scopes, scope)) throw new ApiError(403, "forbidden", `This key lacks the “${scope}” scope.`);
  let body = null;
  if (req.method !== "GET") {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_BODY) throw new ApiError(413, "too_large", "Request body is larger than 5 MB. Send smaller batches.");
    body = await req.text();
    if (body.length > MAX_BODY) throw new ApiError(413, "too_large", "Request body is larger than 5 MB. Send smaller batches.");
    if (key.signing_secret) {
      const secret = await vault.open(key.workspace_id, "apikey.signing", key.signing_secret);
      if (!verifySignature(req.headers.get("x-variaq-signature"), body, secret)) throw new ApiError(401, "bad_signature", "Missing or invalid X-Variaq-Signature (or timestamp older than 5 minutes).");
    }
  }
  if (!key.last_used_at || Date.parse(key.last_used_at) < Date.now() - 60_000) db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [db.now(), key.id]).catch(() => {});
  return { key, ws: { id: key.workspace_id, slug: key.slug, name: key.ws_name, currency: key.currency }, scopes, body };
}

function apiAudit(wsId, key, action, detail) {
  return db.run("INSERT INTO audit_events (id, workspace_id, user_id, action, entity_type, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [db.id(), wsId, key.created_by, action, "api_key", key.id, JSON.stringify({ key: `nq_${key.prefix}_…`, ...detail }), db.now()]);
}

/** Wrap a route handler with auth + JSON error handling. */
const handler = (scope, fn) => async (req) => {
  try { return await fn(req, await authenticate(req, scope)); }
  catch (e) { return errorResponse(e); }
};

module.exports = { SCOPES, generateKey, parseScopes, hasScope, verifySignature, sign, authenticate, handler, json, errorResponse, ApiError, apiAudit };
