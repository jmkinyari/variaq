// Outbound request guard for ERP connectors (SSRF protection). A tenant-supplied URL must not be
// able to reach the app's own network: loopback, private ranges, link-local/metadata endpoints.
const dns = require("dns").promises;
const net = require("net");

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const s = ip.toLowerCase();
  if (s.startsWith("::ffff:")) return isPrivateIp(s.slice(7));
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80");
}

/** Validates a connector URL. Throws with a user-facing message. Set CONNECTOR_ALLOW_PRIVATE=1 for on-prem ERPs. */
async function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("That isn't a valid URL."); }
  const allowPrivate = process.env.CONNECTOR_ALLOW_PRIVATE === "1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (allowPrivate || process.env.NODE_ENV !== "production"))) throw new Error("Connector URLs must use https://.");
  if (u.username || u.password) throw new Error("Put credentials in the credential fields, not in the URL.");
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw new Error(`Couldn't resolve ${host}.`); })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error("That address points to a private or internal network. Ask your administrator to enable on-premise connectors (CONNECTOR_ALLOW_PRIVATE=1).");
  return u;
}

/** fetch() with timeout, size cap, and SSRF check on every hop (redirects are followed manually). */
async function safeFetch(url, opts = {}, { timeoutMs = 30_000, maxBytes = 50 * 1024 * 1024, maxRedirects = 3 } = {}) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try { res = await fetch(current, { ...opts, redirect: "manual", signal: ctrl.signal }); }
    catch (e) { throw new Error(e.name === "AbortError" ? `Request to ${new URL(current).host} timed out.` : `Couldn't reach ${new URL(current).host}: ${e.message}`); }
    finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { current = new URL(res.headers.get("location"), current).toString(); continue; }
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) throw new Error("The response is too large.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("The response is too large.");
    return { status: res.status, ok: res.ok, headers: res.headers, buffer: () => buf, text: () => buf.toString("utf8"), json: () => JSON.parse(buf.toString("utf8")) };
  }
  throw new Error("Too many redirects.");
}

module.exports = { isPrivateIp, assertSafeUrl, safeFetch };
