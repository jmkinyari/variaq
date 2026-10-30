"use server";
import db from "@/lib/db";
import { requireWorkspace, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { KENYA_TAX_STARTER } from "@/lib/templates";

export async function saveMapping(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const id = String(formData.get("id") || "");
  const f = (k) => String(formData.get(k) || "").trim();
  const rate = f("rate_percent");
  if (rate && !/^\d+(\.\d+)?$/.test(rate)) back(`/app/${slug}/tax/mappings`, { err: "Rate must be a number like 16 or 1.5 (or leave it blank)." });
  if (!f("tax_code") || !f("name")) back(`/app/${slug}/tax/mappings`, { err: "Tax code and name are required." });
  const verified = formData.get("verified") === "on" ? 1 : 0;
  if (verified && !f("source_url")) back(`/app/${slug}/tax/mappings`, { err: "Add the source (e.g. a KRA page or notice) before marking a mapping verified." });
  const t = db.now();
  const args = [f("tax_code").toUpperCase(), f("name"), rate || null, f("account_code") || null, f("applies_to") || "BOTH", f("source_url") || null, verified, f("notes") || null, t];
  if (id) {
    await db.batch([{ sql: "UPDATE tax_mappings SET tax_code=?, name=?, rate_percent=?, account_code=?, applies_to=?, source_url=?, verified=?, notes=?, updated_at=? WHERE id = ? AND workspace_id = ?", args: [...args, id, ws.id] }, auditStmt(ws.id, user.id, "tax.updated", "tax_mapping", id, { code: args[0], rate: args[2], verified: !!verified })]);
  } else {
    const nid = db.id();
    await db.batch([{ sql: "INSERT INTO tax_mappings (tax_code, name, rate_percent, account_code, applies_to, source_url, verified, notes, updated_at, id, workspace_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", args: [...args, nid, ws.id, t] }, auditStmt(ws.id, user.id, "tax.created", "tax_mapping", nid, { code: args[0] })]);
  }
  back(`/app/${slug}/tax/mappings`, { ok: "Saved." });
}

export async function addStarter(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const have = new Set((await db.all("SELECT tax_code FROM tax_mappings WHERE workspace_id = ?", [ws.id])).map((r) => r.tax_code));
  const t = db.now();
  const add = KENYA_TAX_STARTER.filter(([c]) => !have.has(c));
  await db.batch([
    ...add.map(([code, name, applies]) => ({ sql: "INSERT INTO tax_mappings (id, workspace_id, tax_code, name, applies_to, source_url, verified, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [db.id(), ws.id, code, name, applies, "https://www.kra.go.ke/", 0, "Starter entry — confirm the current rate and treatment with KRA guidance or your tax adviser before use.", t, t] })),
    auditStmt(ws.id, user.id, "tax.starter_added", "tax_mapping", null, { added: add.length }),
  ]);
  back(`/app/${slug}/tax/mappings`, { ok: `Added ${add.length} starter codes. Rates are blank until you set and verify them.` });
}

export async function deleteMapping(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const id = String(formData.get("id"));
  await db.batch([{ sql: "DELETE FROM tax_mappings WHERE id = ? AND workspace_id = ?", args: [id, ws.id] }, auditStmt(ws.id, user.id, "tax.deleted", "tax_mapping", id, {})]);
  back(`/app/${slug}/tax/mappings`, { ok: "Deleted." });
}
