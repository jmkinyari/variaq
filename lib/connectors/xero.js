// Xero via the Accounting API Journals endpoint — the complete, immutable posting history
// (every invoice, bill, payment and manual journal). Incremental by JournalNumber offset.
const { toCents, toIsoDate, toIsoDateTime, refreshOAuth, assertOk } = require("./common");

const TOKEN_URL = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com/api.xro/2.0";

/** Xero Journal → canonical lines. Pure (unit-tested). */
function normalize(j) {
  return (j.JournalLines || []).map((l, i) => {
    const tracking = l.TrackingCategories || [];
    return {
      externalId: `jl:${l.JournalLineID}`,
      journalNo: String(j.JournalNumber),
      lineNo: i + 1,
      date: toIsoDate(j.JournalDate),
      accountCode: l.AccountCode || l.AccountID,
      accountName: l.AccountName,
      description: l.Description || j.Reference || j.SourceType,
      reference: j.Reference || null,
      amountCents: toCents(l.NetAmount),
      entryType: j.SourceType || null,
      postedAt: toIsoDateTime(j.CreatedDateUTC),
      taxCode: l.TaxType && l.TaxType !== "NONE" ? l.TaxType : null,
      costCenter: tracking[0]?.Option || null,
      department: tracking[1]?.Option || null,
    };
  });
}

async function token(cfg, http) {
  if (cfg.accessToken && cfg.expiresAt && cfg.expiresAt > Date.now() + 60000) return { accessToken: cfg.accessToken };
  const t = await refreshOAuth(http, TOKEN_URL, { clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: cfg.refreshToken });
  // Xero rotates refresh tokens: the new one must be persisted or the next sync fails.
  return { accessToken: t.accessToken, cfgUpdate: { refreshToken: t.refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt } };
}
const headers = (cfg, at) => ({ authorization: `Bearer ${at}`, "xero-tenant-id": cfg.tenantId, accept: "application/json" });

module.exports = {
  type: "XERO", label: "Xero", vendor: "Xero",
  description: "Reads Xero's full journal history (invoices, bills, payments, manual journals) incrementally.",
  fields: [
    { key: "clientId", label: "Client ID", type: "text", required: true, help: "From your Xero app at developer.xero.com (scope: accounting.journals.read accounting.settings.read offline_access)." },
    { key: "clientSecret", label: "Client secret", type: "password", required: true, secret: true },
    { key: "refreshToken", label: "Refresh token", type: "password", required: true, secret: true, help: "From the app's OAuth consent. Variaq stores the rotated token after each sync." },
    { key: "tenantId", label: "Tenant (organisation) ID", type: "text", required: true },
  ],
  async test(cfg, { http }) {
    const t = await token(cfg, http);
    const res = await http(`${API}/Organisation`, { headers: headers(cfg, t.accessToken) });
    assertOk(res, "Xero organisation lookup");
    const org = res.json().Organisations?.[0];
    return { ok: true, message: `Connected to ${org?.Name || "Xero"} (${org?.BaseCurrency || ""}).`, cfgUpdate: t.cfgUpdate };
  },
  async fetch(cfg, cursor, { http, log }) {
    const c = cursor || { offset: 0 };
    const t = await token(cfg, http);
    let chart = null;
    if (!c.offset) {
      const ar = await http(`${API}/Accounts`, { headers: headers(cfg, t.accessToken) });
      assertOk(ar, "Xero accounts");
      chart = (ar.json().Accounts || []).filter((a) => a.Code).map((a) => ({ code: a.Code, name: a.Name, type: a.Type }));
    }
    const res = await http(`${API}/Journals?offset=${c.offset}`, { headers: headers(cfg, t.accessToken) });
    assertOk(res, "Xero journals");
    const journals = res.json().Journals || [];
    log(`Xero: read ${journals.length} journals after #${c.offset}.`);
    const lines = journals.flatMap(normalize);
    const last = journals.reduce((m, j) => Math.max(m, j.JournalNumber), c.offset);
    return { lines, chart, nextCursor: { offset: last }, done: journals.length < 100, cfgUpdate: t.cfgUpdate };
  },
  normalize,
};
