const test = require("node:test");
const assert = require("node:assert/strict");
const { runJournalTests } = require("../lib/audit/journal-rules");
const { benford } = require("../lib/audit/stats");
const { detectMispostings, train, predict } = require("../lib/audit/misposting");
const { sequenceGaps, rollforward, missingRecurring, runCompleteness } = require("../lib/audit/completeness");
const { kenyaHolidays, easterSunday, nonWorkingDay } = require("../lib/audit/calendar");
const { matchCharts, canonTokens } = require("../lib/coa/match");
const { translateTb, reconcileCharts } = require("../lib/coa/consolidate");
const { buildChart } = require("../lib/statements");

const ACCOUNTS = [
  ["1010", "KCB Bank"], ["1100", "Trade Debtors"], ["1600", "Motor Vehicles"], ["2010", "Trade Creditors"], ["2200", "PAYE Payable"],
  ["4000", "Sales"], ["6100", "Rent"], ["6200", "Fuel"], ["6300", "Electricity"], ["6400", "Salaries"], ["6500", "Repairs and Maintenance"], ["9999", "Suspense"],
];
const chart = buildChart(ACCOUNTS.map(([account_code, account_name]) => ({ account_code, account_name })));
let n = 0;
const L = (o) => ({ id: `e${++n}`, reference: null, counterparty: null, postedBy: null, approvedBy: null, postedAt: null, entryType: null, ...o });
const jv = (no, date, lines, extra = {}) => lines.map(([acct, amt, desc], i) => L({ journalNo: no, date, accountCode: acct, amountCents: amt, description: desc || "Line", lineNo: i + 1, ...extra }));

function history() {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const d = `2025-${String(m).padStart(2, "0")}-15`;
    out.push(...jv(`H${m}a`, d, [["6100", 15000000, "Office rent Westlands"], ["1010", -15000000, "Office rent Westlands"]]));
    out.push(...jv(`H${m}b`, d, [["6200", 2000000 + m * 1000, "Fuel Shell Kenya"], ["1010", -(2000000 + m * 1000), "Fuel Shell Kenya"]]));
    out.push(...jv(`H${m}c`, d, [["6300", 900000 + m * 500, "KPLC electricity token"], ["1010", -(900000 + m * 500), "KPLC electricity token"]]));
    out.push(...jv(`H${m}d`, d, [["1010", 50000000 + m * 777, "Customer receipt"], ["1100", -(50000000 + m * 777), "Customer receipt"]]));
  }
  return out;
}

test("Kenyan holidays include movable Easter dates and Sunday observance", () => {
  assert.equal(easterSunday(2026).toISOString().slice(0, 10), "2026-04-05");
  const h = kenyaHolidays(2026);
  assert.equal(h.get("2026-04-03"), "Good Friday");
  assert.equal(h.get("2026-04-06"), "Easter Monday");
  assert.ok(nonWorkingDay("2026-10-20"));
  assert.equal(nonWorkingDay("2026-10-21"), null);
});

test("journal rules: unbalanced, weekend, self-approval, round amount, vague, duplicates", () => {
  const lines = [
    ...history(),
    ...jv("JV100", "2026-02-10", [["6100", 1000000], ["1010", -900000]]), // unbalanced by 1,000 KES
    ...jv("JV101", "2026-02-14", [["6500", 30000000, "adjustment"], ["1010", -30000000, "adjustment"]], { postedBy: "jane", approvedBy: "JANE" }), // Saturday, round, vague, self-approved
    ...jv("JV102", "2026-02-16", [["6300", 123456], ["1010", -123456]]),
    ...jv("JV103", "2026-02-18", [["6300", 123456], ["1010", -123456]]),
    ...jv("JV104", "2026-02-19", [["4000", 500000]]), // single line
  ];
  const { findings, stats } = runJournalTests(lines, { periodFrom: "2026-02-01", periodTo: "2026-02-28", chart, params: { enabled: null } });
  const rules = (no) => findings.filter((f) => f.journalNo === no).map((f) => f.rule);
  assert.ok(rules("JV100").includes("UNBALANCED_JOURNAL"));
  const u = findings.find((f) => f.rule === "UNBALANCED_JOURNAL");
  assert.equal(u.corrective.lines[0].creditCents, 100000);
  for (const r of ["WEEKEND_HOLIDAY", "SELF_APPROVED", "ROUND_AMOUNT", "VAGUE_DESCRIPTION"]) assert.ok(rules("JV101").includes(r), r);
  assert.ok(rules("JV103").includes("DUPLICATE_JOURNAL"));
  assert.ok(rules("JV104").includes("SINGLE_LINE"));
  assert.ok(stats.journals >= 5);
  // Fingerprints are stable across runs.
  const again = runJournalTests(lines, { periodFrom: "2026-02-01", periodTo: "2026-02-28", chart });
  assert.deepEqual(again.findings.map((f) => f.fingerprint).sort(), findings.map((f) => f.fingerprint).sort());
});

