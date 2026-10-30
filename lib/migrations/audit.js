// Migrations for the audit module. Append-only: add new { id, steps } objects; never edit a shipped one.
// Ids must be unique across all modules, so prefix them with "audit_".
module.exports = [
  { id: "audit_001_indexes", steps: [
    "CREATE INDEX IF NOT EXISTS ix_af_account ON audit_findings(workspace_id, account_code)",
    "CREATE INDEX IF NOT EXISTS ix_af_journal ON audit_findings(workspace_id, journal_no)",
    "CREATE INDEX IF NOT EXISTS ix_af_assignee ON audit_findings(workspace_id, assignee_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_le_ws_acct_date ON ledger_entries(workspace_id, account_code, date)",
    "CREATE INDEX IF NOT EXISTS ix_tb_ws ON tb_imports(workspace_id, chart, as_at)",
    "CREATE INDEX IF NOT EXISTS ix_coa_map_ws ON coa_mappings(workspace_id, source_chart, target_chart)",
  ] },
];
