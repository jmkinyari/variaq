"use server";
import db from "@/lib/db";
import { requirePerm, auditStmt, notifyStmt, can } from "@/lib/auth";
import { back } from "@/lib/flash";
import { seal } from "@/lib/vault";
import { buildEvidence } from "@/lib/audit/evidence";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (fd, k, max = 200) => String(fd.get(k) || "").trim().slice(0, max);

export async function raiseQuery(formData) {
  const slug = str(formData, "slug");
  const { user, ws } = await requirePerm(slug, "query.raise");
  const path = `/app/${slug}/queries`;
  const title = str(formData, "title"), question = str(formData, "question", 8000);
  if (title.length < 4 || question.length < 10) back(path, { err: "Give the query a title and describe what you need (at least a sentence)." });
  const accountCode = str(formData, "account_code", 60) || null, journalNo = str(formData, "journal_no", 80) || null;
  const from = ISO.test(str(formData, "period_from")) ? str(formData, "period_from") : null, to = ISO.test(str(formData, "period_to")) ? str(formData, "period_to") : null;
  const due = ISO.test(str(formData, "due_date")) ? str(formData, "due_date") : null;
  const priority = ["LOW", "NORMAL", "HIGH"].includes(str(formData, "priority")) ? str(formData, "priority") : "NORMAL";
  const count = await db.get("SELECT COUNT(*) n FROM auditor_queries WHERE workspace_id = ?", [ws.id]);
  const ref = `Q-${new Date().getUTCFullYear()}-${String((count?.n || 0) + 1).padStart(3, "0")}`;
  const evidence = accountCode || journalNo ? await buildEvidence(ws, { accountCode, journalNo, from, to }) : null;
  const id = db.id(), t = db.now();
  const admins = await db.all("SELECT user_id FROM memberships WHERE workspace_id = ? AND role IN ('OWNER','ADMIN') AND user_id <> ?", [ws.id, user.id]);
  await db.batch([
    { sql: `INSERT INTO auditor_queries (id, workspace_id, ref, title, question, auditor_name, auditor_firm, account_code, journal_no, period_from, period_to, status, priority, due_date, evidence, raised_by, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?,?,?,?)`,
      args: [id, ws.id, ref, title, await seal(ws.id, "query.question", question), str(formData, "auditor_name", 100) || user.name, str(formData, "auditor_firm", 100) || null, accountCode, journalNo, from, to, priority, due, evidence ? await seal(ws.id, "query.evidence", evidence) : null, user.id, t, t] },
    ...admins.map((a) => notifyStmt(ws.id, a.user_id, "query.raised", `New auditor query ${ref}: ${title}`, `/app/${slug}/queries/${id}`)),
    auditStmt(ws.id, user.id, "query.raised", "auditor_query", id, { ref, title, accountCode, journalNo }),
  ]);
  back(`${path}/${id}`, { ok: `Query ${ref} raised.${evidence ? " An evidence pack was generated from the ledger." : ""}` });
}

async function load(formData, perm) {
  const slug = str(formData, "slug");
  const { user, ws } = await requirePerm(slug, perm);
  const q = await db.get("SELECT * FROM auditor_queries WHERE id = ? AND workspace_id = ?", [str(formData, "id", 60), ws.id]);
  if (!q) back(`/app/${slug}/queries`, { err: "Query not found." });
  return { user, ws, slug, q, path: `/app/${slug}/queries/${q.id}` };
}

export async function assignQuery(formData) {
  const { user, ws, slug, q, path } = await load(formData, "query.respond");
  const assignee = await db.get("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.id = ? AND m.role IN ('OWNER','ADMIN','MEMBER')", [ws.id, str(formData, "assignee_id", 60)]);
  if (!assignee) back(path, { err: "Choose a team member." });
  const t = db.now();
  const task = await db.get("SELECT id FROM close_tasks WHERE workspace_id = ? AND source_type = 'query' AND source_id = ?", [ws.id, q.id]);
  await db.batch([
    { sql: "UPDATE auditor_queries SET assignee_id = ?, status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END, updated_at = ? WHERE id = ?", args: [assignee.id, t, q.id] },
    task
      ? { sql: "UPDATE close_tasks SET assignee_id = ?, updated_at = ?, version = version + 1 WHERE id = ?", args: [assignee.id, t, task.id] }
      : { sql: "INSERT INTO close_tasks (id, workspace_id, period, title, category, status, assignee_id, due_date, sort_order, created_at, updated_at, priority, description, source_type, source_id) VALUES (?,?,?,?,?,'TODO',?,?,?,?,?,?,?,'query',?)",
        args: [db.id(), ws.id, t.slice(0, 7), `Auditor query ${q.ref}: ${q.title}`.slice(0, 200), "Audit queries", assignee.id, q.due_date, 9100, t, t, q.priority, `Respond to the auditor: /app/${slug}/queries/${q.id}`, q.id] },
    notifyStmt(ws.id, assignee.id, "query.assigned", `${user.name} assigned you auditor query ${q.ref}`, path),
    auditStmt(ws.id, user.id, "query.assigned", "auditor_query", q.id, { ref: q.ref, assignee: assignee.name }),
  ]);
  back(path, { ok: `Assigned to ${assignee.name}.` });
}

