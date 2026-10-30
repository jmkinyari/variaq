import db from "@/lib/db";
export const dynamic = "force-dynamic";

/** Liveness + database readiness for load balancers and container health checks. No auth, no data. */
export async function GET() {
  const t0 = Date.now();
  try {
    await db.get("SELECT 1 ok");
    return Response.json({ status: "ok", db: "ok", latencyMs: Date.now() - t0 }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", db: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
