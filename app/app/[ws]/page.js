import Link from "next/link";
import "@/styles/planning.css";
import db from "@/lib/db";
import { requireWorkspace, can, ROLE_LABELS } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import { formatDateTime } from "@/lib/dates";
import { StatusBadge } from "@/components/Badges";
import { KpiTile } from "@/components/charts";
import { buildSeries, computeKpis } from "@/lib/kpi";
import { loadKpiInputs } from "@/lib/budget/data";
import { loadAlerts } from "@/lib/boardpack/alerts";
export const dynamic = "force-dynamic";

const safe = (p, d) => p.catch(() => d);

export default async function Overview({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const w = ws.id;
  const base = `/app/${ws.slug}`;
  const today = new Date().toISOString().slice(0, 10);
  const isCfo = can(ws.role, "approve");
  const isAuditor = ws.role === "AUDITOR";
  const [le, bank, stmts, recs, reps, lastImport, team, myTasks, myFindings, myQueries, myNotes, notifs, alerts, budgets, packs] = await Promise.all([
    db.get("SELECT COUNT(*) n, MIN(date) mn, MAX(date) mx FROM ledger_entries WHERE workspace_id = ?", [w]),
    db.get("SELECT COUNT(*) n FROM bank_accounts WHERE workspace_id = ?", [w]),
    db.get("SELECT COUNT(*) n FROM bank_statements WHERE workspace_id = ?", [w]),
    db.all("SELECT r.*, b.name bank FROM reconciliations r JOIN bank_accounts b ON b.id = r.bank_account_id WHERE r.workspace_id = ? ORDER BY r.updated_at DESC LIMIT 5", [w]),
    db.get("SELECT COUNT(*) n FROM reports WHERE workspace_id = ?", [w]),
    db.get("SELECT * FROM ledger_imports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1", [w]),
    db.get("SELECT COUNT(*) n FROM memberships WHERE workspace_id = ?", [w]),
    db.all("SELECT id, title, period, status, due_date, priority FROM close_tasks WHERE workspace_id = ? AND assignee_id = ? AND status <> 'DONE' ORDER BY (due_date IS NULL), due_date, period LIMIT 8", [w, user.id]),
    safe(db.all("SELECT id, title, severity, entry_date FROM audit_findings WHERE workspace_id = ? AND assignee_id = ? AND status = 'OPEN' ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END LIMIT 6", [w, user.id]), []),
    safe(db.all(isAuditor ? "SELECT id, ref, title, status, due_date FROM auditor_queries WHERE workspace_id = ? AND raised_by = ? AND status <> 'CLOSED' ORDER BY created_at DESC LIMIT 6" : "SELECT id, ref, title, status, due_date FROM auditor_queries WHERE workspace_id = ? AND assignee_id = ? AND status NOT IN ('CLOSED','RESPONDED') ORDER BY (due_date IS NULL), due_date LIMIT 6", [w, user.id]), []),
    db.all("SELECT n.budget_id, n.account_code, n.period, n.action FROM budget_notes n WHERE n.workspace_id = ? AND n.owner_id = ? AND n.action IS NOT NULL ORDER BY n.created_at DESC LIMIT 5", [w, user.id]),
    db.all("SELECT id, title, link, created_at FROM notifications WHERE workspace_id = ? AND user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 6", [w, user.id]),
    loadAlerts(w, { today }),
    db.all("SELECT id, name, status FROM budgets WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 3", [w]),
    db.all("SELECT id, title, status, period FROM board_packs WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 3", [w]),
  ]);
  const period = await db.get("SELECT period FROM close_tasks WHERE workspace_id = ? ORDER BY period DESC LIMIT 1", [w]);
  const close = period ? await db.get("SELECT COUNT(*) n, SUM(status = 'DONE') done FROM close_tasks WHERE workspace_id = ? AND period = ?", [w, period.period]) : null;
  let kpis = null;
  if (le.n && !isAuditor) {
    const inputs = await loadKpiInputs(w, null, 13);
    if (inputs) kpis = Object.fromEntries(computeKpis(buildSeries(inputs), inputs.months, { aging: inputs.aging }).map((k) => [k.key, k]));
  }
  const steps = [
    [le.n > 0, "Import your ledger", `${base}/data?kind=ledger`, "Upload a CSV or Excel export of your general ledger — or connect your ERP."],
    [bank.n > 0, "Add a bank account", `${base}/bank`, "Link it to the ledger account that records its transactions."],
    [stmts.n > 0, "Import a bank statement", `${base}/bank`, "Upload the statement for a period."],
    [recs.length > 0, "Run a reconciliation", `${base}/reconciliations/new`, "Match the statement to the ledger and review exceptions."],
    [budgets.length > 0, "Create a budget", `${base}/budgets/new`, "Generate next year's budget from your own history."],
    [reps.n > 0, "Save a variance report", `${base}/reports/new`, "Compare two periods and explain material changes."],
    [team.n > 1, "Invite your team", `${base}/team`, "Add accountants, reviewers, auditors and viewers."],
  ];
  const done = steps.filter((s) => s[0]).length;
  const tileKeys = isCfo ? ["revenue", "net_profit", "cash", "runway"] : ["revenue", "gross_margin", "cash", "working_capital"];
  const workItems = myTasks.length + myFindings.length + myQueries.length + myNotes.length;
  return (
    <>
      <PageHead title={`Good ${new Date().getUTCHours() + 3 < 12 ? "morning" : new Date().getUTCHours() + 3 < 17 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`} desc={`${ws.name} · Kenya · reporting in ${ws.currency} · you're signed in as ${ROLE_LABELS[ws.role] || ws.role}`}>
        {isCfo && <Link className="btn" href={`${base}/dashboard`}>CFO dashboard</Link>}
        {isCfo && <Link className="btn primary" href={`${base}/board-packs`}>Board packs</Link>}
      </PageHead>
      <Flash searchParams={searchParams} />

      {kpis &&<div className="kpi-grid" style={{ marginBottom: "1rem" }}>{tileKeys.map((k) => kpis[k] && <KpiTile key={k} kpi={kpis[k]} currency={ws.currency} href={isCfo ? `${base}/dashboard` : undefined} />)}</div>}

      <div className="grid grid-2" style={{ marginBottom: "1rem", alignItems: "start" }}>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>{isAuditor ? "Your audit queries" : "Your work"}</h3>{!isAuditor && <Link className="btn sm" href={`${base}/tasks?view=mine`}>All my tasks</Link>}</div>
          {workItems === 0 && <p className="muted small" style={{ marginTop: ".8rem" }}>{isAuditor ? <>No open queries. <Link href={`${base}/queries`}>Raise a query</Link>.</> : "Nothing assigned to you right now."}</p>}
          <ul className="alert-list" style={{ marginTop: ".5rem" }}>
            {myTasks.map((t) => <li key={t.id}><span className={`badge ${t.due_date && t.due_date < today ? "bad" : ""}`}>{t.due_date && t.due_date < today ? "Overdue" : t.due_date || "Close"}</span><div><Link href={`${base}/close?period=${t.period}`}>{t.title}</Link><div className="faint small">Month-end close {t.period} · <StatusBadge status={t.status} /></div></div></li>)}
            {myFindings.map((f) => <li key={f.id}><span className={`badge ${f.severity === "HIGH" || f.severity === "CRITICAL" ? "bad" : "warn"}`}>{String(f.severity).toLowerCase()}</span><div><Link href={`${base}/journal-audit`}>{f.title}</Link><div className="faint small">Journal audit finding{f.entry_date ? ` · ${f.entry_date}` : ""}</div></div></li>)}
            {myQueries.map((q) => <li key={q.id}><span className={`badge ${q.due_date && q.due_date < today ? "bad" : "info"}`}>{q.ref}</span><div><Link href={`${base}/queries/${q.id}`}>{q.title}</Link><div className="faint small">Auditor query · {String(q.status).toLowerCase().replace("_", " ")}{q.due_date ? ` · due ${q.due_date}` : ""}</div></div></li>)}
            {myNotes.map((n, i) => <li key={i}><span className="badge warn">Budget</span><div><Link href={`${base}/budgets/${n.budget_id}?tab=bva&month=${n.period}`}>{n.action}</Link><div className="faint small">Variance action · {n.account_code} · {n.period}</div></div></li>)}
          </ul>
        </div>
        <div className="card">
          <h3 style={{ margin: 0 }}>Needs attention</h3>
          {alerts.list.length === 0 && notifs.length === 0 && <p className="muted small" style={{ marginTop: ".8rem" }}>No open control alerts.</p>}
          <ul className="alert-list" style={{ marginTop: ".5rem" }}>
            {alerts.list.map((a) => <li key={a.text}><span className={`badge ${a.level}`}>{a.level === "bad" ? "Action" : "Review"}</span><Link href={base + a.href}>{a.text}</Link></li>)}
            {notifs.map((n) => <li key={n.id}><span className="badge info">New</span><div>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}<div className="faint small">{formatDateTime(n.created_at)}</div></div></li>)}
          </ul>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: "1.5rem" }}>
        <Link href={`${base}/ledger`} className="card stat" style={{ color: "var(--text)", textDecoration: "none" }}><div className="label">Ledger entries</div><div className="value">{le.n.toLocaleString()}</div><div className="faint small">{le.n ? `${le.mn} → ${le.mx}` : "None yet"}</div></Link>
        <Link href={`${base}/reconciliations`} className="card stat" style={{ color: "var(--text)", textDecoration: "none" }}><div className="label">Open recon exceptions</div><div className="value" style={{ color: alerts.reconEx ? "var(--bad)" : undefined }}>{alerts.reconEx}</div><div className="faint small">{bank.n} bank account{bank.n === 1 ? "" : "s"} · {stmts.n} statement{stmts.n === 1 ? "" : "s"}</div></Link>
        <Link href={`${base}/close`} className="card stat" style={{ color: "var(--text)", textDecoration: "none" }}><div className="label">Close {period?.period || ""}</div><div className="value">{close ? `${close.done || 0}/${close.n}` : "—"}</div>{close && <div className="progress" style={{ marginTop: 6 }}><span style={{ width: `${close.n ? ((close.done || 0) / close.n) * 100 : 0}%` }} /></div>}</Link>
        <Link href={`${base}/budgets`} className="card stat" style={{ color: "var(--text)", textDecoration: "none" }}><div className="label">Budgets</div><div className="value">{budgets.length ? budgets[0].status.toLowerCase() : "—"}</div><div className="faint small">{budgets[0]?.name || "None yet"}</div></Link>
      </div>

      <div className="grid grid-2">
        {done < steps.length ? <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Getting started</h3><span className="badge">{done}/{steps.length}</span></div>
          <div style={{ marginTop: ".8rem" }}>
            {steps.map(([ok, t, href, d]) => (
              <div key={t} className="row" style={{ padding: ".5rem 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start", flexWrap: "nowrap" }}>
                <span className={`badge ${ok ? "good" : ""}`}>{ok ? "Done" : "To do"}</span>
                <div><Link href={href}>{t}</Link><div className="muted small">{d}</div></div>
              </div>))}
          </div>
        </div> : <div className="card">
          <h3 style={{ margin: 0 }}>Board packs</h3>
          {packs.length === 0 ? <p className="muted small" style={{ marginTop: ".8rem" }}>None yet. <Link href={`${base}/board-packs`}>Create one</Link>.</p> :
            <div style={{ marginTop: ".8rem" }}>{packs.map((p) => <Link key={p.id} href={`${base}/board-packs/${p.id}`} className="row between" style={{ padding: ".55rem 0", borderBottom: "1px solid var(--border)", color: "var(--text)", textDecoration: "none" }}><div><strong>{p.title}</strong><div className="muted small">{p.period}</div></div><span className="badge">{p.status.toLowerCase().replace("_", " ")}</span></Link>)}</div>}
        </div>}
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Recent reconciliations</h3>{!isAuditor && <Link href={`${base}/reconciliations/new`} className="btn sm">New</Link>}</div>
          {recs.length === 0 ? <p className="muted" style={{ marginTop: "1rem" }}>None yet.</p> :
            <div style={{ marginTop: ".8rem" }}>{recs.map((r) => (
              <Link key={r.id} href={`${base}/reconciliations/${r.id}`} className="row between" style={{ padding: ".55rem 0", borderBottom: "1px solid var(--border)", color: "var(--text)", textDecoration: "none" }}>
                <div><strong>{r.name}</strong><div className="muted small">{r.bank} · updated {formatDateTime(r.updated_at)}</div></div>
                <StatusBadge status={r.status} />
              </Link>))}</div>}
          {lastImport && <p className="faint small" style={{ marginTop: "1rem", marginBottom: 0 }}>Last ledger import: {lastImport.file_name} ({lastImport.row_count} rows), {formatDateTime(lastImport.created_at)}</p>}
        </div>
      </div>
    </>
  );
}
