"use server";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, requirePerm, auditStmt, notifyStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { buildSnapshot, sectionDigest, SECTIONS } from "@/lib/boardpack/build";
import { aiAvailable, aiUnavailableReason, askClaude } from "@/lib/ai";
import { hit } from "@/lib/security/rate-limit";

const YM = /^\d{4}-\d{2}$/;
const KEYS = SECTIONS.map(([k]) => k);

async function loadPack(wsId, id) {
  const p = await db.get("SELECT * FROM board_packs WHERE id = ? AND workspace_id = ?", [id, wsId]);
  if (!p) return null;
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  return { ...p, sections: parse(p.sections, KEYS), commentary: parse(p.commentary, {}), snapshot: parse(p.snapshot, null) };
}

export async function createPack(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  if (!hit("heavy", ws.id).ok) back(`/app/${slug}/board-packs`, { err: "Too many runs in a short time. Wait a minute." });
  const period = String(formData.get("period") || "");
  if (!YM.test(period)) back(`/app/${slug}/board-packs`, { err: "Choose the reporting month." });
  const budgetId = String(formData.get("budget_id") || "") || null;
  if (budgetId && !(await db.get("SELECT 1 FROM budgets WHERE id = ? AND workspace_id = ?", [budgetId, ws.id]))) back(`/app/${slug}/board-packs`, { err: "Budget not found." });
  const sections = KEYS.filter((k) => k === "cover" || formData.get(`s_${k}`) === "1");
  const title = String(formData.get("title") || "").trim().slice(0, 120) || `Board pack — ${new Date(period + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  const snapshot = await buildSnapshot(ws, period, budgetId);
  const id = db.id(), t = db.now();
  await db.batch([
    { sql: "INSERT INTO board_packs (id, workspace_id, period, title, status, budget_id, sections, commentary, snapshot, version, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", args: [id, ws.id, period, title, "DRAFT", budgetId, JSON.stringify(sections), "{}", JSON.stringify(snapshot), 1, user.id, t, t] },
    auditStmt(ws.id, user.id, "boardpack.created", "board_pack", id, { period, title, budgetId }),
  ]);
  redirect(`/app/${slug}/board-packs/${id}?ok=${encodeURIComponent("Board pack created with a snapshot of today's numbers. Add commentary to each section, then send it for review.")}`);
}

/** Save one section's commentary (called from the browser) with optimistic locking. */
export async function saveCommentary(slug, id, version, key, text, { ai = false } = {}) {
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const p = await loadPack(ws.id, id);
  if (!p) return { error: "Board pack not found." };
  if (p.status === "APPROVED") return { error: "This pack is approved and can't be edited." };
  if (!KEYS.includes(key)) return { error: "Unknown section." };
  const commentary = { ...p.commentary, [key]: { text: String(text || "").slice(0, 8000), by: user.name, at: db.now(), ai: !!ai } };
  try {
    const v = await db.updateVersioned("board_packs", id, ws.id, version, { commentary: JSON.stringify(commentary), updated_at: db.now() });
    await db.batch([auditStmt(ws.id, user.id, "boardpack.commentary_saved", "board_pack", id, { section: key, ai: !!ai, chars: commentary[key].text.length })]);
    return { ok: true, version: v, entry: commentary[key] };
  } catch (e) {
    if (e.code === "CONFLICT") return { error: e.message, conflict: true };
    throw e;
  }
}

/** Draft commentary for a section with AI. Returned to the editor only — the user reviews and saves it. */
export async function draftCommentary(slug, id, key) {
  const { ws, user } = await requireWorkspace(slug, "MEMBER");
  if (!(await aiAvailable(ws))) return { error: (await aiUnavailableReason(ws)) || "AI is unavailable." };
  if (!hit("heavy", `ai|${ws.id}`).ok) return { error: "Too many AI requests. Wait a minute." };
  const p = await loadPack(ws.id, id);
  if (!p?.snapshot) return { error: "Board pack not found." };
  const title = SECTIONS.find(([k]) => k === key)?.[1] || key;
  const digest = sectionDigest(p.snapshot, key);
  if (!digest) return { error: "There's nothing to summarise in this section." };
  try {
    const text = await askClaude(
      "You are a CFO writing concise board-pack commentary for a Kenyan company. Use only the numbers provided; do not invent figures, causes or events. Write 3–6 short sentences or bullets: what happened, why it matters, and what management will do. Plain British English, no headings, amounts in the given currency.",
      `Company: ${p.snapshot.company}\nPeriod: ${p.snapshot.period}\nSection: ${title}\n\nNumbers:\n${digest}`,
      { ws, user, feature: "BOARD_PACK_DRAFT", maxTokens: 2000 });
    return { ok: true, text };
  } catch (e) { return { error: e.message }; }
}

export async function refreshSnapshot(formData) {
  const slug = String(formData.get("slug")), id = String(formData.get("id"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const p = await loadPack(ws.id, id);
  if (!p) back(`/app/${slug}/board-packs`, { err: "Board pack not found." });
  if (p.status !== "DRAFT") back(`/app/${slug}/board-packs/${id}`, { err: "Only draft packs can be refreshed; numbers are frozen once sent for review." });
  const snapshot = await buildSnapshot(ws, p.period, p.budget_id);
  await db.batch([
    { sql: "UPDATE board_packs SET snapshot = ?, version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ?", args: [JSON.stringify(snapshot), db.now(), id, ws.id] },
    auditStmt(ws.id, user.id, "boardpack.refreshed", "board_pack", id, { period: p.period }),
  ]);
  back(`/app/${slug}/board-packs/${id}`, { ok: "Numbers refreshed from the latest ledger." });
}

const FLOW = {
  submit: { from: ["DRAFT"], to: "IN_REVIEW", perm: "data.edit", verb: "sent for review" },
  approve: { from: ["IN_REVIEW"], to: "APPROVED", perm: "approve", verb: "approved" },
  reject: { from: ["IN_REVIEW", "APPROVED"], to: "DRAFT", perm: "approve", verb: "returned to draft" },
};

export async function changePackStatus(formData) {
  const slug = String(formData.get("slug")), id = String(formData.get("id")), action = String(formData.get("action"));
  const path = `/app/${slug}/board-packs/${id}`;
  const f = FLOW[action];
  if (!f) back(path, { err: "Unknown action." });
  const { user, ws } = await requirePerm(slug, f.perm);
  const p = await loadPack(ws.id, id);
  if (!p || !f.from.includes(p.status)) back(path, { err: "That change isn't allowed from the pack's current status." });
  if (action === "approve" && p.created_by === user.id && ws.role !== "OWNER") back(path, { err: "Segregation of duties: someone other than the preparer must approve the pack." });
  const stmts = [
    { sql: `UPDATE board_packs SET status = ?, version = version + 1, updated_at = ?${action === "approve" ? ", approved_by = ?, approved_at = ?" : ", approved_by = NULL, approved_at = NULL"} WHERE id = ? AND status = ?`, args: action === "approve" ? [f.to, db.now(), user.id, db.now(), id, p.status] : [f.to, db.now(), id, p.status] },
    auditStmt(ws.id, user.id, `boardpack.${action}`, "board_pack", id, { from: p.status, to: f.to }),
  ];
  if (action === "submit") for (const a of await db.all("SELECT user_id FROM memberships WHERE workspace_id = ? AND role IN ('OWNER','ADMIN') AND user_id <> ?", [ws.id, user.id])) stmts.push(notifyStmt(ws.id, a.user_id, "boardpack.review", `Board pack “${p.title}” is ready for your review`, path));
  else stmts.push(notifyStmt(ws.id, p.created_by, `boardpack.${action}`, `Board pack “${p.title}” was ${f.verb}`, path));
  await db.batch(stmts.filter(Boolean));
  back(path, { ok: `Board pack ${f.verb}.` });
}

export async function deletePack(formData) {
  const slug = String(formData.get("slug")), id = String(formData.get("id"));
  const { user, ws } = await requirePerm(slug, "admin");
  const p = await loadPack(ws.id, id);
  if (!p) back(`/app/${slug}/board-packs`, { err: "Board pack not found." });
  if (p.status === "APPROVED" && ws.role !== "OWNER") back(`/app/${slug}/board-packs/${id}`, { err: "Approved packs can only be deleted by the owner." });
  await db.batch([{ sql: "DELETE FROM board_packs WHERE id = ? AND workspace_id = ?", args: [id, ws.id] }, auditStmt(ws.id, user.id, "boardpack.deleted", "board_pack", id, { title: p.title, status: p.status })]);
  back(`/app/${slug}/board-packs`, { ok: `Deleted “${p.title}”.` });
}
