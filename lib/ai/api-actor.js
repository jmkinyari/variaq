// REST API actor for specialist agents: an API key belongs to a workspace, and agent calls run as
// the key's creator (their AI usage, audit trail and data access) while they remain a member.
import "server-only";
import db from "../db";
import { ApiError } from "../api";

export async function apiActor(key, ws) {
  const row = await db.get("SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ? WHERE w.id = ?", [key.created_by, ws.id]);
  if (!row) throw new ApiError(403, "forbidden", "The key's creator is no longer a member of this workspace.");
  if (row.suspended_at) throw new ApiError(403, "suspended", "This workspace is suspended.");
  const user = await db.get("SELECT id, name, email FROM users WHERE id = ?", [key.created_by]);
  if (!user) throw new ApiError(403, "forbidden", "The key's creator no longer exists.");
  return { ws: row, user };
}

export function parseBody(body) {
  try { return JSON.parse(body || "{}"); } catch { throw new ApiError(400, "invalid_json", "Body must be JSON."); }
}
