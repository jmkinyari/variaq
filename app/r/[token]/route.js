import db from "@/lib/db";
import { sha256 } from "@/lib/security/crypto";
import { hit } from "@/lib/security/rate-limit";
import { reportHtml } from "@/lib/ai/assistant";
import { htmlResponse } from "@/lib/ai/serve";

// Public, read-only, time-limited share link for an AI report. The token is stored hashed.
export async function GET(req, { params }) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  if (!hit({ limit: 60, windowMs: 60_000 }, `share|${ip}`).ok) return new Response("Too many requests.", { status: 429 });
  const token = String(params.token || "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return notAvailable();
  const r = await db.get("SELECT r.*, w.name ws_name FROM ai_reports r JOIN workspaces w ON w.id = r.workspace_id WHERE r.share_token = ? AND w.suspended_at IS NULL", [sha256(token)]);
  if (!r || !r.share_expires_at || r.share_expires_at < db.now()) return notAvailable();
  return htmlResponse(await reportHtml({ id: r.workspace_id }, r), { frameable: false });
}

function notAvailable() {
  return new Response("<!doctype html><meta charset=utf-8><title>Link unavailable</title><body style=\"font:16px system-ui;padding:40px;color:#29242d\"><h1 style=\"font-weight:400\">This link isn't available</h1><p>It may have expired or been revoked. Ask the person who shared it for a new link.</p></body>",
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
