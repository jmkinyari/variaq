// Platform tests: connector normalisation from fixture payloads (no network), sync diff and
// control totals, job backoff, API keys/scopes/signatures, generic REST field mapping.
const test = require("node:test");
const assert = require("node:assert/strict");
const odoo = require("../lib/connectors/odoo");
const xero = require("../lib/connectors/xero");
const qbo = require("../lib/connectors/quickbooks");
const bc = require("../lib/connectors/dynamics");
const zoho = require("../lib/connectors/zoho");
const generic = require("../lib/connectors/generic");
const filedrop = require("../lib/connectors/filedrop");
const { canon, lineHash, toCents, toIsoDate, splitCodeName } = require("../lib/connectors/common");
const { diffLines, controlTotals } = require("../lib/connectors/sync");
const { mergeConfig, missingRequired, publicConfig } = require("../lib/connectors");
const { backoffMs } = require("../lib/jobs");
const api = require("../lib/api");
const { sha256 } = require("../lib/security/crypto");

const valid = (l) => { const r = canon(l); assert.equal(r.error, undefined, r.error); return r.line; };

test("common: money, dates, code/name split", () => {
  assert.equal(toCents("1,234.565"), 123457);
  assert.equal(toCents(-0.005), -1);
  assert.equal(toCents("abc"), null);
  assert.equal(toIsoDate("/Date(1714435200000+0000)/"), "2024-04-30");
  assert.equal(toIsoDate("2026-04-30T10:00:00"), "2026-04-30");
  assert.deepEqual(splitCodeName("400000 Product Sales"), { code: "400000", name: "Product Sales" });
  assert.deepEqual(splitCodeName("[1010] Bank KCB"), { code: "1010", name: "Bank KCB" });
});

test("odoo: account.move.line → canonical", () => {
  const l = valid(odoo.normalize({ id: 77, move_id: [5, "INV/2026/0005"], move_name: "INV/2026/0005", account_id: [9, "400000 Product Sales"], partner_id: [3, "Acme Ltd"], name: "Widgets", ref: "PO-1", date: "2026-04-03", debit: 0, credit: 1160.5, balance: -1160.5, journal_id: [1, "Customer Invoices"], create_uid: [2, "Jane Wanjiku"], create_date: "2026-04-03 08:15:00", write_date: "2026-04-03 08:15:00", currency_id: [1, "KES"], tax_line_id: false }));
  assert.equal(l.externalId, "aml:77");
  assert.equal(l.journalNo, "INV/2026/0005");
  assert.equal(l.accountCode, "400000");
  assert.equal(l.amountCents, -116050);
  assert.equal(l.counterparty, "Acme Ltd");
  assert.equal(l.postedBy, "Jane Wanjiku");
  assert.equal(l.postedAt, "2026-04-03T08:15:00.000Z");
  assert.equal(l.taxCode, null);
  // Chart lookup wins over the display name.
  assert.equal(odoo.normalize({ id: 1, account_id: [9, "X"], date: "2026-01-01", balance: 1 }, new Map([[9, { code: "4000", name: "Sales" }]])).accountCode, "4000");
});

test("xero: journal → balanced canonical lines", () => {
  const lines = xero.normalize({ JournalID: "j1", JournalNumber: 412, JournalDate: "/Date(1777507200000+0000)/", CreatedDateUTC: "/Date(1777510800000+0000)/", Reference: "INV-0042", SourceType: "ACCREC",
    JournalLines: [{ JournalLineID: "a", AccountCode: "200", AccountName: "Sales", NetAmount: -1000, TaxType: "OUTPUT2", TrackingCategories: [{ Name: "Region", Option: "Nairobi" }] },
      { JournalLineID: "b", AccountCode: "820", AccountName: "VAT", NetAmount: -160, TaxType: "NONE" }, { JournalLineID: "c", AccountCode: "610", AccountName: "Debtors", NetAmount: 1160 }] }).map(valid);
  assert.equal(lines.length, 3);
  assert.equal(lines.reduce((a, l) => a + l.amountCents, 0), 0);
  assert.equal(lines[0].journalNo, "412");
  assert.equal(lines[0].costCenter, "Nairobi");
  assert.equal(lines[0].taxCode, "OUTPUT2");
  assert.equal(lines[1].taxCode, null);
  assert.equal(lines[0].entryType, "ACCREC");
});

