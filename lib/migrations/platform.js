// Migrations for the platform module (connectors, API, jobs, tasks, close sign-off).
// Append-only: add new { id, steps } objects; never edit a shipped one. Ids are prefixed "platform_".
module.exports = [
  { id: "platform_001", steps: [
    "ALTER TABLE api_keys ADD COLUMN signing_secret TEXT",
    "ALTER TABLE jobs ADD COLUMN dedupe_key TEXT",
    "CREATE INDEX IF NOT EXISTS ix_jobs_dedupe ON jobs(dedupe_key, status)",
    `CREATE TABLE IF NOT EXISTS close_signoffs (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, period TEXT NOT NULL,
      approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, note TEXT, PRIMARY KEY (workspace_id, period))`,
    "CREATE INDEX IF NOT EXISTS ix_le_ws_source ON ledger_entries(workspace_id, source)",
    "CREATE INDEX IF NOT EXISTS ix_le_ws_posted_by ON ledger_entries(workspace_id, posted_by)",
  ] },
];
