import db from "@/lib/db";
import { requireWorkspace, audit } from "@/lib/auth";
import { toCsv } from "../../settings/export/tables";
import { auditWhere } from "../query";
export const dynamic = "force-dynamic";

/** CSV of the (filtered) audit log, including the hash chain columns so auditors can re-verify it. */
export async function GET(req, { params }) {
  const { user, ws } = await requireWorkspace(params.ws);
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { W, args } = auditWhere(ws.id, sp);
  const rows = await db.all(`SELECT a.seq, a.created_at, u.name user_name, u.email user_email, a.action, a.entity_type, a.entity_id, a.detail, a.ip, a.prev_hash, a.hash FROM audit_events a LEFT JOIN users u ON u.id = a.user_id WHERE ${W} ORDER BY a.seq LIMIT 200000`, args);
  await audit(ws.id, user.id, "audit_log.exported", "workspace", ws.id, { rows: rows.length, filters: sp });
  return new Response("﻿" + toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${ws.slug}-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
}
