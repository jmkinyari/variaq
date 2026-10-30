import "@/styles/audit.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { open, openJson } from "@/lib/vault";
import { formatDate, formatDateTime } from "@/lib/dates";
import Evidence from "../../Evidence";
import PrintButton from "./PrintButton";
export const metadata = { title: "Query response report" };

export default async function QueryReport({ params }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const q = await db.get("SELECT q.*, a.name assignee_name, s.name responder_name FROM auditor_queries q LEFT JOIN users a ON a.id = q.assignee_id LEFT JOIN users s ON s.id = q.responded_by WHERE q.id = ? AND q.workspace_id = ?", [params.id, ws.id]);
  if (!q) notFound();
  const [question, response, evidence] = await Promise.all([open(ws.id, "query.question", q.question), open(ws.id, "query.response", q.response), openJson(ws.id, "query.evidence", q.evidence, null)]);
  const points = JSON.parse(q.action_points || "[]");
  return (
    <>
      <div className="row no-print" style={{ marginBottom: "1rem" }}><Link href={`/app/${ws.slug}/queries/${q.id}`} className="btn sm">← Back</Link><PrintButton /></div>
      <article className="report-page">
        <div className="faint small">{ws.name} · Audit query response · {q.ref}</div>
        <h1>{q.title}</h1>
        <table><tbody>
          <tr><td>Raised by</td><td>{q.auditor_name}{q.auditor_firm ? `, ${q.auditor_firm}` : ""} on {formatDate(q.created_at.slice(0, 10))}</td></tr>
          <tr><td>Subject</td><td>{[q.account_code && `Account ${q.account_code}`, q.journal_no && `Journal ${q.journal_no}`].filter(Boolean).join(" · ") || "General"}</td></tr>
          <tr><td>Period</td><td>{q.period_from ? formatDate(q.period_from) : "—"} – {q.period_to ? formatDate(q.period_to) : "—"}</td></tr>
          <tr><td>Status</td><td>{q.status.replace("_", " ").toLowerCase()}{q.closed_at ? ` (closed ${formatDateTime(q.closed_at)})` : ""}</td></tr>
          <tr><td>Responded by</td><td>{q.responder_name ? `${q.responder_name}, ${formatDateTime(q.responded_at)}` : "—"}</td></tr>
        </tbody></table>
        <h2>Query</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{question}</p>
        <h2>Response</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{response || "Awaiting response."}</p>
        {points.length > 0 && <>
          <h2>Action points</h2>
          <table><thead><tr><th>#</th><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{points.map((p, i) => <tr key={i}><td>{i + 1}</td><td className="wrap">{p.text}</td><td>{p.owner || "—"}</td><td>{p.due ? formatDate(p.due) : "—"}</td><td>{p.done ? "Done" : "Open"}</td></tr>)}</tbody></table>
        </>}
        <h2>Supporting analysis</h2>
        <Evidence ev={evidence} currency={ws.currency} slug={ws.slug} print />
        <p className="faint small" style={{ marginTop: "2rem" }}>Prepared in Variaq from the company's ledger. Printed by {user.name} on {formatDateTime(new Date().toISOString())}. Figures reflect the ledger at the time the evidence pack was generated.</p>
      </article>
    </>
  );
}
