// Task rules shared by the close checklist and the task board: status transitions, dependencies,
// reviewer sign-off, optimistic locking and assignment notifications.
import "server-only";
import db from "@/lib/db";
import { auditStmt, notifyStmt } from "@/lib/auth";

export const STATUSES = [["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["IN_REVIEW", "In review"], ["DONE", "Done"]];
export const PRIORITIES = [["LOW", "Low"], ["NORMAL", "Normal"], ["HIGH", "High"], ["URGENT", "Urgent"]];
const STATUS_SET = new Set(STATUSES.map((s) => s[0]));
const PRIO_SET = new Set(PRIORITIES.map((s) => s[0]));

/**
 * Validate and save changes to a task. Throws Error with a user-facing message.
 * `changes` may contain status, priority, assignee_id, reviewer_id, due_date, depends_on, description, title, category.
 */
export async function updateTask({ ws, user, task, changes, expectedVersion }) {
  const next = { ...task, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) };
  if (!STATUS_SET.has(next.status)) throw new Error("Unknown status.");
  if (!PRIO_SET.has(next.priority || "NORMAL")) throw new Error("Unknown priority.");
  const members = new Set((await db.all("SELECT user_id FROM memberships WHERE workspace_id = ?", [ws.id])).map((m) => m.user_id));
  for (const k of ["assignee_id", "reviewer_id"]) if (next[k] && !members.has(next[k])) throw new Error("Assignees and reviewers must be members of this workspace.");
  if (next.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(next.due_date)) throw new Error("Due date must be a date.");
  if (next.depends_on) {
    if (next.depends_on === task.id) throw new Error("A task can't depend on itself.");
    const dep = await db.get("SELECT id, title, status, depends_on FROM close_tasks WHERE id = ? AND workspace_id = ?", [next.depends_on, ws.id]);
    if (!dep) throw new Error("The task it depends on doesn't exist.");
    if (dep.depends_on === task.id) throw new Error("That would create a circular dependency.");
    if (next.status !== "TODO" && dep.status !== "DONE" && next.status !== task.status) throw new Error(`Blocked: “${dep.title}” must be done first.`);
  }
  if (next.status !== task.status) {
    if (next.status === "DONE" && task.reviewer_id && task.reviewer_id !== user.id && task.status !== "IN_REVIEW") throw new Error("This task has a reviewer — send it for review first; the reviewer marks it done.");
    if (next.status === "DONE" && task.reviewer_id && task.reviewer_id !== user.id && task.status === "IN_REVIEW") throw new Error("Only the reviewer can mark a task in review as done.");
    if (next.status === "DONE" && task.assignee_id === user.id && task.reviewer_id === user.id) { /* self-review allowed when explicitly set as both */ }
  }
  const t = db.now();
  const completed = next.status === "DONE" ? (task.status === "DONE" ? [task.completed_at, task.completed_by] : [t, user.id]) : [null, null];
  const fields = {
    title: String(next.title).slice(0, 200), category: String(next.category || "General").slice(0, 40), status: next.status, priority: next.priority || "NORMAL",
    assignee_id: next.assignee_id || null, reviewer_id: next.reviewer_id || null, due_date: next.due_date || null, depends_on: next.depends_on || null,
    description: next.description ? String(next.description).slice(0, 4000) : null, completed_at: completed[0], completed_by: completed[1], updated_at: t,
  };
  await db.updateVersioned("close_tasks", task.id, ws.id, expectedVersion ?? task.version, fields);
  const link = `/app/${ws.slug}/tasks/${task.id}`;
  const diff = {};
  for (const k of ["status", "priority", "assignee_id", "reviewer_id", "due_date", "depends_on"]) if ((task[k] || null) !== (fields[k] || null)) diff[k] = `${task[k] || "—"} → ${fields[k] || "—"}`;
  const stmts = [auditStmt(ws.id, user.id, "task.updated", "close_task", task.id, { title: task.title, ...diff })];
  if (fields.assignee_id && fields.assignee_id !== task.assignee_id && fields.assignee_id !== user.id) stmts.push(notifyStmt(ws.id, fields.assignee_id, "task.assigned", `${user.name} assigned you: ${fields.title}`, link));
  if (fields.reviewer_id && fields.reviewer_id !== task.reviewer_id && fields.reviewer_id !== user.id) stmts.push(notifyStmt(ws.id, fields.reviewer_id, "task.reviewer", `You're the reviewer for: ${fields.title}`, link));
  if (fields.status === "IN_REVIEW" && task.status !== "IN_REVIEW" && fields.reviewer_id && fields.reviewer_id !== user.id) stmts.push(notifyStmt(ws.id, fields.reviewer_id, "task.review", `Ready for your review: ${fields.title}`, link));
  if (fields.status === "DONE" && task.status !== "DONE" && fields.assignee_id && fields.assignee_id !== user.id) stmts.push(notifyStmt(ws.id, fields.assignee_id, "task.done", `Signed off: ${fields.title}`, link));
  await db.batch(stmts);
}

export async function createTask({ ws, user, period, title, category, priority, assignee_id, reviewer_id, due_date, description, source_type, source_id }) {
  if (!/^\d{4}-\d{2}$/.test(period || "")) throw new Error("Choose a period (month).");
  if (!String(title || "").trim()) throw new Error("Give the task a title.");
  const max = await db.get("SELECT MAX(sort_order) m FROM close_tasks WHERE workspace_id = ? AND period = ?", [ws.id, period]);
  const id = db.id(), t = db.now();
  const stmts = [
    { sql: "INSERT INTO close_tasks (id, workspace_id, period, title, category, priority, assignee_id, reviewer_id, due_date, description, source_type, source_id, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, ws.id, period, String(title).trim().slice(0, 200), String(category || "General").slice(0, 40), PRIO_SET.has(priority) ? priority : "NORMAL", assignee_id || null, reviewer_id || null, due_date || null, description ? String(description).slice(0, 4000) : null, source_type || null, source_id || null, (max?.m ?? 0) + 1, t, t] },
    auditStmt(ws.id, user.id, "task.created", "close_task", id, { period, title, source_type }),
  ];
  if (assignee_id && assignee_id !== user.id) stmts.push(notifyStmt(ws.id, assignee_id, "task.assigned", `${user.name} assigned you: ${title}`, `/app/${ws.slug}/tasks/${id}`));
  await db.batch(stmts);
  return id;
}