export async function respondQuery(formData) {
  const { user, ws, q, path } = await load(formData, "query.respond");
  const response = str(formData, "response", 12000);
  if (response.length < 10) back(path, { err: "Write the response to the auditor." });
  const points = [];
  for (let i = 0; i < 8; i++) {
    const text = str(formData, `ap_text_${i}`, 500);
    if (!text) continue;
    const due = str(formData, `ap_due_${i}`);
    points.push({ text, owner: str(formData, `ap_owner_${i}`, 60) || null, due: ISO.test(due) ? due : null, done: formData.get(`ap_done_${i}`) === "on" });
  }
  const t = db.now();
  await db.batch([
    { sql: "UPDATE auditor_queries SET response = ?, action_points = ?, status = 'RESPONDED', responded_by = ?, responded_at = ?, updated_at = ? WHERE id = ?", args: [await seal(ws.id, "query.response", response), JSON.stringify(points), user.id, t, t, q.id] },
    notifyStmt(ws.id, q.raised_by, "query.responded", `Response to ${q.ref}: ${q.title}`, path),
    auditStmt(ws.id, user.id, "query.responded", "auditor_query", q.id, { ref: q.ref, actionPoints: points.length }),
  ]);
  back(path, { ok: "Response saved and the auditor was notified." });
}

export async function setQueryStatus(formData) {
  const { user, ws, q, path } = await load(formData, "query.raise");
  const status = str(formData, "status");
  if (!["OPEN", "IN_PROGRESS", "CLOSED"].includes(status)) back(path, { err: "Unknown status." });
  // The auditor (or an admin) accepts the response by closing it; accountants move it to in-progress.
  if (status === "CLOSED" && !(user.id === q.raised_by || can(ws.role, "approve"))) back(path, { err: "Only the person who raised the query or an admin can close it." });
  if (status === "IN_PROGRESS" && !can(ws.role, "query.respond")) back(path, { err: "Only the finance team can start work on a query." });
  const t = db.now();
  await db.batch([
    { sql: "UPDATE auditor_queries SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?", args: [status, status === "CLOSED" ? t : null, t, q.id] },
    status === "CLOSED" ? { sql: "UPDATE close_tasks SET status = 'DONE', completed_at = ?, completed_by = ?, updated_at = ?, version = version + 1 WHERE workspace_id = ? AND source_type = 'query' AND source_id = ? AND status <> 'DONE'", args: [t, user.id, t, ws.id, q.id] } : null,
    status === "OPEN" && q.assignee_id ? notifyStmt(ws.id, q.assignee_id, "query.reopened", `Auditor query ${q.ref} was reopened`, path) : null,
    auditStmt(ws.id, user.id, "query.status_changed", "auditor_query", q.id, { ref: q.ref, from: q.status, to: status }),
  ].filter(Boolean));
  back(path, { ok: status === "CLOSED" ? "Query closed." : "Status updated." });
}

export async function refreshEvidence(formData) {
  const { user, ws, q, path } = await load(formData, "query.respond");
  if (!q.account_code && !q.journal_no) back(path, { err: "Add an account or journal to the query to build evidence." });
  const ev = await buildEvidence(ws, { accountCode: q.account_code, journalNo: q.journal_no, from: q.period_from, to: q.period_to });
  await db.batch([
    { sql: "UPDATE auditor_queries SET evidence = ?, updated_at = ? WHERE id = ?", args: [await seal(ws.id, "query.evidence", ev), db.now(), q.id] },
    auditStmt(ws.id, user.id, "query.evidence_refreshed", "auditor_query", q.id, { ref: q.ref }),
  ]);
  back(path, { ok: "Evidence pack rebuilt from the current ledger." });
}
