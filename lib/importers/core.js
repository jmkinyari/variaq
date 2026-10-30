// Importers for the core datasets: ledger journal lines, trial balances, charts of accounts,
// bank statements and ageing reports. Each importer receives records already validated on the
// server by lib/ingest/clean.validate and returns { message, redirect, targetId, imported }.
import "server-only";
import db from "../db";
import { auditStmt, assertPeriodOpen } from "../auth";
import { defaultClass } from "../statements";

const LEDGER_COLS = ["id", "workspace_id", "import_id", "date", "description", "reference", "account_code", "account_name", "amount_cents", "counterparty", "created_at",
  "journal_no", "line_no", "source", "entry_type", "posted_by", "approved_by", "posted_at", "currency", "tax_code", "cost_center", "department", "project"];

/** Insert canonical journal lines (shared with ERP connectors and the REST API). */
export function ledgerRow(wsId, importId, r, t, source = "CSV") {
  return [db.id(), wsId, importId, r.date, String(r.description || "").slice(0, 500), r.reference || null, r.accountCode, r.accountName || null, r.amountCents, r.counterparty || null, t,
    r.journalNo || null, r.lineNo ?? null, source, r.entryType || null, r.postedBy || null, r.approvedBy || null, r.postedAt || null, r.currency || null, r.taxCode || null, r.costCenter || null, r.department || null, r.project || null];
}
export { LEDGER_COLS };

/** Journals whose lines don't sum to zero. */
export function unbalancedJournals(records) {
  const sums = new Map();
  for (const r of records) if (r.journalNo) sums.set(r.journalNo, (sums.get(r.journalNo) || 0) + r.amountCents);
  return [...sums].filter(([, s]) => s !== 0).map(([j, s]) => ({ journalNo: j, diffCents: s }));
}

export const IMPORTERS = {
  ledger: {
    options: [{ key: "source", label: "Source system", type: "text", placeholder: "e.g. Sage 300, Dynamics BC, QuickBooks", default: "Excel/CSV upload" }],
    async run({ ws, user, records, fileName, options, cleanReport }) {
      await assertPeriodOpen(ws.id, records.map((r) => r.date));
      const lo = records.reduce((a, r) => (r.date < a ? r.date : a), "9999"), hi = records.reduce((a, r) => (r.date > a ? r.date : a), "0000");
      const existing = await db.all("SELECT date, account_code, amount_cents, COALESCE(reference,'') ref, description, COALESCE(journal_no,'') j FROM ledger_entries WHERE workspace_id = ? AND date BETWEEN ? AND ?", [ws.id, lo, hi]);
      const key = (d, a, c, r, s, j) => `${d}|${a}|${c}|${r}|${s}|${j}`;
      const seen = new Set(existing.map((e) => key(e.date, e.account_code, e.amount_cents, e.ref, e.description, e.j)));
      const fresh = records.filter((r) => !seen.has(key(r.date, r.accountCode, r.amountCents, r.reference || "", String(r.description || "").slice(0, 500), r.journalNo || "")));
      const dupes = records.length - fresh.length;
      if (!fresh.length) throw new Error("Every row is already in this workspace's ledger, so nothing was imported.");
      const unbalanced = unbalancedJournals(fresh);
      const importId = db.id(), t = db.now();
      const source = String(options.source || "Excel/CSV upload").slice(0, 60);
      await db.batch([
        { sql: "INSERT INTO ledger_imports (id, workspace_id, file_name, row_count, skipped, created_by, created_at, source, clean_report) VALUES (?,?,?,?,?,?,?,?,?)", args: [importId, ws.id, fileName, fresh.length, dupes, user.id, t, source, JSON.stringify(cleanReport)] },
        ...db.insertMany("ledger_entries", LEDGER_COLS, fresh.map((r) => ledgerRow(ws.id, importId, r, t, source))),
        auditStmt(ws.id, user.id, "ledger.imported", "ledger_import", importId, { fileName, imported: fresh.length, duplicatesSkipped: dupes, unbalancedJournals: unbalanced.length, source }),
      ]);
      const msg = `Imported ${fresh.length.toLocaleString()} journal lines${dupes ? `, skipped ${dupes} already in the ledger` : ""}.${unbalanced.length ? ` Warning: ${unbalanced.length} journal(s) don't balance — see Journal audit.` : ""}`;
      return { message: msg, redirect: `/app/${ws.slug}/ledger`, targetId: importId, imported: fresh.length };
    },
  },

  trial_balance: {
    options: [
      { key: "chart", label: "Ledger / entity name", type: "text", required: true, placeholder: "e.g. Old ERP, Subsidiary Uganda, Group", default: "ERP" },
      { key: "asAt", label: "Balances as at", type: "date", required: true },
    ],
    async run({ ws, user, records, fileName, options }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.asAt || "")) throw new Error("Choose the date the balances are as at.");
      const chart = String(options.chart || "ERP").trim().slice(0, 60);
      const id = db.id(), t = db.now();
      const total = records.reduce((a, r) => a + r.amountCents, 0);
      await db.batch([
        { sql: "INSERT INTO tb_imports (id, workspace_id, chart, as_at, file_name, row_count, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)", args: [id, ws.id, chart, options.asAt, fileName, records.length, user.id, t] },
        ...db.insertMany("tb_lines", ["id", "workspace_id", "import_id", "account_code", "account_name", "balance_cents"], records.map((r) => [db.id(), ws.id, id, r.accountCode, r.accountName || null, r.amountCents])),
        ...db.insertMany("coa_accounts", ["workspace_id", "chart", "code", "name", "class", "parent_code", "created_at"], records.map((r) => [ws.id, chart, r.accountCode, r.accountName || r.accountCode, defaultClass(r.accountCode, r.accountName), null, t]), { orIgnore: true }),
        auditStmt(ws.id, user.id, "tb.imported", "tb_import", id, { fileName, chart, asAt: options.asAt, lines: records.length, netCents: total }),
      ]);
      return { message: `Imported ${records.length} trial-balance lines for “${chart}” as at ${options.asAt}.${total !== 0 ? ` Note: the trial balance is out of balance by ${(total / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}.` : " It balances."}`, redirect: `/app/${ws.slug}/coa?chart=${encodeURIComponent(chart)}`, targetId: id, imported: records.length };
    },
  },

  coa: {
    options: [{ key: "chart", label: "Chart name", type: "text", required: true, placeholder: "e.g. GROUP (reporting chart) or Subsidiary KE", default: "GROUP" }],
    async run({ ws, user, records, fileName, options }) {
      const chart = String(options.chart || "GROUP").trim().slice(0, 60);
      const t = db.now();
      await db.batch([
        { sql: "DELETE FROM coa_accounts WHERE workspace_id = ? AND chart = ?", args: [ws.id, chart] },
        ...db.insertMany("coa_accounts", ["workspace_id", "chart", "code", "name", "class", "parent_code", "created_at"], records.map((r) => [ws.id, chart, r.accountCode, r.accountName, classFromType(r.accountType) || defaultClass(r.accountCode, r.accountName), r.parentCode || null, t]), { orIgnore: true }),
        auditStmt(ws.id, user.id, "coa.imported", "coa", chart, { fileName, accounts: records.length }),
      ]);
      return { message: `Loaded ${records.length} accounts into chart “${chart}”.`, redirect: `/app/${ws.slug}/coa?chart=${encodeURIComponent(chart)}`, imported: records.length };
    },
  },

  bank: {
    options: [{ key: "bankAccountId", label: "Bank account", type: "select", required: true, choices: "bankAccounts" }],
    async run({ ws, user, records, fileName, options }) {
      const acct = await db.get("SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ?", [options.bankAccountId, ws.id]);
      if (!acct) throw new Error("Choose a bank account (add one under Bank accounts first).");
      const id = db.id(), t = db.now();
      const dates = records.map((r) => r.date).sort();
      await db.batch([
        { sql: "INSERT INTO bank_statements (id, workspace_id, bank_account_id, file_name, period_start, period_end, row_count, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", args: [id, ws.id, acct.id, fileName, dates[0], dates[dates.length - 1], records.length, user.id, t] },
        ...db.insertMany("bank_transactions", ["id", "workspace_id", "statement_id", "date", "description", "reference", "amount_cents", "balance_cents"], records.map((r) => [db.id(), ws.id, id, r.date, String(r.description).slice(0, 500), r.reference || null, r.amountCents, r.balanceCents ?? null])),
        auditStmt(ws.id, user.id, "bank.statement_imported", "bank_statement", id, { fileName, rows: records.length, account: acct.name }),
      ]);
      return { message: `Imported ${records.length} statement lines into ${acct.name}.`, redirect: `/app/${ws.slug}/bank/statements/${id}`, targetId: id, imported: records.length };
    },
  },

  ar_aging: agingImporter("AR"),
  ap_aging: agingImporter("AP"),
};

