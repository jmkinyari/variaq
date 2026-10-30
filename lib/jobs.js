// Database-backed job queue. Safe across many app instances and worker processes:
// a job is claimed with a conditional UPDATE (only one claimer's UPDATE matches), held under a
// time-limited lease, and re-claimable if its worker dies. Failures retry with exponential backoff.
const os = require("os");
const db = require("./db");
const { JOB_TYPES } = require("./ai/agents");

const LEASE_MS = 10 * 60_000;
const WORKER_ID = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 6)}`;

/** Exponential backoff with jitter cap: 30s, 2m, 8m, 32m … max 2h. Pure (unit-tested). */
function backoffMs(attempt, random = Math.random) {
  const base = 30_000 * 4 ** Math.max(0, attempt - 1);
  return Math.min(base, 2 * 3_600_000) + Math.floor(random() * 5000);
}

async function enqueue(type, payload = {}, { workspaceId = null, runAfter = null, maxAttempts = 3, createdBy = null, dedupeKey = null } = {}) {
  if (dedupeKey) {
    const dup = await db.get("SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('QUEUED','RUNNING')", [dedupeKey]);
    if (dup) return { id: dup.id, deduped: true };
  }
  const id = db.id(), t = db.now();
  await db.run("INSERT INTO jobs (id, workspace_id, type, payload, status, attempts, max_attempts, run_after, created_by, created_at, updated_at, dedupe_key) VALUES (?,?,?,?,'QUEUED',0,?,?,?,?,?,?)",
    [id, workspaceId, type, JSON.stringify(payload), maxAttempts, runAfter || t, createdBy, t, t, dedupeKey]);
  return { id };
}

/**
 * Specialist-agent jobs run through a runner registered by the server-only assistant module
 * (lib/ai/assistant.js sets globalThis.__variaqAgentRunner). A process without it (e.g. the
 * standalone worker) leaves agent.* jobs for a web-process worker that has it.
 */
const agentRunner = () => globalThis.__variaqAgentRunner || null;

/** Claim up to `limit` ready jobs for this worker. */
async function claim(limit = 3, workerId = WORKER_ID, { skipAgentJobs = !agentRunner() } = {}) {
  const t = db.now();
  const skip = skipAgentJobs ? " AND type NOT LIKE 'agent.%'" : "";
  const candidates = await db.all(`SELECT id FROM jobs WHERE ((status = 'QUEUED' AND run_after <= ?) OR (status = 'RUNNING' AND lease_until < ?))${skip} ORDER BY run_after LIMIT ?`, [t, t, limit * 3]);
  const claimed = [];
  for (const c of candidates) {
    if (claimed.length >= limit) break;
    const lease = new Date(Date.now() + LEASE_MS).toISOString();
    const r = await db.run("UPDATE jobs SET status = 'RUNNING', locked_by = ?, lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND ((status = 'QUEUED' AND run_after <= ?) OR (status = 'RUNNING' AND lease_until < ?))",
      [workerId, lease, t, c.id, t, t]);
    if (r.changes) claimed.push(await db.get("SELECT * FROM jobs WHERE id = ?", [c.id]));
  }
  return claimed;
}

async function complete(job, result) {
  await db.run("UPDATE jobs SET status = 'DONE', result = ?, locked_by = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND locked_by = ?", [JSON.stringify(result ?? null).slice(0, 4000), db.now(), job.id, job.locked_by]);
}
async function fail(job, err) {
  const final = job.attempts >= job.max_attempts || !!err?.permanent; // permanent: retrying can't help (e.g. AI switched off)
  await db.run("UPDATE jobs SET status = ?, error = ?, run_after = ?, locked_by = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND locked_by = ?",
    [final ? "FAILED" : "QUEUED", String(err?.message || err).slice(0, 1000), new Date(Date.now() + backoffMs(job.attempts)).toISOString(), db.now(), job.id, job.locked_by]);
}

/** Handler for one specialist job type: payload { workspaceId, userId, agentId, periodFrom, periodTo, entityId, title, instructions, template }. */
const agentHandler = async (p, job) => {
  const run = agentRunner();
  if (!run) throw new Error("Agent runner not loaded in this process; the job will be retried by a web-process worker.");
  return run(p, job);
};

const HANDLERS = {
  ...Object.fromEntries(JOB_TYPES.map((t) => [t, agentHandler])), // agent.cfo_report, agent.budget_forecast, agent.month_end_close, agent.journal_audit, agent.kra_tax
  "connector.sync": async (p) => require("./connectors/sync").runSync(p.connectorId, { triggeredBy: p.userId || null }),
  "audit.seal": async (p) => ({ sealed: await require("./audit-chain").sealWorkspace(p.workspaceId) }),
  "cleanup": async () => {
    const t = db.now();
    const s = await db.run("DELETE FROM sessions WHERE expires_at < ?", [t]);
    const n = await db.run("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?", [new Date(Date.now() - 90 * 86400000).toISOString()]);
    const j = await db.run("DELETE FROM jobs WHERE status IN ('DONE','FAILED') AND updated_at < ?", [new Date(Date.now() - 30 * 86400000).toISOString()]);
    return { sessions: s.changes, notifications: n.changes, jobs: j.changes };
  },
};

async function runJob(job) {
  const h = HANDLERS[job.type];
  if (!h) return fail({ ...job, attempts: job.max_attempts }, new Error(`No handler for ${job.type}`));
  try { await complete(job, await h(JSON.parse(job.payload || "{}"), job)); }
  catch (e) { await fail(job, e); }
}

/** Enqueue due scheduled work: connector syncs on their schedule, audit sealing, daily cleanup. */
async function schedule() {
  const now = Date.now();
  const due = await db.all("SELECT id, workspace_id, schedule_minutes, last_sync_at FROM connectors WHERE status = 'ACTIVE' AND schedule_minutes > 0");
  for (const c of due) {
    if (c.last_sync_at && Date.parse(c.last_sync_at) + c.schedule_minutes * 60_000 > now) continue;
    await enqueue("connector.sync", { connectorId: c.id }, { workspaceId: c.workspace_id, dedupeKey: `sync:${c.id}`, maxAttempts: 3 });
  }
  const unsealed = await db.all("SELECT DISTINCT workspace_id FROM audit_events WHERE hash IS NULL LIMIT 200");
  for (const w of unsealed) await enqueue("audit.seal", { workspaceId: w.workspace_id }, { workspaceId: w.workspace_id, dedupeKey: `seal:${w.workspace_id}` });
  const lastCleanup = await db.get("SELECT MAX(created_at) t FROM jobs WHERE type = 'cleanup'");
  if (!lastCleanup?.t || Date.parse(lastCleanup.t) < now - 86400000) await enqueue("cleanup", {}, { dedupeKey: "cleanup" });
}

/** Poll loop. Returns a stop() function. */
function startWorker({ intervalMs = 5000, concurrency = 2, logger = console } = {}) {
  const g = globalThis;
  if (g.__variaqWorker) return g.__variaqWorker.stop;
  let stopped = false, ticks = 0, timer = null;
  const tick = async () => {
    if (stopped) return;
    try {
      if (ticks++ % 12 === 0) await schedule();
      const jobs = await claim(concurrency);
      await Promise.all(jobs.map(runJob));
    } catch (e) { logger.error?.(`[variaq worker] ${e.message}`); }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, 1500);
  const stop = () => { stopped = true; clearTimeout(timer); g.__variaqWorker = null; };
  g.__variaqWorker = { stop };
  logger.log?.(`[variaq worker] started (${WORKER_ID})`);
  return stop;
}

module.exports = { enqueue, claim, complete, fail, runJob, schedule, startWorker, backoffMs, HANDLERS, WORKER_ID };
