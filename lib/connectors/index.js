// Connector registry + encrypted configuration storage.
const vault = require("../vault");

const ADAPTERS = Object.fromEntries([
  require("./odoo"), require("./xero"), require("./quickbooks"), require("./dynamics"), require("./zoho"), require("./generic"), require("./filedrop"),
].map((a) => [a.type, a]));

const PURPOSE = "connector.config";
const loadConfig = (conn) => vault.openJson(conn.workspace_id, PURPOSE, conn.config, {});
const sealConfig = (workspaceId, cfg) => vault.seal(workspaceId, PURPOSE, cfg);

/** Merge a form submission into an existing config. Blank secret fields keep the stored value (secrets are write-only). */
function mergeConfig(adapter, existing, submitted) {
  const out = { ...existing };
  for (const f of adapter.fields) {
    const v = submitted[f.key];
    if (v === undefined) continue;
    const s = String(v).trim();
    if (f.secret && !s) continue;
    out[f.key] = s;
  }
  return out;
}
function missingRequired(adapter, cfg) {
  return adapter.fields.filter((f) => f.required && !String(cfg[f.key] ?? "").trim()).map((f) => f.label);
}
/** Non-secret config values that are safe to show in the UI. */
function publicConfig(adapter, cfg) {
  return Object.fromEntries(adapter.fields.filter((f) => !f.secret).map((f) => [f.key, cfg[f.key] ?? ""]));
}
const sourceName = (conn) => `${conn.type}#${conn.id.slice(0, 8)}`;

module.exports = { ADAPTERS, loadConfig, sealConfig, mergeConfig, missingRequired, publicConfig, sourceName };
