"use server";
import db from "@/lib/db";
import { requireWorkspace, auditStmt } from "@/lib/auth";
import { normalizeSettings } from "@/lib/cashflow";

/**
 * Save forecast settings (13-week scenarios, actual-week corrections and the 12-month view) with an
 * optimistic lock: if someone else saved since this page loaded, nothing is overwritten.
 */
export async function saveForecastVersioned(slug, settings, version) {
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const clean = normalizeSettings(settings);
  // Stamp who corrected each actual week (server-side, not trusted from the browser).
  const before = await db.get("SELECT settings, version FROM cash_forecasts WHERE workspace_id = ?", [ws.id]);
  let prevActual = {};
  try { prevActual = before ? normalizeSettings(JSON.parse(before.settings)).actualOverrides : {}; } catch { prevActual = {}; }
  for (const [k, o] of Object.entries(clean.actualOverrides)) {
    const p = prevActual[k];
    if (!p || p.cents !== o.cents || p.note !== o.note) { o.by = user.name; o.at = db.now(); } else { o.by = p.by; o.at = p.at; }
  }
  const json = JSON.stringify(clean);
  if (json.length > 800000) return { error: "Too many manual overrides to save." };
  const t = db.now();
  const changedActuals = Object.keys(clean.actualOverrides).filter((k) => JSON.stringify(prevActual[k]) !== JSON.stringify(clean.actualOverrides[k])).length + Object.keys(prevActual).filter((k) => !clean.actualOverrides[k]).length;
  const detail = { lookback: clean.lookback, overrides: Object.fromEntries(Object.entries(clean.scenarios).map(([k, s]) => [k, Object.keys(s.overrides).length])), actualCorrections: Object.keys(clean.actualOverrides).length, actualCorrectionsChanged: changedActuals, monthlyBasis: clean.monthly.basis };
  if (before) {
    const r = await db.run("UPDATE cash_forecasts SET settings = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE workspace_id = ? AND version = ?", [json, user.id, t, ws.id, Number(version) || 0]);
    if (!r.changes) return { error: "Someone else saved the forecast after you opened it. Reload to see their version, then re-apply your changes.", conflict: true };
  } else {
    try { await db.run("INSERT INTO cash_forecasts (workspace_id, settings, updated_by, updated_at, version) VALUES (?,?,?,?,1)", [ws.id, json, user.id, t]); }
    catch { return { error: "Someone else saved the forecast at the same time. Reload and try again.", conflict: true }; }
  }
  await db.batch([auditStmt(ws.id, user.id, "cashflow.forecast_saved", "workspace", ws.id, detail)]);
  return { ok: true, savedAt: t, by: user.name, version: before ? (Number(version) || 0) + 1 : 1, settings: clean };
}
