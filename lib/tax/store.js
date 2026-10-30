// Tax data persistence shared by the Data hub importers, the demo seeder and the pages.
// Plain CommonJS (no server-only) so scripts/seed.js can use it.
const db = require("../db");
const { invoiceKey, normPin, isCreditNote } = require("./keys");

const KIND_MAP = {
  sales_invoices: { kind: "SALES", source: "ERP" },
  purchase_invoices: { kind: "PURCHASES", source: "ERP" },
  itax_sales: { kind: "SALES", source: "ITAX" },
  itax_purchases: { kind: "PURCHASES", source: "ITAX" },
  wht_vat: { kind: "WHT_VAT", source: "ITAX" },
};
const DOC_COLS = ["id", "workspace_id", "batch_id", "kind", "source", "period", "pin", "counterparty", "invoice_no", "invoice_key", "cu_invoice_no", "invoice_date", "doc_type", "related_invoice", "taxable_cents", "vat_cents", "total_cents", "rate_code", "description", "extra"];

/** Normalised record (from lib/ingest validate) → tax_documents row values. */
function docRow(wsId, batchId, kind, source, period, r) {
  let taxable = r.taxableCents ?? 0, vat = r.vatCents ?? 0;
  const credit = isCreditNote({ docType: r.docType, taxableCents: taxable, vatCents: vat, relatedInvoice: r.relatedInvoice });
  if (credit) { taxable = -Math.abs(taxable); vat = -Math.abs(vat); }
  const invoiceNo = kind === "WHT_VAT" ? (r.invoiceNo || r.certificateNo) : r.invoiceNo;
  const extra = {};
  for (const k of ["etrSerial", "relatedDate", "purchaseType", "customsEntry", "certificateNo"]) if (r[k]) extra[k] = r[k];
  return [db.id(), wsId, batchId, kind, source, period, normPin(r.pin), r.counterparty || null, invoiceNo || null, invoiceKey(invoiceNo), r.cuInvoiceNo || (source === "ITAX" && kind !== "WHT_VAT" ? invoiceNo : null) || null,
    r.date || null, credit ? "CREDIT_NOTE" : "INVOICE", r.relatedInvoice || null, taxable, vat, r.totalCents ?? taxable + vat, r.rateCode || null, r.description ? String(r.description).slice(0, 300) : null, Object.keys(extra).length ? JSON.stringify(extra) : null];
}

/**
 * Replace the batch for (kind, source, period) with these records. Returns { batchId, replaced, count }.
 * extraStmts: e.g. an audit statement to commit atomically.
 */
async function storeBatch({ wsId, userId, datasetKind, period, records, fileName, cleanReport = [], extraStmts = [] }) {
  const map = KIND_MAP[datasetKind];
  if (!map) throw new Error("Unknown tax dataset.");
  const prev = await db.all("SELECT id, row_count FROM tax_batches WHERE workspace_id = ? AND kind = ? AND source = ? AND period = ?", [wsId, map.kind, map.source, period]);
  const batchId = db.id(), t = db.now();
  await db.batch([
    ...prev.flatMap((p) => [{ sql: "DELETE FROM tax_documents WHERE batch_id = ? AND workspace_id = ?", args: [p.id, wsId] }, { sql: "DELETE FROM tax_batches WHERE id = ? AND workspace_id = ?", args: [p.id, wsId] }]),
    { sql: "INSERT INTO tax_batches (id, workspace_id, kind, source, period, file_name, row_count, clean_report, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [batchId, wsId, map.kind, map.source, period, fileName, records.length, JSON.stringify(cleanReport), userId, t] },
    ...db.insertMany("tax_documents", DOC_COLS, records.map((r) => docRow(wsId, batchId, map.kind, map.source, period, r))),
    ...extraStmts,
  ]);
  return { batchId, replaced: prev.reduce((a, p) => a + p.row_count, 0), count: records.length, ...map };
}

/** tax_documents rows → engine documents. */
function toDoc(r) {
  const extra = r.extra ? JSON.parse(r.extra) : {};
  return {
    id: r.id, source: r.source, period: r.period, pin: r.pin, counterparty: r.counterparty, invoiceNo: r.invoice_no, invoiceKey: r.invoice_key,
    cuInvoiceNo: r.cu_invoice_no, date: r.invoice_date, docType: r.doc_type, relatedInvoice: r.related_invoice, relatedDate: extra.relatedDate || null,
    taxableCents: r.taxable_cents, vatCents: r.vat_cents, totalCents: r.total_cents, rateCode: r.rate_code, description: r.description, extra,
    certificateNo: extra.certificateNo || r.invoice_no,
  };
}

async function loadDocs(wsId, kind, period, source) {
  const rows = await db.all(`SELECT * FROM tax_documents WHERE workspace_id = ? AND kind = ? AND period = ?${source ? " AND source = ?" : ""}`, source ? [wsId, kind, period, source] : [wsId, kind, period]);
  return rows.map(toDoc);
}

module.exports = { KIND_MAP, DOC_COLS, docRow, storeBatch, toDoc, loadDocs };
