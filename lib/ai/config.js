// Platform AI configuration, owned by Variaq system administrators (not by individual companies).
//
// - One Anthropic API key for the whole platform, stored sealed with the master key. Admins renew
//   it in the admin console; a new key is tested before it replaces the old one, and every change
//   is logged. A renewal date drives reminders.
// - Each company (workspace) gets an entitlement set by Variaq (on/off, monthly token allowance)
//   and must give consent (by its owner) before any of its data is sent to the model.
// - Every call is metered per company/user/feature for quota enforcement and billing.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import db from "../db";
import { sealGlobal, openGlobal } from "../security/crypto";

export const MODELS = {
  "claude-opus-5-5": { label: "Claude Opus 5.5 (most capable, default)", inUsd: 4, outUsd: 20, cacheReadUsd: 0.2, fallbacks: true },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5 (faster, lower cost)", inUsd: 2, outUsd: 10, cacheReadUsd: 0.2, fallbacks: true },
  "claude-haiku-5-5": { label: "Claude Haiku 5.5 (fastest, lowest cost)", inUsd: 0.1, outUsd: 0.5, cacheReadUsd: 0.01, fallbacks: false },
};
export const EFFORTS = ["low", "medium", "high", "xhigh"];

const DEFAULTS = {
  enabled: false,
  model: "claude-opus-5-5",
  effort: "medium",
  defaultMonthlyTokens: 2_000_000,
  newCompaniesEnabled: true,
  reportMaxTokens: 32_000,
  chatMaxTokens: 16_000,
};

const g = globalThis;
if (!g.__nqAi) g.__nqAi = { cfg: null, at: 0, client: null, clientKeyHint: null };
const cache = g.__nqAi;
const TTL_MS = 15_000; // other app instances pick up admin changes within 15 s

async function readSetting(key) {
  const row = await db.get("SELECT value FROM platform_settings WHERE key = ?", [key]);
  return row ? row.value : null;
}
async function writeSetting(key, value, userId) {
  await db.run("INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at", [key, value, userId || null, db.now()]);
}

/** Full platform AI config, including key metadata (never the key itself). */
export async function getAiConfig({ fresh = false } = {}) {
  if (!fresh && cache.cfg && Date.now() - cache.at < TTL_MS) return cache.cfg;
  const [cfgRaw, metaRaw, sealed] = await Promise.all([readSetting("ai.config"), readSetting("ai.key_meta"), readSetting("ai.key")]);
  const cfg = { ...DEFAULTS, ...(cfgRaw ? JSON.parse(cfgRaw) : {}) };
  if (!MODELS[cfg.model]) cfg.model = DEFAULTS.model;
  const meta = metaRaw ? JSON.parse(metaRaw) : null;
  let key = sealed ? openGlobal("ai.key", sealed) : null;
  let keySource = key ? "console" : null;
  if (!key && process.env.ANTHROPIC_API_KEY) { key = process.env.ANTHROPIC_API_KEY; keySource = "environment"; }
  const now = new Date().toISOString().slice(0, 10);
  const renewBy = meta?.renewBy || null;
  const keyState = !key ? "MISSING" : renewBy && renewBy < now ? "EXPIRED" : renewBy && daysBetween(now, renewBy) <= 14 ? "RENEW_SOON" : "OK";
  cache.cfg = { ...cfg, key, keySource, keyMeta: meta, keyState, renewBy };
  cache.at = Date.now();
  return cache.cfg;
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
function invalidate() { cache.cfg = null; cache.client = null; cache.clientKeyHint = null; }

export async function saveAiConfig(patch, userId) {
  const cur = await getAiConfig({ fresh: true });
  const next = {
    enabled: patch.enabled ?? cur.enabled,
    model: MODELS[patch.model] ? patch.model : cur.model,
    effort: EFFORTS.includes(patch.effort) ? patch.effort : cur.effort,
    defaultMonthlyTokens: Number.isFinite(+patch.defaultMonthlyTokens) && +patch.defaultMonthlyTokens >= 0 ? Math.round(+patch.defaultMonthlyTokens) : cur.defaultMonthlyTokens,
    newCompaniesEnabled: patch.newCompaniesEnabled ?? cur.newCompaniesEnabled,
    reportMaxTokens: cur.reportMaxTokens, chatMaxTokens: cur.chatMaxTokens,
  };
  await writeSetting("ai.config", JSON.stringify(next), userId);
  invalidate();
  return next;
}

const keyHint = (k) => `${String(k).slice(0, 7)}…${String(k).slice(-4)}`;

/** Verify a key works (cheap metadata call, no tokens spent). Returns { ok, message }. */
export async function testKey(apiKey, model) {
  try {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 });
    const m = await client.models.retrieve(model || DEFAULTS.model);
    return { ok: true, message: `Key works — ${m.display_name || m.id} is available.` };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, message: "Anthropic rejected this key (invalid or revoked)." };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, message: "This key doesn't have access to the selected model." };
    if (e instanceof Anthropic.NotFoundError) return { ok: false, message: "The selected model isn't available to this key." };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, message: "Couldn't reach the Anthropic API from this server." };
    if (e instanceof Anthropic.APIError) return { ok: false, message: `Anthropic API error ${e.status}.` };
    return { ok: false, message: e.message || "Key test failed." };
  }
}

