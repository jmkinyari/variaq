"use server";
import db from "@/lib/db";
import { requireWorkspace, auditStmt, notifyStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { updateTask, createTask } from "./logic";

const val = (fd, k) => { const v = fd.get(k); return v === null ? undefined : String(v); };

export async function saveTask(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const id = String(formData.get("id"));
  const returnTo = String(formData.get("return") || `/app/${slug}/tasks/${id}`);
  const safeReturn = returnTo.startsWith(`/app/${slug}/`) ? returnTo : `/app/${slug}/tasks`;
  const task = await db.get("SELECT * FROM close_tasks WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!task) back(`/app/${slug}/tasks`, { err: "Task not found." });
  let err = null;
  try {
    await updateTask({ ws, user, task, expectedVersion: Number(formData.get("version")) || task.version, changes: {
      status: val(formData, "status"), priority: val(formData, "priority"), assignee_id: val(formData, "assignee_id"), reviewer_id: val(formData, "reviewer_id"),
      due_date: val(formData, "due_date"), depends_on: val(formData, "depends_on"), description: val(formData, "description"), title: val(formData, "title"),
    } });
  } catch (e) { err = e.message; }
  back(safeReturn, err ? { err } : { ok: "Saved." });
}

export async function newTask(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  let id = null, err = null;
  try {
    id = await createTask({ ws, user, period: String(formData.get("period") || ""), title: val(formData, "title"), category: val(formData, "category"), priority: val(formData, "priority"),
      assignee_id: val(formData, "assignee_id") || null, reviewer_id: val(formData, "reviewer_id") || null, due_date: val(formData, "due_date") || null, description: val(formData, "description"),
      source_type: val(formData, "source_type") || null, source_id: val(formData, "source_id") || null });
  } catch (e) { err = e.message; }
  if (err) back(`/app/${slug}/tasks`, { err });
  back(`/app/${slug}/tasks/${id}`, { ok: "Task created." });
}

export async function addComment(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const id = String(formData.get("id"));
  const body = String(formData.get("body") || "").trim().slice(0, 4000);
  const task = await db.get("SELECT * FROM close_tasks WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!task) back(`/app/${slug}/tasks`, { err: "Task not found." });
  if (!body) back(`/app/${slug}/tasks/${id}`, { err: "Write a comment first." });
  const link = `/app/${slug}/tasks/${id}`;
  const notifyIds = [...new Set([task.assignee_id, task.reviewer_id].filter((u) => u && u !== user.id))];
  await db.batch([
    { sql: "INSERT INTO task_comments (id, workspace_id, task_id, user_id, body, created_at) VALUES (?,?,?,?,?,?)", args: [db.id(), ws.id, id, user.id, body, db.now()] },
    auditStmt(ws.id, user.id, "task.commented", "close_task", id, { title: task.title }),
    ...notifyIds.map((u) => notifyStmt(ws.id, u, "task.comment", `${user.name} commented on: ${task.title}`, link)),
  ]);
  back(link);
}

export async function markAllRead(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug);
  await db.run("UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND user_id = ? AND read_at IS NULL", [db.now(), ws.id, user.id]);
  back(`/app/${slug}/tasks?view=mine`);
}
