import db from "@/lib/db";
import { getUser } from "@/lib/auth";
import { reportHtml } from "@/lib/ai/assistant";
import { htmlResponse } from "@/lib/ai/serve";

// Sanitised report HTML for the in-app viewer, printing and download. Members only.
export async function GET(req, { params }) {
  const user = await getUser();
  if (!user) return new Response("Sign in required.", { status: 401 });
  const ws = await db.get("SELECT w.* FROM workspaces w JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ? WHERE w.slug = ? AND w.suspended_at IS NULL", [user.id, params.ws]);
  if (!ws) return new Response("Not found.", { status: 404 });
  const r = await db.get("SELECT * FROM ai_reports WHERE id = ? AND workspace_id = ?", [params.id, ws.id]);
  if (!r || (r.visibility === "PRIVATE" && r.created_by !== user.id)) return new Response("Not found.", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return htmlResponse(await reportHtml(ws, r), { download, fileName: r.title, origin: new URL(req.url).origin });
}
