const test = require("node:test");
const assert = require("node:assert/strict");
const { invoiceKey, validPin, normPin, isCreditNote, levenshtein } = require("../lib/tax/keys");
const { reconcile, reconcileWhvat, documentIssues } = require("../lib/tax/vat-recon");
const { computeVat3, sectionB, sectionF, sectionL, toCsv } = require("../lib/tax/vat3");
const { obligationsFor, rollForward, estimatePenalty, monthsLate } = require("../lib/tax/calendar");
const { etimsDeductibility, vatControl } = require("../lib/tax/ledger-check");

let n = 0;
const doc = (o) => ({ id: `d${++n}`, docType: "INVOICE", date: "2026-04-10", taxableCents: 100000, vatCents: 16000, ...o, invoiceKey: invoiceKey(o.invoiceNo) });

test("invoice keys and PINs normalise", () => {
  assert.equal(invoiceKey(" inv-00042 "), "INV00042");
  assert.equal(invoiceKey("00042"), "42");
  assert.equal(invoiceKey(""), null);
  assert.ok(validPin("p051234567x"));
  assert.ok(validPin("A012345678Z"));
  assert.ok(!validPin("P05123456X"));
  assert.ok(!validPin("B051234567X"));
  assert.equal(normPin(" p05-1234567 x"), "P051234567X");
  assert.equal(levenshtein("INV1001", "INV1010"), 2);
});

test("credit notes are detected", () => {
  assert.ok(isCreditNote({ docType: "Credit Note", taxableCents: 100 }));
  assert.ok(isCreditNote({ taxableCents: -100 }));
  assert.ok(!isCreditNote({ docType: "Invoice", taxableCents: 100 }));
});

