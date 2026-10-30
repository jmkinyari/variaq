// Microsoft Dynamics 365 Business Central via API v2.0 (generalLedgerEntries — immutable, numbered).
const { toCents, clientCredentials, assertOk } = require("./common");

const PAGE = 1000;
const api = (cfg) => `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(cfg.tenantId)}/${encodeURIComponent(cfg.environment || "production")}/api/v2.0/companies(${cfg.companyId})`;

/** generalLedgerEntry → canonical line. Pure (unit-tested). */
function normalize(e, accounts = {}) {
  return {
    externalId: `gle:${e.entryNumber}`,
    journalNo: e.documentNumber || null,
    lineNo: e.entryNumber,
    date: e.postingDate,
    accountCode: e.accountNumber,
    accountName: accounts[e.accountNumber] || null,
    description: e.description || e.documentNumber,
    reference: e.documentNumber || null,
    amountCents: (toCents(e.debitAmount) || 0) - (toCents(e.creditAmount) || 0),
    entryType: e.documentType && e.documentType !== " " ? e.documentType : null,
    postedAt: e.lastModifiedDateTime || null,
  };
}

async function token(cfg, http) {
  return clientCredentials(http, `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, { clientId: cfg.clientId, clientSecret: cfg.clientSecret, scope: "https://api.businesscentral.dynamics.com/.default" });
}

module.exports = {
  type: "DYNAMICS_BC", label: "Dynamics 365 Business Central", vendor: "Microsoft",
  description: "Reads G/L entries incrementally by entry number using an Entra ID app registration.",
  fields: [
    { key: "tenantId", label: "Entra tenant ID", type: "text", required: true },
    { key: "environment", label: "Environment name", type: "text", placeholder: "production" },
    { key: "companyId", label: "Company ID (GUID)", type: "text", required: true },
    { key: "clientId", label: "App (client) ID", type: "text", required: true },
    { key: "clientSecret", label: "Client secret", type: "password", required: true, secret: true, help: "Register the app in Business Central (Microsoft Entra Applications) with D365 READ permissions." },
  ],
  async test(cfg, { http }) {
    const at = await token(cfg, http);
    const res = await http(`${api(cfg)}`, { headers: { authorization: `Bearer ${at}`, accept: "application/json" } });
    assertOk(res, "Business Central company lookup");
    return { ok: true, message: `Connected to ${res.json().displayName || res.json().name || "Business Central"}.` };
  },
  async fetch(cfg, cursor, { http, log }) {
    const c = cursor || { entry: 0 };
    const at = await token(cfg, http);
    const h = { authorization: `Bearer ${at}`, accept: "application/json" };
    let chart = null;
    if (!c.accounts) {
      const ar = await http(`${api(cfg)}/accounts?$select=number,displayName,category`, { headers: h });
      assertOk(ar, "Business Central accounts");
      const accts = ar.json().value || [];
      chart = accts.map((a) => ({ code: a.number, name: a.displayName, type: a.category }));
      c.accounts = Object.fromEntries(accts.map((a) => [a.number, a.displayName]));
    }
    const res = await http(`${api(cfg)}/generalLedgerEntries?$filter=entryNumber gt ${Number(c.entry) || 0}&$orderby=entryNumber&$top=${PAGE}`, { headers: h });
    assertOk(res, "Business Central G/L entries");
    const rows = res.json().value || [];
    log(`Business Central: ${rows.length} entries after #${c.entry}.`);
    const last = rows.reduce((m, r) => Math.max(m, r.entryNumber), c.entry);
    return { lines: rows.map((r) => normalize(r, c.accounts)), chart, nextCursor: { entry: last, accounts: c.accounts }, done: rows.length < PAGE };
  },
  normalize,
};
