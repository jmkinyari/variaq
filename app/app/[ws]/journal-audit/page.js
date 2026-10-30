import "@/styles/audit.css";
import Link from "next/link";
import { agentHref } from "@/lib/ai/deep-links";
import db from "@/lib/db";
import { requireWorkspace, canEdit, canAdmin } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { RULES, DEFAULTS } from "@/lib/audit/journal-rules";
import { SevBadge, StateBadge, BenfordChart, FINDING_STATUSES } from "./ui";
import { runAudit, bulkResolve } from "./actions";
export const metadata = { title: "Journal audit" };

const PAGE = 100;
const kes = (c) => (c / 100).toFixed(0);

export default async function JournalAuditPage({ params, searchParams: sp }) {
  const { ws } = await requireWorkspace(params.ws);
  const range = await db.get("SELECT MIN(date) mn, MAX(date) mx, COUNT(*) n FROM ledger_entries WHERE workspace_id = ?", [ws.id]);
  const lastRun = sp.run
    ? await db.get("SELECT r.*, u.name by_name FROM audit_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ? AND r.workspace_id = ?", [sp.run, ws.id])
    : await db.get("SELECT r.*, u.name by_name FROM audit_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.workspace_id = ? ORDER BY r.created_at DESC LIMIT 1", [ws.id]);
  const runParams = lastRun ? JSON.parse(lastRun.params || "{}") : {};
  const stats = lastRun ? JSON.parse(lastRun.stats || "{}") : null;
  const defFrom = lastRun?.period_from || (range?.mx ? `${range.mx.slice(0, 7)}-01` : "");
  const defTo = lastRun?.period_to || range?.mx || "";

  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const where = ["f.workspace_id = ?"], args = [ws.id];
  const status = sp.status ?? "ACTIVE";
  if (status === "ACTIVE") where.push("f.status IN ('OPEN','IN_PROGRESS')");
  else if (status) { where.push("f.status = ?"); args.push(status); }
  if (sp.rule) { where.push("f.rule = ?"); args.push(sp.rule); }
  if (sp.severity) { where.push("f.severity = ?"); args.push(sp.severity); }
  if (sp.assignee) { where.push("f.assignee_id = ?"); args.push(sp.assignee); }
  if (sp.account) { where.push("f.account_code = ?"); args.push(sp.account); }
  const W = where.join(" AND ");
  const [count, findings, members, byRule] = await Promise.all([
    db.get(`SELECT COUNT(*) n FROM audit_findings f WHERE ${W}`, args),
    db.all(`SELECT f.*, u.name assignee_name FROM audit_findings f LEFT JOIN users u ON u.id = f.assignee_id WHERE ${W}
            ORDER BY CASE f.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, f.amount_cents DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, args),
    db.all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name", [ws.id]),
    db.all("SELECT rule, severity, COUNT(*) n FROM audit_findings WHERE workspace_id = ? AND status IN ('OPEN','IN_PROGRESS') GROUP BY rule, severity", [ws.id]),
  ]);
  const ruleTotals = {};
  for (const r of byRule) { ruleTotals[r.rule] ||= { n: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }; ruleTotals[r.rule].n += r.n; ruleTotals[r.rule][r.severity] += r.n; }
  const pages = Math.max(1, Math.ceil(count.n / PAGE));
  const qs = (o) => `?${new URLSearchParams(Object.fromEntries(Object.entries({ ...sp, ...o }).filter(([k, v]) => v !== undefined && v !== "" && !["ok", "err"].includes(k))))}`;
  const exportQs = new URLSearchParams(Object.fromEntries(Object.entries({ status, rule: sp.rule, severity: sp.severity }).filter(([, v]) => v)));

  return (
    <>
      <PageHead title="Journal audit" desc="Automated journal-entry testing (ISA 240 style): unbalanced, back-dated, self-approved, duplicate, unusual and misposted entries — each with a corrective action.">
        <Link className="btn" href={`/app/${ws.slug}/journal-audit/export?${exportQs}`}>Download correcting journals (CSV)</Link>
        <Link className="btn ghost ai-ask-link" href={agentHref(ws.slug, "journal-audit", { period: (lastRun?.period_to || range?.mx || "").slice(0, 7) || undefined })}>Ask Journal Audit</Link>
      </PageHead>
      <Flash searchParams={sp} />

      {!range?.n ? <div className="card empty"><h3>No ledger data yet</h3><p>Import journal lines in the Data hub or connect your ERP, then run the tests.</p><Link href={`/app/${ws.slug}/data?kind=ledger`} className="btn primary">Upload ledger</Link></div> : <>
        {canEdit(ws.role) && (
          <form action={runAudit} className="card" style={{ marginBottom: "1rem" }}>
            <input type="hidden" name="slug" value={ws.slug} />
            <div className="form-row" style={{ alignItems: "end" }}>
              <div><label>From</label><input type="date" name="from" defaultValue={defFrom} min={range.mn} required /></div>
              <div><label>To</label><input type="date" name="to" defaultValue={defTo} required /></div>
              <div><label>Approval limit ({ws.currency})</label><input name="approvalLimit" inputMode="decimal" defaultValue={kes(runParams.approvalLimitCents || DEFAULTS.approvalLimitCents)} /></div>
              <div><label>Materiality ({ws.currency})</label><input name="materiality" inputMode="decimal" defaultValue={kes(runParams.materialityCents || DEFAULTS.materialityCents)} /></div>
              <Submit pendingText="Testing journals…">Run journal tests</Submit>
            </div>
            <details style={{ marginTop: ".8rem" }}>
              <summary className="small">Advanced settings and rule selection</summary>
              <div className="form-row" style={{ marginTop: ".6rem" }}>
                <div><label>Capitalisation threshold ({ws.currency})</label><input name="capex" inputMode="decimal" defaultValue={kes(runParams.capexThresholdCents || 5_000_000)} /></div>
                <div><label>Suspense account code</label><input name="suspenseAccount" defaultValue={runParams.suspenseAccount || DEFAULTS.suspenseAccount} /></div>
                <div><label>Extra holidays (e.g. Eid), ISO dates</label><input name="holidays" placeholder="2026-03-20, 2026-05-27" defaultValue={(runParams.extraHolidays || []).map((h) => h.date).join(", ")} /></div>
              </div>
              <div className="grid grid-3" style={{ marginTop: ".6rem" }}>
                {Object.entries(RULES).map(([id, r]) => (
                  <label key={id} className="row small" style={{ fontWeight: 400, color: "var(--text)", flexWrap: "nowrap" }}>
                    <input type="checkbox" name="rules" value={id} defaultChecked={!runParams.enabled || runParams.enabled.includes(id)} style={{ width: "auto" }} /> {r.title}
                  </label>))}
              </div>
            </details>
          </form>
        )}

        {lastRun && stats && (
          <div className="grid grid-2" style={{ marginBottom: "1.5rem" }}>
            <div className="card">
              <h3>Last run</h3>
              <p className="muted small" style={{ marginTop: 0 }}>{formatDate(lastRun.period_from)} – {formatDate(lastRun.period_to)} · {formatDateTime(lastRun.created_at)} by {lastRun.by_name}</p>
              <div className="grid grid-3">
                <div className="stat"><div className="label">Lines tested</div><div className="value">{(stats.lines || 0).toLocaleString()}</div></div>
                <div className="stat"><div className="label">Journals</div><div className="value">{(stats.journals || 0).toLocaleString()}</div></div>
                <div className="stat"><div className="label">Findings</div><div className="value">{stats.findings || 0}</div></div>
              </div>
              <div className="row small" style={{ marginTop: ".6rem" }}>
                <SevBadge severity="HIGH" /> {stats.bySeverity?.HIGH || 0} <SevBadge severity="MEDIUM" /> {stats.bySeverity?.MEDIUM || 0} <SevBadge severity="LOW" /> {stats.bySeverity?.LOW || 0}
              </div>
            </div>
            <div className="card"><h3>Benford's law (first digit)</h3><BenfordChart result={stats.benford} /></div>
          </div>
        )}

        {Object.keys(ruleTotals).length > 0 && <>
          <h2>Open findings by test</h2>
          <div className="table-wrap" style={{ marginBottom: "1.5rem" }}><table>
            <thead><tr><th>Test</th><th className="num">High</th><th className="num">Medium</th><th className="num">Low</th><th className="num">Total</th><th>What to do</th></tr></thead>
            <tbody>{Object.entries(ruleTotals).sort((a, b) => b[1].HIGH - a[1].HIGH || b[1].n - a[1].n).map(([rule, t]) => (
              <tr key={rule}><td><Link href={qs({ rule, page: 1 })}>{RULES[rule]?.title || rule}</Link></td><td className="num">{t.HIGH || ""}</td><td className="num">{t.MEDIUM || ""}</td><td className="num">{t.LOW || ""}</td><td className="num">{t.n}</td><td className="wrap small muted">{RULES[rule]?.action}</td></tr>))}</tbody>
          </table></div>
        </>}

        <form className="card filters" style={{ marginBottom: "1rem" }}>
          <div className="form-row" style={{ alignItems: "end" }}>
            <div><label>Test</label><select name="rule" defaultValue={sp.rule || ""}><option value="">All tests</option>{Object.entries(RULES).map(([id, r]) => <option key={id} value={id}>{r.title}</option>)}</select></div>
            <div><label>Severity</label><select name="severity" defaultValue={sp.severity || ""}><option value="">All</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></div>
            <div><label>Status</label><select name="status" defaultValue={status}><option value="ACTIVE">Open + in progress</option><option value="">All</option>{FINDING_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label>Assignee</label><select name="assignee" defaultValue={sp.assignee || ""}><option value="">Anyone</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            <div><label>Account</label><input name="account" defaultValue={sp.account || ""} placeholder="e.g. 6100" /></div>
            <div className="row"><button className="btn primary">Filter</button><Link className="btn ghost" href={`/app/${ws.slug}/journal-audit`}>Clear</Link></div>
          </div>
        </form>

        <div className="row between small muted" style={{ marginBottom: ".5rem" }}><span>{count.n.toLocaleString()} finding(s)</span><span>Page {page} of {pages}</span></div>
        <div className="table-wrap"><table className="findings">
          <thead><tr><th>Severity</th><th>Finding</th><th>Journal</th><th>Account</th><th>Date</th><th className="num">Amount</th><th>Status</th><th>Assignee</th></tr></thead>
          <tbody>
            {findings.map((f) => {
              const d = JSON.parse(f.detail || "{}");
              return (
                <tr key={f.id}>
                  <td><SevBadge severity={f.severity} /></td>
                  <td className="wrap"><Link href={`/app/${ws.slug}/journal-audit/${f.id}`}>{f.title}</Link>{f.corrective && <span className="badge accent" style={{ marginLeft: 6 }}>fix proposed</span>}<div className="faint small">{(d.reasons?.[0] || d.day || (d.pairs ? d.pairs[0] : "") || d.line || "").toString().slice(0, 140)}</div></td>
                  <td>{f.journal_no?.startsWith("D:") ? "—" : (f.journal_no || "—").replace(/^J:/, "")}</td>
                  <td>{f.account_code ? <Link href={qs({ account: f.account_code, page: 1 })}>{f.account_code}</Link> : "—"}</td>
                  <td className="small">{f.entry_date ? formatDate(f.entry_date) : "—"}</td>
                  <td className="num">{f.amount_cents !== null ? formatMoney(f.amount_cents, ws.currency) : "—"}</td>
                  <td><StateBadge status={f.status} /></td>
                  <td className="small">{f.assignee_name || "—"}</td>
                </tr>);
            })}
            {!findings.length && <tr><td colSpan={8} className="empty">{lastRun ? "No findings match these filters." : "Run the journal tests to see findings."}</td></tr>}
          </tbody>
        </table></div>
        {pages > 1 && <div className="row" style={{ marginTop: ".8rem" }}>{page > 1 && <Link className="btn sm" href={qs({ page: page - 1 })}>← Previous</Link>}{page < pages && <Link className="btn sm" href={qs({ page: page + 1 })}>Next →</Link>}</div>}

        {canAdmin(ws.role) && sp.rule && RULES[sp.rule] && (
          <form action={bulkResolve} className="card row" style={{ marginTop: "1.5rem", alignItems: "end" }}>
            <input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="rule" value={sp.rule} />
            <div style={{ flex: 1, minWidth: 160 }}><label>Bulk-resolve open “{RULES[sp.rule].title}” (low/medium only)</label><select name="status"><option value="FALSE_POSITIVE">False positive</option><option value="ACCEPTED_RISK">Accepted risk</option></select></div>
            <div style={{ flex: 2, minWidth: 220 }}><label>Reason (recorded on the audit trail)</label><input name="note" required minLength={5} placeholder="e.g. Weekend postings are system batch jobs" /></div>
            <Submit className="btn" confirm="Update all open findings for this test?">Apply</Submit>
          </form>
        )}
      </>}
    </>
  );
}
