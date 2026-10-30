import { handler, json, ApiError, apiAudit } from "@/lib/api";
import { hit } from "@/lib/security/rate-limit";
import { buildAgentPayload, enqueueAgentJob, listAgentJobs } from "@/lib/ai/agent-jobs";
import { apiActor, parseBody } from "@/lib/ai/api-actor";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/agents/jobs — queue a specialist background job (report, audit pack, tax recon, close summary, forecast).
 * Body: { agentId, kind?, period?: "YYYY-MM" | periodFrom/periodTo, entityId?, title?, instructions?, template? }
 * → 202 { id, type, deduped, status: "QUEUED", statusUrl }
 */
export const POST = handler("agents:run", async (req, { key, ws: keyWs, body }) => {
  const b = parseBody(body);
  const { ws, user } = await apiActor(key, keyWs);
  if (!hit("heavy", `ai-agent-job|${ws.id}`).ok) throw new ApiError(429, "rate_limited", "Too many background tasks queued.", { retryAfterSec: 60 });
  const p = buildAgentPayload({ ws, user, ...b, agentId: String(b.agentId || "") });
  if (p.error) throw new ApiError(400, "invalid_job", p.error);
  const r = await enqueueAgentJob(p.agent.id, p.payload, { createdBy: user.id });
  await apiAudit(ws.id, key, "api.agent_job_queued", { agent: p.agent.id, job: r.id, deduped: !!r.deduped });
  return json({ id: r.id, type: r.type, deduped: !!r.deduped, status: "QUEUED", statusUrl: `/api/v1/agents/jobs/${r.id}` }, 202);
});

/** GET /api/v1/agents/jobs?limit= — recent agent jobs in this workspace. */
export const GET = handler("agents:read", async (req, { ws }) => {
  const limit = parseInt(new URL(req.url).searchParams.get("limit") || "30", 10) || 30;
  return json({ data: await listAgentJobs(ws.id, { limit }) });
});
