"use server";
import db from "@/lib/db";
import { requireWorkspace, auditStmt, audit } from "@/lib/auth";
import { validateRows, checkMapping } from "@/lib/csv-import";
import { back } from "@/lib/flash";

export async function createBankAccount(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const name = String(formData.get("name") || "").trim();
  const ledgerCode = String(formData.get("ledger_account_code") || "").trim();
  if (!name) back(`/app/${slug}/bank`, { err: "Give the bank account a name." });
  if (!ledgerCode) back(`/app/${slug}/bank`, { err: "Choose the ledger account that records this bank's transactions." });
  const id = db.id();
  await db.run("INSERT INTO bank_accounts (id, workspace_id, name, bank_name, account_mask, currency, ledger_account_code, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, ws.id, name, String(formData.get("bank_name") || "").trim() || null, String(formData.get("account_mask") || "").trim().slice(-4) || null, String(formData.get("currency") || ws.currency).toUpperCase().slice(0, 3), ledgerCode, db.now()]);
  await audit(ws.id, user.id, "bank_account.created", "bank_account", id, { name, ledgerCode });
  back(`/app/${slug}/bank`, { ok: `Added ${name}.` });
}

export async function updateBankAccount(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const id = String(formData.get("id"));
  const ledgerCode = String(formData.get("ledger_account_code") || "").trim();
  if (!ledgerCode) back(`/app/${slug}/bank`, { err: "Choose a ledger account." });
  await db.run("UPDATE bank_accounts SET ledger_account_code = ? WHERE id = ? AND workspace_id = ?", [ledgerCode, id, ws.id]);
  await audit(ws.id, user.id, "bank_account.updated", "bank_account", id, { ledgerCode });
  back(`/app/${slug}/bank`, { ok: "Bank account updated." });
}

export async function importStatement(slug, payload) {
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const { rows, mapping, dateFormat, decimal, skipInvalid, fileName, bankAccountId } = payload || {};
  const acct = await db.get("SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ?", [bankAccountId, ws.id]);
  if (!acct) return { error: "Bank account not found." };
  if (!Array.isArray(rows) || !rows.length) return { error: "The file has no rows." };
  if (rows.length > 50000) return { error: "Statements are limited to 50,000 rows." };
  const problems = checkMapping("bank", mapping || {});
  if (problems.length) return { error: problems.join(" ") };
  const { valid, errors } = validateRows("bank", rows, mapping, { dateFormat, decimal });
  if (errors.length && !skipInvalid) return { error: `${errors.length} rows have errors. Fix them or choose to skip them.` };
  if (!valid.length) return { error: "No valid rows to import." };
  const dates = valid.map((r) => r.date).sort();
  const periodStart = dates[0], periodEnd = dates[dates.length - 1];
  const overlap = await db.get("SELECT file_name FROM bank_statements WHERE bank_account_id = ? AND period_start <= ? AND period_end >= ?", [acct.id, periodEnd, periodStart]);
  const stmtId = db.id();
  const t = db.now();
  await db.batch([
    { sql: "INSERT INTO bank_statements (id, workspace_id, bank_account_id, file_name, period_start, period_end, row_count, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", args: [stmtId, ws.id, acct.id, String(fileName || "statement.csv").slice(0, 200), periodStart, periodEnd, valid.length, user.id, t] },
    ...valid.map((r) => ({ sql: "INSERT INTO bank_transactions (id, workspace_id, statement_id, date, description, reference, amount_cents, balance_cents) VALUES (?,?,?,?,?,?,?,?)", args: [db.id(), ws.id, stmtId, r.date, r.description.slice(0, 500), r.reference, r.amountCents, r.balanceCents] })),
    auditStmt(ws.id, user.id, "bank_statement.imported", "bank_statement", stmtId, { fileName, account: acct.name, rows: valid.length, skipped: errors.length, periodStart, periodEnd }),
  ]);
  const msg = `Imported ${valid.length} transactions (${periodStart} to ${periodEnd}).${overlap ? ` Note: this overlaps ${overlap.file_name}.` : ""}`;
  return { ok: true, redirect: `/app/${slug}/bank/statements/${stmtId}?ok=${encodeURIComponent(msg)}` };
}

export async function deleteStatement(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const id = String(formData.get("id"));
  const st = await db.get("SELECT * FROM bank_statements WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!st) back(`/app/${slug}/bank`, { err: "Statement not found." });
  const used = await db.get("SELECT COUNT(*) n FROM reconciliations WHERE statement_id = ?", [id]);
  if (used.n) back(`/app/${slug}/bank/statements/${id}`, { err: "This statement is used by a reconciliation. Delete the reconciliation first." });
  await db.batch([
    { sql: "DELETE FROM bank_transactions WHERE statement_id = ?", args: [id] },
    { sql: "DELETE FROM bank_statements WHERE id = ?", args: [id] },
    auditStmt(ws.id, user.id, "bank_statement.deleted", "bank_statement", id, { fileName: st.file_name }),
  ]);
  back(`/app/${slug}/bank`, { ok: `Deleted ${st.file_name}.` });
}
