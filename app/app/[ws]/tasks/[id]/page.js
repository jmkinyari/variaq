import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { StatusBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/dates";
import { STATUSES, PRIORITIES } from "../logic";
import { saveTask, addComment } from "../actions";
import "@/styles/platform.css";
export const metadata = { title: "Task" };

const SOURCE_LINKS = { audit_finding: (b, id) => `${b}/journal-audit?finding=${id}`, auditor_query: (b, id) => `${b}/queries/${id}`, variance: (b, id) => `${b}/reports/${id}`, tax_recon: (b) => `${b}/tax/vat` };

export default async function TaskPage({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const task = await db.get("SELECT t.*, c.name completed_name FROM close_tasks t LEFT JOIN users c ON c.id = t.completed_by WHERE t.id = ? AND t.workspace_id = ?", [params.id, ws.id]);
  if (!task) notFound();
  const base = `/app/${ws.slug}`;
  const [members, comments, activity, siblings, dependents] = await Promise.all([
    db.all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name", [ws.id]),
    db.all("SELECT c.*, u.name FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ? AND c.workspace_id = ? ORDER BY c.created_at", [task.id, ws.id]),
    db.all("SELECT a.*, u.name FROM audit_events a LEFT JOIN users u ON u.id = a.user_id WHERE a.workspace_id = ? AND a.entity_type = 'close_task' AND a.entity_id = ? ORDER BY a.created_at DESC LIMIT 50", [ws.id, task.id]),
    db.all("SELECT id, title, status FROM close_tasks WHERE workspace_id = ? AND period = ? AND id <> ? ORDER BY sort_order", [ws.id, task.period, task.id]),
    db.all("SELECT id, title, status FROM close_tasks WHERE workspace_id = ? AND depends_on = ?", [ws.id, task.id]),
  ]);
  // Opening the task clears its notifications for this user.
  await db.run("UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND user_id = ? AND link = ? AND read_at IS NULL", [db.now(), ws.id, user.id, `${base}/tasks/${task.id}`]);
  const dep = siblings.find((s) => s.id === task.depends_on);
  const edit = canEdit(ws.role);
  const today = new Date().toISOString().slice(0, 10);
  const H = () => <><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={task.id} /><input type="hidden" name="version" value={task.version} /></>;
  return (
    <>
      <PageHead title={task.title} crumbs={<><Link href={`${base}/tasks`}>Tasks</Link> · <Link href={`${base}/close?period=${task.period}`}>{task.period} close</Link></>}
        desc={`${task.category} · created ${formatDateTime(task.created_at)}`}>
        <StatusBadge status={task.status} />
      </PageHead>
      <Flash searchParams={searchParams} />
      {dep && dep.status !== "DONE" && task.status !== "DONE" && <div className="alert warn">Blocked by <Link href={`${base}/tasks/${dep.id}`}>{dep.title}</Link> — it must be done before this task can progress.</div>}
      {task.due_date && task.due_date < today && task.status !== "DONE" && <div className="alert error">Overdue since {task.due_date}.</div>}
      {task.status === "DONE" && <div className="alert success">Completed {task.completed_at ? formatDateTime(task.completed_at) : ""}{task.completed_name ? ` by ${task.completed_name}` : ""}.</div>}
      {task.source_type && SOURCE_LINKS[task.source_type] && <p className="small">Linked to {task.source_type.replace(/_/g, " ")}: <Link href={SOURCE_LINKS[task.source_type](base, task.source_id)}>open</Link></p>}

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <form action={saveTask} className="card stack">
          <H />
          <div className="field"><label>Title</label><input name="title" defaultValue={task.title} disabled={!edit} maxLength={200} /></div>
          <div className="form-row">
            <div><label>Status</label><select name="status" defaultValue={task.status} disabled={!edit}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label>Priority</label><select name="priority" defaultValue={task.priority} disabled={!edit}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label>Due</label><input type="date" name="due_date" defaultValue={task.due_date || ""} disabled={!edit} /></div>
          </div>
          <div className="form-row">
            <div><label>Owner</label><select name="assignee_id" defaultValue={task.assignee_id || ""} disabled={!edit}><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            <div><label>Reviewer</label><select name="reviewer_id" defaultValue={task.reviewer_id || ""} disabled={!edit}><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          </div>
          <div className="field"><label>Depends on</label><select name="depends_on" defaultValue={task.depends_on || ""} disabled={!edit}><option value="">Nothing</option>{siblings.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.status.toLowerCase().replace("_", " ")})</option>)}</select></div>
          <div className="field"><label>Description / evidence required</label><textarea name="description" rows={5} defaultValue={task.description || ""} disabled={!edit} maxLength={4000} /></div>
          {edit && <div><Submit>Save</Submit> <span className="faint small">Version {task.version} — if someone else saves first you'll be asked to reload.</span></div>}
          {dependents.length > 0 && <p className="small muted" style={{ margin: 0 }}>Blocks: {dependents.map((d) => <Link key={d.id} href={`${base}/tasks/${d.id}`} style={{ marginRight: 8 }}>{d.title}</Link>)}</p>}
        </form>

        <div className="stack">
          <div className="card">
            <h3>Comments</h3>
            {comments.length === 0 && <p className="muted small">No comments yet.</p>}
            {comments.map((c) => <div key={c.id} className="comment"><div className="small"><strong>{c.name}</strong> <span className="faint">{formatDateTime(c.created_at)}</span></div><div className="wrap" style={{ whiteSpace: "pre-wrap" }}>{c.body}</div></div>)}
            {edit && <form action={addComment} className="stack"><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={task.id} />
              <textarea name="body" rows={3} required maxLength={4000} placeholder="Progress, evidence location, questions for the reviewer…" /><div><Submit className="btn sm primary">Comment</Submit></div></form>}
          </div>
          <div className="card">
            <h3>Activity</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: "1.1rem" }}>{activity.map((a) => { let d = {}; try { d = JSON.parse(a.detail); } catch {} return (
              <li key={a.id}><span className="faint">{formatDateTime(a.created_at)}</span> {a.name || "System"} — {a.action.replace(/^(task|close)\./, "").replace(/_/g, " ")}{Object.entries(d).filter(([k]) => k !== "title").map(([k, v]) => ` · ${k}: ${v}`).join("")}</li>); })}</ul>
          </div>
        </div>
      </div>
    </>
  );
}
