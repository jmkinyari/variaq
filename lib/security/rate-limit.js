// Sliding-window rate limiter. In-memory per app instance; behind a load balancer each instance
// enforces its own window, which still caps abuse at N × limit. Swap `store` for Redis to share.
const g = globalThis;
if (!g.__variaqRate) g.__variaqRate = new Map();
const store = g.__variaqRate;

const POLICIES = {
  login: { limit: 10, windowMs: 15 * 60_000 },     // per IP + email
  signup: { limit: 5, windowMs: 60 * 60_000 },     // per IP
  mfa: { limit: 8, windowMs: 10 * 60_000 },
  api: { limit: 600, windowMs: 60_000 },           // per API key
  upload: { limit: 60, windowMs: 10 * 60_000 },    // per user
  heavy: { limit: 30, windowMs: 60_000 },          // engine runs per workspace
  contact: { limit: 5, windowMs: 60 * 60_000 },
};

/** Returns { ok, remaining, retryAfterSec }. */
function hit(policy, key, now = Date.now()) {
  const p = POLICIES[policy] || policy;
  const k = `${typeof policy === "string" ? policy : "custom"}|${key}`;
  const arr = (store.get(k) || []).filter((t) => now - t < p.windowMs);
  if (arr.length >= p.limit) {
    store.set(k, arr);
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((p.windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  store.set(k, arr);
  if (store.size > 50_000) sweep(now);
  return { ok: true, remaining: p.limit - arr.length, retryAfterSec: 0 };
}
function reset(policy, key) { store.delete(`${policy}|${key}`); }
function sweep(now = Date.now()) {
  for (const [k, arr] of store) if (!arr.length || now - arr[arr.length - 1] > 3_600_000) store.delete(k);
}

class RateLimitError extends Error {
  constructor(retryAfterSec) { super(`Too many attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`); this.retryAfterSec = retryAfterSec; }
}
function enforce(policy, key) { const r = hit(policy, key); if (!r.ok) throw new RateLimitError(r.retryAfterSec); return r; }

module.exports = { hit, reset, enforce, sweep, POLICIES, RateLimitError };
