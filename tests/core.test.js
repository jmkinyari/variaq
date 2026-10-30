const test = require("node:test");
const assert = require("node:assert");
const { parseAmount } = require("../lib/money");
const { parseDate, detectDateFormat } = require("../lib/dates");
const { validateRows, guessMapping, checkMapping } = require("../lib/csv-import");
const { matchTransactions } = require("../lib/matching");
const { computeFlux } = require("../lib/flux");

test("parseAmount", () => {
  assert.equal(parseAmount("KES 1,234.50"), 123450);
  assert.equal(parseAmount("(500)"), -50000);
  assert.equal(parseAmount("-12.3"), -1230);
  assert.equal(parseAmount("1.200,75", { decimal: "," }), 120075);
  assert.equal(parseAmount("250.00 DR"), -25000);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
});

test("parseDate", () => {
  assert.equal(parseDate("2026-04-30"), "2026-04-30");
  assert.equal(parseDate("30/04/2026", "DD/MM/YYYY"), "2026-04-30");
  assert.equal(parseDate("04/30/2026", "MM/DD/YYYY"), "2026-04-30");
  assert.equal(parseDate("30-Apr-2026", "DD-MMM-YYYY"), "2026-04-30");
  assert.equal(parseDate("31/02/2026", "DD/MM/YYYY"), null);
  assert.equal(detectDateFormat(["30/04/2026", "15/04/2026"]), "DD/MM/YYYY");
});

test("ledger CSV validation with debit/credit", () => {
  const headers = ["Date", "Narration", "Ref", "Account Code", "Debit", "Credit"];
  const m = guessMapping("ledger", headers);
  assert.equal(m.description, "Narration");
  assert.equal(m.debit, "Debit");
  assert.deepEqual(checkMapping("ledger", m), []);
  const rows = [
    { Date: "2026-04-01", Narration: "Sale", Ref: "INV1", "Account Code": "1010", Debit: "1,000", Credit: "" },
    { Date: "bad", Narration: "", Ref: "", "Account Code": "", Debit: "x", Credit: "" },
  ];
  const { valid, errors } = validateRows("ledger", rows, m);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].amountCents, 100000);
  assert.equal(errors[0].row, 3);
  assert.ok(errors[0].messages.length >= 3);
});

test("matching", () => {
  const bank = [
    { id: "b1", date: "2026-04-02", description: "MPESA C2B INV-1001 Acme", reference: "QK12", amountCents: 50000 },
    { id: "b2", date: "2026-04-05", description: "Bank charges", reference: "", amountCents: -350 },
    { id: "b3", date: "2026-04-09", description: "EFT Supplier X PO-77", reference: "PO-77", amountCents: -120000 },
  ];
  const ledger = [
    { id: "l1", date: "2026-04-01", description: "Receipt Acme", reference: "INV-1001", amountCents: 50000 },
    { id: "l2", date: "2026-04-09", description: "Payment Supplier X", reference: "PO-77", amountCents: -119000 },
    { id: "l3", date: "2026-04-20", description: "Cheque 004", reference: "CHQ004", amountCents: -80000 },
  ];
  const r = matchTransactions(bank, ledger, { periodStart: "2026-04-01", periodEnd: "2026-04-30" });
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].ledgerEntryId, "l1");
  const types = r.exceptions.map((e) => e.type).sort();
  assert.deepEqual(types, ["AMOUNT_MISMATCH", "UNMATCHED_BANK", "UNMATCHED_LEDGER"]);
});

test("flux", () => {
  const e = [
    { id: "1", date: "2026-03-10", accountCode: "6100", accountName: "Fuel", amountCents: 1000000, counterparty: "Rubis" },
    { id: "2", date: "2026-04-10", accountCode: "6100", accountName: "Fuel", amountCents: 3000000, counterparty: "Rubis" },
    { id: "3", date: "2026-04-12", accountCode: "6100", accountName: "Fuel", amountCents: 4000000, counterparty: "TotalEnergies" },
  ];
  const f = computeFlux(e, { baseStart: "2026-03-01", baseEnd: "2026-03-31", compStart: "2026-04-01", compEnd: "2026-04-30" });
  assert.equal(f.lines[0].change, 6000000);
  assert.equal(f.lines[0].material, true);
  assert.match(f.lines[0].explanation, /TotalEnergies/);
});

// ---- Financial statements & cash flow ----
const S = require("../lib/statements");
const CF = require("../lib/cashflow");

