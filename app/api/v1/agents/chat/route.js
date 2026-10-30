import { handler, json, ApiError, apiAudit } from "@/lib/api";
import { hit } from "@/lib/security/rate-limit";
import { askAssistant } from "@/lib/ai/assistant";
import { getAgent } from "@/lib/ai/agents";
import { apiActor, parseBody } from "@/lib/ai/api-actor";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/agents/chat — ask a specialist (or let the coordinator route with agentId "auto").
 * Body: { message, conversationId?, agentId?, period?: "YYYY-MM", entityId?, page?: "/app/<slug>/tax/vat" }
 */
export const POST = handler("agents:run", async (req, { key, ws: keyWs, body }) => {
  const b = parseBody(body);
  if (!String(b.message || "").trim()) throw new ApiError(400, "no_message", "Send a non-empty `message`.");
  if (b.agentId && b.agentId !== "auto" && !getAgent(b.agentId)) throw new ApiError(400, "unknown_agent", `Unknown agentId "${String(b.agentId).slice(0, 40)}".`);
  if (b.period && !/^\d{4}-\d{2}(-\d{2})?$/.test(String(b.period))) throw new ApiError(400, "bad_period", "period must be YYYY-MM or YYYY-MM-DD");
  const { ws, user } = await apiActor(key, keyWs);
  if (!hit({ limit: 20, windowMs: 60_000 }, `ai|${user.id}`).ok) throw new ApiError(429, "rate_limited", "Too many AI questions. Wait a moment.", { retryAfterSec: 60 });
  const r = await askAssistant({ ws, user, conversationId: b.conversationId ? String(b.conversationId) : null, message: String(b.message), page: b.page ? { path: String(b.page), title: "" } : null, agentId: b.agentId || null, period: b.period || null, entityId: b.entityId || null });
  if (r.error) throw new ApiError(422, "ai_error", r.error, { conversationId: r.conversationId || null });
  await apiAudit(ws.id, key, "api.agent_chat", { agent: r.agent?.id, conversation: r.conversationId });
  return json({ conversationId: r.conversationId, agent: r.agent, answer: r.answer, toolsUsed: r.toolsUsed, proposals: r.proposals, refused: !!r.refused });
});
