import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { StatusBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/dates";
import { STATUSES, PRIORITIES } from "./logic";
import { newTask, markAllRead } from "./actions";
import "@/styles/platform.css";
export const metadata = { title: "Tasks & workload" };

const VIEWS = [["mine", "My work"], ["team", "Team workload"], ["board", "Board"]];
const PRIO_BADGE = { URGENT: "bad", HIGH: "warn", NORMAL: "", LOW: "" };

export default async function TasksPage({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const view = VIEWS.some(([v]) => v === searchParams.view) ? searchParams.view : "team";
  const today = new Date().toISOString().slice(0, 10);
  const periods = await db.all("SELECT period, COUNT(*) n, SUM(status = 'DONE') done FROM close_tasks WHERE workspace_id = ? GROUP BY period ORDER BY period DESC LIMIT 24", [ws.id]);
  const period = /^\d{4}-\d{2}$/.test(searchParams.period || "") ? searchParams.period : periods[0]?.period || today.slice(0, 7);
  const where = ["t.workspace_id = ?"], args = [ws.id];
  if (view !== "mine") { where.push("t.period = ?"); args.push(period); }
  if (searchParams.assignee) { where.push("t.assignee_id = ?"); args.push(searchParams.assignee); }
  if (searchParams.priority) { where.push("t.priority = ?"); args.push(searchParams.priority); }
  if (searchParams.status) { where.push("t.status = ?"); args.push(searchParams.status); }
  const [tasks, members, notes, findings, queries] = await Promise.all([
    db.all(`SELECT t.*, a.name assignee_name, r.name reviewer_name, d.title dep_title, d.status dep_status, (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) comments
            FROM close_tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users r ON r.id = t.reviewer_id LEFT JOIN close_tasks d ON d.id = t.depends_on
            WHERE ${where.join(" AND ")} ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, COALESCE(t.due_date, '9999'), t.sort_order LIMIT 2000`, args),
    db.all("SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name", [ws.id]),
    db.all("SELECT * FROM notifications WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 15", [ws.id, user.id]),
    db.all("SELECT f.id, f.title, f.severity, f.status, f.assignee_id, f.rule, f.last_seen_at FROM audit_findings f WHERE f.workspace_id = ? AND f.assignee_id IS NOT NULL AND f.status = 'OPEN' ORDER BY f.last_seen_at DESC LIMIT 500", [ws.id]).catch(() => []),
    db.all("SELECT q.id, q.ref, q.title, q.status, q.assignee_id, q.due_date FROM auditor_queries q WHERE q.workspace_id = ? AND q.assignee_id IS NOT NULL AND q.status NOT IN ('CLOSED') ORDER BY COALESCE(q.due_date,'9999') LIMIT 500", [ws.id]).catch(() => []),
  ]);
  const base = `/app/${ws.slug}`;
  const overdue = (t) => t.due_date && t.due_date < today && t.status !== "DONE";
  const blocked = (t) => t.depends_on && t.dep_status !== "DONE" && t.status !== "DONE";
  const qs = (o) => "?" + new URLSearchParams(Object.fromEntries(Object.entries({ view, period, ...o }).filter(([, v]) => v))).toString();
  const done = tasks.filter((t) => t.status === "DONE").length;

  return (
    <>
      <PageHead title="Tasks & workload" desc="Every close task, audit finding and auditor query in one place — who owns it, what's blocked and what's overdue.">
        <div className="seg">{VIEWS.map(([v, l]) => <Link key={v} href={qs({ view: v })} className={`btn sm ${view === v ? "primary" : ""}`}>{l}</Link>)}</div>
      </PageHead>
      <Flash searchParams={searchParams} />

      {view !== "mine" && <form className="card row" style={{ marginBottom: "1rem", alignItems: "end" }}>
        <input type="hidden" name="view" value={view} />
        <div><label>Period</label><select name="period" defaultValue={period}>{periods.map((p) => <option key={p.period} value={p.period}>{p.period} ({p.done || 0}/{p.n})</option>)}{!periods.some((p) => p.period === period) && <option value={period}>{period}</option>}</select></div>
        <div><label>Owner</label><select name="assignee" defaultValue={searchParams.assignee || ""}><option value="">Everyone</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <div><label>Priority</label><select name="priority" defaultValue={searchParams.priority || ""}><option value="">Any</option>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        {view !== "board" && <div><label>Status</label><select name="status" defaultValue={searchParams.status || ""}><option value="">Any</option>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>}
        <button className="btn">Apply</button>
      </form>}

      {view === "mine" && <MyWork {...{ ws, user, tasks, findings, queries, notes, base, today, overdue, blocked }} />}

      {view === "team" && <>
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="row between"><strong>{period}: {done} of {tasks.length} tasks done</strong><span className="muted small">{tasks.filter(overdue).length} overdue · {tasks.filter(blocked).length} blocked · {tasks.filter((t) => t.status === "IN_REVIEW").length} awaiting review</span></div>
          <div className="progress" style={{ marginTop: ".6rem" }}><span style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Person</th><th className="num">Open</th><th className="num">In review</th><th className="num">Overdue</th><th className="num">Done</th><th>Progress</th><th className="num">Reviewing</th><th className="num">Findings</th><th className="num">Auditor queries</th></tr></thead>
          <tbody>{[...members, { id: null, name: "Unassigned" }].map((m) => {
            const mine = tasks.filter((t) => (t.assignee_id || null) === m.id);
            const d = mine.filter((t) => t.status === "DONE").length, rv = mine.filter((t) => t.status === "IN_REVIEW").length, od = mine.filter(overdue).length;
            const open = mine.length - d;
            if (!m.id && !mine.length) return null;
            return <tr key={m.id || "none"}>
              <td><Link href={qs({ view: "board", assignee: m.id || "" })}>{m.name}</Link>{m.role && <div className="faint small">{m.role.toLowerCase()}</div>}</td>
              <td className="num">{open}</td><td className="num">{rv}</td><td className="num" style={{ color: od ? "var(--bad)" : undefined }}>{od}</td><td className="num">{d}</td>
              <td><div className="workload-bar" title={`${d} done / ${mine.length}`}><span style={{ width: `${mine.length ? (d / mine.length) * 100 : 0}%`, background: "var(--good)" }} /><span style={{ width: `${mine.length ? (rv / mine.length) * 100 : 0}%`, background: "var(--info)" }} /><span style={{ width: `${mine.length ? (od / mine.length) * 100 : 0}%`, background: "var(--bad)" }} /></div></td>
              <td className="num">{m.id ? tasks.filter((t) => t.reviewer_id === m.id && t.status === "IN_REVIEW").length : ""}</td>
              <td className="num">{m.id ? findings.filter((f) => f.assignee_id === m.id).length : ""}</td>
              <td className="num">{m.id ? queries.filter((q) => q.assignee_id === m.id).length : ""}</td>
            </tr>; })}</tbody>
        </table></div>
        <TaskTable tasks={tasks} base={base} overdue={overdue} blocked={blocked} />
      </>}

      {view === "board" && <div className="kanban">
        {STATUSES.map(([s, l]) => { const col = tasks.filter((t) => t.status === s); return (
          <div key={s} className="col"><h4><span>{l}</span><span>{col.length}</span></h4>
            {col.map((t) => <Link key={t.id} href={`${base}/tasks/${t.id}`} className={`task-card prio-${t.priority}`}>
              {t.title}
              <div className="meta">{t.assignee_name || "Unassigned"}{t.due_date && <span className={overdue(t) ? "badge bad" : ""}>{overdue(t) ? "overdue " : "due "}{t.due_date}</span>}{blocked(t) && <span className="badge warn">blocked</span>}{t.priority !== "NORMAL" && <span className={`badge ${PRIO_BADGE[t.priority]}`}>{t.priority.toLowerCase()}</span>}{t.comments > 0 && <span>💬 {t.comments}</span>}</div>
            </Link>)}
          </div>); })}
      </div>}

      {canEdit(ws.role) && view !== "mine" && <form action={newTask} className="card" style={{ marginTop: "1.5rem" }}>
        <h3>New task for {period}</h3>
        <input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="period" value={period} />
        <div className="form-row">
          <div style={{ flex: 2, minWidth: 220 }}><label>Title</label><input name="title" required maxLength={200} placeholder="e.g. Reconcile USD bank account" /></div>
          <div><label>Category</label><input name="category" defaultValue="General" maxLength={40} /></div>
          <div><label>Priority</label><select name="priority" defaultValue="NORMAL">{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label>Owner</label><select name="assignee_id" defaultValue=""><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label>Reviewer</label><select name="reviewer_id" defaultValue=""><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label>Due</label><input type="date" name="due_date" /></div>
        </div>
        <div className="field"><label>Description</label><textarea name="description" rows={2} maxLength={4000} /></div>
        <Submit>Create task</Submit>
      </form>}
    </>
  );
}

function TaskTable({ tasks, base, overdue, blocked }) {
  if (!tasks.length) return <div className="card empty" style={{ marginTop: "1rem" }}><p>No tasks match.</p></div>;
  return (
    <div className="table-wrap" style={{ marginTop: "1rem" }}><table>
      <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Owner</th><th>Reviewer</th><th>Due</th><th>Depends on</th></tr></thead>
      <tbody>{tasks.map((t) => (
        <tr key={t.id}><td className="wrap"><Link href={`${base}/tasks/${t.id}`}>{t.title}</Link><div className="faint small">{t.category} · {t.period}{t.comments ? ` · ${t.comments} comment(s)` : ""}{t.source_type ? ` · from ${t.source_type.replace(/_/g, " ")}` : ""}</div></td>
          <td><StatusBadge status={t.status} />{blocked(t) && <span className="badge warn" style={{ marginLeft: 4 }}>blocked</span>}</td>
          <td>{t.priority.toLowerCase()}</td><td>{t.assignee_name || "—"}</td><td>{t.reviewer_name || "—"}</td>
          <td style={{ color: overdue(t) ? "var(--bad)" : undefined }}>{t.due_date || "—"}</td><td className="small wrap">{t.dep_title || "—"}</td></tr>))}</tbody>
    </table></div>
  );
}

function MyWork({ ws, user, tasks, findings, queries, notes, base, today, overdue, blocked }) {
  const mine = tasks.filter((t) => t.assignee_id === user.id && t.status !== "DONE");
  const reviews = tasks.filter((t) => t.reviewer_id === user.id && t.status === "IN_REVIEW");
  const myFindings = findings.filter((f) => f.assignee_id === user.id);
  const myQueries = queries.filter((q) => q.assignee_id === user.id);
  const unread = notes.filter((n) => !n.read_at).length;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="stat"><div className="label">My open tasks</div><div className="value">{mine.length}</div></div>
        <div className="stat"><div className="label">Overdue</div><div className="value" style={{ color: mine.filter(overdue).length ? "var(--bad)" : undefined }}>{mine.filter(overdue).length}</div></div>
        <div className="stat"><div className="label">Waiting for my review</div><div className="value">{reviews.length}</div></div>
        <div className="stat"><div className="label">Findings & queries</div><div className="value">{myFindings.length + myQueries.length}</div></div>
      </div>
      {notes.length > 0 && <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Notifications {unread > 0 && <span className="badge bad">{unread} new</span>}</h3>
          {unread > 0 && <form action={markAllRead}><input type="hidden" name="slug" value={ws.slug} /><Submit className="btn sm ghost">Mark all read</Submit></form>}</div>
        <ul className="small" style={{ margin: ".5rem 0 0", paddingLeft: "1.1rem" }}>{notes.map((n) => <li key={n.id} style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title} <span className="faint">· {formatDateTime(n.created_at)}</span></li>)}</ul>
      </div>}
      <h3>Assigned to me</h3>
      <TaskTable tasks={mine} base={base} overdue={overdue} blocked={blocked} />
      {reviews.length > 0 && <><h3>Waiting for my review</h3><TaskTable tasks={reviews} base={base} overdue={overdue} blocked={blocked} /></>}
      {myFindings.length > 0 && <><h3>Journal-audit findings assigned to me</h3>
        <div className="table-wrap"><table><thead><tr><th>Finding</th><th>Severity</th><th>Rule</th></tr></thead>
          <tbody>{myFindings.map((f) => <tr key={f.id}><td className="wrap"><Link href={`${base}/journal-audit?finding=${f.id}`}>{f.title}</Link></td><td>{f.severity.toLowerCase()}</td><td className="small">{f.rule}</td></tr>)}</tbody></table></div></>}
      {myQueries.length > 0 && <><h3>Auditor queries assigned to me</h3>
        <div className="table-wrap"><table><thead><tr><th>Ref</th><th>Query</th><th>Status</th><th>Due</th></tr></thead>
          <tbody>{myQueries.map((q) => <tr key={q.id}><td>{q.ref}</td><td className="wrap"><Link href={`${base}/queries/${q.id}`}>{q.title}</Link></td><td><StatusBadge status={q.status} /></td><td style={{ color: q.due_date && q.due_date < today ? "var(--bad)" : undefined }}>{q.due_date || "—"}</td></tr>)}</tbody></table></div></>}
    </div>
  );
}
