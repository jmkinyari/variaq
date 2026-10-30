// Demo tax data for "Demo Supplies Ltd", April 2026. One source of truth for both the sample CSV
// files (samples/tax/) and the database seeder, designed so the VAT reconciliation produces every
// status: matched (all four passes), amount / VAT / PIN / period mismatches, missing on either side,
// expired input VAT, prohibited input, duplicates, a credit note without its original, and WHVAT
// certificates that match, differ, or have no invoice.
// CommonJS, no server-only: scripts/seed.js requires it. All names and PINs are fictional.
const fs = require("fs");
const path = require("path");

const OWN_PIN = "P051234567X";
const PERIOD = "2026-04";
const K = (kes) => Math.round(kes * 100);
const vat16 = (t) => Math.round(t * 0.16);

function build() {
  const S = (invoiceNo, date, pin, counterparty, taxable, vat, o = {}) => ({ invoiceNo, date, pin, counterparty, taxableCents: K(taxable), vatCents: K(vat), totalCents: K(taxable + vat), rateCode: "S", description: "Office and business supplies", ...o });
  const salesErp = [
    S("SI-2026-0401", "2026-04-03", "P051111111A", "Kilimani Retailers Ltd", 250000, 40000, { cuInvoiceNo: "0040562500000000401" }),
    S("SI-2026-0402", "2026-04-06", "P052222222B", "Westlands Hardware Ltd", 100000, 16000),
    S("SI-2026-0403", "2026-04-08", "P053333333C", "Ruiru Stationers", 50000, 8000),
    S("SI-2026-0404", "2026-04-14", "P054444444D", "Thika Office Mart", 80000, 12800),
    S("SI-2026-0405", "2026-04-15", "", "Cash customer", 30000, 4800),
    S("SI-2026-0406", "2026-04-30", "P055555555E", "Mombasa Traders Ltd", 45000, 7200),
    S("SI-2026-0407", "2026-04-18", "P051010101Z", "County Government of Nairobi", 500000, 80000),
    S("SI-2026-0408", "2026-04-21", "P056666666F", "Nakuru Supplies Ltd", 64000, 10240),
    S("SC-2026-0011", "2026-04-24", "P051111111A", "Kilimani Retailers Ltd", -20000, -3200, { docType: "Credit Note", relatedInvoice: "SI-2026-0399", description: "Returned toner cartridges" }),
  ];
  const B = (invoiceNo, date, pin, counterparty, taxable, vat, o = {}) => ({ invoiceNo, date, pin, counterparty, taxableCents: K(taxable), vatCents: K(vat), etrSerial: "KRAMW004202604000001", description: "Office and business supplies", ...o });
  const salesItax = [
    B("0040562500000000401", "2026-04-03", "P051111111A", "KILIMANI RETAILERS LTD", 250000, 40000),
    B("SI-2026-0402", "2026-04-06", "P052222222B", "WESTLANDS HARDWARE LTD", 120000, 19200),
    B("SI-2026-0403", "2026-04-08", "P053333333C", "RUIRU STATIONERS", 50000, 7000),
    B("SI-2026-0406", "2026-05-02", "P055555555E", "MOMBASA TRADERS LTD", 45000, 7200),
    B("SI-2026-0407", "2026-04-18", "P051010101Z", "COUNTY GOVERNMENT OF NAIROBI", 500000, 80000),
    B("SI-2026-0408", "2026-04-21", "P056666666G", "NAKURU SUPPLIES LTD", 64000, 10240),
    B("0040562500000000600", "2026-04-27", "P057777777H", "ELDORET WHOLESALERS LTD", 60000, 9600),
    B("SC-2026-0011", "2026-04-24", "P051111111A", "KILIMANI RETAILERS LTD", -20000, -3200, { relatedInvoice: "SI-2026-0399", relatedDate: "2026-03-28" }),
  ];
  const P = (invoiceNo, date, pin, counterparty, taxable, vat, o = {}) => ({ invoiceNo, date, pin, counterparty, taxableCents: K(taxable), vatCents: K(vat), totalCents: K(taxable + vat), rateCode: "S", description: "Stock purchases", ...o });
  const purchErp = [
    P("PI-881", "2026-04-02", "P060000001A", "Bidco Distributors Ltd", 300000, 48000, { cuInvoiceNo: "0110693710000002955" }),
    P("KPLC-APR-2026", "2026-04-05", "", "Kenya Power", 40000, 6400, { description: "Electricity April" }),
    P("OF-1123", "2026-04-09", "P060000003C", "Office Furnishers Ltd", 150000, 24000, { description: "Office chairs" }),
    P("FUEL-77", "2026-04-10", "P060000004D", "Safari Fuel Station", 20000, 1600, { rateCode: "8%", description: "Diesel for delivery vans" }),
    P("PS-2210", "2025-09-15", "P060000005E", "Prime Stationers", 10000, 1600, { description: "Printer paper (late claim)" }),
    P("GH-55", "2026-04-16", "P060000006F", "Grand Hotel Nairobi", 25000, 4000, { description: "Staff accommodation and restaurant" }),
    P("LCK-2026-0901", "2026-04-02", "P060000007G", "Lakeside Logistics Ltd", 70000, 11200, { description: "Freight and delivery" }),
    P("PI-882", "2026-04-22", "P060000001A", "Bidco Distributors Ltd", 5000, 800),
    P("PI-882", "2026-04-22", "P060000001A", "Bidco Distributors Ltd", 5000, 800),
    P("SX-44", "2026-04-25", "P060000009J", "Securex Ltd", 60000, 9600, { description: "Security services April" }),
  ];
  const F = (invoiceNo, date, pin, counterparty, taxable, vat, o = {}) => ({ purchaseType: "Local", invoiceNo, date, pin, counterparty, taxableCents: K(taxable), vatCents: K(vat), description: "Supplies", ...o });
  const purchItax = [
    F("0110693710000002955", "2026-04-02", "P060000001A", "BIDCO DISTRIBUTORS LTD", 300000, 48000),
    F("KPLC-APR-2026", "2026-04-05", "P060000002B", "KENYA POWER AND LIGHTING CO PLC", 40000, 6400),
    F("FUEL-77", "2026-04-10", "P060000004D", "SAFARI FUEL STATION", 20000, 1600, { description: "Diesel" }),
    F("PS-2210", "2025-09-15", "P060000005E", "PRIME STATIONERS", 10000, 1600),
    F("GH-55", "2026-04-16", "P060000006F", "GRAND HOTEL NAIROBI", 25000, 4000, { description: "Accommodation and restaurant" }),
    F("LCK20260910", "2026-04-20", "P060000007G", "LAKESIDE LOGISTICS LTD", 70000, 11200),
    F("SX-44", "2026-04-25", "P060000009J", "SECUREX LTD", 55000, 8800),
    F("0110693710000003001", "2026-04-28", "P060000008H", "UNGA DISTRIBUTORS LTD", 90000, 14400),
  ];
  const whvat = [
    { certificateNo: "WHV2026040001", invoiceNo: "SI-2026-0407", date: "2026-04-25", pin: "P051010101Z", counterparty: "COUNTY GOVERNMENT OF NAIROBI", taxableCents: K(500000), vatCents: K(10000) },
    { certificateNo: "WHV2026040002", invoiceNo: "SI-2026-0401", date: "2026-04-26", pin: "P051111111A", counterparty: "KILIMANI RETAILERS LTD", taxableCents: K(250000), vatCents: K(4000) },
    { certificateNo: "WHV2026040003", invoiceNo: "SI-2026-0999", date: "2026-04-29", pin: "P051212121K", counterparty: "KENYA PORTS AUTHORITY", taxableCents: K(150000), vatCents: K(3000) },
  ];
  return { salesErp, salesItax, purchErp, purchItax, whvat };
}

