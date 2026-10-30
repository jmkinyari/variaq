// Zoho Books (manual journals + chart of accounts). Zoho's journal list omits line items, so each
// journal on a page is fetched in detail; pages are kept small to respect Zoho's rate limits.
const { toCents, refreshOAuth, assertOk } = require("./common");

const PER_PAGE = 50;
const DCS = { com: "com", eu: "eu", in: "in", au: "com.au", jp: "jp", ca: "ca", sa: "sa" };

/** Zoho journal (detail) → canonical lines. Pure (unit-tested). */
function normalize(j, accounts = {}) {
  return (j.line_items || []).map((l, i) => {
    const amt = toCents(l.amount) || 0;
    const a = accounts[l.account_id] || {};
    return {
      externalId: `zj:${j.journal_id}:${l.line_id || i}`,
      journalNo: j.entry_number || j.journal_id,
      lineNo: i + 1,
      date: j.journal_date,
      accountCode: a.code || l.account_code || l.account_id,
      accountName: l.account_name || a.name || null,
      description: l.description || j.notes || j.reference_number || "",
      reference: j.reference_number || null,
      amountCents: l.debit_or_credit === "credit" ? -Math.abs(amt) : Math.abs(amt),
      currency: j.currency_code || null,
      fxRate: j.exchange_rate || null,
      counterparty: l.customer_name || l.vendor_name || null,
      entryType: j.journal_type || "journal",
      postedBy: j.created_by_name || null,
      postedAt: j.created_time || null,
      taxCode: l.tax_name || null,
      project: l.project_name || null,
    };
  });
}

const hosts = (cfg) => { const dc = DCS[cfg.dataCenter] || "com"; return { accounts: `https://accounts.zoho.${dc}`, api: `https://www.zohoapis.${dc}/books/v3` }; };
async function token(cfg, http) {
  if (cfg.accessToken && cfg.expiresAt > Date.now() + 60000) return { accessToken: cfg.accessToken };
  const t = await refreshOAuth(http, `${hosts(cfg).accounts}/oauth/v2/token`, { clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: cfg.refreshToken, basicAuth: false });
  return { accessToken: t.accessToken, cfgUpdate: { accessToken: t.accessToken, expiresAt: t.expiresAt } };
}

module.exports = {
  type: "ZOHO_BOOKS", label: "Zoho Books", vendor: "Zoho",
  description: "Reads manual journals and the chart of accounts. Pair with a ledger file drop for subledger postings.",
  fields: [
    { key: "dataCenter", label: "Data centre", type: "select", options: [["com", "zoho.com (US/global)"], ["eu", "EU"], ["in", "India"], ["au", "Australia"], ["sa", "Saudi Arabia"], ["ca", "Canada"], ["jp", "Japan"]] },
    { key: "organizationId", label: "Organization ID", type: "text", required: true },
    { key: "clientId", label: "Client ID", type: "text", required: true },
    { key: "clientSecret", label: "Client secret", type: "password", required: true, secret: true },
    { key: "refreshToken", label: "Refresh token", type: "password", required: true, secret: true, help: "Scope ZohoBooks.accountants.READ,ZohoBooks.settings.READ" },
  ],
  async test(cfg, { http }) {
    const t = await token(cfg, http);
    const res = await http(`${hosts(cfg).api}/organizations/${encodeURIComponent(cfg.organizationId)}`, { headers: { authorization: `Zoho-oauthtoken ${t.accessToken}` } });
    assertOk(res, "Zoho organisation lookup");
    return { ok: true, message: `Connected to ${res.json().organization?.name || "Zoho Books"}.`, cfgUpdate: t.cfgUpdate };
  },
  async fetch(cfg, cursor, { http, log }) {
    const c = cursor || { page: 1, since: null };
    const t = await token(cfg, http);
    const h = { authorization: `Zoho-oauthtoken ${t.accessToken}` };
    const org = `organization_id=${encodeURIComponent(cfg.organizationId)}`;
    let chart = null;
    if (!c.accounts) {
      const ar = await http(`${hosts(cfg).api}/chartofaccounts?${org}&per_page=1000`, { headers: h });
      assertOk(ar, "Zoho chart of accounts");
      const accts = ar.json().chartofaccounts || [];
      chart = accts.map((a) => ({ code: a.account_code || a.account_id, name: a.account_name, type: a.account_type }));
      c.accounts = Object.fromEntries(accts.map((a) => [a.account_id, { code: a.account_code || a.account_id, name: a.account_name }]));
    }
    const res = await http(`${hosts(cfg).api}/journals?${org}&page=${c.page}&per_page=${PER_PAGE}&sort_column=journal_date${c.since ? `&last_modified_time=${encodeURIComponent(c.since)}` : ""}`, { headers: h });
    assertOk(res, "Zoho journals");
    const body = res.json();
    const lines = [];
    for (const j of body.journals || []) {
      const dr = await http(`${hosts(cfg).api}/journals/${encodeURIComponent(j.journal_id)}?${org}`, { headers: h });
      assertOk(dr, "Zoho journal detail");
      lines.push(...normalize(dr.json().journal || {}, c.accounts));
    }
    log(`Zoho Books: page ${c.page}, ${body.journals?.length || 0} journals.`);
    const more = !!body.page_context?.has_more_page;
    return { lines, chart, nextCursor: more ? { ...c, page: c.page + 1 } : { page: 1, since: new Date().toISOString().slice(0, 19) + "+0000", accounts: c.accounts }, done: !more, cfgUpdate: t.cfgUpdate };
  },
  normalize,
};
