// Server-side tax data access: profile (KRA PIN encrypted), running and persisting VAT
// reconciliations, and loading ledger figures for the cross-checks.
import "server-only";
import db from "../db";
import { open } from "../vault";
import { auditStmt } from "../auth";
import { loadChart } from "../statements-data";
import { loadDocs, toDoc } from "./store";
import { reconcile, reconcileWhvat } from "./vat-recon";
import { computeVat3 } from "./vat3";
import { vatControl, revenueCheck, etimsDeductibility } from "./ledger-check";
import { monthEnd } from "./keys";

export async function getProfile(wsId) {
  const p = await db.get("SELECT * FROM tax_profile WHERE workspace_id = ?", [wsId]);
  if (!p) return { exists: false, vat_registered: 1, wht_vat_agent: 0, fy_end_month: 12, paye_registered: 1, wht_registered: 1, tot_registered: 0, kraPin: null };
  let kraPin = null;
  try { kraPin = await open(wsId, "tax.kra_pin", p.kra_pin); } catch { kraPin = null; }
  return { ...p, exists: true, kraPin };
}

/** Run the full VAT reconciliation for a period and persist it. Returns the run id. */
export async function runVatRecon(ws, userId, period, adjustments = {}) {
  const profile = await getProfile(ws.id);
  const [erpS, itaxS, erpP, itaxP, certs] = await Promise.all([
    loadDocs(ws.id, "SALES", period, "ERP"), loadDocs(ws.id, "SALES", period, "ITAX"),
    loadDocs(ws.id, "PURCHASES", period, "ERP"), loadDocs(ws.id, "PURCHASES", period, "ITAX"),
    loadDocs(ws.id, "WHT_VAT", period, "ITAX"),
  ]);
  if (!erpS.length && !itaxS.length && !erpP.length && !itaxP.length) throw new Error(`No tax documents for ${period}. Upload the ERP registers and the iTax/eTIMS files first.`);
  const sales = reconcile({ side: "SALES", period, erp: erpS, itax: itaxS, ownPin: profile.kraPin });
  const purchases = reconcile({ side: "PURCHASES", period, erp: erpP, itax: itaxP, ownPin: profile.kraPin });
  const whvat = reconcileWhvat({ certificates: certs, sales: [...erpS, ...itaxS.filter((d) => !erpS.some((e) => e.invoiceKey === d.invoiceKey))] });
  const vat3 = computeVat3({ sales, purchases, whvat, adj: adjustments });

  // Keep reviewers' decisions from the previous run of this period for the same document pair.
  const prev = await db.all(`SELECT i.side, i.erp_doc_id, i.itax_doc_id, i.status, i.review_status, i.note, i.reviewed_by, i.reviewed_at FROM tax_recon_items i
    WHERE i.run_id = (SELECT id FROM tax_recon_runs WHERE workspace_id = ? AND kind = 'VAT' AND period = ? ORDER BY created_at DESC LIMIT 1) AND i.review_status <> 'OPEN'`, [ws.id, period]);
  const carry = new Map(prev.map((p) => [`${p.side}|${p.erp_doc_id}|${p.itax_doc_id}|${p.status}`, p]));

  const runId = db.id(), t = db.now();
  const cols = ["id", "run_id", "workspace_id", "status", "erp_doc_id", "itax_doc_id", "pin", "counterparty", "invoice_no", "erp_vat_cents", "itax_vat_cents", "diff_cents", "issues", "action", "review_status", "note", "reviewed_by", "reviewed_at", "side", "pass", "doc_date", "itax_date", "itax_invoice_no", "erp_taxable_cents", "itax_taxable_cents"];
  const row = (x) => {
    const c = carry.get(`${x.side}|${x.erpId}|${x.itaxId}|${x.status}`);
    const autoAccepted = x.status === "MATCHED" && !x.issues.some((i) => i.severity !== "info");
    return [db.id(), runId, ws.id, x.status, x.erpId, x.itaxId, x.pin, x.counterparty, x.invoiceNo, x.erpVatCents, x.itaxVatCents, x.diffCents, JSON.stringify(x.issues), x.action,
      c?.review_status || (autoAccepted ? "ACCEPTED" : "OPEN"), c?.note || null, c?.reviewed_by || null, c?.reviewed_at || null, x.side, x.pass, x.date, x.itaxDate, x.itaxInvoiceNo, x.erpTaxableCents, x.itaxTaxableCents];
  };
  const whItems = whvat.items.map((w) => ({ side: "WHT_VAT", status: w.status, erpId: w.saleId, itaxId: null, pin: w.pin, counterparty: w.counterparty, invoiceNo: w.certificateNo, erpVatCents: w.expectedCents, itaxVatCents: w.withheldCents, diffCents: (w.expectedCents ?? 0) - w.withheldCents, issues: [], action: w.action, pass: 0, date: w.date, itaxDate: w.date, itaxInvoiceNo: w.invoiceNo, erpTaxableCents: null, itaxTaxableCents: null }));
  const all = [...sales.items, ...purchases.items, ...whItems];
  const stats = { sales: sales.stats, purchases: purchases.stats, whvat: { counts: whvat.counts, totalCreditCents: whvat.totalCreditCents, certificates: whvat.items.length } };
  await db.batch([
    { sql: "INSERT INTO tax_recon_runs (id, workspace_id, kind, period, stats, created_by, created_at, vat3, adjustments) VALUES (?,?,?,?,?,?,?,?,?)", args: [runId, ws.id, "VAT", period, JSON.stringify(stats), userId, t, JSON.stringify(vat3), JSON.stringify(adjustments)] },
    ...db.insertMany("tax_recon_items", cols, all.map(row), { perStmt: 60 }),
    auditStmt(ws.id, userId, "tax.vat_recon_run", "tax_recon_run", runId, { period, items: all.length, matchRateSales: sales.stats.matchRate, matchRatePurchases: purchases.stats.matchRate, netVatCents: vat3.netCents }),
  ]);
  return runId;
}