test("journal rules: suspense balance, abnormal balance, after-hours and backdating into a locked period", () => {
  const lines = [
    ...history(),
    ...jv("JV200", "2026-01-31", [["9999", 2500000, "unidentified receipt"], ["1010", -2500000, "unidentified receipt"]], { postedAt: "2026-03-10T19:30:00Z" }), // 22:30 EAT, posted after lock
    ...jv("JV201", "2026-01-20", [["1010", 90000000, "Customer prepaid"], ["2010", -0, "x"], ["1100", -90000000, "Customer prepaid"]]),
  ];
  const locks = new Map([["2026-01", "2026-02-05T08:00:00Z"]]);
  const { findings } = runJournalTests(lines, { periodFrom: "2026-01-01", periodTo: "2026-01-31", chart, locks });
  assert.ok(findings.some((f) => f.rule === "SUSPENSE_BALANCE" && f.accountCode === "9999"));
  assert.ok(findings.some((f) => f.rule === "AFTER_HOURS" && f.journalNo === "JV200"));
  assert.ok(findings.some((f) => f.rule === "BACKDATED" && f.severity === "HIGH"));
  assert.ok(findings.some((f) => f.rule === "ABNORMAL_BALANCE" && f.accountCode === "1100"), "debtors with a credit balance");
});

test("Benford MAD conformity", () => {
  // Generate Benford-distributed amounts.
  const vals = []; let s = 1;
  for (let i = 0; i < 5000; i++) { s = (s * 16807) % 2147483647; vals.push(Math.round(10 ** (2 + 4 * (s / 2147483647)))); }
  const good = benford(vals);
  assert.ok(good.mad < 0.012, `MAD ${good.mad}`);
  const bad = benford(Array.from({ length: 1000 }, (_, i) => 50000 + i));
  assert.equal(bad.conformity, "Nonconformity");
  assert.equal(bad.digits[4].count, 1000);
});

test("naive Bayes learns posting patterns and flags a misposting with a reclass", () => {
  const hist = history();
  const model = train(hist);
  const p = predict(model, { description: "Fuel Shell Kenya", amountCents: 2100000 });
  assert.equal(p[0].code, "6200");
  const tested = [L({ date: "2026-02-03", journalNo: "JV300", accountCode: "6300", description: "Fuel Shell Kenya", amountCents: 2050000 })];
  const flags = detectMispostings(tested, hist, chart);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].suggestedCode, "6200");
  // Keyword rule: fuel posted to motor vehicles (fixed asset).
  const kw = detectMispostings([L({ date: "2026-02-03", accountCode: "1600", description: "Diesel for truck", amountCents: 800000 })], hist, chart);
  assert.equal(kw[0].method, "KEYWORD");
  assert.equal(kw[0].expectedClass, "EXPENSE");
  // Capital item expensed.
  const cap = detectMispostings([L({ date: "2026-02-03", accountCode: "6500", description: "Purchase of 3 laptops", amountCents: 45000000 })], hist, chart);
  assert.equal(cap[0].expectedClass, "NONCURRENT_ASSET");
});

test("sequence gaps and duplicates per prefix", () => {
  const nums = [...Array.from({ length: 20 }, (_, i) => `JV-${String(i + 1).padStart(4, "0")}`).filter((x) => x !== "JV-0007" && x !== "JV-0008"), "JV-0003", ...Array.from({ length: 12 }, (_, i) => `INV${100 + i}`)];
  const r = sequenceGaps(nums);
  const jvs = r.series.find((s) => s.prefix === "JV-");
  assert.equal(jvs.missing, 2);
  assert.equal(jvs.gaps[0], "JV-0007 – JV-0008");
  assert.equal(r.duplicates[0].number, "JV-0003");
  assert.equal(r.series.find((s) => s.prefix === "INV").missing, 0);
});

test("completeness: TB roll-forward and missing recurring postings", () => {
  const diffs = rollforward({ opening: new Map([["1010", 100]]), movements: new Map([["1010", 50], ["4000", -50]]), closing: new Map([["1010", 150], ["4000", -10050]]), toleranceCents: 0 });
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].code, "4000");
  const monthly = new Map([["6100", new Map([["2026-01", { n: 1, cents: 100 }], ["2026-02", { n: 1, cents: 100 }], ["2026-03", { n: 1, cents: 100 }]])]]);
  const miss = missingRecurring(monthly, "2026-04", new Map([["6100", "Rent"]]));
  assert.equal(miss[0].code, "6100");
  assert.ok(miss[0].keyword);
  const suite = runCompleteness({ journalNumbers: [], invoiceNumbers: [], monthly, targetYm: "2026-04", names: new Map([["6100", "Rent"]]) });
  assert.equal(suite.tests.find((t) => t.id === "RECURRING_POSTINGS").status, "FAIL");
});

