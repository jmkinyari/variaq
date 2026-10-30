// Database loaders for the financial statements. Server-only.
import "server-only";
import db from "./db";
import { buildChart } from "./statements";

export async function loadChart(wsId) {
  const [accounts, overrides, banks] = await Promise.all([
    db.all("SELECT account_code, MAX(account_name) account_name, COUNT(*) n, MIN(date) first_date, MAX(date) last_date FROM ledger_entries WHERE workspace_id = ? GROUP BY account_code ORDER BY account_code", [wsId]),
    db.all("SELECT account_code, class, is_cash, cf_category FROM account_settings WHERE workspace_id = ?", [wsId]),
    db.all("SELECT ledger_account_code FROM bank_accounts WHERE workspace_id = ? AND ledger_account_code IS NOT NULL AND ledger_account_code <> ''", [wsId]),
  ]);
  const bankCodes = new Set(banks.map((b) => String(b.ledger_account_code)));
  return { chart: buildChart(accounts, overrides, bankCodes), accounts, bankCodes };
}

/** Cumulative balance per account up to and including `asAt`. */
export async function balancesAt(wsId, asAt) {
  const rows = await db.all("SELECT account_code, SUM(amount_cents) bal FROM ledger_entries WHERE workspace_id = ? AND date <= ? GROUP BY account_code", [wsId, asAt]);
  return new Map(rows.map((r) => [String(r.account_code), r.bal || 0]));
}

/** Net movement per account between two dates (inclusive). */
export async function movements(wsId, from, to) {
  const rows = await db.all("SELECT account_code, SUM(amount_cents) amt FROM ledger_entries WHERE workspace_id = ? AND date BETWEEN ? AND ? GROUP BY account_code", [wsId, from, to]);
  return new Map(rows.map((r) => [String(r.account_code), r.amt || 0]));
}

/** All entries in a window, shaped for classifyCashFlows. */
export async function entriesBetween(wsId, from, to) {
  return db.all("SELECT id, date, reference, description, account_code accountCode, amount_cents amountCents FROM ledger_entries WHERE workspace_id = ? AND date BETWEEN ? AND ?", [wsId, from, to]);
}

export async function ledgerRange(wsId) {
  return db.get("SELECT MIN(date) mn, MAX(date) mx, COUNT(*) n FROM ledger_entries WHERE workspace_id = ?", [wsId]);
}

// ---- Period helpers (ISO dates) ----
export const monthBounds = (ym) => { const [y, m] = ym.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`]; };
export const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const shiftDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const shiftYears = (d, n) => { const [y, m, dd] = d.split("-").map(Number); const t = new Date(Date.UTC(y + n, m - 1, dd)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
/** Previous period of equal length (or previous month(s) when the range is whole months). */
export function previousPeriod(from, to) {
  const wholeMonths = from.endsWith("-01") && monthBounds(to.slice(0, 7))[1] === to;
  if (wholeMonths) {
    const [fy, fm] = from.split("-").map(Number), [ty, tm] = to.split("-").map(Number);
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    const start = new Date(Date.UTC(fy, fm - 1 - months, 1)).toISOString().slice(0, 10);
    return [start, shiftDays(from, -1)];
  }
  const len = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  const end = shiftDays(from, -1);
  return [shiftDays(end, -len), end];
}
