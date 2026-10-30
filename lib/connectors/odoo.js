// Odoo (Community / Enterprise / Odoo.sh, v14+) via the external JSON-RPC API.
// Reads posted journal items (account.move.line) incrementally by write_date, plus the chart.
const { toCents, toIsoDate, splitCodeName, assertOk } = require("./common");

const PAGE = 500;
const FIELDS = ["id", "move_id", "move_name", "account_id", "partner_id", "name", "ref", "date", "debit", "credit", "balance", "amount_currency", "currency_id",
  "journal_id", "create_uid", "create_date", "write_date", "tax_line_id", "parent_state"];

async function rpc(http, cfg, service, method, args) {
  const res = await http(cfg.url.replace(/\/+$/, "") + "/jsonrpc", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }),
  });
  assertOk(res, "Odoo request");
  const j = res.json();
  if (j.error) throw new Error(`Odoo: ${j.error.data?.message || j.error.message}`);
  return j.result;
}
async function login(http, cfg) {
  const uid = await rpc(http, cfg, "common", "authenticate", [cfg.database, cfg.username, cfg.apiKey, {}]);
  if (!uid) throw new Error("Odoo rejected the login. Check the database name, user and API key.");
  return uid;
}
const kw = (http, cfg, uid, model, method, args, opts) => rpc(http, cfg, "object", "execute_kw", [cfg.database, uid, cfg.apiKey, model, method, args, opts]);

/** account.move.line record → canonical line. Pure (unit-tested). */
function normalize(r, chart = new Map()) {
  const acc = Array.isArray(r.account_id) ? r.account_id : [null, ""];
  const fromChart = chart.get(acc[0]);
  const cn = fromChart || splitCodeName(acc[1]);
  const amount = r.balance !== undefined && r.balance !== null ? r.balance : (r.debit || 0) - (r.credit || 0);
  return {
    externalId: `aml:${r.id}`,
    journalNo: r.move_name || (Array.isArray(r.move_id) ? r.move_id[1] : null),
    lineNo: r.id,
    date: r.date,
    accountCode: cn.code, accountName: cn.name,
    description: r.name || r.ref || "",
    reference: r.ref || null,
    amountCents: toCents(amount),
    currency: Array.isArray(r.currency_id) ? r.currency_id[1] : null,
    fxRate: r.amount_currency && amount ? Math.abs(amount / r.amount_currency) : null,
    counterparty: Array.isArray(r.partner_id) ? r.partner_id[1] : null,
    entryType: Array.isArray(r.journal_id) ? r.journal_id[1] : null,
    postedBy: Array.isArray(r.create_uid) ? r.create_uid[1] : null,
    postedAt: r.create_date || null,
    taxCode: Array.isArray(r.tax_line_id) ? r.tax_line_id[1] : null,
  };
}

module.exports = {
  type: "ODOO", label: "Odoo", vendor: "Odoo S.A.",
  description: "Odoo 14–18 (online, Odoo.sh or self-hosted). Reads posted journal items and the chart of accounts via the external API.",
  fields: [
    { key: "url", label: "Odoo URL", type: "url", required: true, placeholder: "https://yourcompany.odoo.com" },
    { key: "database", label: "Database name", type: "text", required: true },
    { key: "username", label: "Login (email)", type: "text", required: true },
    { key: "apiKey", label: "API key", type: "password", required: true, secret: true, help: "Odoo → Preferences → Account Security → New API Key. Use a read-only accounting user." },
    { key: "since", label: "Start from date", type: "date", help: "First sync reads entries modified on or after this date (default 1 Jan last year)." },
  ],
  async test(cfg, { http }) {
    const uid = await login(http, cfg);
    const n = await kw(http, cfg, uid, "account.move.line", "search_count", [[["parent_state", "=", "posted"]]], {});
    return { ok: true, message: `Connected as user #${uid}. ${n.toLocaleString()} posted journal items are visible.` };
  },
  async fetch(cfg, cursor, { http, log }) {
    const c = cursor || { since: (cfg.since || `${new Date().getUTCFullYear() - 1}-01-01`) + " 00:00:00", offset: 0, max: null };
    const uid = await login(http, cfg);
    let chart = null;
    if (!c.offset) {
      const accts = await kw(http, cfg, uid, "account.account", "search_read", [[]], { fields: ["id", "code", "name"], limit: 20000 });
      chart = accts.map((a) => ({ code: a.code, name: a.name }));
      c.chartMap = Object.fromEntries(accts.map((a) => [a.id, [a.code, a.name]]));
    }
    const chartMap = new Map(Object.entries(c.chartMap || {}).map(([k, v]) => [Number(k), { code: v[0], name: v[1] }]));
    const rows = await kw(http, cfg, uid, "account.move.line", "search_read", [[["parent_state", "=", "posted"], ["write_date", ">=", c.since]]],
      { fields: FIELDS, limit: PAGE, offset: c.offset, order: "write_date asc, id asc" });
    log(`Odoo: read ${rows.length} journal items (offset ${c.offset}).`);
    const lines = rows.map((r) => normalize(r, chartMap));
    const maxWrite = rows.reduce((m, r) => (r.write_date > m ? r.write_date : m), c.max || c.since);
    const done = rows.length < PAGE;
    const next = done ? { since: maxWrite, offset: 0, max: null } : { ...c, offset: c.offset + rows.length, max: maxWrite };
    return { lines, chart, nextCursor: next, done };
  },
  normalize,
};
