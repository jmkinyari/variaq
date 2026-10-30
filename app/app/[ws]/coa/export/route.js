// Mapping table export (source → target) for review or loading into a consolidation tool.
import { requireWorkspace } from "@/lib/auth";
import { chartAccounts, loadMappings } from "@/lib/coa/data";

const cell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req, { params }) {
  const { ws } = await requireWorkspace(params.ws);
  const sp = new URL(req.url).searchParams;
  const source = (sp.get("source") || "").slice(0, 80), target = (sp.get("target") || "").slice(0, 80);
  const [src, tgt, maps] = await Promise.all([chartAccounts(ws.id, source), chartAccounts(ws.id, target), loadMappings(ws.id, source, target)]);
  const tn = new Map(tgt.map((a) => [a.code, a.name]));
  const out = [["Source chart", "Source code", "Source name", "Target chart", "Target code", "Target name", "Confidence", "Status", "Method"].join(",")];
  for (const a of src) {
    const m = maps.get(a.code);
    out.push([source, a.code, a.name, target, m?.target_code || "", m?.target_code ? tn.get(String(m.target_code)) || "" : "", m?.confidence ?? "", m?.status || "UNMAPPED", m?.method || ""].map(cell).join(","));
  }
  const fname = `coa-mapping-${source}-to-${target}.csv`.replace(/[^\w.\-]/g, "_");
  return new Response("﻿" + out.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fname}"`, "cache-control": "no-store" } });
}