export async function getRun(wsId, runId) {
  const r = await db.get("SELECT r.*, u.name by_name FROM tax_recon_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ? AND r.workspace_id = ?", [runId, wsId]);
  if (!r) return null;
  return { ...r, stats: JSON.parse(r.stats || "{}"), vat3: r.vat3 ? JSON.parse(r.vat3) : null, adjustments: JSON.parse(r.adjustments || "{}") };
}
export async function latestRun(wsId, period) {
  const r = await db.get(`SELECT id FROM tax_recon_runs WHERE workspace_id = ? AND kind = 'VAT'${period ? " AND period = ?" : ""} ORDER BY created_at DESC LIMIT 1`, period ? [wsId, period] : [wsId]);
  return r ? getRun(wsId, r.id) : null;
}
export async function runItems(wsId, runId, { side, status, review } = {}) {
  const where = ["workspace_id = ?", "run_id = ?"], args = [wsId, runId];
  if (side) { where.push("side = ?"); args.push(side); }
  if (status) { where.push("status = ?"); args.push(status); }
  if (review) { where.push("review_status = ?"); args.push(review); }
  const rows = await db.all(`SELECT * FROM tax_recon_items WHERE ${where.join(" AND ")} ORDER BY CASE status WHEN 'MATCHED' THEN 9 WHEN 'CERT_MATCHED' THEN 9 ELSE 1 END, ABS(COALESCE(diff_cents,0)) DESC LIMIT 2000`, args);
  return rows.map((r) => ({ ...r, issues: JSON.parse(r.issues || "[]") }));
}

/** Rebuild engine results from stored items (for CSV exports). */
export async function runResults(wsId, runId) {
  const items = await runItems(wsId, runId);
  const docIds = [...new Set(items.flatMap((i) => [i.erp_doc_id, i.itax_doc_id]).filter(Boolean))];
  const docs = new Map();
  for (let k = 0; k < docIds.length; k += 400) {
    const chunk = docIds.slice(k, k + 400);
    for (const d of await db.all(`SELECT * FROM tax_documents WHERE workspace_id = ? AND id IN (${chunk.map(() => "?").join(",")})`, [wsId, ...chunk])) docs.set(d.id, toDoc(d));
  }
  const shape = (i) => ({ ...i, side: i.side, erpId: i.erp_doc_id, itaxId: i.itax_doc_id, invoiceNo: i.invoice_no, itaxInvoiceNo: i.itax_invoice_no, date: i.doc_date, itaxDate: i.itax_date,
    erpVatCents: i.erp_vat_cents, itaxVatCents: i.itax_vat_cents, erpTaxableCents: i.erp_taxable_cents, itaxTaxableCents: i.itax_taxable_cents, diffCents: i.diff_cents });
  const pick = (side) => ({ items: items.filter((i) => i.side === side).map(shape) });
  const wh = items.filter((i) => i.side === "WHT_VAT").map((i) => ({ status: i.status, pin: i.pin, counterparty: i.counterparty, certificateNo: i.invoice_no, date: i.doc_date, withheldCents: i.itax_vat_cents }));
  return { sales: pick("SALES"), purchases: pick("PURCHASES"), whvat: { items: wh }, all: items.map(shape), docs };
}

