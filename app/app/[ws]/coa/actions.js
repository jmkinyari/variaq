"use server";
import db from "@/lib/db";
import { requireWorkspace, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { hit } from "@/lib/security/rate-limit";
import { matchCharts } from "@/lib/coa/match";
import { chartAccounts, loadMappings, confirmedMappings } from "@/lib/coa/data";

const str = (fd, k, max = 80) => String(fd.get(k) || "").trim().slice(0, max);

async function ctx(formData) {
  const slug = str(formData, "slug");
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const source = str(formData, "source"), target = str(formData, "target");
  const path = `/app/${slug}/coa?tab=map&source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`;
  if (!source || !target || source === target) back(`/app/${slug}/coa`, { err: "Choose two different charts." });
  return { user, ws, slug, source, target, path };
}

/** Suggest a target account for every source account. Never overwrites confirmed/overridden rows. */
export async function autoMap(formData) {
  const { user, ws, source, target, path } = await ctx(formData);
  if (!hit("heavy", ws.id).ok) back(path, { err: "Too many runs in the last minute." });
  const [src, tgt, existing, confirmed] = await Promise.all([chartAccounts(ws.id, source), chartAccounts(ws.id, target), loadMappings(ws.id, source, target), confirmedMappings(ws.id, target)]);
  if (!src.length || !tgt.length) back(path, { err: "Both charts need accounts. Upload a chart of accounts or trial balance first." });
  // Learned signal: confirmed mappings from *other* source charts (by name), plus this chart's own by code.
  const learned = confirmed.map((c) => (c.chart === source ? { sourceCode: c.code, targetCode: c.targetCode } : { sourceName: c.sourceName, targetCode: c.targetCode }));
  const res = matchCharts(src, tgt, learned);
  const t = db.now();
  const stmts = [];
  let suggested = 0;
  for (const r of res) {
    const cur = existing.get(r.code);
    if (cur && cur.status !== "SUGGESTED") continue;
    const top = r.candidates[0];
    stmts.push({
      sql: `INSERT INTO coa_mappings (workspace_id, source_chart, source_code, target_chart, target_code, confidence, method, reasons, status, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,'SUGGESTED',?,?)
            ON CONFLICT(workspace_id, source_chart, source_code, target_chart) DO UPDATE SET target_code = excluded.target_code, confidence = excluded.confidence, method = excluded.method, reasons = excluded.reasons, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      args: [ws.id, source, r.code, target, top?.code || null, top?.confidence || 0, "AUTO", JSON.stringify({ reasons: top?.reasons || ["No plausible match"], alternatives: r.candidates.slice(1) }), user.id, t],
    });
    suggested++;
  }
  stmts.push(auditStmt(ws.id, user.id, "coa.automapped", "coa_mapping", `${source}>${target}`, { suggested, kept: res.length - suggested }));
  await db.batch(stmts);
  back(path, { ok: `Suggested mappings for ${suggested} account(s); ${res.length - suggested} already confirmed mapping(s) were kept.` });
}

/** Save edits from the mapping grid: each row posts map_<code> (target code) and optional ok_<code>. */
export async function saveMappings(formData) {
  const { user, ws, source, target, path } = await ctx(formData);
  const [existing, tgt] = await Promise.all([loadMappings(ws.id, source, target), chartAccounts(ws.id, target)]);
  const valid = new Set(tgt.map((a) => a.code));
  const t = db.now();
  const stmts = [];
  let changed = 0, invalid = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("map_")) continue;
    const code = k.slice(4).slice(0, 60);
    const val = String(v).trim().split(" ")[0];
    const confirm = formData.get(`ok_${code}`) === "on";
    const cur = existing.get(code);
    if (val && !valid.has(val)) { invalid.push(`${code}→${val}`); continue; }
    const targetCode = val || null;
    const isChange = (cur?.target_code || null) !== targetCode;
    if (!isChange && !(confirm && cur?.status === "SUGGESTED")) continue;
    const status = isChange ? (targetCode ? "OVERRIDDEN" : "SUGGESTED") : "CONFIRMED";
    stmts.push({
      sql: `INSERT INTO coa_mappings (workspace_id, source_chart, source_code, target_chart, target_code, confidence, method, reasons, status, updated_by, updated_at) VALUES (?,?,?,?,?,100,'MANUAL','{"reasons":["Set by a person"]}',?,?,?)
            ON CONFLICT(workspace_id, source_chart, source_code, target_chart) DO UPDATE SET target_code = excluded.target_code, status = excluded.status, method = CASE WHEN ? THEN 'MANUAL' ELSE coa_mappings.method END, confidence = CASE WHEN ? THEN 100 ELSE coa_mappings.confidence END, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      args: [ws.id, source, code, target, targetCode, status, user.id, t, isChange ? 1 : 0, isChange ? 1 : 0],
    });
    changed++;
  }
  if (stmts.length) await db.batch([...stmts, auditStmt(ws.id, user.id, "coa.mappings_saved", "coa_mapping", `${source}>${target}`, { changed })]);
  back(path, invalid.length ? { err: `Saved ${changed}. These target codes don't exist in ${target}: ${invalid.slice(0, 8).join(", ")}` } : { ok: `Saved ${changed} mapping(s).` });
}

export async function confirmAbove(formData) {
  const { user, ws, source, target, path } = await ctx(formData);
  const threshold = Math.min(100, Math.max(50, parseInt(str(formData, "threshold"), 10) || 85));
  const r = await db.run("UPDATE coa_mappings SET status = 'CONFIRMED', updated_by = ?, updated_at = ? WHERE workspace_id = ? AND source_chart = ? AND target_chart = ? AND status = 'SUGGESTED' AND target_code IS NOT NULL AND confidence >= ?", [user.id, db.now(), ws.id, source, target, threshold]);
  await db.batch([auditStmt(ws.id, user.id, "coa.bulk_confirmed", "coa_mapping", `${source}>${target}`, { threshold, count: r.changes })]);
  back(path, { ok: `Confirmed ${r.changes} suggestion(s) at ${threshold}% confidence or higher.` });
}