/** Renew (replace) the platform key. The new key must pass a live test first. */
export async function renewKey(apiKey, { renewBy, note, userId }) {
  const k = String(apiKey || "").trim();
  if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k)) return { ok: false, message: "That doesn't look like an Anthropic API key (it should start with sk-ant-)." };
  const cfg = await getAiConfig({ fresh: true });
  const t = await testKey(k, cfg.model);
  await logKeyEvent("TEST", keyHint(k), t.message, t.ok, userId);
  if (!t.ok) return t;
  const meta = { hint: keyHint(k), renewedAt: db.now(), renewedBy: userId, renewBy: /^\d{4}-\d{2}-\d{2}$/.test(renewBy || "") ? renewBy : null, lastTestAt: db.now(), lastTestOk: true };
  await writeSetting("ai.key", sealGlobal("ai.key", k), userId);
  await writeSetting("ai.key_meta", JSON.stringify(meta), userId);
  await logKeyEvent("RENEWED", meta.hint, note || null, true, userId);
  invalidate();
  return { ok: true, message: `New key ${meta.hint} is active. ${t.message}` };
}

export async function revokeKey(userId, note) {
  const cfg = await getAiConfig({ fresh: true });
  await db.run("DELETE FROM platform_settings WHERE key IN ('ai.key', 'ai.key_meta')");
  await logKeyEvent("REVOKED", cfg.keyMeta?.hint || null, note || null, true, userId);
  invalidate();
}

export async function retestKey(userId) {
  const cfg = await getAiConfig({ fresh: true });
  if (!cfg.key) return { ok: false, message: "No key is configured." };
  const t = await testKey(cfg.key, cfg.model);
  await logKeyEvent("TEST", cfg.keyMeta?.hint || "environment", t.message, t.ok, userId);
  if (cfg.keySource === "console") await writeSetting("ai.key_meta", JSON.stringify({ ...cfg.keyMeta, lastTestAt: db.now(), lastTestOk: t.ok }), userId);
  invalidate();
  return t;
}

async function logKeyEvent(action, hint, note, ok, userId) {
  await db.run("INSERT INTO ai_key_events (id, action, key_hint, note, ok, user_id, created_at) VALUES (?,?,?,?,?,?,?)", [db.id(), action, hint, note ? String(note).slice(0, 300) : null, ok ? 1 : 0, userId || null, db.now()]);
}

/** Shared SDK client for the current platform key. */
export async function aiClient() {
  const cfg = await getAiConfig();
  if (!cfg.key) throw new AiUnavailable("AI isn't set up yet. A Variaq system administrator needs to add an API key.");
  const hint = keyHint(cfg.key);
  if (!cache.client || cache.clientKeyHint !== hint) { cache.client = new Anthropic({ apiKey: cfg.key, maxRetries: 2, timeout: 10 * 60_000 }); cache.clientKeyHint = hint; }
  return { client: cache.client, cfg };
}

export class AiUnavailable extends Error { constructor(m) { super(m); this.code = "AI_UNAVAILABLE"; } }

