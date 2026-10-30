// CSV of proposed correcting journals, in a generic journal-import layout most ERPs accept
// (one row per line, debit/credit columns). Values are escaped against spreadsheet formula injection.
import db from "@/lib/db";
import { requireWorkspace, auditStmt } from "@/lib/auth";

const cell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const amt = (c) => (c ? (c / 100).toFixed(2) : "");

export async function GET(req, { params }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const sp = new URL(req.url).searchParams;
  const where = ["workspace_id = ?", "corrective IS NOT NULL"], args = [ws.id];
  const status = sp.get("status") || "ACTIVE";
  if (status === "ACTIVE") where.push("status IN ('OPEN','IN_PROGRESS')"); else if (status) { where.push("status = ?"); args.push(status); }
  if (sp.get("rule")) { where.push("rule = ?"); args.push(sp.get("rule")); }
  if (sp.get("severity")) { where.push("severity = ?"); args.push(sp.get("severity")); }
  const rows = await db.all(`SELECT id, rule, title, journal_no, entry_date, corrective FROM audit_findings WHERE ${where.join(" AND ")} ORDER BY entry_date LIMIT 5000`, args);
  const out = [["Journal ref", "Date", "Account code", "Account name", "Description", "Debit", "Credit", "Finding", "Source journal"].join(",")];
  const today = new Date().toISOString().slice(0, 10);
  rows.forEach((f, i) => {
    const ref = `NQ-FIX-${String(i + 1).padStart(4, "0")}`;
    for (const l of JSON.parse(f.corrective).lines || []) {
      out.push([ref, today, l.accountCode, l.accountName, l.description, amt(l.debitCents), amt(l.creditCents), f.title, f.journal_no?.startsWith("D:") ? "" : f.journal_no].map(cell).join(","));
    }
  });
  await db.batch([auditStmt(ws.id, user.id, "finding.corrections_exported", "audit_finding", null, { findings: rows.length })]);
  return new Response("﻿" + out.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="correcting-journals-${ws.slug}-${today}.csv"`, "cache-control": "no-store" } });
}