test("chart matching uses synonyms, codes and class", () => {
  assert.ok(canonTokens("Trade Debtors").includes("receivable"));
  assert.ok(canonTokens("Accounts receivable").includes("receivable"));
  const source = [{ code: "1200", name: "Debtors Control" }, { code: "2100", name: "Creditors" }, { code: "4100", name: "Turnover - Local" }, { code: "1250", name: "Stock on hand" }, { code: "1700", name: "M/V - Accumulated Depn" }];
  const target = [{ code: "1100", name: "Accounts receivable" }, { code: "2000", name: "Accounts payable" }, { code: "4000", name: "Revenue" }, { code: "1300", name: "Inventory" }, { code: "1610", name: "Vehicles accumulated depreciation" }, { code: "6100", name: "Rent expense" }];
  const res = matchCharts(source, target);
  const best = Object.fromEntries(res.map((r) => [r.code, r.candidates[0]?.code]));
  assert.equal(best["1200"], "1100");
  assert.equal(best["2100"], "2000");
  assert.equal(best["4100"], "4000");
  assert.equal(best["1250"], "1300");
  assert.equal(best["1700"], "1610");
  // Learned mapping wins.
  const learned = matchCharts([{ code: "7777", name: "Petty cash float" }], target, [{ sourceName: "Petty cash float", targetCode: "6100" }]);
  assert.equal(learned[0].candidates[0].code, "6100");
});

test("chart reconciliation finds equal-and-opposite mispostings", () => {
  const target = new Map([["6100", { name: "Rent" }], ["6300", { name: "Electricity" }], ["4000", { name: "Sales" }]]);
  const a = translateTb([{ code: "R1", balanceCents: 1500 }, { code: "E1", balanceCents: 500 }, { code: "S1", balanceCents: -2000 }], new Map([["R1", "6100"], ["E1", "6300"], ["S1", "4000"]]), target);
  const b = translateTb([{ code: "6100", balanceCents: 1000 }, { code: "6300", balanceCents: 1000 }, { code: "4000", balanceCents: -2000 }], null, target);
  const r = reconcileCharts(a.rows, b.rows, { toleranceCents: 0 });
  assert.equal(r.mispostings.length, 1);
  assert.deepEqual(r.mispostings[0].accounts, ["6100", "6300"]);
  assert.equal(r.mispostings[0].reclass[0].accountCode, "6300");
  assert.equal(r.unexplained.length, 0);
});

test("journal engine handles 200k lines quickly", () => {
  const big = [];
  for (let i = 0; i < 100000; i++) {
    const d = `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
    const amt = 1000 + ((i * 7919) % 900000);
    big.push(L({ journalNo: `B${i}`, date: d, accountCode: ["6100", "6200", "6300", "6400"][i % 4], amountCents: amt, description: ["Rent", "Fuel Shell", "KPLC token", "Salaries"][i % 4], counterparty: `Party ${i % 50}` }));
    big.push(L({ journalNo: `B${i}`, date: d, accountCode: "1010", amountCents: -amt, description: "Bank" }));
  }
  const t0 = Date.now();
  const r = runJournalTests(big, { periodFrom: "2025-10-01", periodTo: "2025-12-31", chart });
  const ms = Date.now() - t0;
  assert.ok(r.stats.lines > 40000);
  assert.ok(ms < 20000, `took ${ms}ms`);
});

test("chart matcher maps an alphanumeric legacy chart onto broad group reporting lines", () => {
  const { matchCharts } = require("../lib/coa/match");
  const group = [["GA-110", "Cash and cash equivalents", "CURRENT_ASSET"], ["GA-210", "Property, plant and equipment", "NONCURRENT_ASSET"], ["GA-290", "Accumulated depreciation", "NONCURRENT_ASSET"], ["GL-110", "Trade payables", "CURRENT_LIABILITY"], ["GL-130", "Tax payable", "CURRENT_LIABILITY"], ["GX-100", "Staff costs", "EXPENSE"], ["GX-200", "Premises costs", "EXPENSE"], ["GX-300", "Distribution and vehicle costs", "EXPENSE"], ["GX-400", "Administrative expenses", "EXPENSE"], ["GX-500", "Depreciation", "EXPENSE"], ["GF-100", "Finance costs", "OTHER_INCOME"], ["GS-999", "Suspense / unallocated", "CURRENT_ASSET"]].map(([code, name, cls]) => ({ code, name, class: cls }));
  const legacy = [["BNK-002", "Mobile Money Till", "GA-110"], ["FA-200", "Motor Vehicles at Cost", "GA-210"], ["FA-290", "Acc. Depn - Fixed Assets", "GA-290"], ["CR-100", "Creditors Control", "GL-110"], ["TAX-200", "PAYE NSSF SHIF Payable", "GL-130"], ["EXP-120", "Power & Lighting", "GX-200"], ["EXP-150", "Rent - Warehouse", "GX-200"], ["EXP-110", "Motor Fuel", "GX-300"], ["EXP-140", "Bank Charges & Commissions", "GX-400"], ["EXP-170", "Depreciation Charge", "GX-500"], ["FIN-100", "Interest on Loans", "GF-100"], ["SUS-999", "Suspense", "GS-999"]];
  const res = matchCharts(legacy.map(([code, name]) => ({ code, name })), group);
  for (const [code, name, want] of legacy) assert.strictEqual(res.find((r) => r.code === code).candidates[0].code, want, name);
});
