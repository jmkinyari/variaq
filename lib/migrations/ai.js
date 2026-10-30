// Migrations for the embedded AI service and the Variaq platform administration console.
// Append-only; ids prefixed "ai_".
module.exports = [
  { id: "ai_001_platform", steps: [
    // Platform-wide settings managed by Variaq system administrators (AI model, keys, limits).
    `CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ai_key_events (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, key_hint TEXT, note TEXT, ok INTEGER, user_id TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS platform_audit (
      id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, target TEXT, detail TEXT NOT NULL DEFAULT '{}', ip TEXT, created_at TEXT NOT NULL)`,
    // Per-company entitlement (set by Variaq) and consent (given by the company's owner).
    `CREATE TABLE IF NOT EXISTS ai_entitlements (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1, monthly_token_limit INTEGER, consent_by TEXT, consent_at TEXT,
      updated_by TEXT, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ai_usage (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT,
      feature TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0, cost_micros INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_ai_usage_ws ON ai_usage(workspace_id, created_at)",
    // Assistant conversations (messages sealed with the company's key).
    `CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, title TEXT NOT NULL, messages TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_ai_conv ON ai_conversations(workspace_id, user_id, updated_at)",
    // Actions the assistant proposes; nothing happens until a person approves.
    `CREATE TABLE IF NOT EXISTS ai_actions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      conversation_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PROPOSED',
      result_id TEXT, proposed_for TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_ai_actions ON ai_actions(workspace_id, status)",
    // AI-generated HTML reports (HTML sealed with the company's key).
    `CREATE TABLE IF NOT EXISTS ai_reports (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL, template TEXT NOT NULL, period_from TEXT, period_to TEXT, instructions TEXT,
      html TEXT NOT NULL, summary TEXT, visibility TEXT NOT NULL DEFAULT 'PRIVATE', share_token TEXT, share_expires_at TEXT,
      model TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_ai_reports ON ai_reports(workspace_id, created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_report_share ON ai_reports(share_token) WHERE share_token IS NOT NULL",
    "ALTER TABLE workspaces ADD COLUMN suspended_at TEXT",
  ] },
  { id: "ai_002_agents", steps: [
    // Specialist agents (Project Variaq): which specialist a conversation is with, and the artifacts
    // (reports, audit packs, tax recons, close summaries, forecasts) their background jobs save back.
    "ALTER TABLE ai_conversations ADD COLUMN agent_id TEXT",
    `CREATE TABLE IF NOT EXISTS ai_artifacts (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'OTHER', title TEXT NOT NULL,
      period_from TEXT, period_to TEXT, entity_id TEXT, job_id TEXT,
      report_id TEXT REFERENCES ai_reports(id) ON DELETE SET NULL,
      summary TEXT, payload TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
      created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_ai_artifacts_ws ON ai_artifacts(workspace_id, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_ai_artifacts_agent ON ai_artifacts(workspace_id, agent_id, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_ai_artifacts_job ON ai_artifacts(job_id)",
  ] },
];
