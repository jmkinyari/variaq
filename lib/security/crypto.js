// Envelope encryption for tenant data.
//
// - A master key (VARIAQ_MASTER_KEY, 32 bytes base64/hex) never touches the database. It only
//   wraps per-workspace data-encryption keys (DEKs).
// - Each workspace has its own random 256-bit DEK, stored wrapped in `workspace_keys`. Deleting a
//   workspace's key row crypto-shreds everything encrypted for it.
// - Fields are sealed with AES-256-GCM, with the workspace id + field purpose bound in as
//   additional authenticated data, so a ciphertext copied to another tenant or column won't open.
// - Blind indexes (HMAC-SHA256 with a key derived per workspace) allow exact-match lookups on
//   encrypted values such as KRA PINs without storing them in clear.
//
// Format of a sealed value:  enc:v<keyVersion>:<iv b64>:<tag b64>:<ciphertext b64>
const crypto = require("crypto");

const PREFIX = "enc:";
let devKeyWarned = false;

function loadMasterKey() {
  const raw = process.env.VARIAQ_MASTER_KEY || "";
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("VARIAQ_MASTER_KEY must be 32 bytes (64 hex chars or base64).");
    return buf;
  }
  if (process.env.NODE_ENV === "production") throw new Error("VARIAQ_MASTER_KEY is required in production. Run `npm run setup` or generate one with `node scripts/keygen.js`.");
  if (!devKeyWarned) { devKeyWarned = true; console.warn("[variaq] VARIAQ_MASTER_KEY not set — using an insecure development key. Never do this in production."); }
  return crypto.createHash("sha256").update("variaq-insecure-development-master-key").digest();
}

const g = globalThis;
if (!g.__variaqKeys) g.__variaqKeys = { master: null, deks: new Map() };
const keys = g.__variaqKeys;
const master = () => (keys.master ||= loadMasterKey());

function gcmSeal(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv, tag: c.getAuthTag(), ct };
}
function gcmOpen(key, iv, tag, ct, aad) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
const b64 = (b) => b.toString("base64");
const unb64 = (s) => Buffer.from(s, "base64");

/** Wrap a DEK with the master key. Returns a string safe to store. */
function wrapKey(dek, workspaceId) {
  const { iv, tag, ct } = gcmSeal(master(), dek, `dek|${workspaceId}`);
  return `${b64(iv)}.${b64(tag)}.${b64(ct)}`;
}
function unwrapKey(wrapped, workspaceId) {
  const [iv, tag, ct] = String(wrapped).split(".").map(unb64);
  return gcmOpen(master(), iv, tag, ct, `dek|${workspaceId}`);
}
const newDek = () => crypto.randomBytes(32);

// DEK cache with a small LRU bound so a busy multi-tenant node doesn't hold every key forever.
const DEK_CACHE_MAX = 500;
function cacheDek(workspaceId, version, dek) {
  const k = `${workspaceId}:${version}`;
  keys.deks.delete(k);
  keys.deks.set(k, dek);
  if (keys.deks.size > DEK_CACHE_MAX) keys.deks.delete(keys.deks.keys().next().value);
}
function cachedDek(workspaceId, version) {
  const k = `${workspaceId}:${version}`;
  const v = keys.deks.get(k);
  if (v) { keys.deks.delete(k); keys.deks.set(k, v); }
  return v;
}
function forgetDeks(workspaceId) { for (const k of [...keys.deks.keys()]) if (k.startsWith(workspaceId + ":")) keys.deks.delete(k); }

/**
 * Key provider: given a workspace id, returns { version, dek } for the current key, and can load
 * an older version for decryption. `loader(workspaceId, version?)` must return { key_version, wrapped_dek }.
 */
function makeKeyring(loader, creator) {
  async function current(workspaceId) {
    let row = await loader(workspaceId);
    if (!row) row = await creator(workspaceId);
    let dek = cachedDek(workspaceId, row.key_version);
    if (!dek) { dek = unwrapKey(row.wrapped_dek, workspaceId); cacheDek(workspaceId, row.key_version, dek); }
    return { version: row.key_version, dek };
  }
  async function version(workspaceId, v) {
    let dek = cachedDek(workspaceId, v);
    if (dek) return dek;
    const row = await loader(workspaceId, v);
    if (!row) throw new Error("Encryption key not found for this workspace. The data may have been crypto-shredded.");
    dek = unwrapKey(row.wrapped_dek, workspaceId);
    cacheDek(workspaceId, v, dek);
    return dek;
  }
  return { current, version };
}

/** Encrypt a string (or JSON-able value) for a workspace. `purpose` binds the value to its column. */
async function seal(keyring, workspaceId, purpose, value) {
  if (value === null || value === undefined || value === "") return value ?? null;
  const plain = typeof value === "string" ? value : JSON.stringify(value);
  const { version, dek } = await keyring.current(workspaceId);
  const { iv, tag, ct } = gcmSeal(dek, Buffer.from(plain, "utf8"), `${workspaceId}|${purpose}`);
  return `${PREFIX}v${version}:${b64(iv)}:${b64(tag)}:${b64(ct)}`;
}
const isSealed = (v) => typeof v === "string" && v.startsWith(PREFIX);
async function open(keyring, workspaceId, purpose, value) {
  if (!isSealed(value)) return value ?? null; // legacy/plain values pass through
  const [, ver, iv, tag, ct] = value.match(/^enc:v(\d+):([^:]+):([^:]+):(.*)$/s) || [];
  if (!ver) throw new Error("Malformed encrypted value.");
  const dek = await keyring.version(workspaceId, Number(ver));
  return gcmOpen(dek, unb64(iv), unb64(tag), unb64(ct), `${workspaceId}|${purpose}`).toString("utf8");
}
async function openJson(keyring, workspaceId, purpose, value, fallback = null) {
  const s = await open(keyring, workspaceId, purpose, value);
  if (s === null || s === undefined || s === "") return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

/** Deterministic, keyed hash for exact-match lookup of encrypted values (e.g. KRA PIN). */
function blindIndex(workspaceId, purpose, value) {
  if (value === null || value === undefined || value === "") return null;
  const k = crypto.createHmac("sha256", master()).update(`bidx|${workspaceId}|${purpose}`).digest();
  return crypto.createHmac("sha256", k).update(String(value).trim().toUpperCase()).digest("base64url").slice(0, 32);
}

/** Seal with the master key directly — for user-level secrets that don't belong to a workspace (MFA seeds). */
function sealGlobal(purpose, value) {
  const { iv, tag, ct } = gcmSeal(master(), Buffer.from(String(value), "utf8"), `global|${purpose}`);
  return `${PREFIX}g:${b64(iv)}:${b64(tag)}:${b64(ct)}`;
}
function openGlobal(purpose, value) {
  const m = String(value || "").match(/^enc:g:([^:]+):([^:]+):(.*)$/s);
  if (!m) return null;
  return gcmOpen(master(), unb64(m[1]), unb64(m[2]), unb64(m[3]), `global|${purpose}`).toString("utf8");
}

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { wrapKey, unwrapKey, newDek, makeKeyring, seal, open, openJson, isSealed, blindIndex, sealGlobal, openGlobal, sha256, randomToken, safeEqual, forgetDeks };
