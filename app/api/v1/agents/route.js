import { handler, json } from "@/lib/api";
import { listAgents, COORDINATOR } from "@/lib/ai/agents";
export const dynamic = "force-dynamic";

/** GET /api/v1/agents — the Project Variaq specialists (id, name, description, page prefixes, report templates, job type). */
export const GET = handler("agents:read", async () => json({ coordinator: COORDINATOR, data: listAgents() }));
