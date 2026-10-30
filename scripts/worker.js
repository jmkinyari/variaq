// Standalone background worker: connector syncs, audit-log sealing, cleanup.
// Run one or more of these next to web instances started with RUN_WORKER=0. Jobs are claimed with
// leases, so any number of workers can run against the same database safely.
require("./load-env");
const db = require("../lib/db");
const { startWorker } = require("../lib/jobs");

db.ensureSchema().then(() => {
  const stop = startWorker({ intervalMs: Number(process.env.WORKER_INTERVAL_MS || 3000), concurrency: Number(process.env.WORKER_CONCURRENCY || 3) });
  const shutdown = () => { console.log("[variaq worker] stopping"); stop(); setTimeout(() => process.exit(0), 500); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}).catch((e) => { console.error(e); process.exit(1); });
