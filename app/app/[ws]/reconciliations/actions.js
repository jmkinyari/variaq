"use server";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, audit, auditStmt } from "@/lib/auth";
import { runMatching } from "@/lib/recon";
import { back } from "@/lib/flash";
import { parseAmount, formatMoney } from "@/lib/money";
import { aiAvailable, aiUnavailableReason, askClaude } from "@/lib/ai";

async function load(formData, minRole = "MEMBER", { allowCompleted = false } = {}) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, minRole);
  const recId = String(formData.get("rec"));
  const rec = await db.get("SELECT * FROM reconciliations WHERE id = ? AND workspace_id = ?", [recId, ws.id]);
  if (!rec) back(`/app/${slug}/reconciliations`, { err: "Reconciliation not found." });
  const path = `/app/${slug}/reconciliations/${rec.id}${formData.get("tab") ? `?tab=${formData.get("tab")}` : ""}`;
  if (!allowCompleted && rec.status === "COMPLETED") back(path, { err: "This reconciliation is completed and locked. Reopen it to make changes." });
  return { user, ws, rec, slug, path };
}
const touch = (id) => ({ sql: "UPDATE reconciliations SET updated_at = ? WHERE id = ?", args: [db.now(), id] });

export async function createReconciliation(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const st = await db.get("SELECT s.*, b.name bank, b.ledger_account_code FROM bank_statements s JOIN bank_accounts b ON b.id = s.bank_account_id WHERE s.id = ? AND s.workspace_id = ?", [String(formData.get("statement")), ws.id]);
  if (!st) back(`/app/${slug}/reconciliations/new`, { err: "Choose a statement." });
  if (!st.ledger_account_code) back(`/app/${slug}/bank`, { err: `Link ${st.bank} to a ledger account first.` });
  const window = Math.min(30, Math.max(0, parseInt(formData.get("date_window") || "3", 10) || 0));
  const large = parseAmount(String(formData.get("large_amount") || "1000000")) ?? 100000000;
  const name = String(formData.get("name") || "").trim() || `${st.bank} · ${st.period_start.slice(0, 7)}`;
  const id = db.id();
  const t = db.now();
  await db.run("INSERT INTO reconciliations (id, workspace_id, bank_account_id, statement_id, name, status, date_window, large_amount_cents, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, ws.id, st.bank_account_id, st.id, name, "IN_PROGRESS", window, Math.abs(large), user.id, t, t]);
  const r = await runMatching(id);
  await audit(ws.id, user.id, "reconciliation.created", "reconciliation", id, { name, statement: st.file_name, ...r });
  redirect(`/app/${slug}/reconciliations/${id}?ok=${encodeURIComponent(`Matched ${r.bank} bank lines against ${r.ledger} ledger entries: ${r.suggested} suggested matches, ${r.exceptions} items to review.`)}`);
}

export async function rerunMatching(formData) {
  const { user, ws, rec, path } = await load(formData);
  const r = await runMatching(rec.id);
  await audit(ws.id, user.id, "reconciliation.rematched", "reconciliation", rec.id, r);
  back(path, { ok: `Matching re-run: ${r.suggested} suggestions, ${r.exceptions} open items. Confirmed matches and resolved items were kept.` });
}

export async function confirmMatch(formData) {
  const { user, ws, rec, path } = await load(formData);
  const id = String(formData.get("id"));
  const m = await db.get("SELECT * FROM matches WHERE id = ? AND reconciliation_id = ? AND status = 'SUGGESTED'", [id, rec.id]);
  if (!m) back(path, { err: "That suggestion is no longer available." });
  await db.batch([
    { sql: "UPDATE matches SET status = 'CONFIRMED', reviewed_by = ?, reviewed_at = ? WHERE id = ?", args: [user.id, db.now(), id] },
    auditStmt(ws.id, user.id, "match.confirmed", "match", id, { reconciliation: rec.id, confidence: m.confidence, method: m.method }), touch(rec.id),
  ]);
  back(path);
}

export async function confirmHighConfidence(formData) {
  const { user, ws, rec, path } = await load(formData);
  const min = Math.max(70, parseInt(formData.get("min") || "90", 10));
  const ms = await db.all("SELECT id FROM matches WHERE reconciliation_id = ? AND status = 'SUGGESTED' AND confidence >= ?", [rec.id, min]);
  if (!ms.length) back(path, { err: `No suggestions at ${min}% confidence or above.` });
  const t = db.now();
  await db.batch([
    ...ms.map((m) => ({ sql: "UPDATE matches SET status = 'CONFIRMED', reviewed_by = ?, reviewed_at = ? WHERE id = ?", args: [user.id, t, m.id] })),
    auditStmt(ws.id, user.id, "match.bulk_confirmed", "reconciliation", rec.id, { count: ms.length, minConfidence: min }), touch(rec.id),
  ]);
  back(path, { ok: `Confirmed ${ms.length} matches at ${min}%+ confidence.` });
}

export async function rejectMatch(formData) {
  const { user, ws, rec, path } = await load(formData);
  const id = String(formData.get("id"));
  const m = await db.get("SELECT * FROM matches WHERE id = ? AND reconciliation_id = ? AND status = 'SUGGESTED'", [id, rec.id]);
  if (!m) back(path, { err: "That suggestion is no longer available." });
  await db.batch([
    { sql: "UPDATE matches SET status = 'REJECTED', reviewed_by = ?, reviewed_at = ? WHERE id = ?", args: [user.id, db.now(), id] },
    auditStmt(ws.id, user.id, "match.rejected", "match", id, { reconciliation: rec.id }),
  ]);
  await runMatching(rec.id); // look for alternatives; unmatched items become exceptions
  back(path, { ok: "Suggestion rejected. Both items were sent back for review." });
}

export async function undoMatch(formData) {
  const { user, ws, rec, path } = await load(formData);
  const id = String(formData.get("id"));
  const m = await db.get("SELECT * FROM matches WHERE id = ? AND reconciliation_id = ? AND status = 'CONFIRMED'", [id, rec.id]);
  if (!m) back(path, { err: "Match not found." });
  await db.batch([
    { sql: m.method === "MANUAL" ? "DELETE FROM matches WHERE id = ?" : "UPDATE matches SET status = 'SUGGESTED', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?", args: [id] },
    { sql: "UPDATE recon_exceptions SET status = 'OPEN', resolved_by = NULL, resolved_at = NULL, note = NULL WHERE reconciliation_id = ? AND note LIKE 'Resolved by manual match%' AND (bank_transaction_id = ? OR ledger_entry_id = ?)", args: [rec.id, m.bank_transaction_id, m.ledger_entry_id] },
    auditStmt(ws.id, user.id, "match.undone", "match", id, { reconciliation: rec.id, method: m.method }), touch(rec.id),
  ]);
  await runMatching(rec.id);
  back(path, { ok: "Match undone." });
}

export async function manualMatch(formData) {
  const { user, ws, rec, path } = await load(formData);
  const exId = String(formData.get("exception"));
  const leId = String(formData.get("ledger_entry") || "");
  const note = String(formData.get("note") || "").trim();
  const ex = await db.get("SELECT * FROM recon_exceptions WHERE id = ? AND reconciliation_id = ?", [exId, rec.id]);
  if (!ex || !ex.bank_transaction_id) back(path, { err: "Exception not found." });
  if (!leId) back(path, { err: "Choose the ledger entry to match." });
  const bt = await db.get("SELECT * FROM bank_transactions WHERE id = ?", [ex.bank_transaction_id]);
  const le = await db.get("SELECT * FROM ledger_entries WHERE id = ? AND workspace_id = ?", [leId, ws.id]);
  if (!le) back(path, { err: "Ledger entry not found." });
  const taken = await db.get("SELECT reconciliation_id FROM matches WHERE status = 'CONFIRMED' AND (ledger_entry_id = ? OR (bank_transaction_id = ? AND reconciliation_id = ?))", [le.id, bt.id, rec.id]);
  if (taken) back(path, { err: "One of these items is already in a confirmed match." });
  const diff = bt.amount_cents - le.amount_cents;
  if (diff !== 0 && !note) back(path, { err: `Amounts differ by ${formatMoney(diff, ws.currency)}. Add a note explaining the difference.` });
  const reasons = ["Matched manually", ...(diff ? [`Difference of ${formatMoney(diff, ws.currency)} accepted`] : []), ...(note ? [`Note: ${note}`] : [])];
  const t = db.now();
  const mId = db.id();
  await db.batch([
    { sql: "DELETE FROM matches WHERE reconciliation_id = ? AND status = 'SUGGESTED' AND (bank_transaction_id = ? OR ledger_entry_id = ?)", args: [rec.id, bt.id, le.id] },
    { sql: "INSERT INTO matches (id, reconciliation_id, bank_transaction_id, ledger_entry_id, status, method, confidence, reasons, reviewed_by, reviewed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", args: [mId, rec.id, bt.id, le.id, "CONFIRMED", "MANUAL", 100, JSON.stringify(reasons), user.id, t, t] },
    { sql: "UPDATE recon_exceptions SET status = 'RESOLVED', note = ?, resolved_by = ?, resolved_at = ? WHERE reconciliation_id = ? AND status = 'OPEN' AND type IN ('UNMATCHED_BANK','UNMATCHED_LEDGER','AMOUNT_MISMATCH') AND (bank_transaction_id = ? OR ledger_entry_id = ?)", args: [`Resolved by manual match${note ? `: ${note}` : ""}`, user.id, t, rec.id, bt.id, le.id] },
    auditStmt(ws.id, user.id, "match.manual", "match", mId, { reconciliation: rec.id, bank: bt.description, ledger: le.description, differenceCents: diff, note }), touch(rec.id),
  ]);
  back(path, { ok: "Matched manually." });
}

export async function resolveException(formData) {
  const { user, ws, rec, path } = await load(formData);
  const id = String(formData.get("id"));
  const status = formData.get("status") === "DISMISSED" ? "DISMISSED" : "RESOLVED";
  const note = String(formData.get("note") || "").trim();
  if (!note) back(path, { err: "Add a short note explaining how the item was resolved — it goes into the audit trail." });
  const ex = await db.get("SELECT * FROM recon_exceptions WHERE id = ? AND reconciliation_id = ? AND status = 'OPEN'", [id, rec.id]);
  if (!ex) back(path, { err: "That item is no longer open." });
  await db.batch([
    { sql: "UPDATE recon_exceptions SET status = ?, note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", args: [status, note, user.id, db.now(), id] },
    auditStmt(ws.id, user.id, `exception.${status.toLowerCase()}`, "exception", id, { reconciliation: rec.id, type: ex.type, note }), touch(rec.id),
  ]);
  back(path);
}

export async function reopenException(formData) {
  const { user, ws, rec, path } = await load(formData);
  const id = String(formData.get("id"));
  await db.batch([
    { sql: "UPDATE recon_exceptions SET status = 'OPEN', resolved_by = NULL, resolved_at = NULL WHERE id = ? AND reconciliation_id = ?", args: [id, rec.id] },
    auditStmt(ws.id, user.id, "exception.reopened", "exception", id, { reconciliation: rec.id }), touch(rec.id),
  ]);
  back(path);
}

export async function aiHint(formData) {
  const { user, ws, rec, path } = await load(formData);
  if (!(await aiAvailable(ws))) back(path, { err: (await aiUnavailableReason(ws)) || "AI is unavailable." });
  const ex = await db.get("SELECT * FROM recon_exceptions WHERE id = ? AND reconciliation_id = ?", [String(formData.get("id")), rec.id]);
  if (!ex) back(path, { err: "Item not found." });
  const bt = ex.bank_transaction_id ? await db.get("SELECT date, description, reference, amount_cents FROM bank_transactions WHERE id = ?", [ex.bank_transaction_id]) : null;
  const le = ex.ledger_entry_id ? await db.get("SELECT date, description, reference, amount_cents, counterparty FROM ledger_entries WHERE id = ?", [ex.ledger_entry_id]) : null;
  const acct = await db.get("SELECT ledger_account_code FROM bank_accounts WHERE id = ?", [rec.bank_account_id]);
  const amt = (bt || le).amount_cents;
  const cands = await db.all(`SELECT date, description, reference, amount_cents, counterparty FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND id NOT IN (SELECT ledger_entry_id FROM matches WHERE status = 'CONFIRMED') ORDER BY ABS(amount_cents - ?) LIMIT 15`, [ws.id, acct.ledger_account_code, amt]);
  let hint;
  try {
    hint = await askClaude(
      "You help an accountant in Kenya review bank reconciliation exceptions. Be concise (max 120 words), practical and cautious. Never state that something is definitely correct; suggest what to check. Amounts are in cents in the data; present them in currency units.",
      `Currency: ${ws.currency}\nException type: ${ex.type}\nDetail: ${ex.detail}\nBank line: ${JSON.stringify(bt)}\nLedger entry: ${JSON.stringify(le)}\nPossible related unmatched ledger entries: ${JSON.stringify(cands)}\n\nWhat is the likely explanation, and what should the reviewer check next?`,
      { ws, user, feature: "RECON_HINT" }
    );
  } catch (e) { back(path, { err: e.message }); }
  await db.batch([
    { sql: "UPDATE recon_exceptions SET ai_hint = ? WHERE id = ?", args: [hint, ex.id] },
    auditStmt(ws.id, user.id, "exception.ai_hint", "exception", ex.id, { reconciliation: rec.id }),
  ]);
  back(path);
}

export async function setStatus(formData) {
  const target = String(formData.get("status"));
  const needsAdmin = target === "IN_PROGRESS";
  const { user, ws, rec, path } = await load(formData, needsAdmin ? "ADMIN" : "MEMBER", { allowCompleted: needsAdmin });
  if (target === "COMPLETED") {
    const pending = await db.get("SELECT (SELECT COUNT(*) FROM matches WHERE reconciliation_id = ? AND status = 'SUGGESTED') s, (SELECT COUNT(*) FROM recon_exceptions WHERE reconciliation_id = ? AND status = 'OPEN') e", [rec.id, rec.id]);
    if (pending.s || pending.e) back(path, { err: `Can't complete yet: ${pending.s} suggested matches to review and ${pending.e} open items.` });
  }
  if (!["IN_PROGRESS", "IN_REVIEW", "COMPLETED"].includes(target)) back(path, { err: "Unknown status." });
  const t = db.now();
  await db.batch([
    { sql: "UPDATE reconciliations SET status = ?, completed_by = ?, completed_at = ?, updated_at = ? WHERE id = ?", args: [target, target === "COMPLETED" ? user.id : null, target === "COMPLETED" ? t : null, t, rec.id] },
    auditStmt(ws.id, user.id, `reconciliation.${target.toLowerCase()}`, "reconciliation", rec.id, { from: rec.status, to: target }),
  ]);
  back(path, { ok: { COMPLETED: "Reconciliation completed and locked.", IN_REVIEW: "Sent for review.", IN_PROGRESS: "Reopened for changes." }[target] });
}

export async function deleteReconciliation(formData) {
  const { user, ws, rec, slug } = await load(formData, "ADMIN");
  await db.batch([
    { sql: "DELETE FROM matches WHERE reconciliation_id = ?", args: [rec.id] },
    { sql: "DELETE FROM recon_exceptions WHERE reconciliation_id = ?", args: [rec.id] },
    { sql: "DELETE FROM reconciliations WHERE id = ?", args: [rec.id] },
    auditStmt(ws.id, user.id, "reconciliation.deleted", "reconciliation", rec.id, { name: rec.name }),
  ]);
  back(`/app/${slug}/reconciliations`, { ok: `Deleted ${rec.name}.` });
}
