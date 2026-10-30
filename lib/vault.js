// Workspace-scoped encryption backed by the database keyring. Use these helpers for any
// sensitive column (connector credentials, KRA PINs, auditor correspondence, MFA seeds).
const db = require("./db");
const c = require("./security/crypto");

async function loadKey(workspaceId, version) {
  return version === undefined
    ? db.get("SELECT key_version, wrapped_dek FROM workspace_keys WHERE workspace_id = ? AND active = 1 ORDER BY key_version DESC LIMIT 1", [workspaceId])
    : db.get("SELECT key_version, wrapped_dek FROM workspace_keys WHERE workspace_id = ? AND key_version = ?", [workspaceId, version]);
}
async function createKey(workspaceId) {
  const wrapped = c.wrapKey(c.newDek(), workspaceId);
  await db.run("INSERT OR IGNORE INTO workspace_keys (workspace_id, key_version, wrapped_dek, active, created_at) VALUES (?,?,?,1,?)", [workspaceId, 1, wrapped, db.now()]);
  return loadKey(workspaceId); // re-read: a concurrent request may have won the insert
}
const keyring = c.makeKeyring(loadKey, createKey);

/** SQL statement creating a workspace's first key — include it in the workspace-creation batch. */
function newKeyStmt(workspaceId) {
  return { sql: "INSERT INTO workspace_keys (workspace_id, key_version, wrapped_dek, active, created_at) VALUES (?,?,?,1,?)", args: [workspaceId, 1, c.wrapKey(c.newDek(), workspaceId), db.now()] };
}

/** Rotate: new active DEK version. Old versions stay for decrypting existing values; re-encrypt lazily. */
async function rotateKey(workspaceId) {
  const cur = await db.get("SELECT MAX(key_version) v FROM workspace_keys WHERE workspace_id = ?", [workspaceId]);
  const v = (cur?.v || 0) + 1;
  await db.batch([
    { sql: "UPDATE workspace_keys SET active = 0 WHERE workspace_id = ?", args: [workspaceId] },
    { sql: "INSERT INTO workspace_keys (workspace_id, key_version, wrapped_dek, active, created_at) VALUES (?,?,?,1,?)", args: [workspaceId, v, c.wrapKey(c.newDek(), workspaceId), db.now()] },
  ]);
  c.forgetDeks(workspaceId);
  return v;
}

const seal = (wsId, purpose, value) => c.seal(keyring, wsId, purpose, value);
const open = (wsId, purpose, value) => c.open(keyring, wsId, purpose, value);
const openJson = (wsId, purpose, value, fallback) => c.openJson(keyring, wsId, purpose, value, fallback);
const blindIndex = (wsId, purpose, value) => c.blindIndex(wsId, purpose, value);

module.exports = { seal, open, openJson, blindIndex, newKeyStmt, rotateKey, keyring };
