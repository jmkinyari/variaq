// Security primitives: envelope encryption, blind indexes, TOTP, rate limiting, SSRF guard, password policy.
const test = require("node:test");
const assert = require("node:assert");
process.env.VARIAQ_MASTER_KEY = "a".repeat(64);
const c = require("../lib/security/crypto");
const totp = require("../lib/security/totp");
const rl = require("../lib/security/rate-limit");
const { isPrivateIp, assertSafeUrl } = require("../lib/security/net");
const { checkPassword } = require("../lib/security/password");

function memoryKeyring() {
  const rows = new Map();
  const loader = async (ws, v) => (v === undefined ? rows.get(ws) : rows.get(ws)?.key_version === v ? rows.get(ws) : null);
  const creator = async (ws) => { const r = { key_version: 1, wrapped_dek: c.wrapKey(c.newDek(), ws) }; rows.set(ws, r); return r; };
  return { keyring: c.makeKeyring(loader, creator), rows };
}

test("sealed values round-trip and are bound to workspace and purpose", async () => {
  const { keyring } = memoryKeyring();
  const s = await c.seal(keyring, "ws1", "connector.config", { password: "hunter2" });
  assert.ok(c.isSealed(s) && !s.includes("hunter2"));
  assert.deepStrictEqual(await c.openJson(keyring, "ws1", "connector.config", s), { password: "hunter2" });
  await assert.rejects(() => c.open(keyring, "ws1", "other.purpose", s));   // column swap
  await assert.rejects(() => c.open(keyring, "ws2", "connector.config", s)); // tenant swap
});

test("tampered ciphertext is rejected", async () => {
  const { keyring } = memoryKeyring();
  const s = await c.seal(keyring, "ws1", "p", "secret");
  const parts = s.split(":"); const ct = Buffer.from(parts[4], "base64"); ct[0] ^= 1; parts[4] = ct.toString("base64");
  await assert.rejects(() => c.open(keyring, "ws1", "p", parts.join(":")));
});

test("same plaintext encrypts differently each time; blind index is deterministic per workspace", async () => {
  const { keyring } = memoryKeyring();
  assert.notStrictEqual(await c.seal(keyring, "w", "p", "x"), await c.seal(keyring, "w", "p", "x"));
  assert.strictEqual(c.blindIndex("w", "pin", "p051234567x"), c.blindIndex("w", "pin", "P051234567X "));
  assert.notStrictEqual(c.blindIndex("w", "pin", "P051234567X"), c.blindIndex("w2", "pin", "P051234567X"));
});

test("wrapped DEK can't be unwrapped for another workspace", () => {
  const w = c.wrapKey(c.newDek(), "ws1");
  assert.throws(() => c.unwrapKey(w, "ws2"));
});

test("TOTP matches RFC 6238 test vector and tolerates one step of drift", () => {
  const secret = totp.base32Encode(Buffer.from("12345678901234567890"));
  assert.strictEqual(totp.hotp(secret, Math.floor(59 / 30)), "287082"); // RFC 6238 vector 94287082, 6-digit form
  const now = 1_700_000_000_000;
  const code = totp.hotp(secret, Math.floor(now / 30000) - 1);
  assert.ok(totp.verify(secret, code, { now }) !== null);
  assert.strictEqual(totp.verify(secret, "12ab56", { now }), null);
});

test("rate limiter blocks after the limit and reports retry time", () => {
  const p = { limit: 3, windowMs: 1000 };
  for (let i = 0; i < 3; i++) assert.ok(rl.hit(p, "k", 1000 + i).ok);
  const r = rl.hit(p, "k", 1500);
  assert.strictEqual(r.ok, false);
  assert.ok(r.retryAfterSec >= 1);
  assert.ok(rl.hit(p, "k", 2100).ok);
});

test("SSRF guard rejects private, loopback and metadata addresses", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.5", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateIp(ip), ip);
  assert.ok(!isPrivateIp("8.8.8.8"));
  process.env.NODE_ENV = "production";
  await assert.rejects(() => assertSafeUrl("http://example.com"), /https/);
  await assert.rejects(() => assertSafeUrl("https://169.254.169.254/latest/meta-data"), /private/);
  await assert.rejects(() => assertSafeUrl("https://user:pw@example.com"), /credentials/);
  delete process.env.NODE_ENV;
});

test("password policy", () => {
  assert.ok(checkPassword("short"));
  assert.ok(checkPassword("password123"));
  assert.ok(checkPassword("janedoe-finance-2026", { email: "janedoe@x.co" }));
  assert.strictEqual(checkPassword("mango tree by the river"), null);
});