const monthStart = () => new Date().toISOString().slice(0, 7) + "-01";

/** Can this company use AI right now? Returns { ok, reason, used, limit, consent, entitled }. */
export async function aiStatus(wsId) {
  const cfg = await getAiConfig();
  const [ent, use] = await Promise.all([
    db.get("SELECT * FROM ai_entitlements WHERE workspace_id = ?", [wsId]),
    db.get("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) n FROM ai_usage WHERE workspace_id = ? AND created_at >= ?", [wsId, monthStart()]),
  ]);
  const entitled = ent ? !!ent.enabled : !!cfg.newCompaniesEnabled;
  const limit = ent?.monthly_token_limit ?? cfg.defaultMonthlyTokens;
  const used = use?.n || 0;
  const consent = !!ent?.consent_at;
  const base = { used, limit, consent, entitled, model: cfg.model, keyState: cfg.keyState };
  if (!cfg.enabled) return { ...base, ok: false, reason: "AI is switched off for the platform by Variaq." };
  if (!cfg.key || cfg.keyState === "EXPIRED") return { ...base, ok: false, reason: "AI is temporarily unavailable (the platform key needs renewal by Variaq)." };
  if (!entitled) return { ...base, ok: false, reason: "AI isn't included for this company. Contact Variaq to enable it." };
  if (!consent) return { ...base, ok: false, needsConsent: true, reason: "The company owner hasn't yet allowed AI to process this company's data (Settings → AI)." };
  if (limit && used >= limit) return { ...base, ok: false, reason: `This month's AI allowance (${limit.toLocaleString()} tokens) is used up. It resets on the 1st, or Variaq can raise it.` };
  return { ...base, ok: true };
}

export async function requireAi(wsId) {
  const s = await aiStatus(wsId);
  if (!s.ok) throw new AiUnavailable(s.reason);
  return s;
}

/** Record token usage and cost from one or more API responses. */
export async function recordUsage({ wsId, userId, feature, model, usage, ok = true }) {
  const m = MODELS[model] || MODELS[DEFAULTS.model];
  const u = usage || {};
  const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const cacheRead = u.cache_read_input_tokens || 0;
  const output = u.output_tokens || 0;
  const costMicros = Math.round(input * m.inUsd + cacheRead * m.cacheReadUsd + output * m.outUsd); // $/MTok × tokens = micro-dollars
  await db.run("INSERT INTO ai_usage (id, workspace_id, user_id, feature, model, input_tokens, output_tokens, cache_read_tokens, cost_micros, ok, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [db.id(), wsId, userId || null, feature, model, input + cacheRead, output, cacheRead, costMicros, ok ? 1 : 0, db.now()]);
}
export function addUsage(total, u) {
  if (!u) return total;
  for (const k of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) total[k] = (total[k] || 0) + (u[k] || 0);
  return total;
}

export async function setEntitlement(wsId, { enabled, monthlyTokenLimit }, userId) {
  await db.run(`INSERT INTO ai_entitlements (workspace_id, enabled, monthly_token_limit, updated_by, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(workspace_id) DO UPDATE SET enabled = excluded.enabled, monthly_token_limit = excluded.monthly_token_limit, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  [wsId, enabled ? 1 : 0, monthlyTokenLimit === null || monthlyTokenLimit === undefined || monthlyTokenLimit === "" ? null : Math.max(0, Math.round(+monthlyTokenLimit)), userId, db.now()]);
}

export async function setConsent(wsId, consent, userId) {
  const cfg = await getAiConfig();
  await db.run(`INSERT INTO ai_entitlements (workspace_id, enabled, consent_by, consent_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(workspace_id) DO UPDATE SET consent_by = excluded.consent_by, consent_at = excluded.consent_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  [wsId, cfg.newCompaniesEnabled ? 1 : 0, consent ? userId : null, consent ? db.now() : null, userId, db.now()]);
}

/** Standard request options: model, effort, and server-side refusal fallback where supported. */
export function requestOptions(cfg) {
  const opts = { model: cfg.model, output_config: { effort: cfg.effort } };
  if (MODELS[cfg.model]?.fallbacks) return { ...opts, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
  return opts;
}
