"use server";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, audit, auditStmt } from "@/lib/auth";
import { computeFlux } from "@/lib/flux";
import { parseAmount } from "@/lib/money";
import { back } from "@/lib/flash";
import { aiAvailable, aiUnavailableReason, askClaude } from "@/lib/ai";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function analyse(wsId, r, prefix) {
  const entries = await db.all(
    `SELECT id, date, description, reference, account_code accountCode, account_name accountName, amount_cents amountCents, counterparty
     FROM ledger_entries WHERE workspace_id = ? AND ((date BETWEEN ? AND ?) OR (date BETWEEN ? AND ?)) ${prefix ? "AND account_code LIKE ?" : ""}`,
    [wsId, r.base_start, r.base_end, r.comp_start, r.comp_end, ...(prefix ? [`${prefix}%`] : [])]
  );
  return computeFlux(entries, { baseStart: r.base_start, baseEnd: r.base_end, compStart: r.comp_start, compEnd: r.comp_end, thresholdPct: r.threshold_pct, thresholdCents: r.threshold_cents });
}

export async function createReport(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const r = {
    base_start: String(formData.get("base_start")), base_end: String(formData.get("base_end")),
    comp_start: String(formData.get("comp_start")), comp_end: String(formData.get("comp_end")),
    threshold_pct: Math.max(0, parseInt(formData.get("threshold_pct") || "10", 10) || 0),
    threshold_cents: Math.abs(parseAmount(String(formData.get("threshold_amount") || "50000")) ?? 5000000),
  };
  if (![r.base_start, r.base_end, r.comp_start, r.comp_end].every((d) => ISO.test(d))) back(`/app/${slug}/reports/new`, { err: "Fill in all four dates." });
  if (r.base_start > r.base_end || r.comp_start > r.comp_end) back(`/app/${slug}/reports/new`, { err: "Each period's start must be before its end." });
  const prefix = String(formData.get("prefix") || "").trim();
  const data = await analyse(ws.id, r, prefix);
  if (!data.lines.length) back(`/app/${slug}/reports/new`, { err: "No ledger entries fall in either period." });
  data.prefix = prefix;
  const name = String(formData.get("name") || "").trim() || `Variance ${r.comp_start.slice(0, 7)} vs ${r.base_start.slice(0, 7)}`;
  const id = db.id(); const t = db.now();
  await db.run("INSERT INTO reports (id, workspace_id, name, base_start, base_end, comp_start, comp_end, threshold_pct, threshold_cents, data, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, ws.id, name, r.base_start, r.base_end, r.comp_start, r.comp_end, r.threshold_pct, r.threshold_cents, JSON.stringify(data), user.id, t, t]);
  await audit(ws.id, user.id, "report.created", "report", id, { name, material: data.totals.material, accounts: data.totals.accounts });
  redirect(`/app/${slug}/reports/${id}`);
}

async function loadReport(formData, minRole = "MEMBER") {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, minRole);
  const rep = await db.get("SELECT * FROM reports WHERE id = ? AND workspace_id = ?", [String(formData.get("report")), ws.id]);
  if (!rep) back(`/app/${slug}/reports`, { err: "Report not found." });
  return { user, ws, rep, slug, path: `/app/${slug}/reports/${rep.id}` };
}

export async function saveNote(formData) {
  const { user, ws, rep, path } = await loadReport(formData);
  const code = String(formData.get("account"));
  const note = String(formData.get("note") || "").trim().slice(0, 2000);
  const notes = JSON.parse(rep.notes || "{}");
  if (note) notes[code] = { text: note, by: user.name, at: db.now() }; else delete notes[code];
  await db.batch([
    { sql: "UPDATE reports SET notes = ?, updated_at = ? WHERE id = ?", args: [JSON.stringify(notes), db.now(), rep.id] },
    auditStmt(ws.id, user.id, "report.note_saved", "report", rep.id, { account: code }),
  ]);
  back(`${path}#acct-${code}`);
}

