import Link from "next/link";
import { agentHref } from "@/lib/ai/deep-links";
import db from "@/lib/db";
import { requireWorkspace, canEdit, can } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { StatusBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/dates";
import { STATUSES, PRIORITIES } from "../tasks/logic";
import { createPeriod, addTask, updateTask, deleteTask, signOffPeriod, reopenPeriod } from "./actions";
import "@/styles/platform.css";
export const metadata = { title: "Month-end close" };

export default async function ClosePage({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const periods = await db.all("SELECT period, COUNT(*) n, SUM(status = 'DONE') done FROM close_tasks WHERE workspace_id = ? GROUP BY period ORDER BY period DESC", [ws.id]);
  const period = /^\d{4}-\d{2}$/.test(searchParams.period || "") ? searchParams.period : periods[0]?.period || new Date().toISOString().slice(0, 7);
  const [tasks, members, signoff, lock] = await Promise.all([
    db.all(`SELECT t.*, d.title dep_title, d.status dep_status, (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) comments
            FROM close_tasks t LEFT JOIN close_tasks d ON d.id = t.depends_on WHERE t.workspace_id = ? AND t.period = ? ORDER BY t.sort_order, t.created_at`, [ws.id, period]),
    db.all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name", [ws.id]),
    db.get("SELECT s.*, u.name FROM close_signoffs s LEFT JOIN users u ON u.id = s.approved_by WHERE s.workspace_id = ? AND s.period = ?", [ws.id, period]),
    db.get("SELECT * FROM period_locks WHERE workspace_id = ? AND period = ?", [ws.id, period]),
  ]);
  const edit = canEdit(ws.role);
  const done = tasks.filter((t) => t.status === "DONE").length;
  const cats = [...new Set(tasks.map((t) => t.category))];
  const today = new Date().toISOString().slice(0, 10);
  const base = `/app/${ws.slug}`;
  const H = ({ t }) => <><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="period" value={period} />{t && <><input type="hidden" name="id" value={t.id} /><input type="hidden" name="version" value={t.version} /></>}</>;
  const mine = tasks.filter((t) => t.assignee_id === user.id && t.status !== "DONE").length;
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today && t.status !== "DONE").length;
  return (
    <>
      <PageHead title="Month-end close" desc="A shared checklist with owners, reviewers, dependencies and due dates, signed off by an approver.">
        <form className="row"><select name="period" defaultValue={period} style={{ width: "auto" }}>{periods.map((p) => <option key={p.period} value={p.period}>{p.period} ({p.done || 0}/{p.n})</option>)}{!periods.some((p) => p.period === period) && <option value={period}>{period}</option>}</select><button className="btn">View</button></form>
        <Link href={`${base}/tasks?view=board&period=${period}`} className="btn">Board view</Link>
        <Link href={agentHref(ws.slug, "month-end-close", { period })} className="btn ghost ai-ask-link">Ask Month-End Close</Link>
      </PageHead>
      <Flash searchParams={searchParams} />
      {tasks.length > 0 ? <>
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="row between"><strong>{period}: {done} of {tasks.length} tasks done</strong>
            <span className="muted small">{mine ? `${mine} assigned to you · ` : ""}{overdue ? `${overdue} overdue · ` : ""}{lock ? <span className="badge info">Period locked</span> : <span className="badge">Period open</span>}</span></div>
          <div className="progress" style={{ marginTop: ".6rem" }}><span style={{ width: `${(done / tasks.length) * 100}%` }} /></div>
          {signoff ? <div className="row between" style={{ marginTop: ".8rem" }}><span className="badge good">Signed off by {signoff.name} · {formatDateTime(signoff.approved_at)}</span>{signoff.note && <span className="small muted">“{signoff.note}”</span>}
              {can(ws.role, "approve") && <form action={reopenPeriod}><H /><Submit className="btn sm ghost" confirm="Withdraw the sign-off for this period?">Withdraw sign-off</Submit></form>}</div>
            : can(ws.role, "approve") && <form action={signOffPeriod} className="row" style={{ marginTop: ".8rem", alignItems: "end" }}><H />
              <div style={{ flex: 1, minWidth: 200 }}><label>Approver sign-off note</label><input name="note" placeholder="Reviewed TB, recs and flux; no open items." /></div>
              <label className="row small" style={{ fontWeight: 400, gap: 6 }}><input type="checkbox" name="lock" defaultChecked style={{ width: "auto" }} /> Lock the period</label>
              <Submit disabled={done !== tasks.length} confirm={`Sign off ${period}?`}>Sign off {period}</Submit></form>}
        </div>
        {cats.map((c) => (
          <div key={c} style={{ marginBottom: "1.2rem" }}>
            <h3>{c}</h3>
            <div className="table-wrap"><table>
              <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Owner</th><th>Reviewer</th><th>Due</th>{edit && <th></th>}</tr></thead>
              <tbody>{tasks.filter((t) => t.category === c).map((t) => {
                const blocked = t.depends_on && t.dep_status !== "DONE" && t.status !== "DONE";
                return (
                <tr key={t.id} className={`prio-${t.priority}`}>
                  <td className="wrap" style={{ textDecoration: t.status === "DONE" ? "line-through" : undefined, color: t.status === "DONE" ? "var(--text-3)" : undefined }}>
                    <Link href={`${base}/tasks/${t.id}`} style={{ color: "inherit" }}>{t.title}</Link>
                    {t.due_date && t.due_date < today && t.status !== "DONE" && <span className="badge bad" style={{ marginLeft: 6 }}>Overdue</span>}
                    {blocked && <span className="badge warn" style={{ marginLeft: 6 }} title={`Waiting for: ${t.dep_title}`}>Blocked</span>}
                    {t.comments > 0 && <span className="faint small" style={{ marginLeft: 6 }}>💬 {t.comments}</span>}
                    {t.dep_title && <div className="faint small">after: {t.dep_title}</div>}
                  </td>
                  {edit ? (
                    <td colSpan={5}>
                      <form action={updateTask} className="row" style={{ flexWrap: "nowrap" }}>
                        <H t={t} />
                        <select name="status" defaultValue={t.status} style={{ minWidth: 115 }}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                        <select name="priority" defaultValue={t.priority} style={{ minWidth: 90 }}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                        <select name="assignee_id" defaultValue={t.assignee_id || ""} style={{ minWidth: 115 }}><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                        <select name="reviewer_id" defaultValue={t.reviewer_id || ""} style={{ minWidth: 115 }}><option value="">No reviewer</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                        <input type="date" name="due_date" defaultValue={t.due_date || ""} style={{ minWidth: 135 }} />
                        <Submit className="btn sm" pendingText="…">Save</Submit>
                      </form>
                    </td>
                  ) : <>
                    <td><StatusBadge status={t.status} /></td>
                    <td>{t.priority.toLowerCase()}</td>
                    <td>{members.find((m) => m.id === t.assignee_id)?.name || "—"}</td>
                    <td>{members.find((m) => m.id === t.reviewer_id)?.name || "—"}</td>
                    <td>{t.due_date || "—"}</td>
                  </>}
                  {edit && <td className="num"><form action={deleteTask}><H t={t} /><Submit className="btn sm ghost" confirm={`Remove “${t.title}”?`}>Remove</Submit></form></td>}
                </tr>); })}</tbody>
            </table></div>
          </div>))}
        {edit && <form action={addTask} className="card row" style={{ alignItems: "end" }}>
          <H />
          <div style={{ flex: 2, minWidth: 220 }}><label>New task</label><input name="title" required placeholder="e.g. Reconcile Equity USD account" /></div>
          <div style={{ flex: 1, minWidth: 140 }}><label>Category</label><input name="category" list="cats" defaultValue="General" /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div><label>Priority</label><select name="priority" defaultValue="NORMAL">{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label>Owner</label><select name="assignee_id" defaultValue=""><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label>Due</label><input type="date" name="due_date" /></div>
          <Submit>Add task</Submit>
        </form>}
      </> : (
        <div className="card empty">
          <h3>No checklist for {period}</h3>
          <p>Start one from the previous month's tasks (or the default template).</p>
          {edit && <form action={createPeriod} className="row" style={{ justifyContent: "center" }}><input type="hidden" name="slug" value={ws.slug} /><input type="month" name="period" defaultValue={period} style={{ width: "auto" }} /><Submit>Create checklist</Submit></form>}
        </div>
      )}
      {edit && tasks.length > 0 && (
        <form action={createPeriod} className="row" style={{ marginTop: "1.5rem" }}><input type="hidden" name="slug" value={ws.slug} /><span className="muted small">Start another month:</span><input type="month" name="period" style={{ width: "auto" }} required /><Submit className="btn sm">Create checklist</Submit></form>
      )}
    </>
  );
}
