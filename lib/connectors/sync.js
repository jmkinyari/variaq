// Sync engine: pulls pages from an adapter, then idempotently upserts canonical lines into
// ledger_entries keyed by (workspace_id, source, external_id). Changed lines are updated in place,
// new ones inserted, unchanged ones skipped; lines dated in locked periods are rejected and logged.
// Each run records control totals so finance can prove completeness against the ERP.
const db = require("../db");
const { safeFetch } = require("../security/net");
const { canon, lineHash } = require("./common");
const { ADAPTERS, loadConfig, sealConfig, sourceName } = require("./index");
const { defaultClass } = require("../statements");

const LEDGER_COLS = ["id", "workspace_id", "import_id", "date", "description", "reference", "account_code", "account_name", "amount_cents", "counterparty", "created_at",
  "journal_no", "line_no", "source", "external_id", "entry_type", "posted_by", "approved_by", "posted_at", "currency", "fx_rate", "tax_code", "cost_center", "department", "project"];
const MAX_PAGES = 400;
const TIME_BUDGET_MS = 4 * 60_000;

/** DB row → canonical line (for hashing against incoming). */
function rowToLine(r) {
  return { externalId: r.external_id, journalNo: r.journal_no, lineNo: r.line_no, date: r.date, accountCode: r.account_code, accountName: r.account_name, description: r.description,
    reference: r.reference, amountCents: r.amount_cents, currency: r.currency, fxRate: r.fx_rate, counterparty: r.counterparty, entryType: r.entry_type, postedBy: r.posted_by,
    approvedBy: r.approved_by, postedAt: r.posted_at, taxCode: r.tax_code, costCenter: r.cost_center, department: r.department, project: r.project };
}

/** Pure diff: existing Map(externalId → {id, hash}) vs incoming canonical lines. Last occurrence of a duplicated id wins. */
function diffLines(existing, incoming) {
  const byId = new Map();
  for (const l of incoming) byId.set(l.externalId, l);
  const inserts = [], updates = [], unchanged = [];
  for (const l of byId.values()) {
    const e = existing.get(l.externalId);
    if (!e) inserts.push(l);
    else if (e.hash !== lineHash(l)) updates.push({ id: e.id, line: l });
    else unchanged.push(l);
  }
  return { inserts, updates, unchanged };
}

/** Control totals over a set of lines: per-journal balance and per-period counts/sums. Pure. */
function controlTotals(lines) {
  const journals = new Map(), byPeriod = {};
  let dr = 0, cr = 0;
  for (const l of lines) {
    if (l.amountCents > 0) dr += l.amountCents; else cr -= l.amountCents;
    if (l.journalNo) journals.set(l.journalNo, (journals.get(l.journalNo) || 0) + l.amountCents);
    const p = l.date.slice(0, 7);
    const b = (byPeriod[p] ||= { lines: 0, debitCents: 0, creditCents: 0 });
    b.lines++; if (l.amountCents > 0) b.debitCents += l.amountCents; else b.creditCents -= l.amountCents;
  }
  const unbalanced = [...journals].filter(([, s]) => s !== 0).map(([journalNo, diffCents]) => ({ journalNo, diffCents }));
  return { lines: lines.length, journals: journals.size, debitCents: dr, creditCents: cr, unbalanced: unbalanced.slice(0, 50), unbalancedCount: unbalanced.length, byPeriod };
}

function insertArgs(wsId, importId, source, l, t) {
  return [db.id(), wsId, importId, l.date, l.description, l.reference, l.accountCode, l.accountName, l.amountCents, l.counterparty, t,
    l.journalNo, l.lineNo, source, l.externalId, l.entryType, l.postedBy, l.approvedBy, l.postedAt, l.currency, l.fxRate, l.taxCode, l.costCenter, l.department, l.project];
}

/**
 * Validate + upsert canonical lines for one source. Used by connector syncs and the REST API.
 * Returns { inserted, updated, unchanged, invalid: [msg], locked: [externalId] }.
 */
