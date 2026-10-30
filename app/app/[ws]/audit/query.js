// Shared filter → SQL for the audit log page and its CSV export.
export function auditWhere(wsId, sp) {
  const where = ["a.workspace_id = ?"], args = [wsId];
  if (sp.type) { where.push("a.entity_type = ?"); args.push(String(sp.type)); }
  if (sp.user) { where.push("a.user_id = ?"); args.push(String(sp.user)); }
  if (sp.action) { where.push("a.action LIKE ?"); args.push(`%${String(sp.action).slice(0, 60)}%`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.from || "")) { where.push("a.created_at >= ?"); args.push(sp.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.to || "")) { where.push("a.created_at < date(?, '+1 day')"); args.push(sp.to); }
  return { W: where.join(" AND "), args };
}
