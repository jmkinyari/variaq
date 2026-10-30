// Workspace creation (shared by the app and the seed script).
const db = require("./db");
const { CLOSE_TEMPLATE } = require("./templates");
const { newKeyStmt } = require("./vault");

function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
}

async function createWorkspace({ name, country = "KE", currency = "KES", industry = null, ownerId, period }) {
  let slug = slugify(name);
  if (await db.get("SELECT id FROM workspaces WHERE slug = ?", [slug])) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const wsId = db.id();
  const t = db.now();
  const p = period || new Date().toISOString().slice(0, 7);
  await db.batch([
    { sql: "INSERT INTO workspaces (id, name, slug, country, currency, industry, created_at) VALUES (?,?,?,?,?,?,?)", args: [wsId, name, slug, country, currency, industry, t] },
    newKeyStmt(wsId),
    { sql: "INSERT INTO memberships (id, user_id, workspace_id, role, created_at) VALUES (?,?,?,?,?)", args: [db.id(), ownerId, wsId, "OWNER", t] },
    ...CLOSE_TEMPLATE.map(([category, title], i) => ({ sql: "INSERT INTO close_tasks (id, workspace_id, period, title, category, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", args: [db.id(), wsId, p, title, category, i, t, t] })),
    { sql: "INSERT INTO audit_events (id, workspace_id, user_id, action, entity_type, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)", args: [db.id(), wsId, ownerId, "workspace.created", "workspace", wsId, JSON.stringify({ name }), t] },
  ]);
  return { id: wsId, slug };
}

module.exports = { createWorkspace, slugify };