async function upsertLines(wsId, source, rawLines, { importId = null } = {}) {
  const valid = [], invalid = [];
  for (const raw of rawLines) { const r = canon(raw); if (r.error) invalid.push(r.error); else valid.push(r.line); }
  const lockedPeriods = new Set((await db.all("SELECT period FROM period_locks WHERE workspace_id = ?", [wsId])).map((r) => r.period));
  const locked = [];
  const open = valid.filter((l) => { if (lockedPeriods.has(l.date.slice(0, 7))) { locked.push(l.externalId); return false; } return true; });
  let inserted = 0, updated = 0, unchanged = 0;
  const t = db.now();
  for (let i = 0; i < open.length; i += 500) {
    const chunk = open.slice(i, i + 500);
    const ids = chunk.map((l) => l.externalId);
    const rows = await db.all(`SELECT * FROM ledger_entries WHERE workspace_id = ? AND source = ? AND external_id IN (${ids.map(() => "?").join(",")})`, [wsId, source, ...ids]);
    const existing = new Map(rows.map((r) => [r.external_id, { id: r.id, hash: lineHash(rowToLine(r)), date: r.date }]));
    const d = diffLines(existing, chunk);
    // An update must not move a line out of (or within) a locked period either.
    const ups = d.updates.filter((u) => { const e = rows.find((r) => r.id === u.id); if (e && lockedPeriods.has(e.date.slice(0, 7))) { locked.push(u.line.externalId); return false; } return true; });
    await db.batch([
      ...db.insertMany("ledger_entries", LEDGER_COLS, d.inserts.map((l) => insertArgs(wsId, importId, source, l, t)), { orIgnore: true, perStmt: 50 }),
      ...ups.map(({ id, line: l }) => ({ sql: `UPDATE ledger_entries SET date=?, description=?, reference=?, account_code=?, account_name=?, amount_cents=?, counterparty=?, journal_no=?, line_no=?, entry_type=?, posted_by=?, approved_by=?, posted_at=?, currency=?, fx_rate=?, tax_code=?, cost_center=?, department=?, project=? WHERE id = ? AND workspace_id = ?`,
        args: [l.date, l.description, l.reference, l.accountCode, l.accountName, l.amountCents, l.counterparty, l.journalNo, l.lineNo, l.entryType, l.postedBy, l.approvedBy, l.postedAt, l.currency, l.fxRate, l.taxCode, l.costCenter, l.department, l.project, id, wsId] })),
    ]);
    inserted += d.inserts.length; updated += ups.length; unchanged += d.unchanged.length;
  }
  return { inserted, updated, unchanged, invalid, locked, validLines: valid };
}

/** Delete lines the ERP reports as removed (only those not confirmed in a bank reconciliation). */
async function deleteLines(wsId, source, externalIds) {
  let n = 0;
  for (let i = 0; i < externalIds.length; i += 500) {
    const ids = externalIds.slice(i, i + 500);
    const r = await db.run(`DELETE FROM ledger_entries WHERE workspace_id = ? AND source = ? AND external_id IN (${ids.map(() => "?").join(",")}) AND id NOT IN (SELECT ledger_entry_id FROM matches WHERE status = 'CONFIRMED') AND substr(date,1,7) NOT IN (SELECT period FROM period_locks WHERE workspace_id = ?)`, [wsId, source, ...ids, wsId]);
    n += r.changes;
  }
  return n;
}

