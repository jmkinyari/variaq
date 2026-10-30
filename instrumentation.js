// Next.js startup hook: run the background job worker inside the web process unless disabled
// (RUN_WORKER=0 on web instances when a dedicated `npm run worker` process is used).
// The NEXT_RUNTIME check wraps the import directly so the edge bundle drops it at compile time.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.RUN_WORKER !== "0" && process.env.NEXT_PHASE !== "phase-production-build") {
      const { startWorker } = await import("./lib/jobs");
      startWorker();
      // Register the specialist-agent runner (lib/ai/assistant.js) so this worker can run agent.* jobs.
      // If it can't load here, it registers on the first AI request instead; until then agent jobs wait.
      try { await import("./lib/ai/assistant"); } catch (e) { console.warn(`[variaq worker] agent runner deferred: ${e.message}`); }
    }
  }
}
