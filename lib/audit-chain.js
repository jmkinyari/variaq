// Tamper-evident audit log. Events are appended unsealed (so any existing batch can include an
// audit statement), then sealed in order: each event's hash = SHA-256(prev_hash || canonical event).
// Editing or deleting any sealed row breaks every hash after it, which verifyChain() detects.
// Sealing is serialised per workspace with an in-process lock plus a conditional UPDATE, so two
// instances sealing the same workspace can't fork the chain (the loser's UPDATE matches no row).
const crypto = require("crypto");
const db = require("./db");

const GENESIS = "0".repeat(64);
const canonical = (e) => JSON.stringify([e.id, e.workspace_id, e.user_id || null, e.action, e.entity_type, e.entity_id || null, e.detail, e.created_at, e.seq]);
const hashOf = (prev, e) => crypto.createHash("sha256").update(prev + "|" + canonical(e)).digest("hex");

const locks = (globalThis.__variaqSealLocks ||= new Map());

async function sealWorkspace(workspaceId) {
  const prevLock = locks.get(workspaceId) || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  locks.set(workspaceId, prevLock.then(() => mine));
  await prevLock;
  try {
    for (let guard = 0; guard < 50; guard++) {
      const last = await db.get("SELECT seq, hash FROM audit_events WHERE workspace_id = ? AND hash IS NOT NULL ORDER BY seq DESC LIMIT 1", [workspaceId]);
      const pending = await db.all("SELECT * FROM audit_events WHERE workspace_id = ? AND hash IS NULL ORDER BY created_at, rowid LIMIT 500", [workspaceId]);
      if (!pending.length) return 0;
      let seq = last?.seq || 0, prev = last?.hash || GENESIS;
      const stmts = [];
      for (const e of pending) {
        seq += 1;
        const h = hashOf(prev, { ...e, seq });
        stmts.push({ sql: "UPDATE audit_events SET seq = ?, prev_hash = ?, hash = ? WHERE id = ? AND hash IS NULL", args: [seq, prev, h, e.id] });
        prev = h;
      }
      try { await db.batch(stmts); }
      catch (e) { if (!/UNIQUE/i.test(e.message)) throw e; /* another instance sealed first — re-read and continue */ }
      if (pending.length < 500) return pending.length;
    }
  } finally { release(); if (locks.get(workspaceId) === mine) locks.delete(workspaceId); }
  return 0;
}

/** Walks the whole chain. Returns { ok, checked, brokenAt?, reason? }. */
async function verifyChain(workspaceId) {
  await sealWorkspace(workspaceId);
  let prev = GENESIS, checked = 0, after = 0;
  for (;;) {
    const rows = await db.all("SELECT * FROM audit_events WHERE workspace_id = ? AND seq > ? ORDER BY seq LIMIT 2000", [workspaceId, after]);
    if (!rows.length) break;
    for (const e of rows) {
      if (e.seq !== checked + 1) return { ok: false, checked, brokenAt: e.seq, reason: `Event #${checked + 1} is missing (deleted).` };
      if (e.prev_hash !== prev) return { ok: false, checked, brokenAt: e.seq, reason: `Event #${e.seq} doesn't link to the previous event.` };
      if (hashOf(prev, e) !== e.hash) return { ok: false, checked, brokenAt: e.seq, reason: `Event #${e.seq} was modified after it was recorded.` };
      prev = e.hash; checked++; after = e.seq;
    }
  }
  return { ok: true, checked, head: prev };
}

module.exports = { sealWorkspace, verifyChain, hashOf, GENESIS };