async function withRetry(fn, log, attempts = 3) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const retryable = e.retryable || /timed out|ECONNRESET|reach/i.test(e.message);
      if (!retryable || i >= attempts - 1) throw e;
      const wait = 1000 * 2 ** i + Math.random() * 500;
      log(`Transient error (${e.message}); retrying in ${Math.round(wait / 1000)}s.`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function auditInsert(wsId, userId, action, entityId, detail) {
  return { sql: "INSERT INTO audit_events (id, workspace_id, user_id, action, entity_type, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)", args: [db.id(), wsId, userId || null, action, "connector", entityId, JSON.stringify(detail), db.now()] };
}

/** Run a full incremental sync for a connector. Safe to call concurrently: a running sync blocks others. */
async function runSync(connectorId, { triggeredBy = null, http = safeFetch } = {}) {
  const conn = await db.get("SELECT * FROM connectors WHERE id = ?", [connectorId]);
  if (!conn) throw new Error("Connector not found.");
  if (conn.status !== "ACTIVE") return { skipped: "Connector is disabled." };
  const stale = new Date(Date.now() - 15 * 60_000).toISOString();
  const claim = await db.run("UPDATE connectors SET last_status = 'RUNNING', updated_at = ? WHERE id = ? AND (last_status IS NULL OR last_status <> 'RUNNING' OR updated_at < ?)", [db.now(), conn.id, stale]);
  if (!claim.changes) return { skipped: "A sync is already running." };

  const adapter = ADAPTERS[conn.type];
  const source = sourceName(conn);
  const runId = db.id(), importId = db.id();
  const logLines = [];
  const log = (m) => { logLines.push(`${new Date().toISOString().slice(11, 19)} ${String(m).slice(0, 500)}`); };
  await db.batch([
    { sql: "INSERT INTO sync_runs (id, workspace_id, connector_id, status, started_at, triggered_by) VALUES (?,?,?,?,?,?)", args: [runId, conn.workspace_id, conn.id, "RUNNING", db.now(), triggeredBy] },
    { sql: "INSERT INTO ledger_imports (id, workspace_id, file_name, row_count, skipped, created_by, created_at, source) VALUES (?,?,?,?,?,?,?,?)", args: [importId, conn.workspace_id, `${conn.name} — sync`, 0, 0, triggeredBy || "system", db.now(), source] },
  ]);
  const totals = { fetched: 0, inserted: 0, updated: 0, skipped: 0, invalid: 0, locked: 0, deleted: 0 };
  const allFetched = [];
  let cfg = await loadConfig(conn);
  let cursor = conn.cursor ? JSON.parse(conn.cursor) : null;
  const started = Date.now();
  let status = "SUCCESS", error = null, pages = 0;
  try {
    if (!adapter) throw new Error(`Unknown connector type ${conn.type}.`);
    for (;;) {
      const page = await withRetry(() => adapter.fetch(cfg, cursor, { http, log }), log);
      pages++;
      if (page.cfgUpdate) { cfg = { ...cfg, ...page.cfgUpdate }; await db.run("UPDATE connectors SET config = ? WHERE id = ?", [await sealConfig(conn.workspace_id, cfg), conn.id]); }
      if (page.chart?.length) {
        const t = db.now();
        await db.batch(db.insertMany("coa_accounts", ["workspace_id", "chart", "code", "name", "class", "parent_code", "created_at"],
          page.chart.filter((a) => a.code).map((a) => [conn.workspace_id, conn.name.slice(0, 60), String(a.code), String(a.name || a.code), defaultClass(a.code, a.name), null, t]), { orIgnore: true }));
        log(`Chart of accounts: ${page.chart.length} accounts.`);
      }
      totals.fetched += page.lines.length;
      const r = await upsertLines(conn.workspace_id, source, page.lines, { importId });
      totals.inserted += r.inserted; totals.updated += r.updated; totals.skipped += r.unchanged; totals.invalid += r.invalid.length; totals.locked += r.locked.length;
      if (allFetched.length < 200_000) allFetched.push(...r.validLines);
      for (const m of r.invalid.slice(0, 5)) log(`Rejected: ${m}`);
      if (r.locked.length) log(`${r.locked.length} line(s) fall in locked periods and were not applied.`);
      if (page.deletedExternalIds?.length) totals.deleted += await deleteLines(conn.workspace_id, source, page.deletedExternalIds);
      // A full-snapshot source (file drop) is the whole ledger: anything no longer in it was deleted upstream.
      if (page.fullSnapshot && page.lines.length) {
        const keep = new Set(r.validLines.map((l) => l.externalId));
        const gone = (await db.all("SELECT external_id FROM ledger_entries WHERE workspace_id = ? AND source = ?", [conn.workspace_id, source])).map((x) => x.external_id).filter((x) => !keep.has(x));
        if (gone.length) { totals.deleted += await deleteLines(conn.workspace_id, source, gone); log(`${gone.length} line(s) no longer in the file were removed.`); }
      }
      cursor = page.nextCursor ?? cursor;
      await db.run("UPDATE connectors SET cursor = ?, updated_at = ? WHERE id = ?", [cursor ? JSON.stringify(cursor) : null, db.now(), conn.id]);
      if (page.done) break;
      if (pages >= MAX_PAGES || Date.now() - started > TIME_BUDGET_MS) { log("Time budget reached; the next sync continues from here."); status = "PARTIAL"; break; }
    }
  } catch (e) {
    status = "FAILED"; error = String(e.message || e).slice(0, 500);
    log(`Failed: ${error}`);
  }
  // Control totals: what the ERP sent this run vs what is now stored for those periods.
  const controls = controlTotals(allFetched);
  const periods = Object.keys(controls.byPeriod);
  if (periods.length) {
    const stored = await db.all(`SELECT substr(date,1,7) p, COUNT(*) n, SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) dr, SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) cr FROM ledger_entries WHERE workspace_id = ? AND source = ? AND substr(date,1,7) IN (${periods.map(() => "?").join(",")}) GROUP BY p`, [conn.workspace_id, source, ...periods]);
    controls.stored = Object.fromEntries(stored.map((s) => [s.p, { lines: s.n, debitCents: s.dr || 0, creditCents: s.cr || 0 }]));
  }
  if (controls.unbalancedCount) log(`${controls.unbalancedCount} journal(s) from the ERP don't balance — they will appear in Journal audit.`);
  const fin = db.now();
  await db.batch([
    { sql: "UPDATE sync_runs SET status=?, finished_at=?, fetched=?, inserted=?, updated=?, skipped=?, controls=?, log=?, error=? WHERE id=?", args: [status, fin, totals.fetched, totals.inserted, totals.updated, totals.skipped + totals.invalid + totals.locked, JSON.stringify({ ...controls, invalid: totals.invalid, locked: totals.locked, deleted: totals.deleted }), JSON.stringify(logLines.slice(-300)), error, runId] },
    { sql: "UPDATE connectors SET last_sync_at=?, last_status=?, last_error=?, updated_at=? WHERE id=?", args: [fin, status, error, fin, conn.id] },
    { sql: "UPDATE ledger_imports SET row_count = ?, skipped = ? WHERE id = ?", args: [totals.inserted, totals.skipped, importId] },
    auditInsert(conn.workspace_id, triggeredBy, `connector.sync_${status.toLowerCase()}`, conn.id, { name: conn.name, ...totals }),
  ]);
  if (!totals.inserted) await db.run("DELETE FROM ledger_imports WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE import_id = ?)", [importId, importId]);
  return { runId, status, error, ...totals };
}

/** Test credentials without writing ledger data. Persists rotated tokens. */
async function testConnection(conn, { http = safeFetch } = {}) {
  const adapter = ADAPTERS[conn.type];
  const cfg = await loadConfig(conn);
  const r = await adapter.test(cfg, { http, log: () => {} });
  if (r.cfgUpdate) await db.run("UPDATE connectors SET config = ? WHERE id = ?", [await sealConfig(conn.workspace_id, { ...cfg, ...r.cfgUpdate }), conn.id]);
  return r;
}

module.exports = { runSync, testConnection, upsertLines, diffLines, controlTotals, rowToLine, LEDGER_COLS };
