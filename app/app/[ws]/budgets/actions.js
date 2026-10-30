"use server";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, requirePerm, can, auditStmt, notifyStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { generateBudget, normalizeAssumptions, METHODS, BUDGET_CLASSES } from "@/lib/budget/engine";
import { budgetHistory, loadBudget } from "@/lib/budget/data";
import { hit } from "@/lib/security/rate-limit";

const YM = /^\d{4}-\d{2}$/;
const MAX_CELL = 1e15; // cents; well past any real budget line
const numOr = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? d : +v);

function lineStmts(budgetId, wsId, lines) {
  return db.insertMany("budget_lines", ["budget_id", "workspace_id", "account_code", "month_idx", "amount_cents"],
    [...lines].flatMap(([code, row]) => row.map((v, m) => [budgetId, wsId, code, m, Math.round(v)])).filter((r) => r[4] !== 0));
}

export async function createBudget(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  if (!hit("heavy", ws.id).ok) back(`/app/${slug}/budgets/new`, { err: "Too many runs in a short time. Wait a minute." });
  const name = String(formData.get("name") || "").trim().slice(0, 100);
  const fyStart = String(formData.get("fy_start") || "");
  const method = String(formData.get("method") || "");
  if (!name) back(`/app/${slug}/budgets/new`, { err: "Give the budget a name." });
  if (!YM.test(fyStart)) back(`/app/${slug}/budgets/new`, { err: "Choose the first month of the financial year." });
  if (!METHODS[method]) back(`/app/${slug}/budgets/new`, { err: "Choose a method." });
  const assumptions = normalizeAssumptions({
    growth: Object.fromEntries(BUDGET_CLASSES.map((c) => [c, numOr(formData.get(`growth_${c}`), undefined)])),
    revGrowth: numOr(formData.get("revGrowth"), undefined), cogsPct: formData.get("cogsPct") === "" ? null : numOr(formData.get("cogsPct"), null),
    inflation: numOr(formData.get("inflation"), undefined), payrollPct: numOr(formData.get("payrollPct"), undefined), payrollMonth: numOr(formData.get("payrollMonth"), 0),
    rounding: numOr(formData.get("rounding"), 100000),
  });
  const { chart, history } = await budgetHistory(ws.id, fyStart);
  const lines = generateBudget({ chart, history, method, assumptions });
  const id = db.id(), t = db.now();
  await db.batch([
    { sql: "INSERT INTO budgets (id, workspace_id, name, fy_start, status, method, assumptions, version, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", args: [id, ws.id, name, fyStart, "DRAFT", method, JSON.stringify(assumptions), 1, user.id, t, t] },
    ...lineStmts(id, ws.id, lines),
    auditStmt(ws.id, user.id, "budget.created", "budget", id, { name, fyStart, method, accounts: lines.size }),
  ]);
  redirect(`/app/${slug}/budgets/${id}?ok=${encodeURIComponent(`Generated “${name}” with ${lines.size} accounts using ${METHODS[method].toLowerCase()}. Review and adjust the grid, then submit for approval.`)}`);
}

/** Save grid edits: changes = { code: [12 natural cents] }. Optimistic lock on budgets.version. */
export async function saveBudgetLines(slug, budgetId, version, changes) {
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const loaded = await loadBudget(ws.id, budgetId);
  if (!loaded) return { error: "Budget not found." };
  if (loaded.budget.status !== "DRAFT") return { error: "Only draft budgets can be edited. Ask an approver to return it to draft." };
  const entries = Object.entries(changes || {});
  if (entries.length > 5000) return { error: "Too many changes in one save." };
  const stmts = [];
  for (const [code, row] of entries) {
    if (!/^[\w.\-/ ]{1,60}$/.test(code) || !Array.isArray(row) || row.length !== 12) return { error: `Invalid row for ${String(code).slice(0, 20)}.` };
    if (row.some((v) => !Number.isFinite(+v) || Math.abs(+v) > MAX_CELL)) return { error: `Invalid amount in ${code}.` };
    stmts.push({ sql: "DELETE FROM budget_lines WHERE budget_id = ? AND account_code = ?", args: [budgetId, code] });
    stmts.push(...lineStmts(budgetId, ws.id, new Map([[code, row.map((v) => Math.round(+v))]])));
  }
  // Version bump first inside the same batch: if someone else saved, the guard row fails the batch.
  try {
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE budgets SET version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ? AND version = ?", [db.now(), budgetId, ws.id, version]);
      if (!r.changes) throw new db.ConflictError();
      await tx.batch([...stmts, auditStmt(ws.id, user.id, "budget.lines_saved", "budget", budgetId, { accounts: entries.length })]);
    });
  } catch (e) {
    if (e.code === "CONFLICT") return { error: e.message, conflict: true };
    throw e;
  }
  return { ok: true, version: version + 1, savedAt: db.now() };
}