test("account classification defaults", () => {
  assert.equal(S.defaultClass("1010", "KCB"), "CURRENT_ASSET");
  assert.equal(S.defaultClass("1600", "Vehicles"), "NONCURRENT_ASSET");
  assert.equal(S.defaultClass("2000", "AP"), "CURRENT_LIABILITY");
  assert.equal(S.defaultClass("2600", "Term loan"), "NONCURRENT_LIABILITY");
  assert.equal(S.defaultClass("4000", "Sales"), "REVENUE");
  assert.equal(S.defaultClass("5000", "COGS"), "COGS");
  assert.equal(S.defaultClass("6300", "Salaries"), "EXPENSE");
  assert.equal(S.defaultClass("BANK-EQ", "Equity Bank current account"), "CURRENT_ASSET");
  const chart = S.buildChart([{ account_code: "1010", account_name: "KCB Operating Account" }, { account_code: "1100", account_name: "Accounts Receivable" }, { account_code: "2200", account_name: "VAT Payable" }]);
  assert.equal(chart.get("1010").isCash, true);
  assert.equal(chart.get("1100").isCash, false);
  assert.equal(chart.get("1100").cf, "CUSTOMER_RECEIPTS");
  assert.equal(chart.get("2200").cf, "TAX");
  const ov = S.buildChart([{ account_code: "1100", account_name: "AR" }], [{ account_code: "1100", is_cash: 1, class: null, cf_category: null }]);
  assert.equal(ov.get("1100").isCash, true);
});

const ACCTS = [["1010", "Bank"], ["1100", "Accounts Receivable"], ["2000", "Accounts Payable"], ["3000", "Share capital"], ["4000", "Sales"], ["5000", "Cost of Sales"], ["6300", "Salaries & Wages"]].map(([account_code, account_name]) => ({ account_code, account_name }));
const E = (id, date, ref, code, cents) => ({ id, date, reference: ref, description: ref, accountCode: code, amountCents: cents });
const LEDGER = [
  E(1, "2026-04-01", "CAP", "1010", 1000000), E(2, "2026-04-01", "CAP", "3000", -1000000),
  E(3, "2026-04-02", "INV1", "1100", 500000), E(4, "2026-04-02", "INV1", "4000", -500000),
  E(5, "2026-04-09", "INV1", "1010", 500000), E(6, "2026-04-09", "INV1", "1100", -500000),
  E(7, "2026-04-03", "PO1", "5000", 200000), E(8, "2026-04-03", "PO1", "2000", -200000),
  E(9, "2026-04-10", "PO1", "2000", 200000), E(10, "2026-04-10", "PO1", "1010", -200000),
  E(11, "2026-04-15", "PAY", "6300", 100000), E(12, "2026-04-15", "PAY", "1010", -100000),
];

test("balance sheet balances and income statement", () => {
  const chart = S.buildChart(ACCTS);
  const bal = new Map(); for (const e of LEDGER) bal.set(e.accountCode, (bal.get(e.accountCode) || 0) + e.amountCents);
  const bs = S.balanceSheet(chart, bal);
  assert.equal(bs.difference, 0);
  assert.equal(bs.totalAssets, 1200000);
  assert.equal(bs.earnings, 200000);
  const is = S.incomeStatement(chart, bal);
  assert.equal(is.revenue.total, 500000);
  assert.equal(is.grossProfit, 300000);
  assert.equal(is.netProfit, 200000);
});

test("cash flows classified by contra account", () => {
  const chart = S.buildChart(ACCTS);
  const flows = S.classifyCashFlows(LEDGER, chart);
  const by = Object.fromEntries(flows.map((f) => [f.id, f.category]));
  assert.equal(by[1], "FINANCING");
  assert.equal(by[5], "CUSTOMER_RECEIPTS");
  assert.equal(by[10], "SUPPLIER_PAYMENTS");
  assert.equal(by[12], "PAYROLL");
  const act = S.cashFlowByActivity(flows);
  assert.equal(act.net, 1200000);
});

test("13-week forecast: weeks, scenarios and overrides", () => {
  assert.equal(CF.weekStart("2026-04-30"), "2026-04-27");
  assert.equal(CF.defaultAnchor("2026-04-30", "2026-10-19"), "2026-05-04");
  assert.equal(CF.defaultAnchor("2026-10-15", "2026-10-19"), "2026-10-19");
  const history = CF.weekList("2026-03-30", 3), forecastWeeks = CF.weekList("2026-04-20", 13);
  const chart = S.buildChart(ACCTS);
  const model = { history, forecastWeeks, actuals: CF.bucketFlows(S.classifyCashFlows(LEDGER, chart), history), openingBeforeHistory: 0 };
  const settings = CF.defaultSettings();
  settings.scenarios.BASE.overrides["OPEX|2026-04-27"] = -50000;
  const r = CF.computeForecast(model, settings);
  assert.equal(r.weeks.length, 16);
  assert.equal(r.actualCount, 3);
  const base = r.scenarios.BASE;
  assert.equal(base.closing[2], 1200000); // actual closing cash before forecast
  assert.equal(r.baseline.CUSTOMER_RECEIPTS, Math.round(500000 / 3));
  assert.equal(base.rows.OPEX[4], -50000);
  assert.equal(base.overridden.OPEX[1], true);
  // Worst case: receipts cut 15% and delayed 1 week → lower ending cash than base; best higher.
  assert.equal(r.scenarios.WORST.rows.CUSTOMER_RECEIPTS[3], 0);
  assert.ok(r.scenarios.WORST.summary.endCash < base.summary.endCash);
  assert.ok(r.scenarios.BEST.summary.endCash > base.summary.endCash - 50000);
  // Closing = opening + net for every week.
  for (let i = 0; i < 16; i++) assert.equal(base.closing[i], base.opening[i] + base.net[i]);
});
