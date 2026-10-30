// Tables included in the owner data export, with columns to omit (secrets, key material).
export const EXPORT_TABLES = {
  ledger_entries: { label: "Ledger lines" },
  ledger_imports: { label: "Ledger imports" },
  bank_accounts: { label: "Bank accounts" },
  bank_transactions: { label: "Bank transactions" },
  reconciliations: { label: "Reconciliations" },
  close_tasks: { label: "Close tasks" },
  task_comments: { label: "Task comments" },
  reports: { label: "Variance reports" },
  account_settings: { label: "Account mapping" },
  tax_mappings: { label: "Tax mappings" },
  audit_events: { label: "Audit log" },
  connectors: { label: "Connectors", omit: ["config", "cursor"] },
  sync_runs: { label: "Sync runs" },
  period_locks: { label: "Period locks" },
};

// CSV cells: quote, and neutralise leading = + - @ so a spreadsheet won't execute them as formulas.
const cell = (v) => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}
