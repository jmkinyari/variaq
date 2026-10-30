"use server";
import db from "@/lib/db";
import { requireWorkspace, requirePerm, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { CLOSE_TEMPLATE } from "@/lib/templates";
import { updateTask as applyUpdate, createTask } from "../tasks/logic";

const PERIOD = /^\d{4}-\d{2}$/;
async function ctx(formData, perm) {
  const slug = String(formData.get("slug"));
  const { user, ws } = perm ? await requirePerm(slug, perm) : await requireWorkspace(slug, "MEMBER");
  const period = String(formData.get("period") || "");
  return { user, ws, slug, period, path: `/app/${slug}/close?period=${period}` };
}

export async function createPeriod(formData) {
  const { user, ws, slug, period, path } = await ctx(formData);
  if (!PERIOD.test(period)) back(`/app/${slug}/close`, { err: "Choose a month." });
  const exists = await db.get("SELECT COUNT(*) n FROM close_tasks WHERE workspace_id = ? AND period = ?", [ws.id, period]);
  if (exists.n) back(path, { err: "That month already has a checklist." });
  // Copy the most recent period's task list (owners, reviewers, priorities, dependencies), or the default template.
  const last = await db.get("SELECT period FROM close_tasks WHERE workspace_id = ? ORDER BY period DESC LIMIT 1", [ws.id]);
  const tasks = last ? await db.all("SELECT id, title, category, assignee_id, reviewer_id, priority, description, depends_on, due_date FROM close_tasks WHERE workspace_id = ? AND period = ? AND source_type IS NULL ORDER BY sort_order", [ws.id, last.period])
    : CLOSE_TEMPLATE.map(([category, title]) => ({ title, category }));
  const t = db.now();
  const newIds = new Map(tasks.map((k) => [k.id, db.id()]));
  // Shift due dates by the number of months between periods, keeping the day of month.
  const shift = (d) => {
    if (!d || !last) return null;
    const [ly, lm] = last.period.split("-").map(Number), [py, pm] = period.split("-").map(Number);
    const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + (py - ly) * 12 + (pm - lm), +d.slice(8, 10)));
    return dt.toISOString().slice(0, 10);
  };
  await db.batch([
    ...tasks.map((k, i) => ({ sql: "INSERT INTO close_tasks (id, workspace_id, period, title, category, assignee_id, reviewer_id, priority, description, depends_on, due_date, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [k.id ? newIds.get(k.id) : db.id(), ws.id, period, k.title, k.category, k.assignee_id || null, k.reviewer_id || null, k.priority || "NORMAL", k.description || null, k.depends_on ? newIds.get(k.depends_on) || null : null, shift(k.due_date), i, t, t] })),
    auditStmt(ws.id, user.id, "close.period_created", "close", period, { tasks: tasks.length, copiedFrom: last?.period || "template" }),
  ]);
  back(path, { ok: `Created the ${period} checklist with ${tasks.length} tasks${last ? ` copied from ${last.period} (owners, reviewers, dependencies and due dates carried forward)` : ""}.` });
}

export async function addTask(formData) {
  const { user, ws, period, path } = await ctx(formData);
  let err = null;
  try { await createTask({ ws, user, period, title: formData.get("title"), category: formData.get("category"), priority: formData.get("priority") || "NORMAL", assignee_id: formData.get("assignee_id") || null, due_date: formData.get("due_date") || null }); }
  catch (e) { err = e.message; }
  back(path, err ? { err } : {});
}

export async function updateTask(formData) {
  const { user, ws, path } = await ctx(formData);
  const id = String(formData.get("id"));
  const task = await db.get("SELECT * FROM close_tasks WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!task) back(path, { err: "Task not found." });
  const v = (k) => { const x = formData.get(k); return x === null ? undefined : String(x); };
  let err = null;
  try { await applyUpdate({ ws, user, task, expectedVersion: Number(formData.get("version")) || task.version, changes: { status: v("status"), assignee_id: v("assignee_id"), reviewer_id: v("reviewer_id"), due_date: v("due_date"), priority: v("priority") } }); }
  catch (e) { err = e.message; }
  back(path, err ? { err } : {});
}

export async function deleteTask(formData) {
  const { user, ws, path } = await ctx(formData);
  const id = String(formData.get("id"));
  const task = await db.get("SELECT title FROM close_tasks WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  await db.batch([
    { sql: "UPDATE close_tasks SET depends_on = NULL WHERE workspace_id = ? AND depends_on = ?", args: [ws.id, id] },
    { sql: "DELETE FROM task_comments WHERE workspace_id = ? AND task_id = ?", args: [ws.id, id] },
    { sql: "DELETE FROM close_tasks WHERE id = ? AND workspace_id = ?", args: [id, ws.id] },
    auditStmt(ws.id, user.id, "close.task_deleted", "close_task", id, { title: task?.title }),
  ]);
  back(path);
}

/** Approver sign-off of the whole period: every task must be done. Optionally locks the period. */
export async function signOffPeriod(formData) {
  const { user, ws, period, path } = await ctx(formData, "approve");
  if (!PERIOD.test(period)) back(path, { err: "Choose a month." });
  const open = await db.get("SELECT COUNT(*) n FROM close_tasks WHERE workspace_id = ? AND period = ? AND status <> 'DONE'", [ws.id, period]);
  if (open.n) back(path, { err: `${open.n} task(s) are still open. Every task must be done before sign-off.` });
  const note = String(formData.get("note") || "").slice(0, 1000) || null;
  const lock = formData.get("lock") === "on";
  const t = db.now();
  await db.batch([
    { sql: "INSERT INTO close_signoffs (workspace_id, period, approved_by, approved_at, note) VALUES (?,?,?,?,?) ON CONFLICT(workspace_id, period) DO UPDATE SET approved_by = excluded.approved_by, approved_at = excluded.approved_at, note = excluded.note", args: [ws.id, period, user.id, t, note] },
    ...(lock ? [{ sql: "INSERT OR IGNORE INTO period_locks (workspace_id, period, locked_by, locked_at, note) VALUES (?,?,?,?,?)", args: [ws.id, period, user.id, t, "Locked at close sign-off"] }] : []),
    auditStmt(ws.id, user.id, "close.period_signed_off", "close", period, { locked: lock, note }),
    ...(lock ? [auditStmt(ws.id, user.id, "period.locked", "period", period, { via: "close sign-off" })] : []),
  ]);
  back(path, { ok: `${period} signed off${lock ? " and locked — imports, syncs and API pushes into it are now rejected" : ""}.` });
}

export async function reopenPeriod(formData) {
  const { user, ws, period, path } = await ctx(formData, "approve");
  await db.batch([
    { sql: "DELETE FROM close_signoffs WHERE workspace_id = ? AND period = ?", args: [ws.id, period] },
    auditStmt(ws.id, user.id, "close.period_reopened", "close", period, {}),
  ]);
  back(path, { ok: `${period} sign-off withdrawn. Unlock the period in Settings if postings are needed.` });
}
