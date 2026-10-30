// Shared helpers for ERP connectors: the canonical journal-line shape, money/date coercion,
// dotted-path access, OAuth2 token refresh, and a stable content hash for change detection.
const crypto = require("crypto");

/** Canonical line fields, in the order used for hashing. */
const CANON_FIELDS = ["externalId", "journalNo", "lineNo", "date", "accountCode", "accountName", "description", "reference", "amountCents", "currency", "fxRate",
  "counterparty", "entryType", "postedBy", "approvedBy", "postedAt", "taxCode", "costCenter", "department", "project"];

/** Decimal (number or string) → integer cents, half away from zero. null if not a number. */
function toCents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7);
}

/** Many date encodings → "YYYY-MM-DD" (ISO, ISO datetime, Microsoft JSON "/Date(ms+0000)/"). */
function toIsoDate(v) {
  if (!v) return null;
  const s = String(v);
  const ms = s.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function toIsoDateTime(v) {
  if (!v) return null;
  const s = String(v);
  const ms = s.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (ms) return new Date(Number(ms[1])).toISOString();
  // Odoo returns "YYYY-MM-DD HH:MM:SS" in UTC without a zone.
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(" ", "T") + "Z" : s);
  return isNaN(d) ? null : d.toISOString();
}

/** Read a dotted path ("lines.0.account.code") from an object. */
function getPath(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

const str = (v, max = 500) => (v === null || v === undefined || v === false ? null : String(v).trim().slice(0, max) || null);

/** Finalise a line: trims, required checks. Returns { line } or { error }. */
function canon(l) {
  const line = {
    externalId: str(l.externalId, 200), journalNo: str(l.journalNo, 100), lineNo: Number.isFinite(+l.lineNo) && l.lineNo !== null && l.lineNo !== "" ? Math.trunc(+l.lineNo) : null,
    date: toIsoDate(l.date), accountCode: str(l.accountCode, 60), accountName: str(l.accountName, 200), description: str(l.description) || str(l.reference) || "(no description)",
    reference: str(l.reference, 200), amountCents: Number.isInteger(l.amountCents) ? l.amountCents : null, currency: str(l.currency, 3), fxRate: Number.isFinite(+l.fxRate) && l.fxRate ? +l.fxRate : null,
    counterparty: str(l.counterparty, 200), entryType: str(l.entryType, 60), postedBy: str(l.postedBy, 100), approvedBy: str(l.approvedBy, 100), postedAt: l.postedAt ? toIsoDateTime(l.postedAt) : null,
    taxCode: str(l.taxCode, 40), costCenter: str(l.costCenter, 60), department: str(l.department, 100), project: str(l.project, 100),
  };
  if (!line.externalId) return { error: "missing externalId" };
  if (!line.date) return { error: `line ${line.externalId}: missing or invalid date` };
  if (!line.accountCode) return { error: `line ${line.externalId}: missing account code` };
  if (line.amountCents === null) return { error: `line ${line.externalId}: missing amount` };
  return { line };
}

function lineHash(l) {
  return crypto.createHash("sha256").update(JSON.stringify(CANON_FIELDS.slice(1).map((k) => l[k] ?? null))).digest("hex").slice(0, 32);
}

/** Leading account code from a display name like "400000 Product Sales" or "[1010] Bank". */
function splitCodeName(display) {
  const s = String(display || "").trim();
  const m = s.match(/^\[?([A-Za-z0-9.\-]+)\]?\s+(.*)$/);
  return m && /\d/.test(m[1]) ? { code: m[1], name: m[2] } : { code: s, name: s };
}

/** OAuth2 refresh-token grant. Returns { accessToken, refreshToken, expiresAt }. */
async function refreshOAuth(fetchFn, tokenUrl, { clientId, clientSecret, refreshToken, extra = {}, basicAuth = true }) {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, ...(basicAuth ? {} : { client_id: clientId, client_secret: clientSecret }), ...extra });
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (basicAuth) headers.authorization = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetchFn(tokenUrl, { method: "POST", headers, body: body.toString() });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}). Reconnect the integration with a new refresh token.`);
  const j = res.json();
  return { accessToken: j.access_token, refreshToken: j.refresh_token || refreshToken, expiresAt: Date.now() + (Number(j.expires_in) || 1800) * 1000 };
}

/** Client-credentials grant (Microsoft identity platform etc.). */
async function clientCredentials(fetchFn, tokenUrl, { clientId, clientSecret, scope }) {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope });
  const res = await fetchFn(tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (!res.ok) throw new Error(`Authentication failed (${res.status}). Check the tenant, client ID and secret.`);
  return res.json().access_token;
}

/** Throws a readable error for a non-2xx API response (never includes credentials). */
function assertOk(res, what) {
  if (res.ok) return;
  let detail = "";
  try { detail = res.text().slice(0, 200).replace(/\s+/g, " "); } catch {}
  const hint = res.status === 401 || res.status === 403 ? " Check the credentials and that the API user has read access to the ledger." : res.status === 429 ? " The ERP is rate-limiting requests; the sync will retry." : "";
  const e = new Error(`${what} failed (${res.status}).${hint}${detail ? ` ${detail}` : ""}`);
  e.retryable = res.status === 429 || res.status >= 500;
  throw e;
}

module.exports = { CANON_FIELDS, toCents, toIsoDate, toIsoDateTime, getPath, canon, lineHash, splitCodeName, refreshOAuth, clientCredentials, assertOk, str };