test("matcher passes and statuses", () => {
  const pin = "P051234567X", pin2 = "P059999999Q";
  const erp = [
    doc({ source: "ERP", pin, invoiceNo: "INV-1", counterparty: "Acme" }),                                   // pass 1 → MATCHED
    doc({ source: "ERP", pin: null, invoiceNo: "INV-2", counterparty: "Beta" }),                             // pass 2 (key + amount)
    doc({ source: "ERP", pin, invoiceNo: "ERP-77", counterparty: "Acme", date: "2026-04-12", taxableCents: 50000, vatCents: 8000 }), // pass 3 (pin+amount+date)
    doc({ source: "ERP", pin: pin2, invoiceNo: "INV10045", counterparty: "Gamma", taxableCents: 70000, vatCents: 11200 }),            // pass 4 fuzzy
    doc({ source: "ERP", pin, invoiceNo: "INV-5", counterparty: "Acme", taxableCents: 200000, vatCents: 32000 }),                   // AMOUNT_MISMATCH
    doc({ source: "ERP", pin, invoiceNo: "INV-6", counterparty: "Acme", vatCents: 14000 }),                  // VAT_MISMATCH
    doc({ source: "ERP", pin: "P051111111A", invoiceNo: "INV-7", counterparty: "Delta" }),                    // PIN_MISMATCH
    doc({ source: "ERP", pin, invoiceNo: "INV-8", counterparty: "Acme", date: "2026-03-30" }),               // DATE_PERIOD
    doc({ source: "ERP", pin, invoiceNo: "INV-9", counterparty: "Acme", taxableCents: 999900, vatCents: 159984 }), // MISSING_IN_ITAX
  ];
  const itax = [
    doc({ source: "ITAX", pin, invoiceNo: "INV-1" }),
    doc({ source: "ITAX", pin: pin2, invoiceNo: "INV-2" }),
    doc({ source: "ITAX", pin, invoiceNo: "0040562500000000600", date: "2026-04-14", taxableCents: 50000, vatCents: 8000 }),
    doc({ source: "ITAX", pin: null, invoiceNo: "INV10054", taxableCents: 70000, vatCents: 11200 }),
    doc({ source: "ITAX", pin, invoiceNo: "INV-5", taxableCents: 150000, vatCents: 24000 }),
    doc({ source: "ITAX", pin, invoiceNo: "INV-6", vatCents: 16000 }),
    doc({ source: "ITAX", pin: "P052222222B", invoiceNo: "INV-7" }),
    doc({ source: "ITAX", pin, invoiceNo: "INV-8", date: "2026-04-02" }),
    doc({ source: "ITAX", pin: "P053333333C", invoiceNo: "X-1", counterparty: "Unknown", taxableCents: 300000, vatCents: 48000 }), // MISSING_IN_ERP
  ];
  const { items, stats } = reconcile({ side: "PURCHASES", period: "2026-04", erp, itax });
  const byInv = (no) => items.find((i) => i.invoiceNo === no);
  assert.equal(byInv("INV-1").status, "MATCHED"); assert.equal(byInv("INV-1").pass, 1);
  assert.equal(byInv("INV-2").pass, 2); assert.equal(byInv("INV-2").status, "MATCHED");
  assert.equal(byInv("ERP-77").pass, 3); assert.equal(byInv("ERP-77").status, "MATCHED");
  assert.equal(byInv("INV10045").pass, 4);
  assert.equal(byInv("INV-5").status, "AMOUNT_MISMATCH");
  assert.equal(byInv("INV-6").status, "VAT_MISMATCH");
  assert.equal(byInv("INV-7").status, "PIN_MISMATCH");
  assert.equal(byInv("INV-8").status, "DATE_PERIOD_MISMATCH");
  assert.equal(byInv("INV-9").status, "MISSING_IN_ITAX");
  assert.equal(byInv("X-1").status, "MISSING_IN_ERP");
  assert.match(byInv("INV-9").action, /can't be claimed/);
  assert.equal(stats.atRiskVatCents, 159984);
  assert.equal(stats.unrecordedVatCents, 48000);
  // INV-5: claim the lower of ERP and eTIMS.
  assert.ok(stats.claimableVatCents >= 24000);
  assert.equal(stats.byStatus.MATCHED.count, 4);
});

test("sales side: unrecorded revenue and self-supply", () => {
  const own = "P051234567X";
  const { items } = reconcile({ side: "SALES", period: "2026-04", ownPin: own, erp: [doc({ source: "ERP", pin: own, invoiceNo: "S1" })], itax: [doc({ source: "ITAX", pin: "P050000001K", invoiceNo: "S2", counterparty: "Cust" })] });
  const s1 = items.find((i) => i.invoiceNo === "S1"), s2 = items.find((i) => i.invoiceNo === "S2");
  assert.equal(s1.status, "MISSING_IN_ITAX");
  assert.ok(s1.issues.some((x) => x.code === "SELF_SUPPLY"));
  assert.equal(s2.status, "MISSING_IN_ERP");
  assert.match(s2.action, /unrecorded revenue/);
});

test("document issues: rate, 6-month input rule, long invoice no, credit note", () => {
  const ctx = { period: "2026-10", knownKeys: new Set() };
  const issues = (d, side = "PURCHASES") => documentIssues({ source: "ERP", ...d }, side, ctx).map((x) => x.code);
  assert.ok(issues({ pin: "P051234567X", taxableCents: 100000, vatCents: 15000 }).includes("RATE"));
  assert.ok(!issues({ pin: "P051234567X", taxableCents: 100000, vatCents: 8000, description: "Diesel" }).includes("RATE"));
  // April 2026 invoice: claimable until 31 Oct 2026; claiming in Nov 2026 is expired.
  assert.ok(!issues({ pin: "P051234567X", date: "2026-04-15", taxableCents: 1, vatCents: 0, rateCode: "E" }).includes("EXPIRED_INPUT"));
  assert.ok(documentIssues({ source: "ERP", pin: "P051234567X", date: "2026-04-15" }, "PURCHASES", { period: "2026-11" }).some((x) => x.code === "EXPIRED_INPUT"));
  assert.ok(issues({ invoiceNo: "X".repeat(41) }).includes("INVOICE_NO_TOO_LONG"));
  assert.ok(issues({ docType: "CREDIT_NOTE", taxableCents: -100 }).includes("CREDIT_NO_ORIGINAL"));
  assert.ok(issues({ pin: "BAD" }).includes("INVALID_PIN"));
});

test("duplicates flagged", () => {
  const erp = [doc({ source: "ERP", pin: "P051234567X", invoiceNo: "D1" }), doc({ source: "ERP", pin: "P051234567X", invoiceNo: "D1" })];
  const { items } = reconcile({ side: "PURCHASES", period: "2026-04", erp, itax: [] });
  assert.ok(items.every((i) => i.issues.some((x) => x.code === "DUPLICATE")));
});

test("withholding VAT certificates check 2%", () => {
  const sales = [doc({ source: "ERP", pin: "P051234567X", invoiceNo: "S10", taxableCents: 1000000, vatCents: 160000 })];
  const r = reconcileWhvat({ sales, certificates: [
    { pin: "P051234567X", invoiceNo: "S10", certificateNo: "C1", vatCents: 20000, date: "2026-04-20" },
    { pin: "P051234567X", invoiceNo: "S10X", certificateNo: "C2", vatCents: 5000, date: "2026-04-21" },
  ] });
  assert.equal(r.items[0].status, "CERT_MATCHED");
  assert.equal(r.items[1].status, "CERT_NO_INVOICE");
  assert.equal(r.totalCreditCents, 25000);
});

test("VAT3 O_VAT_Due computation", () => {
  const sales = { items: [{ erpVatCents: 160000, itaxVatCents: 160000, erpTaxableCents: 1000000, itaxTaxableCents: 1000000 }, { erpVatCents: null, itaxVatCents: 16000, erpTaxableCents: null, itaxTaxableCents: 100000 }] };
  const purchases = { stats: { claimableVatCents: 80000 } };
  const { rows, netCents } = computeVat3({ sales, purchases, whvat: { totalCreditCents: 20000 }, adj: { commonInputCents: 10000, exemptSalesCents: 1100000, creditBfCents: 5000 } });
  assert.equal(rows[13], 176000);
  assert.equal(rows[14], 80000);
  assert.equal(rows[18], 5000); // 10000 × 50% exempt share
  assert.equal(rows[19], 75000);
  assert.equal(rows[20], 101000);
  assert.equal(rows[24], 101000 - 5000 - 20000);
  assert.equal(netCents, rows[28]);
});

test("section CSVs use iTax column order and defuse formulas", () => {
  const docs = new Map([["i1", { description: "=cmd()", extra: {} }]]);
  const csv = sectionB({ items: [{ pin: "P051234567X", counterparty: "Acme", itaxId: "i1", itaxDate: "2026-04-03", itaxInvoiceNo: "001", itaxTaxableCents: 100000, itaxVatCents: 16000 }] }, docs);
  const [head, row] = csv.trim().split("\r\n");
  assert.ok(head.startsWith("PIN of Purchaser,Name of Purchaser,ETR Serial Number,Invoice Date"));
  assert.match(row, /03\/04\/2026/);
  assert.match(row, /'=cmd\(\)/);
  assert.match(row, /1000\.00,160\.00/);
  const f = sectionF({ items: [{ pin: "P051234567X", itaxId: "i1", erpId: "e1", itaxDate: "2026-04-03", itaxInvoiceNo: "9", erpTaxableCents: 90000, itaxTaxableCents: 100000, erpVatCents: 14400, itaxVatCents: 16000, issues: [] }] }, docs);
  assert.match(f, /900\.00,144\.00/); // lower of ERP and eTIMS
  assert.ok(sectionL({ items: [{ status: "CERT_MATCHED", pin: "P1", counterparty: "X", certificateNo: "C", date: "2026-04-01", withheldCents: 2000 }] }).includes("20.00"));
  assert.equal(toCsv(["a"], [["x,y"]]).trim(), 'a\r\n"x,y"');
});

test("deadlines roll forward over weekends and holidays", () => {
  // 20 Dec 2025 is a Saturday → Monday 22 Dec.
  assert.equal(rollForward("2025-12-20"), "2025-12-22");
  // 20 Oct is Mashujaa Day (2024-10-20 is a Sunday → observed Mon 21 → due Tue 22).
  assert.equal(rollForward("2024-10-20"), "2024-10-22");
  const obs = obligationsFor("2026-05");
  const vat = obs.find((o) => o.code === "VAT3"), paye = obs.find((o) => o.code === "PAYE");
  assert.equal(vat.statutory, "2026-06-20"); assert.equal(vat.due, "2026-06-22"); // Saturday → Monday
  assert.equal(paye.statutory, "2026-06-09"); assert.equal(paye.due, "2026-06-09");
  assert.ok(obligationsFor("2026-04").some((o) => o.code === "INSTALMENT")); // month 4 of a Dec year-end
  assert.ok(!obligationsFor("2026-05").some((o) => o.code === "INSTALMENT"));
  assert.ok(obligationsFor("2026-12").some((o) => o.code === "IT2C"));
});

test("penalty estimator", () => {
  assert.equal(monthsLate("2026-05-20", "2026-05-19"), 0);
  assert.equal(monthsLate("2026-05-20", "2026-06-25"), 2);
  const p = estimatePenalty("VAT3", { taxCents: 100_000_00, due: "2026-05-20", filedOn: "2026-06-01", paidOn: "2026-06-01" });
  assert.equal(p.lateFilingCents, 10_000_00); // higher of 5% (5,000) or 10,000
  assert.equal(p.latePaymentCents, 5_000_00);
  assert.equal(p.interestCents, 1_000_00);
  const none = estimatePenalty("VAT3", { taxCents: 1, due: "2026-05-20", filedOn: "2026-05-19", paidOn: "2026-05-19" });
  assert.equal(none.totalCents, 0);
});

test("eTIMS deductibility excludes exempt categories", () => {
  const r = etimsDeductibility({ year: 2026, etims: [{ counterparty: "Acme Ltd", taxableCents: 60000 }], expenses: [
    { accountName: "Office supplies", description: "Stationery", counterparty: "ACME Limited", amountCents: 100000 },
    { accountName: "Salaries", description: "April payroll", counterparty: "Staff", amountCents: 500000 },
    { accountName: "Bank charges", description: "Ledger fee", counterparty: "KCB", amountCents: 2000 },
    { accountName: "Repairs", description: "Plumbing", counterparty: "Joe Fundi", amountCents: 30000 },
  ] });
  assert.equal(r.totals.exemptCents, 502000);
  const acme = r.rows.find((x) => /acme/i.test(x.counterparty));
  assert.equal(acme.unsupportedCents, 40000);
  assert.equal(r.totals.unsupportedCents, 70000);
});

test("VAT control flags differences", () => {
  const c = vatControl({ hasAccounts: true, ledgerOutputCents: 100, registerOutputCents: 100, itaxOutputCents: 50000, ledgerInputCents: 0, registerInputCents: 0, itaxInputCents: 0 });
  assert.ok(c.lines[0].ok);
  assert.ok(!c.lines[1].ok);
  assert.equal(vatControl({ hasAccounts: false }).configured, false);
});
