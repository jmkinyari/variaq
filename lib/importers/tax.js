// Tax importers for the Data hub: ERP sales/purchase registers, KRA iTax/eTIMS auto-populated
// files (Sections B and F) and withholding-VAT certificates. Re-uploading the same dataset for the
// same period replaces the earlier upload.
import "server-only";
import { auditStmt } from "../auth";
import { storeBatch, KIND_MAP } from "../tax/store";

const PERIOD_RE = /^\d{4}-\d{2}$/;
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const LABELS = { sales_invoices: "ERP sales invoices", purchase_invoices: "ERP purchase invoices", itax_sales: "iTax/eTIMS sales", itax_purchases: "iTax/eTIMS purchases", wht_vat: "withholding VAT certificates" };

function importer(datasetKind) {
  return {
    options: [{ key: "period", label: "VAT return period", type: "month", required: true, default: lastMonth(), help: "The month of the VAT3 return these documents belong to." }],
    async run({ ws, user, records, fileName, options, cleanReport }) {
      const period = String(options.period || "");
      if (!PERIOD_RE.test(period)) throw new Error("Choose the VAT return period (month).");
      const map = KIND_MAP[datasetKind];
      const res = await storeBatch({
        wsId: ws.id, userId: user.id, datasetKind, period, records, fileName, cleanReport,
        extraStmts: [auditStmt(ws.id, user.id, "tax.documents_imported", "tax_batch", null, { datasetKind, period, rows: records.length, fileName })],
      });
      const credits = records.filter((r) => (r.taxableCents || 0) < 0 || /credit/i.test(r.docType || "")).length;
      return {
        message: `Imported ${res.count} ${LABELS[datasetKind]} for ${period}${credits ? ` (${credits} credit notes)` : ""}.${res.replaced ? ` Replaced the previous upload of ${res.replaced} rows for that period.` : ""} Run the VAT reconciliation when both ERP and iTax data are in.`,
        redirect: `/app/${ws.slug}/tax/vat?period=${period}${map.kind === "WHT_VAT" ? "" : `&side=${map.kind}`}`,
        targetId: res.batchId, imported: res.count,
      };
    },
  };
}

export const TAX_IMPORTERS = Object.fromEntries(Object.keys(KIND_MAP).map((k) => [k, importer(k)]));
