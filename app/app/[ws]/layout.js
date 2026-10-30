import { Suspense } from "react";
import Nav from "@/components/Nav";
import AiAssistant from "@/components/AiAssistant";
import db from "@/lib/db";
import "@/styles/ai.css";
import { requireWorkspace, can } from "@/lib/auth";
import { aiStatus } from "@/lib/ai/config";
import { listAgents } from "@/lib/ai/agents";

export default async function WsLayout({ children, params }) {
  const { user, ws } = await requireWorkspace(params.ws);
  const [unread, ai] = await Promise.all([
    db.get("SELECT COUNT(*) n FROM notifications WHERE workspace_id = ? AND user_id = ? AND read_at IS NULL", [ws.id, user.id]),
    aiStatus(ws.id),
  ]);
  // The floating assistant appears when AI is usable here, or when the owner just needs to consent.
  const showAi = ai.ok || (ai.needsConsent && ai.entitled);
  return (
    <div className="app">
      <Nav slug={ws.slug} wsName={ws.name} userName={user.name} role={ws.role} unread={unread?.n || 0} aiOn={ai.ok} platformAdmin={user.platformAdmin} />
      <div className="main">{children}</div>
      {showAi && <Suspense fallback={null}><AiAssistant slug={ws.slug} available={ai.ok} reason={ai.reason} canEdit={can(ws.role, "data.edit")} agents={listAgents()} /></Suspense>}
    </div>
  );
}