// ---- CSV files in realistic layouts --------------------------------------------------------
const money = (c) => (c / 100).toFixed(2);
const dmy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const csv = (header, rows) => [header, ...rows].map((r) => r.map((v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n") + "\r\n";

function sampleFiles() {
  const d = build();
  return {
    "erp-sales-register-2026-04.csv": csv(["Invoice No", "eTIMS CU Invoice No", "Invoice Date", "Customer PIN", "Customer Name", "Document Type", "Original Invoice", "Net Amount", "VAT Amount", "Total", "VAT Code", "Description"],
      d.salesErp.map((r) => [r.invoiceNo, r.cuInvoiceNo || "", r.date, r.pin, r.counterparty, r.docType || "Invoice", r.relatedInvoice || "", money(r.taxableCents), money(r.vatCents), money(r.totalCents), r.rateCode, r.description])),
    "erp-purchase-register-2026-04.csv": csv(["Supplier Invoice No", "eTIMS CU Invoice No", "Invoice Date", "Supplier PIN", "Supplier Name", "Taxable Amount", "Input VAT", "Total Amount", "VAT Code", "Description"],
      d.purchErp.map((r) => [r.invoiceNo, r.cuInvoiceNo || "", r.date, r.pin, r.counterparty, money(r.taxableCents), money(r.vatCents), money(r.totalCents), r.rateCode, r.description])),
    "SEC_B_WITH_VAT_PIN1.csv": csv(["PIN of Purchaser", "Name of Purchaser", "ETR Serial Number", "Invoice Date", "Invoice Number", "Description of Goods/Services", "Taxable Value (Ksh)", "Amount of VAT (Ksh)", "Relevant Invoice Number", "Relevant Invoice Date"],
      d.salesItax.map((r) => [r.pin, r.counterparty, r.etrSerial, dmy(r.date), r.invoiceNo, r.description, money(r.taxableCents), money(r.vatCents), r.relatedInvoice || "", dmy(r.relatedDate)])),
    "SEC_F_WITH_VAT_PIN1.csv": csv(["Type of Purchases", "PIN of Supplier", "Name of Supplier", "Invoice Date", "Invoice Number", "Description of Goods/Services", "Custom Entry Number", "Taxable Value (Ksh)", "Amount of VAT (Ksh)", "Relevant Invoice Number", "Relevant Invoice Date"],
      d.purchItax.map((r) => [r.purchaseType, r.pin, r.counterparty, dmy(r.date), r.invoiceNo, r.description, "", money(r.taxableCents), money(r.vatCents), "", ""])),
    "whvat-certificates-2026-04.csv": csv(["Withholder PIN", "Withholder Name", "Certificate Number", "Invoice Number", "Certificate Date", "Taxable Value", "VAT Withheld"],
      d.whvat.map((r) => [r.pin, r.counterparty, r.certificateNo, r.invoiceNo, dmy(r.date), money(r.taxableCents), money(r.vatCents)])),
  };
}
function writeSampleCsvs(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(sampleFiles())) fs.writeFileSync(path.join(dir, name), body);
}

/** Seed the demo tax profile and documents for a workspace. Returns the period seeded. */
async function seedTaxDemo(wsId, userId) {
  const db = require("../db");
  const { seal, blindIndex } = require("../vault");
  const { storeBatch } = require("./store");
  const d = build();
  const t = db.now();
  await db.run(`INSERT OR REPLACE INTO tax_profile (workspace_id, kra_pin, pin_index, vat_registered, wht_vat_agent, output_vat_account, input_vat_account, wht_vat_account, wht_account, paye_account, updated_by, updated_at, fy_end_month)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [wsId, await seal(wsId, "tax.kra_pin", OWN_PIN), blindIndex(wsId, "kra_pin", OWN_PIN), 1, 0, "2200", "1300", "1310", "2210", "2220", userId, t, 12]);
  const sets = [["sales_invoices", d.salesErp, "erp-sales-register-2026-04.csv"], ["itax_sales", d.salesItax, "SEC_B_WITH_VAT_PIN1.csv"], ["purchase_invoices", d.purchErp, "erp-purchase-register-2026-04.csv"], ["itax_purchases", d.purchItax, "SEC_F_WITH_VAT_PIN1.csv"], ["wht_vat", d.whvat, "whvat-certificates-2026-04.csv"]];
  for (const [kind, records, fileName] of sets) await storeBatch({ wsId, userId, datasetKind: kind, period: PERIOD, records, fileName });
  return PERIOD;
}

module.exports = { build, sampleFiles, writeSampleCsvs, seedTaxDemo, OWN_PIN, PERIOD, vat16 };
