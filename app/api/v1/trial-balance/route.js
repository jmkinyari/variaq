import db from "@/lib/db";
import { handler, json, ApiError } from "@/lib/api";
export const dynamic = "force-dynamic";

/** GET /api/v1/trial-balance?asAt=YYYY-MM-DD — closing balance per account (debit +, credit −). */
export const GET = handler("tb:read", async (req, { ws }) => {
  const asAt = new URL(req.url).searchParams.get("asAt") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asAt)) throw new ApiError(400, "bad_date", "asAt must be YYYY-MM-DD");
  const rows = await db.all("SELECT account_code, MAX(account_name) account_name, SUM(amount_cents) bal FROM ledger_entries WHERE workspace_id = ? AND date <= ? GROUP BY account_code ORDER BY account_code", [ws.id, asAt]);
  const lines = rows.filter((r) => r.bal).map((r) => ({ accountCode: r.account_code, accountName: r.account_name, balance: r.bal / 100, debit: r.bal > 0 ? r.bal / 100 : 0, credit: r.bal < 0 ? -r.bal / 100 : 0 }));
  const net = rows.reduce((a, r) => a + (r.bal || 0), 0);
  return json({ asAt, currency: ws.currency, lines, totals: { debit: lines.reduce((a, l) => a + l.debit, 0), credit: lines.reduce((a, l) => a + l.credit, 0), net: net / 100, balanced: net === 0 } });
});