function agingImporter(side) {
  return {
    options: [{ key: "asAt", label: "Ageing as at", type: "date", required: true }],
    async run({ ws, user, records, fileName, options }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.asAt || "")) throw new Error("Choose the ageing date.");
      const batch = db.id(), t = db.now();
      const rows = records.map((r) => {
        const parts = [r.currentCents || 0, r.d30Cents || 0, r.d60Cents || 0, r.d90Cents || 0];
        return [db.id(), ws.id, side, options.asAt, batch, r.counterparty, ...parts, r.totalCents ?? parts.reduce((a, b) => a + b, 0), t];
      });
      await db.batch([
        { sql: "DELETE FROM aging_lines WHERE workspace_id = ? AND side = ? AND as_at = ?", args: [ws.id, side, options.asAt] },
        ...db.insertMany("aging_lines", ["id", "workspace_id", "side", "as_at", "batch_id", "counterparty", "current_cents", "d30_cents", "d60_cents", "d90_cents", "total_cents", "created_at"], rows),
        auditStmt(ws.id, user.id, `aging.${side.toLowerCase()}_imported`, "aging", batch, { fileName, asAt: options.asAt, rows: rows.length }),
      ]);
      return { message: `Imported ${rows.length} ${side === "AR" ? "customer" : "supplier"} ageing lines as at ${options.asAt}.`, redirect: `/app/${ws.slug}/dashboard`, imported: rows.length };
    },
  };
}

function classFromType(t) {
  const s = String(t || "").toLowerCase();
  if (!s) return null;
  if (/non[- ]?current asset|fixed asset|property|equipment/.test(s)) return "NONCURRENT_ASSET";
  if (/current asset|bank|cash|receivable|inventory|asset/.test(s)) return "CURRENT_ASSET";
  if (/non[- ]?current liab|long[- ]term/.test(s)) return "NONCURRENT_LIABILITY";
  if (/liab|payable|credit card/.test(s)) return "CURRENT_LIABILITY";
  if (/equity|capital|reserve/.test(s)) return "EQUITY";
  if (/cost of (sales|goods)|cogs|direct cost/.test(s)) return "COGS";
  if (/other income|other expense|finance/.test(s)) return "OTHER_INCOME";
  if (/income|revenue|sales/.test(s)) return "REVENUE";
  if (/expense|overhead|cost/.test(s)) return "EXPENSE";
  return null;
}
export { classFromType };
