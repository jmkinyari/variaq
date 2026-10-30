// VAT3 return computation (sheet O_VAT_Due, rows 13–28) and CSV exports in the iTax section
// layouts (Sections B, F, L). Column orders follow the KRA auto-populated return guide (Nov 2023).
// Pure functions.
const { validPin, normPin } = require("./keys");

/**
 * sales / purchases: reconcile() results ({items, stats}). whvat: reconcileWhvat() result.
 * adj: { importedServicesVatCents, exemptOnlyInputCents, commonInputCents, exemptSalesCents, zeroRatedSalesCents,
 *        creditBfCents, refundClaimCents, vatPaidCents, creditAdjustmentCents, debitAdjustmentCents }
 */
function computeVat3({ sales, purchases, whvat, adj = {} }) {
  const n = (k) => Math.round(Number(adj[k] || 0));
  // Output VAT can't be below eTIMS: take the higher of ERP and eTIMS per matched invoice, plus
  // anything only in eTIMS (must be declared) and anything only in the ERP (declared as lump sum).
  let output = 0, taxableSales = 0;
  for (const it of sales?.items || []) {
    const v = Math.max(it.erpVatCents ?? -Infinity, it.itaxVatCents ?? -Infinity);
    const t = Math.max(it.erpTaxableCents ?? -Infinity, it.itaxTaxableCents ?? -Infinity);
    output += Number.isFinite(v) ? v : 0; taxableSales += Number.isFinite(t) ? t : 0;
  }
  const input = purchases?.stats?.claimableVatCents || 0;
  const exemptSales = n("exemptSalesCents"), zeroSales = n("zeroRatedSalesCents");
  const totalSupplies = taxableSales + zeroSales + exemptSales;
  const exemptShare = totalSupplies > 0 ? exemptSales / totalSupplies : 0;
  const r = {};
  r[13] = output;
  r[14] = input;
  r[15] = n("importedServicesVatCents");
  r[16] = n("exemptOnlyInputCents");
  r[17] = n("commonInputCents");
  r[18] = Math.round(r[17] * exemptShare);
  r[19] = r[14] + r[15] - r[16] - r[18];
  r[20] = r[13] - r[19];
  r[21] = n("creditBfCents");
  r[22] = whvat?.totalCreditCents || 0;
  r[23] = n("refundClaimCents");
  r[24] = r[20] - r[21] - r[22] + r[23];
  r[25] = n("vatPaidCents");
  r[26] = n("creditAdjustmentCents");
  r[27] = n("debitAdjustmentCents");
  r[28] = r[24] - r[25] - r[26] + r[27];
  return { rows: r, exemptShare, taxableSalesCents: taxableSales, payable: r[28] > 0, netCents: r[28] };
}

const VAT3_ROW_LABELS = {
  13: "Output VAT", 14: "Input VAT (claimable, per eTIMS)", 15: "VAT claimable on imported services",
  16: "Input VAT attributable only to exempt supplies", 17: "Input VAT attributable to taxable and exempt supplies",
  18: "Non-deductible input VAT (row 17 × exempt share)", 19: "Deductible input VAT (14 + 15 − 16 − 18)",
  20: "VAT payable / (credit) (13 − 19)", 21: "Credit brought forward", 22: "Withholding VAT credits (sheet L)",
  23: "Refund claim lodged", 24: "Total VAT payable / (credit)", 25: "VAT paid", 26: "Credit adjustment voucher / inventory approval order",
  27: "Debit adjustment voucher", 28: "Net VAT payable / (credit carried forward)",
};

