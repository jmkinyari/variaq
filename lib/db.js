// Data-access layer over libSQL (SQLite file locally, sqld/Turso when hosted).
//
// Concurrency model:
// - Local file: WAL journal + busy timeout, so many readers and one writer at a time coexist.
//   Encrypted at rest when DATABASE_ENCRYPTION_KEY is set (libSQL page-level encryption).
// - Hosted (libsql:// or http(s)://): any number of stateless app instances share one database.
// - Writes that must be atomic go through batch() / tx(); transient SQLITE_BUSY errors are retried
//   with jitter. Mutable documents (budgets, forecasts, tasks, board packs) carry a `version` column
//   for optimistic locking (see updateVersioned).
const { createClient } = require("@libsql/client");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { SCHEMA, MIGRATIONS } = require("./schema");

function makeClient() {
  const url = process.env.DATABASE_URL || "file:data/variaq.db";
  const isFile = url.startsWith("file:");
  if (isFile) {
    const dir = path.dirname(path.resolve(url.slice(5)));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  return {
    isFile,
    client: createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
      encryptionKey: isFile && process.env.DATABASE_ENCRYPTION_KEY ? process.env.DATABASE_ENCRYPTION_KEY : undefined,
    }),
  };
}

const g = globalThis;
if (!g.__variaqDb) g.__variaqDb = { ...makeClient(), ready: null };
const state = g.__variaqDb;

const isDupColumn = (e) => /duplicate column name/i.test(String(e?.message || e));
const isBusy = (e) => /SQLITE_BUSY|database is locked/i.test(String(e?.message || e) + String(e?.code || ""));

async function migrate(client) {
  await client.execute("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set((await client.execute("SELECT id FROM schema_migrations")).rows.map((r) => r[0]));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const sql of m.steps) {
      try { await client.execute(sql); }
      catch (e) { if (!isDupColumn(e)) throw new Error(`Migration ${m.id} failed on: ${sql.slice(0, 80)}… — ${e.message}`); }
    }
    await client.execute({ sql: "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)", args: [m.id, new Date().toISOString()] });
  }
}

async function ensureSchema() {
  if (!state.ready) {
    // Retried as a whole: several processes (web instances, the worker, a build) may start together,
    // or the file may still be recovering after an unclean shutdown (SQLITE_BUSY_RECOVERY).
    state.ready = retry(async () => {
      const c = state.client;
      if (state.isFile) {
        await c.execute("PRAGMA journal_mode = WAL");
        await c.execute("PRAGMA busy_timeout = 8000");
        await c.execute("PRAGMA synchronous = NORMAL");
      }
      await c.execute("PRAGMA foreign_keys = ON");
      const stmts = SCHEMA.split(";").map((s) => s.trim()).filter(Boolean);
      await c.batch(stmts, "write");
      await migrate(c);
    }, 8).catch((e) => { state.ready = null; throw e; });
  }
  return state.ready;
}

const rowsToObjects = (rs) => rs.rows.map((r) => {
  const o = {};
  rs.columns.forEach((c, i) => { const v = r[i]; o[c] = typeof v === "bigint" ? Number(v) : v; });
  return o;
});

async function retry(fn, attempts = 5) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (!isBusy(e) || i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 40 * 2 ** i + Math.random() * 60));
    }
  }
}

async function all(sql, args = []) { await ensureSchema(); return rowsToObjects(await retry(() => state.client.execute({ sql, args }))); }
async function get(sql, args = []) { return (await all(sql, args))[0] || null; }
async function run(sql, args = []) { await ensureSchema(); const r = await retry(() => state.client.execute({ sql, args })); return { changes: r.rowsAffected, lastId: r.lastInsertRowid }; }

const CHUNK = 2000;
/** Run many statements atomically: [{sql, args}, ...]. Large sets use one write transaction in chunks. */
async function batch(stmts) {
  await ensureSchema();
  const list = stmts.filter(Boolean);
  if (!list.length) return;
  if (list.length <= CHUNK) return retry(() => state.client.batch(list, "write"));
  return retry(async () => {
    const tx = await state.client.transaction("write");
    try {
      for (let i = 0; i < list.length; i += CHUNK) await tx.batch(list.slice(i, i + CHUNK));
      await tx.commit();
    } catch (e) { await tx.rollback().catch(() => {}); throw e; } finally { tx.close(); }
  });
}

/** Interactive write transaction: fn(tx) where tx has all/get/run. Retried on contention. */
async function tx(fn) {
  await ensureSchema();
  return retry(async () => {
    const t = await state.client.transaction("write");
    const api = {
      all: async (sql, args = []) => rowsToObjects(await t.execute({ sql, args })),
      get: async (sql, args = []) => rowsToObjects(await t.execute({ sql, args }))[0] || null,
      run: async (sql, args = []) => { const r = await t.execute({ sql, args }); return { changes: r.rowsAffected }; },
      batch: (stmts) => t.batch(stmts.filter(Boolean)),
    };
    try { const out = await fn(api); await t.commit(); return out; }
    catch (e) { await t.rollback().catch(() => {}); throw e; }
    finally { t.close(); }
  });
}

/** Multi-row INSERT statements (fewer round trips than one statement per row). */
function insertMany(table, cols, rows, { orIgnore = false, perStmt = 100 } = {}) {
  const out = [];
  const ph = `(${cols.map(() => "?").join(",")})`;
  for (let i = 0; i < rows.length; i += perStmt) {
    const chunk = rows.slice(i, i + perStmt);
    out.push({ sql: `INSERT ${orIgnore ? "OR IGNORE " : ""}INTO ${table} (${cols.join(",")}) VALUES ${chunk.map(() => ph).join(",")}`, args: chunk.flat() });
  }
  return out;
}

class ConflictError extends Error { constructor() { super("Someone else saved changes to this in the meantime. Reload to see their version, then re-apply your edits."); this.code = "CONFLICT"; } }
/** UPDATE … SET …, version = version + 1 WHERE id = ? AND workspace_id = ? AND version = ? */
async function updateVersioned(table, id, workspaceId, expectedVersion, fields) {
  const keys = Object.keys(fields);
  const r = await run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, version = version + 1 WHERE id = ? AND workspace_id = ? AND version = ?`, [...keys.map((k) => fields[k]), id, workspaceId, expectedVersion]);
  if (!r.changes) throw new ConflictError();
  return expectedVersion + 1;
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

module.exports = { all, get, run, batch, tx, insertMany, updateVersioned, ConflictError, id, now, ensureSchema, client: () => state.client };
