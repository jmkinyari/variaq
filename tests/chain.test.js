// Tamper-evident audit chain against a throwaway database file.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nq-chain-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db").replace(/\\/g, "/")}`;
process.env.VARIAQ_MASTER_KEY = "b".repeat(64);
const db = require("../lib/db");
const { sealWorkspace, verifyChain } = require("../lib/audit-chain");
const vault = require("../lib/vault");

test("audit events are sealed in order and tampering is detected", async () => {
  await db.ensureSchema();
  await db.run("INSERT INTO workspaces (id, name, slug, created_at) VALUES ('w','W','w',?)", [db.now()]);
  for (let i = 0; i < 5; i++) await db.run("INSERT INTO audit_events (id, workspace_id, action, entity_type, detail, created_at) VALUES (?,?,?,?,?,?)", [db.id(), "w", "test." + i, "x", "{}", new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()]);
  await Promise.all([sealWorkspace("w"), sealWorkspace("w")]); // concurrent sealers must not fork the chain
  const ok = await verifyChain("w");
  assert.deepStrictEqual([ok.ok, ok.checked], [true, 5]);
  await db.run("UPDATE audit_events SET detail = '{\"x\":1}' WHERE seq = 3 AND workspace_id = 'w'");
  const bad = await verifyChain("w");
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.brokenAt, 3);
});

test("workspace vault seals and rotates keys", async () => {
  await db.run("INSERT INTO workspaces (id, name, slug, created_at) VALUES ('w2','W2','w2',?)", [db.now()]);
  const s = await vault.seal("w2", "t", "hello");
  await vault.rotateKey("w2");
  const s2 = await vault.seal("w2", "t", "again");
  assert.match(s, /^enc:v1:/); assert.match(s2, /^enc:v2:/);
  assert.strictEqual(await vault.open("w2", "t", s), "hello"); // old versions still readable
  assert.strictEqual(await vault.open("w2", "t", s2), "again");
});
