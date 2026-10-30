// Generic REST connector: any ERP or data warehouse that exposes journal lines as JSON.
// Configurable auth, pagination and a field map of dotted paths into each item.
const crypto = require("crypto");
const { toCents, getPath, assertOk } = require("./common");

const MAPPABLE = ["externalId", "journalNo", "lineNo", "date", "accountCode", "accountName", "description", "reference", "amount", "debit", "credit", "currency", "fxRate",
  "counterparty", "entryType", "postedBy", "approvedBy", "postedAt", "taxCode", "costCenter", "department", "project"];

function parseFieldMap(raw) {
  if (!raw) return {};
  const m = typeof raw === "string" ? JSON.parse(raw) : raw;
  for (const k of Object.keys(m)) if (!MAPPABLE.includes(k)) throw new Error(`Unknown field “${k}” in the field map. Allowed: ${MAPPABLE.join(", ")}.`);
  return m;
}

/** One JSON item → canonical line using the field map. Pure (unit-tested). */
function normalize(item, fieldMap) {
  const v = (k) => (fieldMap[k] ? getPath(item, fieldMap[k]) : undefined);
  let amountCents;
  if (fieldMap.amount) amountCents = toCents(v("amount"));
  else amountCents = (toCents(v("debit")) || 0) - Math.abs(toCents(v("credit")) || 0);
  const ext = v("externalId") ?? crypto.createHash("sha1").update(JSON.stringify(item)).digest("hex").slice(0, 24);
  const out = { externalId: String(ext), amountCents };
  for (const k of MAPPABLE) if (!["externalId", "amount", "debit", "credit"].includes(k) && fieldMap[k]) out[k] = v(k);
  if (out.accountCode !== undefined && out.accountCode !== null) out.accountCode = String(out.accountCode);
  return out;
}

function authHeaders(cfg) {
  switch (cfg.authType) {
    case "bearer": return { authorization: `Bearer ${cfg.token}` };
    case "basic": return { authorization: "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64") };
    case "header": return cfg.headerName ? { [cfg.headerName]: cfg.token } : {};
    default: return {};
  }
}

function buildUrl(cfg, c) {
  if (c.next) return c.next;
  const u = new URL(cfg.path || "", cfg.baseUrl.replace(/\/?$/, "/"));
  const size = Number(cfg.pageSize) || 500;
  if (cfg.sizeParam) u.searchParams.set(cfg.sizeParam, String(size));
  if (cfg.pagination === "page") u.searchParams.set(cfg.pageParam || "page", String(c.page || 1));
  if (cfg.pagination === "offset") u.searchParams.set(cfg.pageParam || "offset", String(c.offset || 0));
  if (cfg.pagination === "cursor" && c.cursor) u.searchParams.set(cfg.pageParam || "cursor", c.cursor);
  if (cfg.sinceParam && c.since) u.searchParams.set(cfg.sinceParam, c.since);
  return u.toString();
}

module.exports = {
  type: "GENERIC_REST", label: "Generic REST / JSON API", vendor: "Any ERP",
  description: "Sage, SAP, Oracle NetSuite, Tally, Busy, Acumatica or an in-house system — anything that returns journal lines as JSON.",
  fields: [
    { key: "baseUrl", label: "Base URL", type: "url", required: true, placeholder: "https://erp.example.com/api/" },
    { key: "path", label: "Journal lines path", type: "text", required: true, placeholder: "v1/gl/lines" },
    { key: "authType", label: "Authentication", type: "select", options: [["bearer", "Bearer token"], ["basic", "Basic (user/password)"], ["header", "Custom header"], ["none", "None"]] },
    { key: "token", label: "Token / header value", type: "password", secret: true },
    { key: "headerName", label: "Custom header name", type: "text", placeholder: "X-API-Key" },
    { key: "username", label: "Username (basic)", type: "text" },
    { key: "password", label: "Password (basic)", type: "password", secret: true },
    { key: "itemsPath", label: "Path to the items array", type: "text", placeholder: "data.items (blank if the response is an array)" },
    { key: "pagination", label: "Pagination", type: "select", options: [["none", "None"], ["page", "Page number"], ["offset", "Offset"], ["cursor", "Cursor token"], ["link", "Next-page URL in body"]] },
    { key: "pageParam", label: "Page / offset / cursor parameter", type: "text", placeholder: "page" },
    { key: "sizeParam", label: "Page-size parameter", type: "text", placeholder: "limit" },
    { key: "pageSize", label: "Page size", type: "text", placeholder: "500" },
    { key: "nextPath", label: "Path to next cursor / next URL", type: "text", placeholder: "meta.next" },
    { key: "sinceParam", label: "Modified-since parameter", type: "text", placeholder: "updated_since", help: "Enables incremental syncs." },
    { key: "fieldMap", label: "Field map (JSON)", type: "textarea", required: true, placeholder: '{"externalId":"id","date":"posting_date","journalNo":"journal.number","accountCode":"account.code","accountName":"account.name","description":"memo","debit":"debit","credit":"credit","postedBy":"created_by"}' },
  ],
  async test(cfg, ctx) {
    const r = await this.fetch({ ...cfg }, null, ctx);
    const sample = r.lines[0];
    return { ok: true, message: `Received ${r.lines.length} line(s) on the first page.${sample ? ` First: ${sample.date || "?"} · ${sample.accountCode || "?"} · ${(sample.amountCents ?? 0) / 100}` : ""}` };
  },
  async fetch(cfg, cursor, { http, log }) {
    const fieldMap = parseFieldMap(cfg.fieldMap);
    const c = cursor?.inRun ? cursor : { page: 1, offset: 0, since: cursor?.since || null, startedAt: new Date().toISOString(), inRun: true };
    const url = buildUrl(cfg, c);
    const res = await http(url, { headers: { accept: "application/json", ...authHeaders(cfg) } });
    assertOk(res, "Request");
    const body = res.json();
    const items = cfg.itemsPath ? getPath(body, cfg.itemsPath) : body;
    if (!Array.isArray(items)) throw new Error("The response doesn't contain an array of items at the configured path.");
    log(`REST: ${items.length} items from ${new URL(url).pathname}.`);
    const lines = items.map((it) => normalize(it, fieldMap));
    const size = Number(cfg.pageSize) || 500;
    let next = null;
    if (cfg.pagination === "page" && items.length >= size) next = { ...c, page: c.page + 1 };
    if (cfg.pagination === "offset" && items.length >= size) next = { ...c, offset: c.offset + items.length };
    if (cfg.pagination === "cursor") { const nc = getPath(body, cfg.nextPath || "next_cursor"); if (nc && items.length) next = { ...c, cursor: String(nc) }; }
    if (cfg.pagination === "link") { const nl = getPath(body, cfg.nextPath || "next"); if (nl && items.length) next = { ...c, next: new URL(nl, url).toString() }; }
    if (next) return { lines, nextCursor: next, done: false };
    return { lines, nextCursor: { since: cfg.sinceParam ? c.startedAt : null }, done: true };
  },
  normalize, parseFieldMap, MAPPABLE,
};
