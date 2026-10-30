// Data hub ingest: header detection, structural cleaning, kind detection, mapping, validation.
const test = require("node:test");
const assert = require("node:assert");
const c = require("../lib/ingest/clean");
const { readText } = require("../lib/ingest/read");

const ERP_EXPORT = [
  ["Demo Supplies Ltd"], ["General Ledger Report"], ["Period: Apr 2026"], [],
  ["JV No", "Date", "Account", "Account Name", "Narration", "Debit", "Credit", "Posted By"],
  ["JV001", "03/04/2026", "6100", "Rent", "April rent", "150,000.00", "", "jane"],
  ["", "", "2010", "Payables", "April rent", "", "150,000.00", ""],
  ["JV No", "Date", "Account", "Account Name", "Narration", "Debit", "Credit", "Posted By"],
  ["JV002", "46125", "4000", "Sales", "Cash sale", "", "12,500.50", "tom"],
  ["", "", "1010", "Bank", "Cash sale", "12,500.50", "", ""],
  ["Total", "", "", "", "", "162,500.50", "162,500.50", ""],
];

test("finds the header below title rows and strips page-break headers and totals", () => {
  const t = c.buildTable(ERP_EXPORT);
  assert.strictEqual(t.headerRow, 4);
  assert.strictEqual(t.rows.length, 4);
  const ops = t.report.map((r) => r.op);
  for (const op of ["title_rows", "repeated_headers", "total_rows"]) assert.ok(ops.includes(op), op);
});

test("detects a ledger, maps debit/credit and forward-fills journal-level cells", () => {
  const a = c.analyse(ERP_EXPORT);
  assert.strictEqual(a.kind, "ledger");
  assert.strictEqual(a.mapping.debit, "Debit");
  assert.strictEqual(a.mapping.journalNo, "JV No");
  assert.strictEqual(a.formats.dateFormat, "DD/MM/YYYY");
  const s = c.semanticClean("ledger", a.rows, a.mapping);
  const v = c.validate("ledger", s.rows, a.mapping, a.formats);
  assert.strictEqual(v.errors.length, 0);
  assert.deepStrictEqual(v.valid.map((r) => r.journalNo), ["JV001", "JV001", "JV002", "JV002"]);
  assert.strictEqual(v.valid[1].date, "2026-04-03");
  assert.strictEqual(v.valid[2].date, "2026-04-13"); // Excel serial 46125
  assert.strictEqual(v.valid.reduce((a, r) => a + r.amountCents, 0), 0);
});

test("recognises KRA iTax purchase files and flags malformed PINs as warnings", () => {
  const m = [["PIN of Supplier", "Name of Supplier", "Invoice Date", "Invoice Number", "Description", "Taxable Value (Ksh)", "Amount of VAT (Ksh)"],
    ["P051234567X", "Acme", "01/04/2026", "0040562500000000600", "Stationery", "1,000.00", "160.00"],
    ["P05123", "Bad Pin Ltd", "02/04/2026", "INV-9", "Repairs", "500", "80"]];
  const a = c.analyse(m);
  assert.strictEqual(a.kind, "itax_purchases");
  const v = c.validate(a.kind, a.rows, a.mapping, a.formats);
  assert.strictEqual(v.valid.length, 2);
  assert.strictEqual(v.warningCount, 1);
  assert.strictEqual(v.valid[0].vatCents, 16000);
});

test("trial balance and chart of accounts are told apart from ledgers", () => {
  assert.strictEqual(c.analyse([["Account Code", "Account Name", "Debit", "Credit"], ["1010", "Bank", "100", ""], ["3000", "Capital", "", "100"]]).kind, "trial_balance");
  assert.strictEqual(c.analyse([["Code", "Name", "Account Type", "Parent"], ["1010", "Bank", "Bank", "1000"], ["4000", "Sales", "Revenue", ""]]).kind, "coa");
});

test("wide budget month columns are recognised", () => {
  const cols = c.monthColumns(["Account", "Jan", "February", "Mar 26", "M4", "2026-05", "Total"]);
  assert.deepStrictEqual(cols.map((x) => x.header), ["Jan", "February", "Mar 26", "M4", "2026-05"]);
});

test("cell cleaning removes invisible characters and Excel errors", () => {
  assert.strictEqual(c.cleanCell("\uFEFF  Kshs\u00A0 1,000 "), "Kshs 1,000");
  assert.strictEqual(c.cleanCell("#N/A"), "");
});

test("CSV reader auto-detects semicolon delimiters", () => {
  const [s] = readText("Date;Description;Amount\n2026-04-01;Fee;-100,50\n");
  assert.deepStrictEqual(s.rows[1], ["2026-04-01", "Fee", "-100,50"]);
  const a = c.analyse(s.rows, { kind: "bank" });
  assert.strictEqual(a.formats.decimal, ",");
});

test("Excel workbooks are read with title rows, multiple sheets and real dates", () => {
  const XLSX = require("xlsx");
  const { readBuffer } = require("../lib/ingest/read");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Notes"], ["nothing here"]]), "Cover");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Trial balance as at 31 Dec 2025"], [], ["Account Code", "Account Name", "Debit", "Credit"], ["0101", "Bank", 1500.5, null], ["3000", "Capital", null, 1500.5]]), "TB");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Date", "Narration", "Account", "Debit", "Credit"], [new Date(Date.UTC(2026, 3, 30)), "Rent", "6500", 100, null]], { cellDates: true }), "GL");
  const sheets = readBuffer("book.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  assert.deepStrictEqual(sheets.map((s) => s.name), ["Cover", "TB", "GL"]);
  const tb = c.analyse(sheets[1].rows);
  assert.strictEqual(tb.kind, "trial_balance");
  const v = c.validate(tb.kind, tb.rows, tb.mapping, tb.formats);
  assert.strictEqual(v.valid[0].accountCode, "0101"); // leading zero kept
  assert.strictEqual(v.valid[0].amountCents, 150050);
  const gl = c.analyse(sheets[2].rows, { kind: "ledger" });
  const g = c.validate("ledger", gl.rows, gl.mapping, gl.formats);
  assert.strictEqual(g.valid[0].date, "2026-04-30");
});

test("a bracketed amount in the Debit column is a reversal (credit); negative credits stay credits", () => {
  const m = [["Date", "Narration", "Account", "Debit", "Credit"], ["2026-05-05", "KPLC reversal", "6200", "(18,400.00)", ""], ["2026-05-05", "Sale", "4000", "", "-500.00"]];
  const a = c.analyse(m, { kind: "ledger" });
  const v = c.validate("ledger", a.rows, a.mapping, a.formats);
  assert.deepStrictEqual(v.valid.map((r) => r.amountCents), [-1840000, -50000]);
});
