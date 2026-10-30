"use server";
import db from "@/lib/db";
import { requireWorkspace, auditStmt, notifyStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { hit } from "@/lib/security/rate-limit";
import { parseAmount } from "@/lib/money";
import { RULES } from "@/lib/audit/journal-rules";
import { runAndSaveJournalAudit } from "@/lib/audit/data";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const FINAL = ["CORRECTED", "ACCEPTED_RISK", "FALSE_POSITIVE"];

export async function runAudit(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const path = `/app/${slug}/journal-audit`;
  if (!hit("heavy", ws.id).ok) back(path, { err: "Too many engine runs in the last minute. Wait a moment." });
  const from = String(formData.get("from") || ""), to = String(formData.get("to") || "");
  if (!ISO.test(from) || !ISO.test(to) || from > to) back(path, { err: "Choose a valid date range." });
  const params = {};
  const money = (k) => { const c = parseAmount(String(formData.get(k) || "")); return c && c > 0 ? c : undefined; };
  if (money("approvalLimit")) params.approvalLimitCents = money("approvalLimit");
  if (money("materiality")) params.materialityCents = money("materiality");
  if (money("capex")) params.capexThresholdCents = money("capex");
  const sus = String(formData.get("suspenseAccount") || "").trim(); if (sus) params.suspenseAccount = sus.slice(0, 30);
  const rules = formData.getAll("rules").map(String).filter((r) => RULES[r]);
  if (rules.length && rules.length < Object.keys(RULES).length) params.enabled = rules;
  const holidays = String(formData.get("holidays") || "").split(/[,\s]+/).filter((d) => ISO.test(d)).map((date) => ({ date, name: "Gazetted holiday" }));
  if (holidays.length) params.extraHolidays = holidays;
  const { runId, stats } = await runAndSaveJournalAudit(ws, user, { from, to, params });
  await db.batch([auditStmt(ws.id, user.id, "journal_audit.run", "audit_run", runId, { from, to, findings: stats.findings, lines: stats.lines })]);
  back(`${path}?run=${runId}`, { ok: `Tested ${stats.lines.toLocaleString()} lines in ${stats.journals.toLocaleString()} journals: ${stats.findings} finding(s) (${stats.bySeverity.HIGH} high, ${stats.bySeverity.MEDIUM} medium, ${stats.bySeverity.LOW} low).` });
}

async function loadFinding(formData, minRole = "MEMBER") {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, minRole);
  const id = String(formData.get("id"));
  const f = await db.get("SELECT * FROM audit_findings WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!f) back(`/app/${slug}/journal-audit`, { err: "Finding not found." });
  return { user, ws, slug, f, path: `/app/${slug}/journal-audit/${id}` };
}

export async function assignFinding(formData) {
  const { user, ws, slug, f, path } = await loadFinding(formData);
  const assignee = String(formData.get("assignee_id") || "");
  const member = await db.get("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.id = ? AND m.role IN ('OWNER','ADMIN','MEMBER')", [ws.id, assignee]);
  if (!member) back(path, { err: "Choose a team member who can edit (owner, admin or accountant)." });
  const due = String(formData.get("due_date") || "");
  const t = db.now();
  const existing = await db.get("SELECT id FROM close_tasks WHERE workspace_id = ? AND source_type = 'finding' AND source_id = ?", [ws.id, f.id]);
  const taskId = existing?.id || db.id();
  const title = `Audit finding: ${f.title}${f.journal_no ? ` (${f.journal_no})` : f.account_code ? ` (${f.account_code})` : ""}`.slice(0, 200);
  await db.batch([
    { sql: "UPDATE audit_findings SET assignee_id = ?, status = CASE WHEN status IN ('OPEN','CLEARED') THEN 'IN_PROGRESS' ELSE status END WHERE id = ?", args: [member.id, f.id] },
    existing
      ? { sql: "UPDATE close_tasks SET assignee_id = ?, due_date = COALESCE(?, due_date), updated_at = ?, version = version + 1 WHERE id = ?", args: [member.id, ISO.test(due) ? due : null, t, taskId] }
      : { sql: "INSERT INTO close_tasks (id, workspace_id, period, title, category, status, assignee_id, reviewer_id, due_date, sort_order, created_at, updated_at, priority, description, source_type, source_id) VALUES (?,?,?,?,?,'TODO',?,?,?,?,?,?,?,?,'finding',?)",
        args: [taskId, ws.id, (f.entry_date || t).slice(0, 7), title, "Audit findings", member.id, user.id !== member.id ? user.id : null, ISO.test(due) ? due : null, 9000, t, t, f.severity === "HIGH" ? "HIGH" : "NORMAL", `${f.suggestion || ""}\n\nOpen the finding: /app/${slug}/journal-audit/${f.id}`.trim(), f.id] },
    notifyStmt(ws.id, member.id, "finding.assigned", `${user.name} assigned you: ${f.title}`, `/app/${slug}/journal-audit/${f.id}`),
    auditStmt(ws.id, user.id, "finding.assigned", "audit_finding", f.id, { rule: f.rule, assignee: member.name, taskId }),
  ].filter(Boolean));
  back(path, { ok: `Assigned to ${member.name}. A task was added to their list.` });
}

export async function resolveFinding(formData) {
  const { user, ws, f, path } = await loadFinding(formData);
  const status = String(formData.get("status") || "");
  const note = String(formData.get("note") || "").trim().slice(0, 2000);
  if (![...FINAL, "OPEN", "IN_PROGRESS"].includes(status)) back(path, { err: "Choose a status." });
  if (FINAL.includes(status) && note.length < 5) back(path, { err: "Add a note explaining the resolution (it goes on the audit trail)." });
  if (status === "ACCEPTED_RISK" && f.severity === "HIGH" && !["OWNER", "ADMIN"].includes(ws.role)) back(path, { err: "Only an admin/CFO can accept the risk on a high-severity finding." });
  const t = db.now();
  await db.batch([
    { sql: "UPDATE audit_findings SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", args: [status, note || f.resolution_note, FINAL.includes(status) ? user.id : null, FINAL.includes(status) ? t : null, f.id] },
    FINAL.includes(status) ? { sql: "UPDATE close_tasks SET status = 'DONE', completed_at = ?, completed_by = ?, updated_at = ?, version = version + 1 WHERE workspace_id = ? AND source_type = 'finding' AND source_id = ? AND status <> 'DONE'", args: [t, user.id, t, ws.id, f.id] } : null,
    auditStmt(ws.id, user.id, "finding.status_changed", "audit_finding", f.id, { rule: f.rule, from: f.status, to: status, note }),
  ].filter(Boolean));
  back(path, { ok: "Finding updated." });
}

export async function bulkResolve(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const rule = String(formData.get("rule") || "");
  const status = String(formData.get("status") || "");
  const note = String(formData.get("note") || "").trim().slice(0, 500);
  const path = `/app/${slug}/journal-audit?rule=${encodeURIComponent(rule)}`;
  if (!RULES[rule] || !["ACCEPTED_RISK", "FALSE_POSITIVE"].includes(status) || note.length < 5) back(path, { err: "Choose a rule, a status and a note of at least 5 characters." });
  const r = await db.run("UPDATE audit_findings SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE workspace_id = ? AND rule = ? AND status = 'OPEN' AND severity <> 'HIGH'", [status, note, user.id, db.now(), ws.id, rule]);
  await db.batch([auditStmt(ws.id, user.id, "finding.bulk_resolved", "audit_finding", null, { rule, status, count: r.changes, note })]);
  back(path, { ok: `Updated ${r.changes} open finding(s). High-severity findings must be resolved one by one.` });
}
