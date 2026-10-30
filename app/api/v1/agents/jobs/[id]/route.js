import { handler, json, ApiError } from "@/lib/api";
import { getAgentJob } from "@/lib/ai/agent-jobs";
export const dynamic = "force-dynamic";

/** GET /api/v1/agents/jobs/:id — status, result ({ artifactId, reportId }) and the linked artifact. */
export const GET = handler("agents:read", async (req, { ws }) => {
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  const job = await getAgentJob(ws.id, id);
  if (!job) throw new ApiError(404, "not_found", "No such agent job in this workspace.");
  return json(job);
});
