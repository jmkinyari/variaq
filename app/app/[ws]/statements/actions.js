"use server";
import db from "@/lib/db";
import { requireWorkspace, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { CLASSES, CF_CHOICES, defaultIsCash, defaultCf } from "@/lib/statements";
import { loadChart } from "@/lib/statements-data";
import { normalizeSettings } from "@/lib/cashflow";

/** Save the account mapping. Only differences from the automatic classification are stored. */
export async function saveMapping(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const path = `/app/${slug}/statements/accounts`;
  const { chart, bankCodes } = await loadChart(ws.id);
  const t = db.now();
  const stmts = [];
  let changed = 0;
  for (const a of chart.values()) {
    const cls = String(formData.get(`class:${a.code}`) || "");
    const cf = String(formData.get(`cf:${a.code}`) || "");
    const cash = formData.get(`cash:${a.code}`) === "1";
    if (!CLASSES[cls] || !CF_CHOICES[cf]) continue;
    // Recompute auto values against the chosen class so a class change doesn't freeze stale defaults.
    const autoCash = defaultIsCash(a.code, a.name, cls, bankCodes), autoCf = defaultCf(a.code, a.name, cls);
    const row = {
      class: cls === a.auto.cls ? null : cls,
      is_cash: cash === autoCash ? null : cash ? 1 : 0,
      cf_category: cf === autoCf ? null : cf,
    };
    const before = { cls: a.cls, cash: a.isCash, cf: a.cf };
    if (before.cls !== cls || before.cash !== cash || before.cf !== cf) changed++;
    if (row.class === null && row.is_cash === null && row.cf_category === null) {
      stmts.push({ sql: "DELETE FROM account_settings WHERE workspace_id = ? AND account_code = ?", args: [ws.id, a.code] });
    } else {
      stmts.push({ sql: "INSERT INTO account_settings (workspace_id, account_code, class, is_cash, cf_category, updated_by, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id, account_code) DO UPDATE SET class = excluded.class, is_cash = excluded.is_cash, cf_category = excluded.cf_category, updated_by = excluded.updated_by, updated_at = excluded.updated_at", args: [ws.id, a.code, row.class, row.is_cash, row.cf_category, user.id, t] });
    }
  }
  stmts.push(auditStmt(ws.id, user.id, "statements.mapping_saved", "workspace", ws.id, { changed }));
  await db.batch(stmts);
  back(path, { ok: changed ? `Saved ${changed} account change${changed === 1 ? "" : "s"}. Statements now use the new mapping.` : "No changes to save." });
}

export async function resetMapping(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  await db.batch([
    { sql: "DELETE FROM account_settings WHERE workspace_id = ?", args: [ws.id] },
    auditStmt(ws.id, user.id, "statements.mapping_reset", "workspace", ws.id, {}),
  ]);
  back(`/app/${slug}/statements/accounts`, { ok: "Every account is back to its automatic classification." });
}

/** Save cash-flow forecast assumptions (called from the browser with the settings object). */
export async function saveForecast(slug, settings) {
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const clean = normalizeSettings(settings);
  const json = JSON.stringify(clean);
  if (json.length > 500000) return { error: "Too many manual overrides to save." };
  const t = db.now();
  await db.batch([
    { sql: "INSERT INTO cash_forecasts (workspace_id, settings, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at", args: [ws.id, json, user.id, t] },
    auditStmt(ws.id, user.id, "cashflow.forecast_saved", "workspace", ws.id, { lookback: clean.lookback, overrides: Object.fromEntries(Object.entries(clean.scenarios).map(([k, s]) => [k, Object.keys(s.overrides).length])) }),
  ]);
  return { ok: true, savedAt: t, by: user.name };
}