export async function recompute(formData) {
  const { user, ws, rep, path } = await loadReport(formData);
  const prev = JSON.parse(rep.data);
  const data = await analyse(ws.id, rep, prev.prefix);
  data.prefix = prev.prefix;
  await db.batch([
    { sql: "UPDATE reports SET data = ?, status = 'DRAFT', updated_at = ? WHERE id = ?", args: [JSON.stringify(data), db.now(), rep.id] },
    auditStmt(ws.id, user.id, "report.recomputed", "report", rep.id, { material: data.totals.material }),
  ]);
  back(path, { ok: "Recalculated from the current ledger. Reviewer notes were kept; status reset to draft." });
}

export async function setReportStatus(formData) {
  const { user, ws, rep, path } = await loadReport(formData);
  const status = formData.get("status") === "REVIEWED" ? "REVIEWED" : "DRAFT";
  if (status === "REVIEWED") {
    const data = JSON.parse(rep.data); const notes = JSON.parse(rep.notes || "{}");
    const missing = data.lines.filter((l) => l.material && !notes[l.accountCode]).length;
    if (missing) back(path, { err: `Add an explanation for the ${missing} material account${missing === 1 ? "" : "s"} before marking the report reviewed.` });
  }
  await db.batch([
    { sql: "UPDATE reports SET status = ?, updated_at = ? WHERE id = ?", args: [status, db.now(), rep.id] },
    auditStmt(ws.id, user.id, `report.${status.toLowerCase()}`, "report", rep.id, {}),
  ]);
  back(path, { ok: status === "REVIEWED" ? "Marked as reviewed." : "Moved back to draft." });
}

export async function aiSummary(formData) {
  const { user, ws, rep, path } = await loadReport(formData);
  if (!(await aiAvailable(ws))) back(path, { err: (await aiUnavailableReason(ws)) || "AI is unavailable." });
  const data = JSON.parse(rep.data); const notes = JSON.parse(rep.notes || "{}");
  const material = data.lines.filter((l) => l.material).slice(0, 25).map((l) => ({ account: `${l.accountCode} ${l.accountName}`, base: l.base / 100, current: l.comp / 100, change: l.change / 100, pct: l.pct, drivers: l.drivers.map((d) => ({ name: d.name, change: d.change / 100 })), reviewerNote: notes[l.accountCode]?.text }));
  let text;
  try {
    text = await askClaude(
      "You are a careful finance analyst writing for a management team at a growing business in Kenya. Write a short variance commentary (150–250 words, plain prose, no headings) using ONLY the data provided. Do not invent causes; where the cause isn't in the data or reviewer notes, say what should be confirmed. Positive amounts are debits, negative are credits.",
      `Company: ${ws.name}\nCurrency: ${ws.currency}\nCurrent period: ${rep.comp_start} to ${rep.comp_end}\nComparison period: ${rep.base_start} to ${rep.base_end}\nMaterial movements: ${JSON.stringify(material)}`,
      { ws, user, feature: "VARIANCE_COMMENTARY", maxTokens: 2000 }
    );
  } catch (e) { back(path, { err: e.message }); }
  await db.batch([
    { sql: "UPDATE reports SET ai_summary = ?, updated_at = ? WHERE id = ?", args: [text, db.now(), rep.id] },
    auditStmt(ws.id, user.id, "report.ai_summary", "report", rep.id, {}),
  ]);
  back(path, { ok: "AI draft added. Review it before sharing." });
}

export async function deleteReport(formData) {
  const { user, ws, rep, slug } = await loadReport(formData, "ADMIN");
  await db.batch([{ sql: "DELETE FROM reports WHERE id = ?", args: [rep.id] }, auditStmt(ws.id, user.id, "report.deleted", "report", rep.id, { name: rep.name })]);
  back(`/app/${slug}/reports`, { ok: `Deleted ${rep.name}.` });
}
