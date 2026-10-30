import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import "@/styles/platform.css";
export const metadata = { title: "Journal" };

const SEV = { CRITICAL: "bad", HIGH: "bad", MEDIUM: "warn", LOW: "info" };

/** One journal, every line, balance proof, posting metadata and any audit findings that cite it. */
export default async function JournalPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const no = decodeURIComponent(params.no);
  const base = `/app/${ws.slug}`;
  const source = searchParams.source || null;
  const [lines, findings] = await Promise.all([
    db.all(`SELECT * FROM ledger_entries WHERE workspace_id = ? AND journal_no = ? ${source ? "AND source = ?" : ""} ORDER BY source, COALESCE(line_no, 0), amount_cents DESC LIMIT 5000`, [ws.id, no, ...(source ? [source] : [])]),
    db.all("SELECT id, rule, severity, title, status, suggestion FROM audit_findings WHERE workspace_id = ? AND journal_no = ? ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END", [ws.id, no]).catch(() => []),
  ]);
  const sources = [...new Set(lines.map((l) => l.source))];
  const dr = lines.filter((l) => l.amount_cents > 0).reduce((a, l) => a + l.amount_cents, 0);
  const cr = -lines.filter((l) => l.amount_cents < 0).reduce((a, l) => a + l.amount_cents, 0);
  const dates = [...new Set(lines.map((l) => l.date))];
  const first = lines[0] || {};
  const lagDays = first.posted_at ? Math.round((Date.parse(first.posted_at) - Date.parse(first.date + "T00:00:00Z")) / 86400000) : null;
  return (
    <>
      <PageHead title={`Journal ${no}`} crumbs={<Link href={`${base}/ledger?journal=${encodeURIComponent(no)}`}>Ledger</Link>}
        desc={lines.length ? `${lines.length} line(s) · ${dates.join(", ")}${sources.length > 1 ? ` · ${sources.length} sources share this number` : ` · ${sources[0]}`}` : "No lines found."} />
      {lines.length > 0 && <>
        <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
          <div className="stat"><div className="label">Debits</div><div className="value">{formatMoney(dr, ws.currency)}</div></div>
          <div className="stat"><div className="label">Credits</div><div className="value">{formatMoney(cr, ws.currency)}</div></div>
          <div className="stat"><div className="label">Balance check</div><div className="value" style={{ color: dr === cr ? "var(--good)" : "var(--bad)" }}>{dr === cr ? "Balanced" : formatMoney(dr - cr, ws.currency)}</div></div>
          <div className="stat"><div className="label">Posted</div><div className="value" style={{ fontSize: "1rem" }}>{first.posted_by || "unknown user"}{first.posted_at ? <div className="faint small">{formatDateTime(first.posted_at)}{lagDays !== null && lagDays > 5 ? ` · ${lagDays} days after the entry date` : ""}</div> : null}{first.approved_by && <div className="faint small">approved by {first.approved_by}{first.approved_by === first.posted_by ? " (self-approved)" : ""}</div>}</div></div>
        </div>
        {sources.length > 1 && <div className="alert warn">This journal number appears in several sources ({sources.join(", ")}). Filter: {sources.map((s) => <Link key={s} href={`?source=${encodeURIComponent(s)}`} style={{ marginRight: 8 }}>{s}</Link>)}</div>}
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Date</th><th>Account</th><th>Description</th><th>Counterparty</th><th>Dims</th><th>Tax</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.id}><td className="faint small">{l.line_no ?? i + 1}</td><td>{l.date}</td>
              <td><Link href={`${base}/ledger?account=${encodeURIComponent(l.account_code)}`}>{l.account_code}</Link><div className="faint small">{l.account_name}</div></td>
              <td className="wrap">{l.description}{l.reference && <div className="faint small">ref {l.reference}</div>}</td><td>{l.counterparty || "—"}</td>
              <td className="small">{[l.cost_center, l.department, l.project].filter(Boolean).join(" · ") || "—"}</td><td className="small">{l.tax_code || "—"}</td>
              <td className="num">{l.amount_cents > 0 ? formatMoney(l.amount_cents, ws.currency) : ""}</td><td className="num">{l.amount_cents < 0 ? formatMoney(-l.amount_cents, ws.currency) : ""}</td></tr>))}
            <tr className={dr === cr ? "" : "unbalanced"}><td colSpan={7}><strong>Total</strong></td><td className="num"><strong>{formatMoney(dr, ws.currency)}</strong></td><td className="num"><strong>{formatMoney(cr, ws.currency)}</strong></td></tr></tbody>
        </table></div>
        <div className="muted small" style={{ marginTop: ".5rem" }}>Entry type: {first.entry_type || "—"} · currency {first.currency || ws.currency}{first.fx_rate ? ` @ ${first.fx_rate}` : ""} · external id {first.external_id || "—"}</div>
      </>}
      <h2 style={{ marginTop: "2rem" }}>Audit findings on this journal</h2>
      {findings.length === 0 ? <p className="muted">None. <Link href={`${base}/journal-audit`}>Run the journal audit</Link> to test it.</p> : (
        <div className="table-wrap"><table><thead><tr><th>Severity</th><th>Finding</th><th>Suggested action</th><th>Status</th></tr></thead>
          <tbody>{findings.map((f) => <tr key={f.id}><td><span className={`badge ${SEV[f.severity] || ""}`}>{f.severity.toLowerCase()}</span></td><td className="wrap"><Link href={`${base}/journal-audit?finding=${f.id}`}>{f.title}</Link><div className="faint small">{f.rule}</div></td><td className="wrap small">{f.suggestion || "—"}</td><td>{f.status.toLowerCase()}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
