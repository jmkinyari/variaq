import db from "@/lib/db";
import { handler, json } from "@/lib/api";
import { buildChart, CLASSES } from "@/lib/statements";
export const dynamic = "force-dynamic";

/** GET /api/v1/accounts — chart of accounts as used in the ledger, with statement classification. */
export const GET = handler("reports:read", async (req, { ws }) => {
  const [accounts, overrides] = await Promise.all([
    db.all("SELECT account_code, MAX(account_name) account_name, COUNT(*) n, MIN(date) first_date, MAX(date) last_date FROM ledger_entries WHERE workspace_id = ? GROUP BY account_code ORDER BY account_code", [ws.id]),
    db.all("SELECT account_code, class, is_cash, cf_category FROM account_settings WHERE workspace_id = ?", [ws.id]),
  ]);
  const chart = buildChart(accounts, overrides);
  return json({ data: accounts.map((a) => { const c = chart.get(String(a.account_code)); return { code: a.account_code, name: a.account_name, class: c.cls, classLabel: CLASSES[c.cls], isCash: c.isCash, entries: a.n, firstDate: a.first_date, lastDate: a.last_date }; }) });
});
