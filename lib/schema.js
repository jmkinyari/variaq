// Database schema. Applied automatically on first request (CREATE IF NOT EXISTS),
// and by `npm run setup`. Amounts are stored as integer cents; dates as ISO text.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT 'KE', currency TEXT NOT NULL DEFAULT 'KES',
  industry TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'MEMBER', created_at TEXT NOT NULL,
  UNIQUE(user_id, workspace_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'MEMBER', token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL, accepted_at TEXT, revoked_at TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_imports (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, row_count INTEGER NOT NULL, skipped INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  import_id TEXT REFERENCES ledger_imports(id) ON DELETE CASCADE,
  date TEXT NOT NULL, description TEXT NOT NULL, reference TEXT,
  account_code TEXT NOT NULL, account_name TEXT, amount_cents INTEGER NOT NULL,
  counterparty TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_le_ws_date ON ledger_entries(workspace_id, date);
CREATE INDEX IF NOT EXISTS ix_le_ws_acct ON ledger_entries(workspace_id, account_code);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, bank_name TEXT, account_mask TEXT, currency TEXT NOT NULL DEFAULT 'KES',
  ledger_account_code TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_statements (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  row_count INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  date TEXT NOT NULL, description TEXT NOT NULL, reference TEXT,
  amount_cents INTEGER NOT NULL, balance_cents INTEGER
);
CREATE INDEX IF NOT EXISTS ix_bt_stmt ON bank_transactions(statement_id);
CREATE TABLE IF NOT EXISTS reconciliations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  date_window INTEGER NOT NULL DEFAULT 3, large_amount_cents INTEGER NOT NULL DEFAULT 100000000,
  created_by TEXT NOT NULL, completed_by TEXT, completed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  bank_transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'SUGGESTED', method TEXT NOT NULL, confidence INTEGER NOT NULL,
  reasons TEXT NOT NULL DEFAULT '[]', reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_m_rec ON matches(reconciliation_id);
CREATE TABLE IF NOT EXISTS recon_exceptions (
  id TEXT PRIMARY KEY, reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  bank_transaction_id TEXT, ledger_entry_id TEXT, type TEXT NOT NULL, detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN', note TEXT, ai_hint TEXT, resolved_by TEXT, resolved_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ex_rec ON recon_exceptions(reconciliation_id);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, base_start TEXT NOT NULL, base_end TEXT NOT NULL,
  comp_start TEXT NOT NULL, comp_end TEXT NOT NULL,
  threshold_pct INTEGER NOT NULL DEFAULT 10, threshold_cents INTEGER NOT NULL DEFAULT 5000000,
  data TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '{}', ai_summary TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT', created_by TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tax_mappings (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tax_code TEXT NOT NULL, name TEXT NOT NULL, rate_percent TEXT, account_code TEXT,
  applies_to TEXT NOT NULL DEFAULT 'BOTH', source_url TEXT, verified INTEGER NOT NULL DEFAULT 0,
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS close_tasks (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General',
  status TEXT NOT NULL DEFAULT 'TODO', assignee_id TEXT, reviewer_id TEXT, due_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_ws ON audit_events(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS account_settings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL, class TEXT, is_cash INTEGER, cf_category TEXT,
  updated_by TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, account_code)
);
CREATE TABLE IF NOT EXISTS cash_forecasts (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  settings TEXT NOT NULL DEFAULT '{}', updated_by TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, company TEXT,
  message TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

// Ordered, append-only migrations. Each runs once (tracked in schema_migrations). Never edit a
// shipped migration — add a new one. ALTER TABLE ADD COLUMN steps are skipped if the column exists.
const MIGRATIONS = [
  { id: "001_security", steps: [
    "ALTER TABLE users ADD COLUMN mfa_secret TEXT",
    "ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN mfa_last_step INTEGER",
    "ALTER TABLE users ADD COLUMN recovery_codes TEXT",
    "ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN locked_until TEXT",
    "ALTER TABLE users ADD COLUMN last_login_at TEXT",
    "ALTER TABLE users ADD COLUMN password_changed_at TEXT",
    "ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0",
    // Sessions now store SHA-256(token) as id; existing plain-token sessions are invalidated.
    "DELETE FROM sessions",
    "ALTER TABLE sessions ADD COLUMN last_seen_at TEXT",
    "ALTER TABLE sessions ADD COLUMN ip TEXT",
    "ALTER TABLE sessions ADD COLUMN user_agent TEXT",
    "ALTER TABLE sessions ADD COLUMN mfa_pending INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id)",
    `CREATE TABLE IF NOT EXISTS workspace_keys (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, key_version INTEGER NOT NULL,
      wrapped_dek TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, key_version))`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS period_locks (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, period TEXT NOT NULL,
      locked_by TEXT NOT NULL, locked_at TEXT NOT NULL, note TEXT, PRIMARY KEY (workspace_id, period))`,
    "ALTER TABLE audit_events ADD COLUMN seq INTEGER",
    "ALTER TABLE audit_events ADD COLUMN prev_hash TEXT",
    "ALTER TABLE audit_events ADD COLUMN hash TEXT",
    "ALTER TABLE audit_events ADD COLUMN ip TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_seq ON audit_events(workspace_id, seq)",
    "CREATE INDEX IF NOT EXISTS ix_audit_unsealed ON audit_events(workspace_id, hash)",
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL,
      link TEXT, read_at TEXT, created_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, read_at, created_at)",
    `CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE, type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'QUEUED', attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3, run_after TEXT NOT NULL, locked_by TEXT, lease_until TEXT,
      result TEXT, error TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_jobs_ready ON jobs(status, run_after)",
  ] },
  { id: "002_ledger_depth", steps: [
    "ALTER TABLE ledger_entries ADD COLUMN journal_no TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN line_no INTEGER",
    "ALTER TABLE ledger_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'CSV'",
    "ALTER TABLE ledger_entries ADD COLUMN external_id TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN entry_type TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN posted_by TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN approved_by TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN posted_at TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN currency TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN fx_rate REAL",
    "ALTER TABLE ledger_entries ADD COLUMN tax_code TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN cost_center TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN department TEXT",
    "ALTER TABLE ledger_entries ADD COLUMN project TEXT",
    "CREATE INDEX IF NOT EXISTS ix_le_ws_journal ON ledger_entries(workspace_id, journal_no)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_le_external ON ledger_entries(workspace_id, source, external_id) WHERE external_id IS NOT NULL",
    "ALTER TABLE ledger_imports ADD COLUMN source TEXT NOT NULL DEFAULT 'CSV'",
    "ALTER TABLE ledger_imports ADD COLUMN clean_report TEXT",
  ] },
  { id: "003_tasks", steps: [
    "ALTER TABLE close_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL'",
    "ALTER TABLE close_tasks ADD COLUMN description TEXT",
    "ALTER TABLE close_tasks ADD COLUMN depends_on TEXT",
    "ALTER TABLE close_tasks ADD COLUMN completed_at TEXT",
    "ALTER TABLE close_tasks ADD COLUMN completed_by TEXT",
    "ALTER TABLE close_tasks ADD COLUMN source_type TEXT",
    "ALTER TABLE close_tasks ADD COLUMN source_id TEXT",
    "ALTER TABLE close_tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
    "CREATE INDEX IF NOT EXISTS ix_ct_ws_period ON close_tasks(workspace_id, period)",
    "CREATE INDEX IF NOT EXISTS ix_ct_assignee ON close_tasks(workspace_id, assignee_id, status)",
    `CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_tc_task ON task_comments(task_id)",
  ] },
  { id: "004_datasets_tb_coa", steps: [
    `CREATE TABLE IF NOT EXISTS tb_imports (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chart TEXT NOT NULL, as_at TEXT NOT NULL, file_name TEXT NOT NULL, row_count INTEGER NOT NULL,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS tb_lines (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      import_id TEXT NOT NULL REFERENCES tb_imports(id) ON DELETE CASCADE,
      account_code TEXT NOT NULL, account_name TEXT, balance_cents INTEGER NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_tb_import ON tb_lines(import_id)",
    `CREATE TABLE IF NOT EXISTS coa_accounts (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, chart TEXT NOT NULL,
      code TEXT NOT NULL, name TEXT NOT NULL, class TEXT, parent_code TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, chart, code))`,
    `CREATE TABLE IF NOT EXISTS coa_mappings (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, source_chart TEXT NOT NULL,
      source_code TEXT NOT NULL, target_chart TEXT NOT NULL, target_code TEXT, confidence INTEGER NOT NULL DEFAULT 0,
      method TEXT NOT NULL, reasons TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'SUGGESTED',
      updated_by TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, source_chart, source_code, target_chart))`,
    `CREATE TABLE IF NOT EXISTS aging_lines (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      side TEXT NOT NULL, as_at TEXT NOT NULL, batch_id TEXT NOT NULL, counterparty TEXT NOT NULL,
      current_cents INTEGER NOT NULL DEFAULT 0, d30_cents INTEGER NOT NULL DEFAULT 0, d60_cents INTEGER NOT NULL DEFAULT 0,
      d90_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_aging ON aging_lines(workspace_id, side, as_at)",
    `CREATE TABLE IF NOT EXISTS data_uploads (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, file_name TEXT NOT NULL, sheet TEXT, rows_in INTEGER NOT NULL, rows_imported INTEGER NOT NULL,
      rows_rejected INTEGER NOT NULL, clean_report TEXT NOT NULL DEFAULT '[]', target_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
  ] },
  { id: "005_journal_audit", steps: [
    `CREATE TABLE IF NOT EXISTS audit_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      period_from TEXT NOT NULL, period_to TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}', stats TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS audit_findings (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      run_id TEXT, rule TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}',
      journal_no TEXT, entry_ids TEXT NOT NULL DEFAULT '[]', account_code TEXT, amount_cents INTEGER, entry_date TEXT,
      suggestion TEXT, corrective TEXT, status TEXT NOT NULL DEFAULT 'OPEN', assignee_id TEXT, resolution_note TEXT,
      resolved_by TEXT, resolved_at TEXT, fingerprint TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_af_fp ON audit_findings(workspace_id, fingerprint)",
    "CREATE INDEX IF NOT EXISTS ix_af_ws ON audit_findings(workspace_id, status, severity)",
    `CREATE TABLE IF NOT EXISTS auditor_queries (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      ref TEXT NOT NULL, title TEXT NOT NULL, question TEXT NOT NULL, auditor_name TEXT, auditor_firm TEXT,
      account_code TEXT, journal_no TEXT, period_from TEXT, period_to TEXT, status TEXT NOT NULL DEFAULT 'OPEN',
      priority TEXT NOT NULL DEFAULT 'NORMAL', assignee_id TEXT, due_date TEXT, response TEXT, action_points TEXT NOT NULL DEFAULT '[]',
      evidence TEXT, raised_by TEXT NOT NULL, responded_by TEXT, responded_at TEXT, closed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS ix_aq_ws ON auditor_queries(workspace_id, status)",
  ] },
  { id: "006_budget", steps: [
    `CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, fy_start TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', method TEXT NOT NULL,
      assumptions TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
      approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS budget_lines (
      budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL,
      account_code TEXT NOT NULL, month_idx INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
      PRIMARY KEY (budget_id, account_code, month_idx))`,
    `CREATE TABLE IF NOT EXISTS budget_notes (
      id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL,
      account_code TEXT NOT NULL, period TEXT NOT NULL, note TEXT NOT NULL, action TEXT, owner_id TEXT,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS board_packs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      period TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', budget_id TEXT,
      sections TEXT NOT NULL DEFAULT '[]', commentary TEXT NOT NULL DEFAULT '{}', snapshot TEXT,
      version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, approved_by TEXT, approved_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    "ALTER TABLE cash_forecasts ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
  ] },
  { id: "007_tax", steps: [
    `CREATE TABLE IF NOT EXISTS tax_profile (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, kra_pin TEXT, pin_index TEXT,
      vat_registered INTEGER NOT NULL DEFAULT 1, wht_vat_agent INTEGER NOT NULL DEFAULT 0,
      output_vat_account TEXT, input_vat_account TEXT, wht_vat_account TEXT, wht_account TEXT, paye_account TEXT,
      updated_by TEXT, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS tax_batches (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, source TEXT NOT NULL, period TEXT NOT NULL, file_name TEXT NOT NULL,
      row_count INTEGER NOT NULL, clean_report TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS tax_documents (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL REFERENCES tax_batches(id) ON DELETE CASCADE, kind TEXT NOT NULL, source TEXT NOT NULL,
      period TEXT NOT NULL, pin TEXT, counterparty TEXT, invoice_no TEXT, invoice_key TEXT, cu_invoice_no TEXT,
      invoice_date TEXT, doc_type TEXT NOT NULL DEFAULT 'INVOICE', related_invoice TEXT,
      taxable_cents INTEGER NOT NULL DEFAULT 0, vat_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0,
      rate_code TEXT, description TEXT, extra TEXT)`,
    "CREATE INDEX IF NOT EXISTS ix_td_ws ON tax_documents(workspace_id, kind, period, source)",
    "CREATE INDEX IF NOT EXISTS ix_td_key ON tax_documents(workspace_id, invoice_key)",
    `CREATE TABLE IF NOT EXISTS tax_recon_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, period TEXT NOT NULL, stats TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS tax_recon_items (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES tax_recon_runs(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL,
      status TEXT NOT NULL, erp_doc_id TEXT, itax_doc_id TEXT, pin TEXT, counterparty TEXT, invoice_no TEXT,
      erp_vat_cents INTEGER, itax_vat_cents INTEGER, diff_cents INTEGER, issues TEXT NOT NULL DEFAULT '[]',
      action TEXT, review_status TEXT NOT NULL DEFAULT 'OPEN', note TEXT, reviewed_by TEXT, reviewed_at TEXT)`,
    "CREATE INDEX IF NOT EXISTS ix_tri_run ON tax_recon_items(run_id, status)",
  ] },
  { id: "008_connectors", steps: [
    `CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      cursor TEXT, schedule_minutes INTEGER, last_sync_at TEXT, last_status TEXT, last_error TEXT,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE, status TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT, fetched INTEGER NOT NULL DEFAULT 0, inserted INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, controls TEXT NOT NULL DEFAULT '{}',
      log TEXT NOT NULL DEFAULT '[]', error TEXT, triggered_by TEXT)`,
    "CREATE INDEX IF NOT EXISTS ix_sr_conn ON sync_runs(connector_id, started_at)",
  ] },
];

// Module-owned migrations run after the core ones, in this order.
for (const mod of ["tax", "audit", "planning", "platform", "ai"]) MIGRATIONS.push(...require(`./migrations/${mod}`));

module.exports = { SCHEMA, MIGRATIONS };
