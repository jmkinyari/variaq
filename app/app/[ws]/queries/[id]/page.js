import "@/styles/audit.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, can } from "@/lib/auth";
import { open, openJson } from "@/lib/vault";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatDate, formatDateTime } from "@/lib/dates";
import { StateBadge, QUERY_STATUSES } from "../../journal-audit/ui";
import Evidence from "../Evidence";
import { assignQuery, respondQuery, setQueryStatus, refreshEvidence } from "../actions";
export const metadata = { title: "Auditor query" };

export default async function QueryPage({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const q = await db.get("SELECT q.*, a.name assignee_name, r.name raised_name, s.name responder_name FROM auditor_queries q LEFT JOIN users a ON a.id = q.assignee_id LEFT JOIN users r ON r.id = q.raised_by LEFT JOIN users s ON s.id = q.responded_by WHERE q.id = ? AND q.workspace_id = ?", [params.id, ws.id]);
  if (!q) notFound();
  const [question, response, evidence, members, history] = await Promise.all([
    open(ws.id, "query.question", q.question),
    open(ws.id, "query.response", q.response),
    openJson(ws.id, "query.evidence", q.evidence, null),
    db.all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role IN ('OWNER','ADMIN','MEMBER') ORDER BY u.name", [ws.id]),
    db.all("SELECT e.created_at, e.action, e.detail, u.name FROM audit_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.workspace_id = ? AND e.entity_type = 'auditor_query' AND e.entity_id = ? ORDER BY e.created_at", [ws.id, q.id]),
  ]);
  const points = JSON.parse(q.action_points || "[]");
  const respond = can(ws.role, "query.respond");
  const canClose = user.id === q.raised_by || can(ws.role, "approve");
  const H = () => <><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={q.id} /></>;
  // Existing action points plus two blank rows (at least three rows, at most eight).
  const rows = [...points, ...Array.from({ length: Math.max(2, 3 - points.length) }, () => ({}))].slice(0, 8);

  return (
    <>
      <PageHead title={`${q.ref} · ${q.title}`} crumbs={<Link href={`/app/${ws.slug}/queries`}>← Auditor queries</Link>}>
        <Link className="btn" href={`/app/${ws.slug}/queries/${q.id}/report`}>Response report (print / PDF)</Link>
      </PageHead>
      <Flash searchParams={searchParams} />
      <div className="grid grid-2" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <div className="row" style={{ marginBottom: ".5rem" }}><StateBadge status={q.status} list={QUERY_STATUSES} />{q.priority === "HIGH" && <span className="badge bad">high priority</span>}</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{question}</p>
          <dl className="kv">
            <dt>Raised by</dt><dd>{q.auditor_name || q.raised_name}{q.auditor_firm ? `, ${q.auditor_firm}` : ""} · {formatDateTime(q.created_at)}</dd>
            {q.account_code && <><dt>Account</dt><dd>{q.account_code}</dd></>}
            {q.journal_no && <><dt>Journal</dt><dd>{q.journal_no}</dd></>}
            <dt>Period</dt><dd>{q.period_from ? formatDate(q.period_from) : "—"} – {q.period_to ? formatDate(q.period_to) : "—"}</dd>
            <dt>Due</dt><dd>{q.due_date ? formatDate(q.due_date) : "—"}</dd>
            <dt>Assigned to</dt><dd>{q.assignee_name || "—"}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>Response</h3>
          {response ? <>
            <p style={{ whiteSpace: "pre-wrap" }}>{response}</p>
            <p className="faint small">{q.responder_name} · {formatDateTime(q.responded_at)}</p>
            {points.length > 0 && <><h3 style={{ fontSize: "1rem" }}>Action points</h3>
              <ul>{points.map((p, i) => <li key={i} style={{ textDecoration: p.done ? "line-through" : undefined }}>{p.text}<span className="faint small"> — {p.owner || "unassigned"}{p.due ? `, by ${formatDate(p.due)}` : ""}</span></li>)}</ul></>}
          </> : <p className="muted">No response yet.</p>}
          <div className="row" style={{ marginTop: ".8rem" }}>
            {respond && q.status === "OPEN" && <form action={setQueryStatus}><H /><input type="hidden" name="status" value="IN_PROGRESS" /><Submit className="btn sm">Start work</Submit></form>}
            {canClose && q.status !== "CLOSED" && q.status === "RESPONDED" && <form action={setQueryStatus}><H /><input type="hidden" name="status" value="CLOSED" /><Submit className="btn sm primary">Accept response & close</Submit></form>}
            {canClose && ["RESPONDED", "CLOSED"].includes(q.status) && <form action={setQueryStatus}><H /><input type="hidden" name="status" value="OPEN" /><Submit className="btn sm" confirm="Reopen this query?">Reopen</Submit></form>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row between"><h2 style={{ margin: 0 }}>Evidence pack</h2>{respond && (q.account_code || q.journal_no) && <form action={refreshEvidence}><H /><Submit className="btn sm">Rebuild from current ledger</Submit></form>}</div>
        <Evidence ev={evidence} currency={ws.currency} slug={ws.slug} />
      </div>

      {respond && q.status !== "CLOSED" && <div className="grid grid-2">
        <form action={assignQuery} className="card">
          <H />
          <h3>Assign</h3>
          <div className="field"><label>Team member</label><select name="assignee_id" defaultValue={q.assignee_id || ""} required><option value="">Choose…</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <p className="help">Adds a task to their list and notifies them.</p>
          <Submit>Assign</Submit>
        </form>
        <form action={respondQuery} className="card">
          <H />
          <h3>Respond to the auditor</h3>
          <div className="field"><label>Response</label><textarea name="response" rows={6} required defaultValue={response || ""} placeholder="Explain what happened, reference the evidence above and attach document references." /></div>
          <label>Action points</label>
          {rows.map((p, i) => (
            <div key={i} className="row" style={{ flexWrap: "nowrap", marginBottom: ".4rem" }}>
              <input name={`ap_text_${i}`} defaultValue={p.text || ""} placeholder="Action (e.g. Reverse duplicate JV-0412)" style={{ flex: 3 }} />
              <select name={`ap_owner_${i}`} defaultValue={p.owner || ""} style={{ flex: 1 }}><option value="">Owner</option>{members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select>
              <input type="date" name={`ap_due_${i}`} defaultValue={p.due || ""} style={{ flex: 1 }} />
              <label className="row small" style={{ fontWeight: 400, flexWrap: "nowrap" }}><input type="checkbox" name={`ap_done_${i}`} defaultChecked={!!p.done} style={{ width: "auto" }} />done</label>
            </div>))}
          <Submit>Save response</Submit>
        </form>
      </div>}

      <h2 style={{ marginTop: "2rem" }}>Trail</h2>
      <div className="table-wrap"><table><tbody>{history.map((h, i) => <tr key={i}><td className="small">{formatDateTime(h.created_at)}</td><td>{h.name}</td><td>{h.action.replace("query.", "").replace(/_/g, " ")}</td><td className="small wrap faint">{h.detail}</td></tr>)}</tbody></table></div>
    </>
  );
}
