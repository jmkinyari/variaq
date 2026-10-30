// RFC 6238 time-based one-time passwords (Google Authenticator, Microsoft Authenticator, 1Password…).
const crypto = require("crypto");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secret, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

/** Returns the matched time-step (for replay protection) or null. Accepts ±1 step of clock drift. */
function verify(secret, token, { step = 30, window = 1, now = Date.now() } = {}) {
  const t = String(token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return null;
  const counter = Math.floor(now / 1000 / step);
  for (let w = -window; w <= window; w++) {
    const c = counter + w;
    if (c < 0) continue;
    const expected = hotp(secret, c);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return c;
  }
  return null;
}

const otpauthUrl = (secret, account, issuer = "Variaq") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Recovery codes: shown once, stored as SHA-256 hashes. */
function recoveryCodes(n = 8) {
  return Array.from({ length: n }, () => crypto.randomBytes(5).toString("hex").replace(/(.{5})/, "$1-"));
}

module.exports = { newSecret, hotp, verify, otpauthUrl, base32Encode, base32Decode, recoveryCodes };
