// Cross-module control alerts for the dashboard, overview and board packs. Server-only.
// Each query is defensive: a module may not have data yet.
import "server-only";
import db from "../db";

const safe = (p, fallback) => p.catch(() => fallback);

export async function loadAlerts(wsId, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const [findings, overdue, taxOpen, reconEx, queries, closeP] = await Promise.all([
    safe(db.all("SELECT severity, COUNT(*) n, SUM(COALESCE(ABS(amount_cents),0)) amt FROM audit_findings WHERE workspace_id = ? AND status = 'OPEN' GROUP BY severity", [wsId]), []),
    safe(db.get("SELECT COUNT(*) n FROM close_tasks WHERE workspace_id = ? AND status <> 'DONE' AND due_date IS NOT NULL AND due_date < ?", [wsId, today]), { n: 0 }),
    safe(db.get("SELECT COUNT(*) n, SUM(ABS(COALESCE(i.diff_cents,0))) amt FROM tax_recon_items i JOIN tax_recon_runs r ON r.id = i.run_id WHERE i.workspace_id = ? AND i.status <> 'MATCHED' AND i.review_status = 'OPEN' AND r.id IN (SELECT id FROM tax_recon_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 4)", [wsId, wsId]), { n: 0 }),
    safe(db.get("SELECT COUNT(*) n FROM recon_exceptions e JOIN reconciliations r ON r.id = e.reconciliation_id WHERE r.workspace_id = ? AND e.status = 'OPEN'", [wsId]), { n: 0 }),
    safe(db.get("SELECT COUNT(*) n, SUM(due_date IS NOT NULL AND due_date < ?) late FROM auditor_queries WHERE workspace_id = ? AND status NOT IN ('CLOSED','RESPONDED')", [today, wsId]), { n: 0, late: 0 }),
    safe(db.get("SELECT period, COUNT(*) n, SUM(status = 'DONE') done FROM close_tasks WHERE workspace_id = ? GROUP BY period ORDER BY period DESC LIMIT 1", [wsId]), null),
  ]);
  const sev = Object.fromEntries(findings.map((f) => [String(f.severity).toUpperCase(), f]));
  const high = (sev.CRITICAL?.n || 0) + (sev.HIGH?.n || 0);
  const list = [];
  if (high) list.push({ level: "bad", text: `${high} high-risk journal audit finding${high === 1 ? "" : "s"} open`, href: "/journal-audit" });
  if (overdue?.n) list.push({ level: "bad", text: `${overdue.n} month-end close task${overdue.n === 1 ? " is" : "s are"} overdue`, href: "/close" });
  if (taxOpen?.n) list.push({ level: "warn", text: `${taxOpen.n} unresolved VAT reconciliation item${taxOpen.n === 1 ? "" : "s"} (iTax vs ERP)`, href: "/tax/vat" });
  if (reconEx?.n) list.push({ level: "warn", text: `${reconEx.n} open bank reconciliation exception${reconEx.n === 1 ? "" : "s"}`, href: "/reconciliations" });
  if (queries?.n) list.push({ level: queries.late ? "bad" : "warn", text: `${queries.n} auditor quer${queries.n === 1 ? "y" : "ies"} awaiting response${queries.late ? ` (${queries.late} past due)` : ""}`, href: "/queries" });
  return { list, findings: sev, overdue: overdue?.n || 0, taxOpen: taxOpen?.n || 0, taxAmt: taxOpen?.amt || 0, reconEx: reconEx?.n || 0, queries: queries || { n: 0 }, close: closeP };
}
