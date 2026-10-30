// Migrations for the tax module. Append-only: add new { id, steps } objects; never edit a shipped one.
// Ids must be unique across all modules, so prefix them with "tax_".
module.exports = [
  { id: "tax_001_recon_detail", steps: [
    "ALTER TABLE tax_recon_items ADD COLUMN side TEXT",
    "ALTER TABLE tax_recon_items ADD COLUMN pass INTEGER",
    "ALTER TABLE tax_recon_items ADD COLUMN doc_date TEXT",
    "ALTER TABLE tax_recon_items ADD COLUMN itax_date TEXT",
    "ALTER TABLE tax_recon_items ADD COLUMN itax_invoice_no TEXT",
    "ALTER TABLE tax_recon_items ADD COLUMN erp_taxable_cents INTEGER",
    "ALTER TABLE tax_recon_items ADD COLUMN itax_taxable_cents INTEGER",
    "ALTER TABLE tax_recon_runs ADD COLUMN vat3 TEXT",
    "ALTER TABLE tax_recon_runs ADD COLUMN adjustments TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE tax_profile ADD COLUMN fy_end_month INTEGER NOT NULL DEFAULT 12",
    "ALTER TABLE tax_profile ADD COLUMN paye_registered INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tax_profile ADD COLUMN wht_registered INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tax_profile ADD COLUMN tot_registered INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tax_profile ADD COLUMN revenue_accounts TEXT",
    "CREATE INDEX IF NOT EXISTS ix_tri_ws ON tax_recon_items(workspace_id, review_status)",
    `CREATE TABLE IF NOT EXISTS tax_filings (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      code TEXT NOT NULL, period TEXT NOT NULL, status TEXT NOT NULL, filed_on TEXT, paid_on TEXT,
      amount_cents INTEGER, reference TEXT, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, code, period))`,
  ] },
];