// ---- CSV ----------------------------------------------------------------------------------
const money = (c) => ((c || 0) / 100).toFixed(2);
const ddmmyyyy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
function cell(v, { text = false } = {}) {
  let s = v === null || v === undefined ? "" : String(v);
  // Defuse CSV formula injection in text fields (Excel opens these files).
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (header, rows) => [header.map((h) => cell(h)).join(","), ...rows.map((r) => r.map((v, i) => cell(v, { text: typeof v === "string" && !/^-?\d+(\.\d+)?$/.test(v) })).join(","))].join("\r\n") + "\r\n";

const SECTION_B = ["PIN of Purchaser", "Name of Purchaser", "ETR Serial Number", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Taxable Value (Ksh)", "Amount of VAT (Ksh)", "Relevant Invoice Number", "Relevant Invoice Date"];
const SECTION_F = ["Type of Purchases", "PIN of Supplier", "Name of Supplier", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Custom Entry Number", "Taxable Value (Ksh)", "Amount of VAT (Ksh)", "Relevant Invoice Number", "Relevant Invoice Date"];
// Sheet L column headers are not shown in the KRA guide screenshots — UNVERIFIED; check against the current template.
const SECTION_L = ["PIN of Withholder", "Name of Withholder", "Pay Point / Certificate Number", "VAT Withholding Certificate Date", "Amount of VAT Withheld (Ksh)"];

/**
 * Section B: line items to VAT-registered buyers (valid PIN). eTIMS values are locked, so use them
 * when present; ERP-only invoices are listed for transmission and lump-summed if still missing.
 * docsById: Map(id → document) for ETR serials, descriptions and relevant invoice fields.
 */
function sectionB(sales, docsById) {
  const rows = [];
  for (const it of sales.items) {
    if (!validPin(it.pin)) continue;
    const d = docsById.get(it.itaxId) || docsById.get(it.erpId) || {};
    const useItax = it.itaxId != null;
    rows.push([normPin(it.pin), it.counterparty || "", d.cuInvoiceNo || d.extra?.etrSerial || "", ddmmyyyy(useItax ? it.itaxDate : it.date), useItax ? it.itaxInvoiceNo : it.invoiceNo,
      String(d.description || "").slice(0, 200), money(useItax ? it.itaxTaxableCents : it.erpTaxableCents), money(useItax ? it.itaxVatCents : it.erpVatCents), d.relatedInvoice || "", ddmmyyyy(d.extra?.relatedDate)]);
  }
  return toCsv(SECTION_B, rows);
}
/** Lump sums for buyers with no PIN or a non-VAT PIN (footer rows of Section B). */
function salesLumpSums(sales) {
  let regT = 0, regV = 0, unregT = 0, unregV = 0;
  for (const it of sales.items) {
    const t = it.itaxTaxableCents ?? it.erpTaxableCents ?? 0, v = it.itaxVatCents ?? it.erpVatCents ?? 0;
    if (validPin(it.pin)) { regT += t; regV += v; } else { unregT += t; unregV += v; }
  }
  return { registeredTaxableCents: regT, registeredVatCents: regV, unregisteredTaxableCents: unregT, unregisteredVatCents: unregV };
}

/** Section F: claimable purchases — only eTIMS-backed, not expired; value can only be reduced, so take the lower. */
function sectionF(purchases, docsById) {
  const rows = [];
  for (const it of purchases.items) {
    if (!it.itaxId || it.issues.some((x) => x.code === "EXPIRED_INPUT")) continue;
    const d = docsById.get(it.itaxId) || {};
    const t = it.erpId ? Math.min(it.erpTaxableCents, it.itaxTaxableCents) : it.itaxTaxableCents;
    const v = it.erpId ? Math.min(it.erpVatCents, it.itaxVatCents) : it.itaxVatCents;
    rows.push([d.extra?.purchaseType || "Local", normPin(it.pin) || "", it.counterparty || "", ddmmyyyy(it.itaxDate), it.itaxInvoiceNo, String(d.description || "").slice(0, 200), d.extra?.customsEntry || "", money(t), money(v), d.relatedInvoice || "", ddmmyyyy(d.extra?.relatedDate)]);
  }
  return toCsv(SECTION_F, rows);
}
function sectionL(whvat) {
  return toCsv(SECTION_L, whvat.items.filter((x) => x.status !== "CERT_NO_INVOICE").map((x) => [x.pin || "", x.counterparty || "", x.certificateNo || "", ddmmyyyy(x.date), money(x.withheldCents)]));
}
function exceptionsCsv(items) {
  return toCsv(["Status", "Side", "Counterparty", "PIN", "Invoice (ERP)", "Invoice (eTIMS)", "Date", "ERP taxable", "eTIMS taxable", "ERP VAT", "eTIMS VAT", "VAT difference", "Issues", "Action", "Review status", "Note"],
    items.map((x) => [x.status, x.side, x.counterparty || "", x.pin || "", x.invoice_no || x.invoiceNo || "", x.itaxInvoiceNo || "", x.date || "", money(x.erpTaxableCents), money(x.itaxTaxableCents), money(x.erp_vat_cents ?? x.erpVatCents), money(x.itax_vat_cents ?? x.itaxVatCents), money(x.diff_cents ?? x.diffCents),
      (x.issues || []).map((i) => i.text).join(" | "), x.action || "", x.review_status || "OPEN", x.note || ""]));
}

module.exports = { computeVat3, VAT3_ROW_LABELS, sectionB, sectionF, sectionL, salesLumpSums, exceptionsCsv, toCsv, SECTION_B, SECTION_F, SECTION_L };