/** Ledger figures for the period + the year-to-date eTIMS deductibility check. */
export async function ledgerChecks(ws, period, profile, run) {
  const [from, to] = [`${period}-01`, monthEnd(period)];
  const sum = async (code, sign) => {
    if (!code) return 0;
    const r = await db.get("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ?", [ws.id, code, from, to]);
    return sign * (r?.s || 0);
  };
  const { chart } = await loadChart(ws.id);
  const revenueCodes = profile.revenue_accounts ? profile.revenue_accounts.split(",").map((s) => s.trim()).filter(Boolean) : [...chart.values()].filter((a) => a.cls === "REVENUE").map((a) => a.code);
  let ledgerRevenue = 0;
  if (revenueCodes.length) {
    const r = await db.get(`SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE workspace_id = ? AND date BETWEEN ? AND ? AND account_code IN (${revenueCodes.map(() => "?").join(",")})`, [ws.id, from, to, ...revenueCodes]);
    ledgerRevenue = -(r?.s || 0);
  }
  const s = run?.stats || {};
  const control = vatControl({
    hasAccounts: !!(profile.output_vat_account || profile.input_vat_account),
    ledgerOutputCents: await sum(profile.output_vat_account, -1), ledgerInputCents: await sum(profile.input_vat_account, 1),
    registerOutputCents: s.sales?.erpVatCents || 0, registerInputCents: s.purchases?.erpVatCents || 0,
    itaxOutputCents: s.sales?.itaxVatCents || 0, itaxInputCents: s.purchases?.claimableVatCents || 0,
  });
  const revenue = run ? revenueCheck({ ledgerRevenueCents: ledgerRevenue, registerTaxableCents: s.sales?.erpTaxableCents || 0, itaxTaxableCents: s.sales?.itaxTaxableCents || 0, exemptAndZeroCents: Number(run.adjustments?.exemptSalesCents || 0) + Number(run.adjustments?.zeroRatedSalesCents || 0) }) : [];
  return { control, revenue, ledgerRevenueCents: ledgerRevenue, revenueAccounts: revenueCodes };
}

export async function deductibility(ws, year) {
  const { chart } = await loadChart(ws.id);
  const expenseCodes = [...chart.values()].filter((a) => a.cls === "EXPENSE" || a.cls === "COGS").map((a) => a.code);
  if (!expenseCodes.length) return { rows: [], totals: { expensesCents: 0, exemptCents: 0, noCounterpartyCents: 0, unsupportedCents: 0, taxAtRiskCents: 0 }, exemptByCat: {} };
  const expenses = await db.all(`SELECT id, date, account_code accountCode, account_name accountName, description, counterparty, amount_cents amountCents FROM ledger_entries
    WHERE workspace_id = ? AND date BETWEEN ? AND ? AND amount_cents > 0 AND account_code IN (${expenseCodes.map(() => "?").join(",")})`, [ws.id, `${year}-01-01`, `${year}-12-31`, ...expenseCodes]);
  const etims = await db.all("SELECT pin, counterparty, taxable_cents taxableCents FROM tax_documents WHERE workspace_id = ? AND kind = 'PURCHASES' AND source = 'ITAX' AND period LIKE ?", [ws.id, `${year}-%`]);
  return etimsDeductibility({ expenses, etims, year });
}

/** Counts of uploaded documents per dataset for a period. */
export async function dataStatus(wsId, period) {
  const rows = await db.all("SELECT kind, source, COUNT(*) n, MAX(created_at) at, MAX(file_name) file_name FROM tax_batches WHERE workspace_id = ? AND period = ? GROUP BY kind, source", [wsId, period]);
  const get = (k, s) => rows.find((r) => r.kind === k && r.source === s);
  const docs = await db.all("SELECT kind, source, COUNT(*) n FROM tax_documents WHERE workspace_id = ? AND period = ? GROUP BY kind, source", [wsId, period]);
  const n = (k, s) => docs.find((r) => r.kind === k && r.source === s)?.n || 0;
  return [
    { dataset: "sales_invoices", label: "ERP sales register", count: n("SALES", "ERP"), batch: get("SALES", "ERP") },
    { dataset: "itax_sales", label: "iTax/eTIMS sales (Section B)", count: n("SALES", "ITAX"), batch: get("SALES", "ITAX") },
    { dataset: "purchase_invoices", label: "ERP purchase register", count: n("PURCHASES", "ERP"), batch: get("PURCHASES", "ERP") },
    { dataset: "itax_purchases", label: "iTax/eTIMS purchases (Section F)", count: n("PURCHASES", "ITAX"), batch: get("PURCHASES", "ITAX") },
    { dataset: "wht_vat", label: "Withholding VAT certificates", count: n("WHT_VAT", "ITAX"), batch: get("WHT_VAT", "ITAX") },
  ];
}