test("quickbooks: General Ledger report → lines with stable ids", () => {
  const report = {
    Columns: { Column: ["tx_date", "txn_type", "doc_num", "name", "memo", "account_name", "debt_amt", "credit_amt"].map((k) => ({ ColType: k, MetaData: [{ Name: "ColKey", Value: k }] })) },
    Rows: { Row: [{ Header: { ColData: [{ value: "4000 Sales" }] }, Rows: { Row: [
      { type: "Data", ColData: [{ value: "Beginning Balance" }, {}, {}, {}, {}, {}, {}, {}] },
      { type: "Data", ColData: [{ value: "2026-04-05", id: "145" }, { value: "Invoice" }, { value: "1001" }, { value: "Acme" }, { value: "Widgets" }, { value: "4000 Sales" }, { value: "" }, { value: "500.00" }] },
      { type: "Data", ColData: [{ value: "2026-04-05", id: "145" }, { value: "Invoice" }, { value: "1001" }, { value: "Acme" }, { value: "Widgets" }, { value: "4000 Sales" }, { value: "" }, { value: "500.00" }] },
    ] } }] },
  };
  const lines = qbo.normalize(report).map(valid);
  assert.equal(lines.length, 2, "beginning balance skipped");
  assert.equal(lines[0].accountCode, "4000");
  assert.equal(lines[0].amountCents, -50000);
  assert.equal(lines[0].journalNo, "Invoice-145");
  assert.notEqual(lines[0].externalId, lines[1].externalId, "identical rows get distinct ids");
  assert.equal(qbo.normalize(report)[0].externalId, lines[0].externalId, "ids are deterministic");
});

test("business central: G/L entry → canonical", () => {
  const l = valid(bc.normalize({ entryNumber: 3301, postingDate: "2026-04-30", documentNumber: "G04512", documentType: "Payment", accountNumber: "2910", description: "Payroll", debitAmount: 0, creditAmount: 2500.25 }, { 2910: "Payroll payable" }));
  assert.equal(l.externalId, "gle:3301");
  assert.equal(l.amountCents, -250025);
  assert.equal(l.accountName, "Payroll payable");
  assert.equal(l.entryType, "Payment");
});

test("zoho: journal detail → signed lines using the chart's codes", () => {
  const lines = zoho.normalize({ journal_id: "J9", entry_number: "JRN-9", journal_date: "2026-04-10", reference_number: "ACC-4", line_items: [
    { line_id: "1", account_id: "A1", debit_or_credit: "debit", amount: 300, description: "Accrual" }, { line_id: "2", account_id: "A2", debit_or_credit: "credit", amount: 300 }] }, { A1: { code: "6200", name: "Utilities" }, A2: { code: "2100", name: "Accruals" } }).map(valid);
  assert.deepEqual(lines.map((l) => [l.accountCode, l.amountCents]), [["6200", 30000], ["2100", -30000]]);
  assert.equal(lines[1].description, "ACC-4");
});

test("generic REST: field map with dotted paths, debit/credit, validation", () => {
  const map = generic.parseFieldMap('{"externalId":"id","date":"posting.date","journalNo":"journal.no","accountCode":"account.code","description":"memo","debit":"dr","credit":"cr","postedBy":"user.login"}');
  const l = valid(generic.normalize({ id: 55, posting: { date: "2026-04-02" }, journal: { no: "GJ7" }, account: { code: 6100 }, memo: "Rent", dr: "150,000.00", cr: null, user: { login: "jk" } }, map));
  assert.equal(l.accountCode, "6100");
  assert.equal(l.amountCents, 15000000);
  assert.equal(l.postedBy, "jk");
  assert.equal(generic.normalize({ id: 1, account: { code: 1 }, posting: { date: "2026-01-01" }, cr: 10 }, map).amountCents, -1000);
  assert.throws(() => generic.parseFieldMap('{"evil":"x"}'), /Unknown field/);
});

test("file drop: messy export → canonical lines with content ids", () => {
  const csv = "General Ledger\nJV No,Date,Account,Narration,Debit,Credit\nJ1,03/04/2026,6100,Rent,100.00,\n,,2010,Rent,,100.00\nTotal,,,,100.00,100.00\n";
  const parsed = filedrop.parse("gl.csv", Buffer.from(csv));
  const lines = filedrop.normalize(parsed.valid).map(valid);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].journalNo, "J1", "journal no forward-filled");
  assert.equal(lines[1].date, "2026-04-03");
  assert.equal(lines.reduce((a, l) => a + l.amountCents, 0), 0);
  assert.equal(filedrop.normalize(parsed.valid)[0].externalId, lines[0].externalId);
});

