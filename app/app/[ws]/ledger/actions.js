"use server";
import db from "@/lib/db";
import { requireWorkspace, auditStmt } from "@/lib/auth";
import { validateRows, checkMapping } from "@/lib/csv-import";
import { back } from "@/lib/flash";

const MAX_ROWS = 50000;

export async function importLedger(slug, payload) {
  const { user, ws } = await requireWorkspace(slug, "MEMBER");
  const { rows, mapping, dateFormat, decimal, skipInvalid, fileName } = payload || {};
  if (!Array.isArray(rows) || !rows.length) return { error: "The file has no rows." };
  if (rows.length > MAX_ROWS) return { error: `Files are limited to ${MAX_ROWS.toLocaleString()} rows. Split the export by period.` };
  const problems = checkMapping("ledger", mapping || {});
  if (problems.length) return { error: problems.join(" ") };
  // Re-validate on the server — never trust the browser's result.
  const { valid, errors } = validateRows("ledger", rows, mapping, { dateFormat, decimal });
  if (errors.length && !skipInvalid) return { error: `${errors.length} rows have errors. Fix them or choose to skip them.` };
  if (!valid.length) return { error: "No valid rows to import." };

  // Skip rows that exactly duplicate entries already in this workspace.
  const existing = await db.all("SELECT date, account_code, amount_cents, COALESCE(reference,'') ref, description FROM ledger_entries WHERE workspace_id = ? AND date BETWEEN ? AND ?",
    [ws.id, valid.reduce((a, r) => (r.date < a ? r.date : a), "9999"), valid.reduce((a, r) => (r.date > a ? r.date : a), "0000")]);
  const key = (d, a, c, r, s) => `${d}|${a}|${c}|${r}|${s}`;
  const seen = new Set(existing.map((e) => key(e.date, e.account_code, e.amount_cents, e.ref, e.description)));
  const fresh = valid.filter((r) => !seen.has(key(r.date, r.accountCode, r.amountCents, r.reference || "", r.description)));
  const dupes = valid.length - fresh.length;
  if (!fresh.length) return { error: "Every valid row is already in this workspace's ledger, so nothing was imported." };

  const importId = db.id();
  const t = db.now();
  await db.batch([
    { sql: "INSERT INTO ledger_imports (id, workspace_id, file_name, row_count, skipped, created_by, created_at) VALUES (?,?,?,?,?,?,?)", args: [importId, ws.id, String(fileName || "import.csv").slice(0, 200), fresh.length, errors.length + dupes, user.id, t] },
    ...fresh.map((r) => ({ sql: "INSERT INTO ledger_entries (id, workspace_id, import_id, date, description, reference, account_code, account_name, amount_cents, counterparty, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", args: [db.id(), ws.id, importId, r.date, r.description.slice(0, 500), r.reference, r.accountCode, r.accountName, r.amountCents, r.counterparty, t] })),
    auditStmt(ws.id, user.id, "ledger.imported", "ledger_import", importId, { fileName, imported: fresh.length, invalidSkipped: errors.length, duplicatesSkipped: dupes }),
  ]);
  const msg = `Imported ${fresh.length.toLocaleString()} entries${errors.length ? `, skipped ${errors.length} with errors` : ""}${dupes ? `, skipped ${dupes} already in the ledger` : ""}.`;
  return { ok: true, redirect: `/app/${slug}/ledger?ok=${encodeURIComponent(msg)}` };
}

export async function deleteImport(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requireWorkspace(slug, "ADMIN");
  const id = String(formData.get("id"));
  const imp = await db.get("SELECT * FROM ledger_imports WHERE id = ? AND workspace_id = ?", [id, ws.id]);
  if (!imp) back(`/app/${slug}/ledger`, { err: "Import not found." });
  const used = await db.get("SELECT COUNT(*) n FROM matches m JOIN ledger_entries l ON l.id = m.ledger_entry_id WHERE l.import_id = ? AND m.status = 'CONFIRMED'", [id]);
  if (used.n) back(`/app/${slug}/ledger`, { err: `Can't delete: ${used.n} entries from this import are confirmed in a reconciliation. Remove those matches first.` });
  await db.batch([
    { sql: "DELETE FROM matches WHERE ledger_entry_id IN (SELECT id FROM ledger_entries WHERE import_id = ?)", args: [id] },
    { sql: "DELETE FROM recon_exceptions WHERE ledger_entry_id IN (SELECT id FROM ledger_entries WHERE import_id = ?)", args: [id] },
    { sql: "DELETE FROM ledger_entries WHERE import_id = ?", args: [id] },
    { sql: "DELETE FROM ledger_imports WHERE id = ?", args: [id] },
    auditStmt(ws.id, user.id, "ledger.import_deleted", "ledger_import", id, { fileName: imp.file_name, rows: imp.row_count }),
  ]);
  back(`/app/${slug}/ledger`, { ok: `Deleted ${imp.file_name} and its ${imp.row_count} entries.` });
}
