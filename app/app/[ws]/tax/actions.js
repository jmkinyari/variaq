"use server";
import db from "@/lib/db";
import { requirePerm, auditStmt } from "@/lib/auth";
import { back } from "@/lib/flash";
import { seal, blindIndex } from "@/lib/vault";
import { normPin, validPin } from "@/lib/tax/keys";
import { parseAmount } from "@/lib/money";

const CODE_RE = /^[A-Za-z0-9._-]{1,30}$/;

export async function saveProfile(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "admin");
  const path = `/app/${slug}/tax`;
  const f = (k) => String(formData.get(k) || "").trim();
  const pin = normPin(f("kra_pin"));
  if (pin && !validPin(pin)) back(path, { err: "That KRA PIN isn't in the right format (P or A, 9 digits, a letter — e.g. P051234567X)." });
  const codes = ["output_vat_account", "input_vat_account", "wht_vat_account", "wht_account", "paye_account"].map((k) => f(k) || null);
  if (codes.some((c) => c && !CODE_RE.test(c))) back(path, { err: "Account codes can only contain letters, numbers, dots, dashes and underscores." });
  const revenue = f("revenue_accounts").split(/[,\s]+/).filter(Boolean);
  if (revenue.some((c) => !CODE_RE.test(c))) back(path, { err: "Revenue accounts must be a comma-separated list of account codes." });
  const fy = Math.min(12, Math.max(1, parseInt(f("fy_end_month") || "12", 10) || 12));
  const flag = (k) => (formData.get(k) === "on" ? 1 : 0);
  const sealed = pin ? await seal(ws.id, "tax.kra_pin", pin) : null;
  const t = db.now();
  await db.batch([
    { sql: `INSERT INTO tax_profile (workspace_id, kra_pin, pin_index, vat_registered, wht_vat_agent, output_vat_account, input_vat_account, wht_vat_account, wht_account, paye_account, updated_by, updated_at, fy_end_month, paye_registered, wht_registered, tot_registered, revenue_accounts)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(workspace_id) DO UPDATE SET kra_pin=excluded.kra_pin, pin_index=excluded.pin_index, vat_registered=excluded.vat_registered, wht_vat_agent=excluded.wht_vat_agent,
              output_vat_account=excluded.output_vat_account, input_vat_account=excluded.input_vat_account, wht_vat_account=excluded.wht_vat_account, wht_account=excluded.wht_account,
              paye_account=excluded.paye_account, updated_by=excluded.updated_by, updated_at=excluded.updated_at, fy_end_month=excluded.fy_end_month, paye_registered=excluded.paye_registered,
              wht_registered=excluded.wht_registered, tot_registered=excluded.tot_registered, revenue_accounts=excluded.revenue_accounts`,
      args: [ws.id, sealed, pin ? blindIndex(ws.id, "kra_pin", pin) : null, flag("vat_registered"), flag("wht_vat_agent"), ...codes, user.id, t, fy, flag("paye_registered"), flag("wht_registered"), flag("tot_registered"), revenue.join(",") || null] },
    // Never write the PIN itself to the audit log.
    auditStmt(ws.id, user.id, "tax.profile_updated", "tax_profile", ws.id, { pinSet: !!pin, vatAccounts: codes.slice(0, 2), fyEndMonth: fy }),
  ]);
  back(path, { ok: "Tax profile saved. The KRA PIN is stored encrypted." });
}

export async function recordFiling(formData) {
  const slug = String(formData.get("slug"));
  const { user, ws } = await requirePerm(slug, "data.edit");
  const path = `/app/${slug}/tax`;
  const code = String(formData.get("code") || ""), period = String(formData.get("period") || "");
  const status = String(formData.get("status") || "");
  if (!/^[A-Z0-9]{2,12}$/.test(code) || !/^\d{4}-\d{2}$/.test(period) || !["DUE", "FILED", "PAID"].includes(status)) back(path, { err: "Invalid filing details." });
  const today = new Date().toISOString().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(formData.get("date") || "")) ? String(formData.get("date")) : today;
  const amountRaw = String(formData.get("amount") || "").trim();
  const amount = amountRaw ? parseAmount(amountRaw) : null;
  if (amountRaw && amount === null) back(path, { err: "Amount isn't a number." });
  const reference = String(formData.get("reference") || "").trim().slice(0, 60) || null;
  const prev = await db.get("SELECT * FROM tax_filings WHERE workspace_id = ? AND code = ? AND period = ?", [ws.id, code, period]);
  const filedOn = status === "DUE" ? null : status === "FILED" ? date : prev?.filed_on || date;
  const paidOn = status === "PAID" ? date : null;
  await db.batch([
    { sql: `INSERT INTO tax_filings (id, workspace_id, code, period, status, filed_on, paid_on, amount_cents, reference, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(workspace_id, code, period) DO UPDATE SET status=excluded.status, filed_on=excluded.filed_on, paid_on=excluded.paid_on, amount_cents=COALESCE(excluded.amount_cents, tax_filings.amount_cents), reference=COALESCE(excluded.reference, tax_filings.reference), updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      args: [db.id(), ws.id, code, period, status, filedOn, paidOn, amount, reference, user.id, db.now()] },
    auditStmt(ws.id, user.id, "tax.filing_recorded", "tax_filing", `${code}:${period}`, { status, date, reference }),
  ]);
  back(path, { ok: `${code} for ${period} marked ${status.toLowerCase()}.` });
}
