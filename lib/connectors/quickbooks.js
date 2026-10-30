// QuickBooks Online via the General Ledger report, read one month at a time. The report covers
// every transaction type (invoices, bills, payments, journal entries), not just manual journals.
const crypto = require("crypto");
const { toCents, toIsoDate, splitCodeName, refreshOAuth, assertOk } = require("./common");

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const COLUMNS = "tx_date,txn_type,doc_num,name,memo,account_name,debt_amt,credit_amt,create_by,create_date";
const base = (cfg) => (cfg.environment === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com");

/** Flatten the GeneralLedger report into canonical lines. Pure (unit-tested). */
function normalize(report) {
  const cols = (report.Columns?.Column || []).map((c) => c.MetaData?.find((m) => m.Name === "ColKey")?.Value || c.ColType);
  const idx = (k) => cols.indexOf(k);
  const out = [];
  const seen = new Map();
  const walk = (rows, account) => {
    for (const row of rows || []) {
      const acct = row.Header?.ColData?.[0]?.value ? row.Header.ColData[0].value : account;
      if (row.Rows?.Row) walk(row.Rows.Row, acct);
      if (row.type !== "Data" || !row.ColData) continue;
      const v = (k) => (idx(k) >= 0 ? row.ColData[idx(k)]?.value : "") || "";
      const date = toIsoDate(v("tx_date"));
      if (!date) continue; // beginning-balance rows have no date
      const acctName = v("account_name") || acct || "";
      const { code, name } = splitCodeName(acctName);
      const amountCents = (toCents(v("debt_amt")) || 0) - (toCents(v("credit_amt")) || 0);
      const txnId = idx("tx_date") >= 0 ? row.ColData[idx("tx_date")]?.id : null;
      const base = [date, v("txn_type"), v("doc_num"), code, amountCents, v("memo"), txnId].join("|");
      const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      out.push({
        externalId: "gl:" + crypto.createHash("sha1").update(base + "#" + n).digest("hex").slice(0, 24),
        journalNo: txnId ? `${v("txn_type")}-${txnId}` : v("doc_num") || null,
        date, accountCode: code, accountName: name,
        description: v("memo") || `${v("txn_type")} ${v("doc_num")}`.trim(),
        reference: v("doc_num") || null, amountCents,
        counterparty: v("name") || null, entryType: v("txn_type") || null,
        postedBy: v("create_by") || null, postedAt: v("create_date") || null,
      });
    }
  };
  walk(report.Rows?.Row);
  return out;
}

async function token(cfg, http) {
  if (cfg.accessToken && cfg.expiresAt > Date.now() + 60000) return { accessToken: cfg.accessToken };
  const t = await refreshOAuth(http, TOKEN_URL, { clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: cfg.refreshToken });
  return { accessToken: t.accessToken, cfgUpdate: { refreshToken: t.refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt } };
}
const monthEnd = (d) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nextMonth = (d) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };

module.exports = {
  type: "QUICKBOOKS", label: "QuickBooks Online", vendor: "Intuit",
  description: "Reads the General Ledger report month by month (all transaction types) with account numbers.",
  fields: [
    { key: "clientId", label: "Client ID", type: "text", required: true, help: "From your Intuit developer app (scope com.intuit.quickbooks.accounting)." },
    { key: "clientSecret", label: "Client secret", type: "password", required: true, secret: true },
    { key: "refreshToken", label: "Refresh token", type: "password", required: true, secret: true },
    { key: "realmId", label: "Company (realm) ID", type: "text", required: true },
    { key: "environment", label: "Environment", type: "select", options: [["production", "Production"], ["sandbox", "Sandbox"]] },
    { key: "since", label: "Start from month", type: "date", help: "First sync starts at this date's month (default January last year)." },
  ],
  async test(cfg, { http }) {
    const t = await token(cfg, http);
    const res = await http(`${base(cfg)}/v3/company/${encodeURIComponent(cfg.realmId)}/companyinfo/${encodeURIComponent(cfg.realmId)}?minorversion=70`, { headers: { authorization: `Bearer ${t.accessToken}`, accept: "application/json" } });
    assertOk(res, "QuickBooks company lookup");
    return { ok: true, message: `Connected to ${res.json().CompanyInfo?.CompanyName || "QuickBooks"}.`, cfgUpdate: t.cfgUpdate };
  },
  async fetch(cfg, cursor, { http, log }) {
    const from = cursor?.from || (cfg.since ? cfg.since.slice(0, 7) + "-01" : `${new Date().getUTCFullYear() - 1}-01-01`);
    const today = new Date().toISOString().slice(0, 10);
    const to = monthEnd(from) < today ? monthEnd(from) : today;
    const t = await token(cfg, http);
    const url = `${base(cfg)}/v3/company/${encodeURIComponent(cfg.realmId)}/reports/GeneralLedger?start_date=${from}&end_date=${to}&columns=${COLUMNS}&minorversion=70`;
    const res = await http(url, { headers: { authorization: `Bearer ${t.accessToken}`, accept: "application/json" } });
    assertOk(res, "QuickBooks General Ledger report");
    const lines = normalize(res.json());
    log(`QuickBooks: ${lines.length} lines for ${from} → ${to}.`);
    const done = to >= today;
    // Re-read the current month next time (it is still changing); otherwise move forward.
    return { lines, nextCursor: { from: done ? from : nextMonth(from) }, done, cfgUpdate: t.cfgUpdate };
  },
  normalize,
};
