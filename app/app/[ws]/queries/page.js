import "@/styles/audit.css";
import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace, can } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatDate } from "@/lib/dates";
import { StateBadge, QUERY_STATUSES } from "../journal-audit/ui";
import { raiseQuery } from "./actions";
export const metadata = { title: "Auditor queries" };

export default async function QueriesPage({ params, searchParams: sp }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const where = ["q.workspace_id = ?"], args = [ws.id];
  if (sp.status) { where.push("q.status = ?"); args.push(sp.status); }
  if (sp.mine) { where.push("(q.assignee_id = ? OR q.raised_by = ?)"); args.push(user.id, user.id); }
  const today = new Date().toISOString().slice(0, 10);
  const [queries, accounts, counts] = await Promise.all([
    db.all(`SELECT q.id, q.ref, q.title, q.status, q.priority, q.account_code, q.journal_no, q.due_date, q.auditor_name, q.auditor_firm, q.created_at, a.name assignee_name, r.name raised_name
            FROM auditor_queries q LEFT JOIN users a ON a.id = q.assignee_id LEFT JOIN users r ON r.id = q.raised_by WHERE ${where.join(" AND ")}
            ORDER BY CASE q.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'RESPONDED' THEN 2 ELSE 3 END, q.created_at DESC LIMIT 300`, args),
    db.all("SELECT account_code, MAX(account_name) name FROM ledger_entries WHERE workspace_id = ? GROUP BY account_code ORDER BY account_code", [ws.id]),
    db.all("SELECT status, COUNT(*) n FROM auditor_queries WHERE workspace_id = ? GROUP BY status", [ws.id]),
  ]);
  const cnt = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const raise = can(ws.role, "query.raise");
  return (
    <>
      <PageHead title="Auditor queries" desc="External auditors raise questions about an account or journal; the system builds an evidence pack from the ledger, the finance team responds with action points, and the auditor closes the query." />
      <Flash searchParams={sp} />
      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        {QUERY_STATUSES.map(([s, l]) => <Link key={s} href={`?status=${s}`} className="card stat" style={{ textDecoration: "none", color: "var(--text)" }}><div className="label">{l}</div><div className="value">{cnt[s] || 0}</div></Link>)}
      </div>
      <div className="row" style={{ marginBottom: ".6rem" }}>
        <Link href="?" className={`btn sm ${!sp.status && !sp.mine ? "primary" : ""}`}>All</Link>
        <Link href="?mine=1" className={`btn sm ${sp.mine ? "primary" : ""}`}>Mine</Link>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Ref</th><th>Query</th><th>About</th><th>Raised by</th><th>Assigned</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          {queries.map((q) => (
            <tr key={q.id}>
              <td><Link href={`/app/${ws.slug}/queries/${q.id}`}>{q.ref}</Link></td>
              <td className="wrap">{q.title}{q.priority === "HIGH" && <span className="badge bad" style={{ marginLeft: 6 }}>high</span>}</td>
              <td className="small">{[q.account_code && `Acct ${q.account_code}`, q.journal_no && `JV ${q.journal_no}`].filter(Boolean).join(" · ") || "—"}</td>
              <td className="small">{q.auditor_name || q.raised_name}{q.auditor_firm ? <div className="faint">{q.auditor_firm}</div> : null}</td>
              <td className="small">{q.assignee_name || "—"}</td>
              <td className="small">{q.due_date ? <span style={{ color: q.due_date < today && !["CLOSED", "RESPONDED"].includes(q.status) ? "var(--bad)" : undefined }}>{formatDate(q.due_date)}</span> : "—"}</td>
              <td><StateBadge status={q.status} list={QUERY_STATUSES} /></td>
            </tr>))}
          {!queries.length && <tr><td colSpan={7} className="empty">No queries yet.</td></tr>}
        </tbody>
      </table></div>

      {raise && <>
        <h2 style={{ marginTop: "2rem" }}>Raise a query</h2>
        <form action={raiseQuery} className="card">
          <input type="hidden" name="slug" value={ws.slug} />
          <div className="form-row">
            <div style={{ flex: 2 }}><label>Title</label><input name="title" required maxLength={200} placeholder="e.g. Explain the movement in accrued expenses in March" /></div>
            <div><label>Priority</label><select name="priority" defaultValue="NORMAL"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option></select></div>
            <div><label>Response due</label><input type="date" name="due_date" /></div>
          </div>
          <div className="field"><label>Question / request</label><textarea name="question" rows={4} required placeholder="What happened in this account or journal, and what support do you need?" /></div>
          <div className="form-row">
            <div><label>Account (optional)</label><input name="account_code" list="q-accounts" placeholder="Account code" /><datalist id="q-accounts">{accounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.name}</option>)}</datalist></div>
            <div><label>Journal no. (optional)</label><input name="journal_no" placeholder="e.g. JV-2026-0412" /></div>
            <div><label>Period from</label><input type="date" name="period_from" /></div>
            <div><label>Period to</label><input type="date" name="period_to" /></div>
          </div>
          <div className="form-row">
            <div><label>Auditor name</label><input name="auditor_name" defaultValue={user.name} /></div>
            <div><label>Audit firm</label><input name="auditor_firm" placeholder="Firm name" /></div>
          </div>
          <p className="help">If you name an account or journal, an evidence pack (balances, monthly trend, largest journals, counterparties, related findings, reconciliations, period locks) is generated automatically. Query text is encrypted at rest.</p>
          <Submit>Raise query</Submit>
        </form>
      </>}
    </>
  );
}
