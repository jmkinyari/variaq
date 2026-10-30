import { Suspense } from "react";
import Link from "next/link";
import db from "@/lib/db";
import "@/styles/ai.css";
import { requireWorkspace, can } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import AiAssistant from "@/components/AiAssistant";
import { aiStatus } from "@/lib/ai/config";
import { TEMPLATES } from "@/lib/ai/assistant";
import { ledgerRange, monthBounds } from "@/lib/statements-data";
import { formatDateTime } from "@/lib/dates";
import { createReport, enqueueAgentTaskForm } from "./actions";
import { listAgents, getAgent } from "@/lib/ai/agents";
import { listArtifacts, listAgentJobs } from "@/lib/ai/agent-jobs";
export const metadata = { title: "Variaq AI" };

export default async function AiPage({ params, searchParams }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const agents = listAgents();
  const [s, range, artifacts, agentJobs, reports] = await Promise.all([
    aiStatus(ws.id), ledgerRange(ws.id), listArtifacts(ws.id, user.id, { limit: 30 }), listAgentJobs(ws.id, { limit: 10 }),
    db.all("SELECT r.id, r.title, r.template, r.period_from, r.period_to, r.visibility, r.share_expires_at, r.created_at, r.created_by, u.name author FROM ai_reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.workspace_id = ? AND (r.visibility = 'TEAM' OR r.created_by = ?) ORDER BY r.created_at DESC LIMIT 100", [ws.id, user.id]),
  ]);
  const lastMonth = range?.mx ? monthBounds(range.mx.slice(0, 7)) : ["", ""];
  const preAgent = getAgent(searchParams.agent)?.id || "cfo-reporting";
  const prePeriod = /^\d{4}-\d{2}$/.test(searchParams.period || "") ? searchParams.period : range?.mx?.slice(0, 7) || "";
  const activeJobs = agentJobs.filter((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const pct = s.limit ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 0;
  return (
    <>
      <PageHead title="Variaq AI" desc="Ask questions about your company's figures, get explanations and proposed next steps, and generate shareable HTML reports.">
        <span className="small muted">{s.used.toLocaleString()} / {s.limit ? s.limit.toLocaleString() : "∞"} tokens this month</span>
      </PageHead>
      <Flash searchParams={searchParams} />
      {!s.ok && <div className="alert info">{s.reason} {s.needsConsent && ws.role === "OWNER" && <Link href={`/app/${ws.slug}/settings#ai`}>Go to settings →</Link>}</div>}
      {s.limit > 0 && <div className="progress" style={{ marginBottom: "1rem" }} title={`${pct}% of this month's AI allowance used`}><span style={{ width: `${pct}%` }} /></div>}

      <div className="ai-grid">
        <div className="ai-inline-wrap"><Suspense fallback={null}><AiAssistant slug={ws.slug} available={s.ok} reason={s.reason} mode="inline" canEdit={can(ws.role, "data.edit")} agents={agents} /></Suspense></div>
        <div className="stack">
          <form action={enqueueAgentTaskForm} className="card">
            <h3>Run a specialist in the background</h3>
            <input type="hidden" name="slug" value={ws.slug} />
            <div className="field"><label>Specialist</label><select name="agentId" defaultValue={preAgent}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.description}</option>)}</select></div>
            <div className="form-row">
              <div className="field"><label>Month</label><input type="month" name="period" defaultValue={prePeriod} /></div>
              <div className="field"><label>Entity / reference (optional)</label><input name="entityId" maxLength={80} defaultValue={searchParams.entity || ""} placeholder="e.g. branch, cost centre, journal no." /></div>
            </div>
            <div className="field"><label>Instructions (optional)</label><textarea name="instructions" rows={2} maxLength={2000} placeholder="e.g. Board audience; focus on cash runway." /></div>
            <Submit disabled={!s.ok}>Queue task</Submit>
            <p className="faint small" style={{ marginBottom: 0 }}>Reports, audit packs, tax recons and close summaries run as background jobs and are saved under Artifacts. Close summaries work even without AI.</p>
            {activeJobs.length > 0 && <p className="small" style={{ marginBottom: 0 }}>{activeJobs.length} task(s) running: {activeJobs.map((j) => getAgent(j.agentId)?.shortLabel || j.type).join(", ")}. Refresh to update.</p>}
          </form>

          <div className="card">
            <h3>Artifacts</h3>
            {artifacts.length === 0 ? <p className="muted small">No specialist artifacts yet.</p> : (
              <ul className="ai-report-list">{artifacts.map((a) => (
                <li key={a.id}><Link href={a.report_id ? `/app/${ws.slug}/ai/reports/${a.report_id}` : `/app/${ws.slug}/ai/artifacts/${a.id}`}><strong>{a.title}</strong></Link>
                  <div className="faint small"><span className="ai-agent-badge">{getAgent(a.agent_id)?.shortLabel || a.agent_id}</span>{a.kind.replace(/_/g, " ").toLowerCase()}{a.period_from ? ` · ${a.period_from} – ${a.period_to}` : ""} · {a.author} · {formatDateTime(a.created_at)}{" "}
                    <span className={`badge ${a.status === "READY" ? "good" : a.status === "FAILED" ? "bad" : "info"}`}>{a.status === "READY" ? "Ready" : a.status === "FAILED" ? "Failed" : "Pending"}</span></div>
                  {a.summary && <div className="small muted">{a.summary.slice(0, 200)}</div>}</li>))}</ul>
            )}
          </div>

          <form action={createReport} className="card">
            <h3>Generate a report</h3>
            <input type="hidden" name="slug" value={ws.slug} />
            <div className="field"><label>Report type</label><select name="template" defaultValue="MANAGEMENT">{Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></div>
            <div className="field"><label>Title (optional)</label><input name="title" maxLength={150} placeholder="e.g. April 2026 management report" /></div>
            <div className="form-row">
              <div className="field"><label>From</label><input type="date" name="from" defaultValue={lastMonth[0]} /></div>
              <div className="field"><label>To</label><input type="date" name="to" defaultValue={lastMonth[1]} /></div>
            </div>
            <div className="field"><label>Instructions (optional; required for custom)</label><textarea name="instructions" rows={3} maxLength={2000} placeholder="e.g. Focus on fuel and delivery costs and the cash runway. Audience: the board." /></div>
            <Submit disabled={!s.ok} pendingText="Writing report — this can take a minute…">Generate report</Submit>
            <p className="faint small" style={{ marginBottom: 0 }}>The AI gathers figures from your ledger and modules, then writes the report. Reports start private to you; share them with your team or by a time-limited link.</p>
          </form>

          <div className="card">
            <h3>Reports</h3>
            {reports.length === 0 ? <p className="muted small">No reports yet.</p> : (
              <ul className="ai-report-list">{reports.map((r) => (
                <li key={r.id}><Link href={`/app/${ws.slug}/ai/reports/${r.id}`}><strong>{r.title}</strong></Link>
                  <div className="faint small">{TEMPLATES[r.template]?.label || r.template}{r.period_from ? ` · ${r.period_from} – ${r.period_to}` : ""} · {r.author} · {formatDateTime(r.created_at)}
                    {" "}<span className={`badge ${r.visibility === "TEAM" ? "info" : ""}`}>{r.visibility === "TEAM" ? "Team" : "Private"}</span>{r.share_expires_at && r.share_expires_at > db.now() && <span className="badge warn" style={{ marginLeft: 4 }}>Link shared</span>}</div></li>))}</ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
