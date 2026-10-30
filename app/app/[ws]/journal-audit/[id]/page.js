import "@/styles/audit.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { RULES } from "@/lib/audit/journal-rules";
import { SevBadge, StateBadge, JournalLines, FINDING_STATUSES } from "../ui";
import { assignFinding, resolveFinding } from "../actions";
export const metadata = { title: "Audit finding" };

const LABELS = { differenceCents: "Difference", day: "Non-working day", basis: "Based on", postedAtEat: "Posted at (EAT)", lagDays: "Days between entry date and posting", lockedAt: "Period locked at", limitCents: "Approval limit", user: "User", duplicateOf: "Duplicate of", dates: "Dated", accounts: "Accounts", example: "Description", pairs: "Unseen account pairs", robustZ: "Robust z-score", typicalCents: "Typical amount (median)", line: "Line", reversedOn: "Reversed on", reversalJournal: "Reversal journal", lastActivity: "Last activity before period", balanceCents: "Balance at period end", account: "Account", class: "Class", expected: "Normal side", mad: "MAD", n: "Amounts tested", overRepresented: "Over-represented digits", method: "Method", confidence: "Confidence %", suggestedAccount: "Suggested account", expectedClass: "Expected class" };

export default async function FindingPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const f = await db.get("SELECT f.*, a.name assignee_name, r.name resolver_name FROM audit_findings f LEFT JOIN users a ON a.id = f.assignee_id LEFT JOIN users r ON r.id = f.resolved_by WHERE f.id = ? AND f.workspace_id = ?", [params.id, ws.id]);
  if (!f) notFound();
  const detail = JSON.parse(f.detail || "{}");
  const ids = JSON.parse(f.entry_ids || "[]").slice(0, 200);
  const realJournal = f.journal_no && !f.journal_no.startsWith("D:") ? f.journal_no : null;
  const [lines, journal, members, task, history] = await Promise.all([
    ids.length ? db.all(`SELECT * FROM ledger_entries WHERE workspace_id = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY date, line_no`, [ws.id, ...ids]) : [],
    realJournal ? db.all("SELECT * FROM ledger_entries WHERE workspace_id = ? AND journal_no = ? ORDER BY line_no, date LIMIT 300", [ws.id, realJournal]) : [],
    db.all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role IN ('OWNER','ADMIN','MEMBER') ORDER BY u.name", [ws.id]),
    db.get("SELECT id, status, due_date FROM close_tasks WHERE workspace_id = ? AND source_type = 'finding' AND source_id = ?", [ws.id, f.id]),
    db.all("SELECT e.*, u.name by_name FROM audit_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.workspace_id = ? AND e.entity_type = 'audit_finding' AND e.entity_id = ? ORDER BY e.created_at DESC LIMIT 20", [ws.id, f.id]),
  ]);
  const shown = journal.length ? journal : lines;
  const flagged = new Set(ids);
  const corrective = f.corrective ? JSON.parse(f.corrective) : null;
  const edit = canEdit(ws.role);
  const H = () => <><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={f.id} /></>;
  const fmtVal = (k, v) => (/Cents$/.test(k) ? formatMoney(v, ws.currency) : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

  return (
    <>
      <PageHead title={f.title} crumbs={<Link href={`/app/${ws.slug}/journal-audit`}>← Journal audit</Link>} desc={detail.explain} />
      <Flash searchParams={searchParams} />
      <div className="grid grid-2" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <div className="row" style={{ marginBottom: ".6rem" }}><SevBadge severity={f.severity} /><StateBadge status={f.status} /><span className="faint small">{RULES[f.rule]?.title || f.rule}</span></div>
          <dl className="kv">
            {realJournal && <><dt>Journal</dt><dd><Link href={`/app/${ws.slug}/ledger?q=${encodeURIComponent(realJournal)}`}>{realJournal}</Link></dd></>}
            {f.account_code && <><dt>Account</dt><dd>{f.account_code}</dd></>}
            {f.entry_date && <><dt>Date</dt><dd>{formatDate(f.entry_date)}</dd></>}
            {f.amount_cents !== null && <><dt>Amount</dt><dd>{formatMoney(f.amount_cents, ws.currency)}</dd></>}
            {Object.entries(detail).filter(([k]) => k !== "explain" && k !== "reasons").flatMap(([k, v]) => [<dt key={k + "t"}>{LABELS[k] || k}</dt>, <dd key={k}>{fmtVal(k, v)}</dd>])}
            <dt>First / last detected</dt><dd>{formatDateTime(f.first_seen_at)} / {formatDateTime(f.last_seen_at)}</dd>
            <dt>Assigned to</dt><dd>{f.assignee_name || "—"}{task && <> · <Link href={`/app/${ws.slug}/tasks`}>task {task.status.toLowerCase().replace("_", " ")}</Link></>}</dd>
            {f.resolution_note && <><dt>Resolution</dt><dd>{f.resolution_note}{f.resolver_name ? ` — ${f.resolver_name}` : ""}</dd></>}
          </dl>
          {detail.reasons?.length > 0 && <ul className="small" style={{ marginTop: ".8rem" }}>{detail.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
        <div className="card">
          <h3>Corrective action</h3>
          <p>{f.suggestion}</p>
          {corrective?.lines && <><h3 style={{ fontSize: "1rem" }}>Proposed correcting journal</h3><JournalLines lines={corrective.lines} currency={ws.currency} />
            <p className="faint small">Proposed only — nothing is posted to your ERP. Download it from the findings list to import into the ERP after review and approval.</p></>}
        </div>
      </div>

      {shown.length > 0 && <>
        <h2>{journal.length ? `Journal ${realJournal}` : "Lines"}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Counterparty</th><th>Posted by</th><th>Approved by</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{shown.map((l) => (
            <tr key={l.id} style={flagged.has(l.id) && journal.length ? { background: "var(--warn-bg)" } : undefined}>
              <td className="small">{l.date}</td><td>{l.account_code}<div className="faint small">{l.account_name}</div></td><td className="wrap">{l.description}</td><td className="small">{l.counterparty || "—"}</td>
              <td className="small">{l.posted_by || "—"}{l.posted_at ? <div className="faint">{formatDateTime(l.posted_at)}</div> : null}</td><td className="small">{l.approved_by || "—"}</td>
              <td className="num">{l.amount_cents > 0 ? formatMoney(l.amount_cents, ws.currency) : ""}</td><td className="num">{l.amount_cents < 0 ? formatMoney(-l.amount_cents, ws.currency) : ""}</td>
            </tr>))}</tbody>
        </table></div>
      </>}

      {edit && <div className="grid grid-2" style={{ marginTop: "1.5rem" }}>
        <form action={assignFinding} className="card">
          <H />
          <h3>Assign</h3>
          <div className="form-row">
            <div><label>Team member</label><select name="assignee_id" defaultValue={f.assignee_id || ""} required><option value="">Choose…</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            <div><label>Due date</label><input type="date" name="due_date" defaultValue={task?.due_date || ""} /></div>
          </div>
          <p className="help">Creates a task on their list (Tasks & workload) and notifies them.</p>
          <Submit>Assign</Submit>
        </form>
        <form action={resolveFinding} className="card">
          <H />
          <h3>Update status</h3>
          <div className="field"><label>Status</label><select name="status" defaultValue={f.status === "CLEARED" ? "OPEN" : f.status}>{FINDING_STATUSES.filter(([v]) => v !== "CLEARED").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="field"><label>Note (required when closing)</label><textarea name="note" rows={3} defaultValue="" placeholder="What was done, with the ERP reference of any correcting journal" /></div>
          <Submit>Save</Submit>
        </form>
      </div>}

      {history.length > 0 && <>
        <h2 style={{ marginTop: "2rem" }}>History</h2>
        <div className="table-wrap"><table><tbody>{history.map((h) => <tr key={h.id}><td className="small">{formatDateTime(h.created_at)}</td><td>{h.by_name}</td><td>{h.action}</td><td className="small wrap">{h.detail}</td></tr>)}</tbody></table></div>
      </>}
    </>
  );
}
