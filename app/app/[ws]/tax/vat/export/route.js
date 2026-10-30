import { NextResponse } from "next/server";
import { requireWorkspace, audit } from "@/lib/auth";
import { getRun, runResults } from "@/lib/tax/data";
import { sectionB, sectionF, sectionL, exceptionsCsv, toCsv, VAT3_ROW_LABELS } from "@/lib/tax/vat3";

// CSV downloads for a reconciliation run: exceptions, VAT3 Section B / F / L, and sheet O.
export async function GET(req, { params }) {
  const { user, ws } = await requireWorkspace(params.ws);
  const url = new URL(req.url);
  const runId = url.searchParams.get("run") || "";
  const type = url.searchParams.get("type") || "exceptions";
  const run = await getRun(ws.id, runId);
  if (!run) return new NextResponse("Not found", { status: 404 });
  const res = await runResults(ws.id, runId);
  let csv, name;
  switch (type) {
    case "B": csv = sectionB(res.sales, res.docs); name = `SEC_B_WITH_VAT_PIN_${run.period}.csv`; break;
    case "F": csv = sectionF(res.purchases, res.docs); name = `SEC_F_WITH_VAT_PIN_${run.period}.csv`; break;
    case "L": csv = sectionL(res.whvat); name = `L_WHT_Credits_${run.period}.csv`; break;
    case "O": csv = toCsv(["Row", "Description", "Amount (Ksh)"], Object.entries(run.vat3?.rows || {}).map(([k, v]) => [k, VAT3_ROW_LABELS[k], (v / 100).toFixed(2)])); name = `O_VAT_Due_${run.period}.csv`; break;
    default: csv = exceptionsCsv(res.all.filter((i) => url.searchParams.get("all") === "1" || !["MATCHED", "CERT_MATCHED"].includes(i.status))); name = `VAT_reconciliation_${run.period}.csv`;
  }
  await audit(ws.id, user.id, "tax.exported", "tax_recon_run", runId, { type, period: run.period });
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`, "Cache-Control": "no-store" } });
}
