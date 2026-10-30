// Enqueue and read specialist background jobs + the artifacts they save. Importing this module also
// loads the assistant, which registers the agent runner with the in-process job worker.
import "server-only";
import db from "../db";
import { enqueue } from "../jobs";
import { getAgent, ARTIFACT_KINDS } from "./agents";
import { periodBounds } from "./deep-links";
import { TEMPLATES } from "./assistant";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));

/** Normalise user/API input into a job payload. Returns { payload } or { error }. */
export function buildAgentPayload({ ws, user, agentId, kind, period, periodFrom, periodTo, entityId, title, instructions, template, withReport }) {
  const agent = getAgent(agentId);
  if (!agent) return { error: "Choose a specialist." };
  let [pf, pt] = [ISO.test(periodFrom || "") ? periodFrom : null, ISO.test(periodTo || "") ? periodTo : null];
  if (!pf && period) [pf, pt] = periodBounds(period);
  if (pf && !pt) pt = pf;
  if (pf && pt && pf > pt) return { error: "The period start is after its end." };
  return { agent, payload: {
    workspaceId: ws.id, userId: user.id, agentId: agent.id,
    kind: ARTIFACT_KINDS.includes(kind) ? kind : agent.artifactKind,
    periodFrom: pf, periodTo: pt, entityId: str(entityId, 80) || null,
    title: str(title, 150) || null, instructions: str(instructions, 2000) || null,
    template: TEMPLATES[template] ? template : null, withReport: !!withReport,
  } };
}

/** Enqueue a specialist job (deduped per workspace + agent + period + kind while queued/running). */
export async function enqueueAgentJob(agentId, payload, { createdBy = null, maxAttempts = 2 } = {}) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Unknown agent ${agentId}`);
  const dedupeKey = `agent:${payload.workspaceId}:${agent.id}:${payload.kind || agent.artifactKind}:${payload.periodFrom || "latest"}:${payload.periodTo || ""}:${payload.entityId || ""}`;
  const r = await enqueue(agent.jobType, { ...payload, agentId: agent.id }, { workspaceId: payload.workspaceId, createdBy: createdBy || payload.userId, dedupeKey, maxAttempts });
  return { ...r, type: agent.jobType };
}

const shapeJob = (j) => {
  let result = null, payload = {};
  try { result = j.result ? JSON.parse(j.result) : null; } catch {}
  try { payload = JSON.parse(j.payload || "{}"); } catch {}
  return { id: j.id, type: j.type, agentId: payload.agentId || null, status: j.status, attempts: j.attempts, error: j.error || null, result, periodFrom: payload.periodFrom || null, periodTo: payload.periodTo || null, title: payload.title || null, createdAt: j.created_at, updatedAt: j.updated_at };
};

export async function getAgentJob(wsId, jobId) {
  const j = await db.get("SELECT * FROM jobs WHERE id = ? AND workspace_id = ? AND type LIKE 'agent.%'", [String(jobId), wsId]);
  if (!j) return null;
  const job = shapeJob(j);
  const art = await db.get("SELECT id, status, report_id, summary FROM ai_artifacts WHERE workspace_id = ? AND job_id = ?", [wsId, j.id]);
  return { ...job, artifact: art ? { id: art.id, status: art.status, reportId: art.report_id, summary: art.summary } : null };
}

export async function listAgentJobs(wsId, { limit = 30 } = {}) {
  const rows = await db.all("SELECT * FROM jobs WHERE workspace_id = ? AND type LIKE 'agent.%' ORDER BY created_at DESC LIMIT ?", [wsId, Math.min(100, Math.max(1, limit))]);
  return rows.map(shapeJob);
}

/** Artifacts visible to a user: their own, plus any whose linked report is shared with the team. */
export async function listArtifacts(wsId, userId, { agentId = null, limit = 50 } = {}) {
  const where = ["a.workspace_id = ?", "(a.created_by = ? OR r.visibility = 'TEAM')"], args = [wsId, userId];
  if (agentId && getAgent(agentId)) { where.push("a.agent_id = ?"); args.push(agentId); }
  return db.all(`SELECT a.id, a.agent_id, a.kind, a.title, a.period_from, a.period_to, a.entity_id, a.job_id, a.report_id, a.summary, a.status, a.created_by, a.created_at, a.updated_at, u.name author
    FROM ai_artifacts a LEFT JOIN ai_reports r ON r.id = a.report_id LEFT JOIN users u ON u.id = a.created_by
    WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT ?`, [...args, Math.min(100, Math.max(1, limit))]);
}
