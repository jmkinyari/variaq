import db from "@/lib/db";
import { requireWorkspace, audit } from "@/lib/auth";
import { EXPORT_TABLES, toCsv } from "./tables";
export const dynamic = "force-dynamic";

const strip = (rows, omit = []) => rows.map((r) => { const o = { ...r }; for (const k of omit) delete o[k]; return o; });

/** Owner-only export of this workspace's data. */
export async function GET(req, { params }) {
  const { user, ws } = await requireWorkspace(params.ws, "OWNER");
  const u = new URL(req.url);
  const table = u.searchParams.get("table");
  const stamp = new Date().toISOString().slice(0, 10);
  if (table) {
    const def = EXPORT_TABLES[table];
    if (!def) return new Response("Unknown table", { status: 400 });
    const rows = strip(await db.all(`SELECT * FROM ${table} WHERE workspace_id = ?`, [ws.id]), def.omit);
    await audit(ws.id, user.id, "data.exported", "workspace", ws.id, { table, rows: rows.length });
    return new Response("﻿" + toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${ws.slug}-${table}-${stamp}.csv"`, "cache-control": "no-store" } });
  }
  const out = { workspace: { name: ws.name, slug: ws.slug, currency: ws.currency, exportedAt: new Date().toISOString() } };
  for (const [t, def] of Object.entries(EXPORT_TABLES)) out[t] = strip(await db.all(`SELECT * FROM ${t} WHERE workspace_id = ?`, [ws.id]), def.omit);
  await audit(ws.id, user.id, "data.exported", "workspace", ws.id, { format: "json", tables: Object.keys(EXPORT_TABLES).length });
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${ws.slug}-export-${stamp}.json"`, "cache-control": "no-store" } });
}
