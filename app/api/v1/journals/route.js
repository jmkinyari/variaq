import db from "@/lib/db";
import { handler, json, ApiError, apiAudit } from "@/lib/api";
import { upsertLines, controlTotals } from "@/lib/connectors/sync";
import { toCents } from "@/lib/connectors/common";
export const dynamic = "force-dynamic";

const MAX_LINES = 5000;

/**
 * POST /api/v1/journals — push journal lines from any ERP. Idempotent by externalId per source:
 * re-sending a line updates it; unchanged lines are skipped. Journals must balance.
 * Body: { source?: "SAP-PROD", lines: [{ externalId, journalNo, date, accountCode, accountName?, description, amount | debit/credit | amountCents, ... }] }
 */
export const POST = handler("journals:write", async (req, { key, ws, body }) => {
  let payload;
  try { payload = JSON.parse(body || "{}"); } catch { throw new ApiError(400, "invalid_json", "Body must be JSON."); }
  const lines = payload.lines;
  if (!Array.isArray(lines) || !lines.length) throw new ApiError(400, "no_lines", "Send a non-empty `lines` array.");
  if (lines.length > MAX_LINES) throw new ApiError(413, "too_many_lines", `At most ${MAX_LINES} lines per request.`);
  const source = `API:${String(payload.source || "default").replace(/[^\w.\-]/g, "").slice(0, 40) || "default"}`;
  const canon = lines.map((l) => ({
    ...l,
    amountCents: Number.isInteger(l.amountCents) ? l.amountCents : l.amount !== undefined ? toCents(l.amount) : (toCents(l.debit) || 0) - Math.abs(toCents(l.credit) || 0),
  }));
  const pre = controlTotals(canon.filter((l) => l.date && Number.isInteger(l.amountCents)).map((l) => ({ ...l, date: String(l.date) })));
  if (pre.unbalancedCount && !payload.allowUnbalanced) throw new ApiError(422, "unbalanced", `${pre.unbalancedCount} journal(s) don't balance. Fix them or send allowUnbalanced: true (they will be flagged in Journal audit).`, { unbalanced: pre.unbalanced.slice(0, 20) });
  const r = await upsertLines(ws.id, source, canon);
  if (r.inserted || r.updated) await apiAudit(ws.id, key, "api.journals_pushed", { source, inserted: r.inserted, updated: r.updated, invalid: r.invalid.length, locked: r.locked.length });
  return json({ source, received: lines.length, inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, rejected: { invalid: r.invalid.slice(0, 50), lockedPeriod: r.locked.slice(0, 50) } }, r.invalid.length || r.locked.length ? 207 : 200);
});

/** GET /api/v1/journals?from=&to=&account=&journal=&source=&cursor=&limit= — keyset pagination by id. */
export const GET = handler("journals:read", async (req, { ws }) => {
  const u = new URL(req.url);
  const q = (k) => u.searchParams.get(k);
  const limit = Math.min(1000, Math.max(1, parseInt(q("limit") || "200", 10)));
  const where = ["workspace_id = ?"], args = [ws.id];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (q("from")) { if (!iso.test(q("from"))) throw new ApiError(400, "bad_date", "from must be YYYY-MM-DD"); where.push("date >= ?"); args.push(q("from")); }
  if (q("to")) { if (!iso.test(q("to"))) throw new ApiError(400, "bad_date", "to must be YYYY-MM-DD"); where.push("date <= ?"); args.push(q("to")); }
  if (q("account")) { where.push("account_code = ?"); args.push(q("account")); }
  if (q("journal")) { where.push("journal_no = ?"); args.push(q("journal")); }
  if (q("source")) { where.push("source = ?"); args.push(q("source")); }
  if (q("cursor")) { where.push("id > ?"); args.push(q("cursor")); }
  const rows = await db.all(`SELECT id, date, journal_no, line_no, account_code, account_name, description, reference, amount_cents, counterparty, source, external_id, entry_type, posted_by, approved_by, posted_at, currency, tax_code, cost_center, department, project FROM ledger_entries WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`, [...args, limit + 1]);
  const more = rows.length > limit;
  const data = rows.slice(0, limit).map((r) => ({ ...r, amount: r.amount_cents / 100 }));
  return json({ data, nextCursor: more ? data[data.length - 1].id : null });
});