test("canon rejects incomplete lines", () => {
  assert.match(canon({ externalId: "x", date: "bad", accountCode: "1", amountCents: 1 }).error, /date/);
  assert.match(canon({ externalId: "x", date: "2026-01-01", amountCents: 1 }).error, /account/);
  assert.match(canon({ date: "2026-01-01", accountCode: "1", amountCents: 1 }).error, /externalId/);
});

test("sync diff: insert new, update changed, skip unchanged, last duplicate wins", () => {
  const a = valid({ externalId: "a", date: "2026-04-01", accountCode: "1000", amountCents: 100, description: "x" });
  const b = valid({ externalId: "b", date: "2026-04-01", accountCode: "2000", amountCents: -100, description: "x" });
  const b2 = { ...b, amountCents: -150 };
  const c = valid({ externalId: "c", date: "2026-04-02", accountCode: "3000", amountCents: 5, description: "y" });
  const existing = new Map([["a", { id: "1", hash: lineHash(a) }], ["b", { id: "2", hash: lineHash(b) }]]);
  const d = diffLines(existing, [a, b, b2, c]);
  assert.deepEqual(d.unchanged.map((l) => l.externalId), ["a"]);
  assert.deepEqual(d.updates.map((u) => [u.id, u.line.amountCents]), [["2", -150]]);
  assert.deepEqual(d.inserts.map((l) => l.externalId), ["c"]);
});

test("control totals flag unbalanced journals and sum by period", () => {
  const t = controlTotals([
    { journalNo: "J1", date: "2026-03-31", amountCents: 500 }, { journalNo: "J1", date: "2026-03-31", amountCents: -500 },
    { journalNo: "J2", date: "2026-04-01", amountCents: 300 }, { journalNo: "J2", date: "2026-04-01", amountCents: -200 },
  ]);
  assert.equal(t.journals, 2);
  assert.deepEqual(t.unbalanced, [{ journalNo: "J2", diffCents: 100 }]);
  assert.deepEqual(t.byPeriod["2026-04"], { lines: 2, debitCents: 300, creditCents: 200 });
  assert.equal(t.debitCents, 800);
});

test("connector config: secrets are write-only and never public", () => {
  const cfg = mergeConfig(odoo, { url: "https://a.odoo.com", apiKey: "SECRET" }, { url: "https://b.odoo.com", apiKey: "", database: "prod", username: "u" });
  assert.equal(cfg.apiKey, "SECRET", "blank secret keeps stored value");
  assert.equal(cfg.url, "https://b.odoo.com");
  assert.deepEqual(missingRequired(odoo, cfg), []);
  assert.equal(publicConfig(odoo, cfg).apiKey, undefined);
  assert.deepEqual(missingRequired(xero, {}), ["Client ID", "Client secret", "Refresh token", "Tenant (organisation) ID"]);
});

test("job backoff grows exponentially and is capped", () => {
  const r = () => 0;
  assert.equal(backoffMs(1, r), 30_000);
  assert.equal(backoffMs(2, r), 120_000);
  assert.equal(backoffMs(3, r), 480_000);
  assert.equal(backoffMs(20, r), 7_200_000);
});

test("API keys: format, hash, scopes, HMAC signatures", () => {
  const k = api.generateKey();
  assert.match(k.key, /^nq_[a-f0-9]{8}_[A-Za-z0-9_-]{40,}$/);
  assert.ok(k.key.startsWith(`nq_${k.prefix}_`));
  assert.equal(k.hash, sha256(k.key));
  assert.deepEqual(api.parseScopes('["journals:write","admin:all"]'), ["journals:write"], "unknown scopes dropped");
  assert.equal(api.hasScope(["journals:read"], "journals:write"), false);
  const body = '{"lines":[]}', secret = "s3cret", now = 1_800_000_000;
  const sig = api.sign(body, secret, now);
  assert.equal(api.verifySignature(sig, body, secret, now + 10), true);
  assert.equal(api.verifySignature(sig, body + " ", secret, now), false, "body tampering");
  assert.equal(api.verifySignature(sig, body, "other", now), false, "wrong secret");
  assert.equal(api.verifySignature(sig, body, secret, now + 400), false, "replay window");
  assert.equal(api.verifySignature("garbage", body, secret, now), false);
});