const TRANSITIONS = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", perm: "data.edit", verb: "submitted for approval" },
  approve: { from: ["SUBMITTED"], to: "APPROVED", perm: "approve", verb: "approved" },
  reject: { from: ["SUBMITTED", "APPROVED"], to: "DRAFT", perm: "approve", verb: "returned to draft" },
  lock: { from: ["APPROVED"], to: "LOCKED", perm: "approve", verb: "locked" },
  unlock: { from: ["LOCKED"], to: "APPROVED", perm: "owner", verb: "unlocked" },
};

export async function changeBudgetStatus(formData) {
  const slug = String(formData.get("slug")), id = String(formData.get("id")), action = String(formData.get("action"));
  const path = `/app/${slug}/budgets/${id}`;
  const tr = TRANSITIONS[action];
  if (!tr) back(path, { err: "Unknown action." });
  const { user, ws } = await requirePerm(slug, tr.perm);
  const b = await db.get("SELECT * FROM budgets WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!b || !tr.from.includes(b.status)) back(path, { err: "That change isn't allowed from the budget's current status." });
  if (action === "approve" && b.created_by === user.id && ws.role !== "OWNER") back(path, { err: "Segregation of duties: someone other than the preparer must approve this budget." });
  const note = String(formData.get("note") || "").slice(0, 500);
  const stmts = [
    { sql: `UPDATE budgets SET status = ?, version = version + 1, updated_at = ?${action === "approve" ? ", approved_by = ?, approved_at = ?" : ""} WHERE id = ? AND status = ?`, args: action === "approve" ? [tr.to, db.now(), user.id, db.now(), id, b.status] : [tr.to, db.now(), id, b.status] },
    auditStmt(ws.id, user.id, `budget.${action}`, "budget", id, { name: b.name, from: b.status, to: tr.to, note }),
  ];
  if (action === "submit") {
    const approvers = await db.all("SELECT user_id FROM memberships WHERE workspace_id = ? AND role IN ('OWNER','ADMIN') AND user_id <> ?", [ws.id, user.id]);
    for (const a of approvers) stmts.push(notifyStmt(ws.id, a.user_id, "budget.approval", `Budget “${b.name}” is waiting for your approval`, path));
  } else stmts.push(notifyStmt(ws.id, b.created_by, `budget.${action}`, `Budget “${b.name}” was ${tr.verb}${note ? `: ${note}` : ""}`, path));
  await db.batch(stmts.filter(Boolean));
  back(path, { ok: `Budget ${tr.verb}.` });
}

/** Save reforecast overrides and actual corrections (allowed at any status — it's the forecast, not the budget). */
export async function saveReforecast(slug, budgetId, version, { reforecast, actualOverrides, landingBasis }) {
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const loaded = await loadBudget(ws.id, budgetId);
  if (!loaded) return { error: "Budget not found." };
  const cleanR = {}, cleanA = {};
  for (const [k, v] of Object.entries(reforecast || {})) if (/^[\w.\-/ ]{1,60}\|(\d|1[01])$/.test(k) && Number.isFinite(+v) && Math.abs(+v) < MAX_CELL) cleanR[k] = Math.round(+v);
  for (const [k, v] of Object.entries(actualOverrides || {})) {
    if (!/^[\w.\-/ ]{1,60}\|(\d|1[01])$/.test(k) || !v || !Number.isFinite(+v.cents)) continue;
    const note = String(v.note || "").trim().slice(0, 300);
    if (!note) return { error: `Every change to an actual needs a note (${k.split("|")[0]}).` };
    cleanA[k] = { cents: Math.round(+v.cents), note, by: v.by || user.name, at: v.at || db.now() };
  }
  const assumptions = { ...loaded.budget.assumptions, reforecast: cleanR, actualOverrides: cleanA, landingBasis: landingBasis === "RUN_RATE" ? "RUN_RATE" : "BUDGET" };
  try {
    const v = await db.updateVersioned("budgets", budgetId, ws.id, version, { assumptions: JSON.stringify(assumptions), updated_at: db.now() });
    await db.batch([auditStmt(ws.id, user.id, "budget.reforecast_saved", "budget", budgetId, { forecastCells: Object.keys(cleanR).length, actualCorrections: Object.keys(cleanA).length })]);
    return { ok: true, version: v };
  } catch (e) {
    if (e.code === "CONFLICT") return { error: e.message, conflict: true };
    throw e;
  }
}

export async function addBudgetNote(formData) {
  const slug = String(formData.get("slug")), id = String(formData.get("id"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const back_ = `/app/${slug}/budgets/${id}?tab=bva&month=${encodeURIComponent(String(formData.get("period") || ""))}`;
  const b = await db.get("SELECT id, name FROM budgets WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!b) back(`/app/${slug}/budgets`, { err: "Budget not found." });
  const note = String(formData.get("note") || "").trim().slice(0, 2000);
  const action = String(formData.get("action") || "").trim().slice(0, 500) || null;
  const owner = String(formData.get("owner_id") || "") || null;
  const code = String(formData.get("account_code") || "").slice(0, 60);
  const period = String(formData.get("period") || "");
  if (!note || !code || !YM.test(period)) back(back_, { err: "Write an explanation for the variance." });
  if (owner && !(await db.get("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?", [ws.id, owner]))) back(back_, { err: "Choose an owner from the team." });
  const nid = db.id();
  await db.batch([
    { sql: "INSERT INTO budget_notes (id, budget_id, workspace_id, account_code, period, note, action, owner_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [nid, id, ws.id, code, period, note, action, owner, user.id, db.now()] },
    auditStmt(ws.id, user.id, "budget.variance_explained", "budget", id, { account: code, period, hasAction: !!action }),
    owner && owner !== user.id ? notifyStmt(ws.id, owner, "budget.action", `Variance action on ${code} (${period}): ${action || note}`.slice(0, 200), back_) : null,
  ].filter(Boolean));
  back(back_, { ok: "Explanation saved." });
}

export async function deleteBudget(formData) {
  const slug = String(formData.get("slug")), id = String(formData.get("id"));
  const { user, ws } = await requirePerm(slug, "admin");
  const b = await db.get("SELECT * FROM budgets WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!b) back(`/app/${slug}/budgets`, { err: "Budget not found." });
  if (["APPROVED", "LOCKED"].includes(b.status) && !can(ws.role, "owner")) back(`/app/${slug}/budgets/${id}`, { err: "Approved budgets can only be deleted by the owner." });
  await db.batch([
    { sql: "DELETE FROM budgets WHERE id = ? AND workspace_id = ?", args: [id, ws.id] },
    auditStmt(ws.id, user.id, "budget.deleted", "budget", id, { name: b.name, status: b.status }),
  ]);
  back(`/app/${slug}/budgets`, { ok: `Deleted “${b.name}”.` });
}

export async function copyBudget(formData) {
  const slug = String(formData.get("slug")), id = String(formData.get("id"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const b = await db.get("SELECT * FROM budgets WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!b) back(`/app/${slug}/budgets`, { err: "Budget not found." });
  const nid = db.id(), t = db.now();
  await db.batch([
    { sql: "INSERT INTO budgets (id, workspace_id, name, fy_start, status, method, assumptions, version, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", args: [nid, ws.id, `${b.name} (copy)`.slice(0, 100), b.fy_start, "DRAFT", b.method, b.assumptions, 1, user.id, t, t] },
    { sql: "INSERT INTO budget_lines (budget_id, workspace_id, account_code, month_idx, amount_cents) SELECT ?, workspace_id, account_code, month_idx, amount_cents FROM budget_lines WHERE budget_id = ?", args: [nid, id] },
    auditStmt(ws.id, user.id, "budget.copied", "budget", nid, { from: id }),
  ]);
  redirect(`/app/${slug}/budgets/${nid}?ok=${encodeURIComponent("Copied as a new draft.")}`);
}
