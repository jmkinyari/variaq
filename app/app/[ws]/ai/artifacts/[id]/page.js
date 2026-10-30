import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import db from "@/lib/db";
import "@/styles/ai.css";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import { artifactPayload } from "@/lib/ai/assistant";
import { getAgent } from "@/lib/ai/agents";
import { agentHref } from "@/lib/ai/deep-links";
import { formatDateTime } from "@/lib/dates";
export const metadata = { title: "AI artifact" };

/** One specialist artifact: redirects to its report when it has one, otherwise shows the summary + data. */
export default async function ArtifactPage({ params }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const a = await db.get("SELECT a.*, u.name author, r.visibility FROM ai_artifacts a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN ai_reports r ON r.id = a.report_id WHERE a.id = ? AND a.workspace_id = ?", [params.id, ws.id]);
  if (!a || (a.created_by !== user.id && a.visibility !== "TEAM")) notFound();
  if (a.report_id && a.status === "READY") redirect(`/app/${ws.slug}/ai/reports/${a.report_id}`);
  const agent = getAgent(a.agent_id);
  const data = await artifactPayload(ws, a).catch(() => null);
  const period = a.period_from ? a.period_from.slice(0, 7) : undefined;
  return (
    <>
      <PageHead title={a.title} crumbs={<Link href={`/app/${ws.slug}/ai`}>← Variaq AI</Link>}
        desc={`${agent?.name || a.agent_id} · ${a.kind.replace(/_/g, " ").toLowerCase()}${a.period_from ? ` · ${a.period_from} – ${a.period_to}` : ""} · ${a.author || "—"} · ${formatDateTime(a.created_at)}`}>
        <Link className="btn" href={agentHref(ws.slug, a.agent_id, { period, entity: a.entity_id })}>Ask {agent?.name || "AI"} about this</Link>
      </PageHead>
      <div className="card">
        <p><span className={`badge ${a.status === "READY" ? "good" : a.status === "FAILED" ? "bad" : "info"}`}>{a.status}</span> {a.summary}</p>
        {data?.overdue && <>
          <h3>Overdue close tasks</h3>
          {data.overdue.length ? <ul>{data.overdue.map((t, i) => <li key={i}>{t.title} — {t.owner || "unassigned"}, due {t.due}</li>)}</ul> : <p className="muted small">None overdue.</p>}
          <p className="small"><Link href={`/app/${ws.slug}/close?period=${data.period}`}>Open the {data.period} checklist →</Link></p>
        </>}
        {data && <details><summary className="small">Data captured by the specialist</summary><pre className="ai-artifact-payload">{JSON.stringify(data, null, 2)}</pre></details>}
      </div>
    </>
  );
}
