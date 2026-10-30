"use server";
import db from "@/lib/db";
import { requirePerm, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { parseAmount } from "@/lib/money";
import { hit } from "@/lib/security/rate-limit";
import { runVatRecon } from "@/lib/tax/data";

const PERIOD_RE = /^\d{4}-\d{2}$/;
const ADJ_KEYS = ["creditBfCents", "importedServicesVatCents", "exemptOnlyInputCents", "commonInputCents", "exemptSalesCents", "zeroRatedSalesCents", "refundClaimCents", "vatPaidCents", "creditAdjustmentCents", "debitAdjustmentCents"];

export async function runRecon(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "data.edit");
  const period = String(formData.get("period") || "");
  const path = `/app/${slug}/tax/vat?period=${period}`;
  if (!PERIOD_RE.test(period)) back(`/app/${slug}/tax/vat`, { err: "Choose a period." });
  if (!hit("heavy", ws.id).ok) back(path, { err: "Too many runs in a short time. Wait a minute." });
  const adjustments = {};
  for (const k of ADJ_KEYS) {
    const raw = String(formData.get(k) || "").trim();
    if (!raw) continue;
    const c = parseAmount(raw);
    if (c === null) back(path, { err: `“${raw}” isn't a valid amount.` });
    adjustments[k] = Math.abs(c);
  }
  let runId;
  try { runId = await runVatRecon(ws, user.id, period, adjustments); }
  catch (e) { back(path, { err: e.message }); }
  back(`${path}&run=${runId}`, { ok: "Reconciliation complete. Work through the exceptions below, starting with the most serious." });
}

export async function reviewItem(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "data.edit");
  const id = String(formData.get("id"));
  const ret = String(formData.get("return") || `/app/${slug}/tax/vat`);
  const path = ret.startsWith(`/app/${slug}/tax/vat`) ? ret : `/app/${slug}/tax/vat`;
  const status = String(formData.get("review_status"));
  if (!["OPEN", "ACTIONED", "ACCEPTED"].includes(status)) back(path, { err: "Unknown review status." });
  const note = String(formData.get("note") || "").trim().slice(0, 1000);
  const item = await db.get("SELECT id, status, invoice_no, review_status FROM tax_recon_items WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!item) back(path, { err: "Item not found." });
  if (status === "ACCEPTED" && item.status !== "MATCHED" && item.status !== "CERT_MATCHED" && !note) back(path, { err: "Add a note explaining why this exception is accepted." });
  await db.batch([
    { sql: "UPDATE tax_recon_items SET review_status = ?, note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND workspace_id = ?", args: [status, note || null, user.id, db.now(), id, ws.id] },
    auditStmt(ws.id, user.id, "tax.item_reviewed", "tax_recon_item", id, { invoice: item.invoice_no, status: item.status, review: `${item.review_status} → ${status}`, note: note.slice(0, 200) }),
  ]);
  back(path);
}

export async function acceptAllMatched(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "data.edit");
  const runId = String(formData.get("run"));
  const r = await db.run("UPDATE tax_recon_items SET review_status = 'ACCEPTED', reviewed_by = ?, reviewed_at = ? WHERE run_id = ? AND workspace_id = ? AND status IN ('MATCHED','CERT_MATCHED') AND review_status = 'OPEN'", [user.id, db.now(), runId, ws.id]);
  await db.batch([auditStmt(ws.id, user.id, "tax.matched_accepted", "tax_recon_run", runId, { items: r.changes })]);
  back(String(formData.get("return") || `/app/${slug}/tax/vat`), { ok: `Accepted ${r.changes} matched item(s).` });
}
