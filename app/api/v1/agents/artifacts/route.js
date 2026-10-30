import { handler, json } from "@/lib/api";
import { listArtifacts } from "@/lib/ai/agent-jobs";
import { apiActor } from "@/lib/ai/api-actor";
export const dynamic = "force-dynamic";

/** GET /api/v1/agents/artifacts?agent=&limit= — artifacts the key's creator can see (own, or linked report shared with the team). */
export const GET = handler("agents:read", async (req, { key, ws: keyWs }) => {
  const { ws, user } = await apiActor(key, keyWs);
  const q = new URL(req.url).searchParams;
  const rows = await listArtifacts(ws.id, user.id, { agentId: q.get("agent"), limit: parseInt(q.get("limit") || "50", 10) || 50 });
  return json({ data: rows.map((a) => ({ id: a.id, agentId: a.agent_id, kind: a.kind, title: a.title, periodFrom: a.period_from, periodTo: a.period_to, entityId: a.entity_id, jobId: a.job_id, reportId: a.report_id, summary: a.summary, status: a.status, author: a.author, createdAt: a.created_at, updatedAt: a.updated_at, appUrl: `/app/${ws.slug}/ai/artifacts/${a.id}` })) });
});
