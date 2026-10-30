"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AiMarkdown from "./AiMarkdown";
import { ask, decide, getConversation, listConversations, enqueueAgentTask, getJobStatus } from "@/app/app/[ws]/ai/actions";

const TOOL_LABELS = {
  get_company_overview: "company overview", get_kpis: "KPIs", get_financial_statements: "financial statements", search_ledger: "ledger",
  get_account_activity: "account activity", get_journal: "journal", list_audit_findings: "audit findings", list_tasks: "tasks",
  get_budget_vs_actual: "budget vs actual", get_vat_status: "VAT reconciliation", list_auditor_queries: "auditor queries", list_team: "team",
  propose_task: "task proposal", propose_report: "report proposal",
};
const QUICK = [
  ["Explain this page", "Explain what I'm looking at on this page, what the key numbers mean, and anything that needs my attention."],
  ["What needs attention?", "What needs my attention right now across close, audit findings, tax and cash? Prioritise and propose tasks for the top items."],
  ["Month in review", "Summarise the latest month's performance: revenue, margins, profit, cash and the biggest movements versus the previous month, with reasons from the transactions."],
  ["Draft a report", "Propose a management report for the latest month."],
];

const YM = /^\d{4}-\d{2}(-\d{2})?$/;
const HEAVY = /\b(report|pack|board summary|recon|reconciliation|evidence|forecast|full)\b/i;

/**
 * The embedded assistant. `mode="floating"` renders a launcher button and a slide-over panel;
 * `mode="inline"` renders the chat directly (AI workspace page).
 * `agents` (from listAgents()) enables the Project Variaq specialist picker. Deep-link params
 * `?agent=kra-tax&period=2026-04&entity=…&q=…` preselect a specialist and context; `askai=1`
 * opens the floating panel.
 */
export default function AiAssistant({ slug, available, reason, mode = "floating", canEdit, agents = [] }) {
  const path = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const urlAgent = sp?.get("agent") || "";
  const urlPeriod = YM.test(sp?.get("period") || "") ? sp.get("period") : "";
  const urlEntity = (sp?.get("entity") || "").slice(0, 80);
  const [agentId, setAgentId] = useState(byId[urlAgent] ? urlAgent : "auto");
  const [ctx, setCtx] = useState({ period: urlPeriod, entity: urlEntity });
  const [jobs, setJobs] = useState({}); // jobId → {status, agentId, artifact, error}
  const [open, setOpen] = useState(mode === "inline" || (mode === "floating" && sp?.get("askai") === "1"));
  const [convoId, setConvoId] = useState(null);
  const [items, setItems] = useState([]); // {role, text, tools?, proposals?: [...]}
  const [proposals, setProposals] = useState({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(null);
  const [, startTransition] = useTransition();
  const endRef = useRef(null);
  const inputRef = useRef(null);

  // Deep links: follow ?agent / ?period / ?entity / ?q as the user navigates between modules.
  useEffect(() => {
    if (byId[urlAgent]) setAgentId(urlAgent);
    setCtx({ period: urlPeriod, entity: urlEntity });
    const q = sp?.get("q");
    if (q && mode === "inline") setInput(q.slice(0, 4000));
    if (mode === "floating" && sp?.get("askai") === "1") setOpen(true);
  }, [urlAgent, urlPeriod, urlEntity, sp, byId, mode]);
  // Poll queued background tasks until they finish.
  useEffect(() => {
    const pending = Object.entries(jobs).filter(([, j]) => j.status === "QUEUED" || j.status === "RUNNING");
    if (!pending.length) return;
    const t = setTimeout(async () => {
      for (const [id] of pending) {
        const r = await getJobStatus(slug, id).catch(() => null);
        if (r && !r.error) setJobs((js) => ({ ...js, [id]: { ...js[id], status: r.status, artifact: r.artifact, error: r.error } }));
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [jobs, slug]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [items, busy]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => {
    if (mode !== "floating") return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  async function send(text) {
    const q = String(text ?? input).trim();
    if (!q || busy) return;
    setInput(""); setError(""); setBusy(true);
    setItems((xs) => [...xs, { role: "user", text: q }]);
    try {
      const res = await ask(slug, { conversationId: convoId, message: q, page: { path, title: document.title }, agentId, period: ctx.period || null, entityId: ctx.entity || null });
      if (res?.error) { setError(res.error); setItems((xs) => xs.slice(0, -1)); setInput(q); }
      else {
        setConvoId(res.conversationId);
        setProposals((p) => ({ ...p, ...Object.fromEntries((res.proposals || []).map((x) => [x.id, x])) }));
        setItems((xs) => [...xs, { role: "assistant", text: res.answer, tools: res.toolsUsed, proposals: (res.proposals || []).map((x) => x.id), agent: res.agent?.id, routedBy: res.agent?.routedBy, heavy: HEAVY.test(q) }]);
        setHistory(null);
      }
    } catch { setError("Couldn't reach the server. Check your connection and try again."); setItems((xs) => xs.slice(0, -1)); setInput(q); }
    setBusy(false);
  }

  async function onDecide(id, approve) {
    setProposals((p) => ({ ...p, [id]: { ...p[id], pending: true } }));
    const r = await decide(slug, id, approve);
    if (r?.error) { setProposals((p) => ({ ...p, [id]: { ...p[id], pending: false, error: r.error } })); return; }
    setProposals((p) => ({ ...p, [id]: { ...p[id], pending: false, status: r.status, link: r.link } }));
    startTransition(() => router.refresh());
  }

  async function openHistory() {
    setHistory(history ? null : await listConversations(slug));
  }
  async function loadConvo(id) {
    const c = await getConversation(slug, id);
    if (!c) return;
    setConvoId(c.id); setProposals(c.proposals || {});
    setItems(c.display.map((m) => ({ role: m.role, text: m.text, tools: m.tools, proposals: m.proposals, agent: m.agent })));
    if (c.agentId && byId[c.agentId] && agentId !== "auto") setAgentId(c.agentId);
    setHistory(null);
  }
  async function queueTask(forAgent, instructions) {
    const id = forAgent && byId[forAgent] ? forAgent : agentId !== "auto" ? agentId : "cfo-reporting";
    setError("");
    const r = await enqueueAgentTask(slug, { agentId: id, period: ctx.period || undefined, entityId: ctx.entity || undefined, instructions: instructions ? String(instructions).slice(0, 2000) : undefined });
    if (r?.error) { setError(r.error); return; }
    setJobs((js) => ({ ...js, [r.jobId]: { status: "QUEUED", agentId: id, deduped: r.deduped } }));
  }
  function newChat() { setConvoId(null); setItems([]); setProposals({}); setError(""); setHistory(null); }

  const panel = (
    <section className={`ai-panel ${mode}`} role={mode === "floating" ? "dialog" : undefined} aria-label="Variaq AI assistant">
      <header className="ai-head">
        <div><strong>Variaq AI</strong><div className="faint small">{agentId !== "auto" && byId[agentId] ? `${byId[agentId].name} specialist` : "Project Variaq routes to the right specialist"} · actions need your approval</div></div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm ghost" onClick={openHistory} aria-expanded={!!history}>History</button>
          <button className="btn sm ghost" onClick={newChat}>New</button>
          {mode === "floating" && <Link className="btn sm ghost" href={`/app/${slug}/ai`} onClick={() => setOpen(false)}>Reports</Link>}
          {mode === "floating" && <button className="btn sm ghost" onClick={() => setOpen(false)} aria-label="Close assistant">✕</button>}
        </div>
      </header>
      {agents.length > 0 && <div className="ai-agents" role="tablist" aria-label="Specialist">
        <button role="tab" aria-selected={agentId === "auto"} className={`ai-agent-tab ${agentId === "auto" ? "on" : ""}`} onClick={() => setAgentId("auto")} title="Project Variaq picks the specialist from the page and your question">Auto</button>
        {agents.map((a) => <button key={a.id} role="tab" aria-selected={agentId === a.id} className={`ai-agent-tab ${agentId === a.id ? "on" : ""}`} onClick={() => setAgentId(a.id)} title={a.description}>{a.shortLabel}</button>)}
      </div>}
      {(ctx.period || ctx.entity) && <div className="ai-context small">
        {ctx.period && <span className="ai-chip">Period {ctx.period}<button aria-label="Clear period" onClick={() => setCtx((c) => ({ ...c, period: "" }))}>×</button></span>}
        {ctx.entity && <span className="ai-chip">Entity {ctx.entity}<button aria-label="Clear entity" onClick={() => setCtx((c) => ({ ...c, entity: "" }))}>×</button></span>}
      </div>}
      {Object.keys(jobs).length > 0 && <div className="ai-jobs small">
        {Object.entries(jobs).map(([id, j]) => <div key={id} className="ai-job">
          <span className={`badge ${j.status === "DONE" ? "good" : j.status === "FAILED" ? "bad" : "info"}`}>{j.status === "DONE" ? "Ready" : j.status === "FAILED" ? "Failed" : j.status === "RUNNING" ? "Running" : "Queued"}</span>{" "}
          {byId[j.agentId]?.name || j.agentId} background task{j.deduped ? " (already queued)" : ""}
          {j.artifact?.id && <> · <Link href={j.artifact.reportId ? `/app/${slug}/ai/reports/${j.artifact.reportId}` : `/app/${slug}/ai/artifacts/${j.artifact.id}`}>Open</Link></>}
          {j.status === "FAILED" && j.artifact?.summary && <span className="faint"> · {j.artifact.summary}</span>}
        </div>)}
      </div>}
      {history && <div className="ai-history">
        {history.length ? history.map((h) => <button key={h.id} className="ai-hist-item" onClick={() => loadConvo(h.id)}>{h.agent_id && byId[h.agent_id] && <span className="ai-agent-badge">{byId[h.agent_id].shortLabel}</span>}{h.title}<span className="faint small"> · {new Date(h.updated_at).toLocaleDateString("en-GB")}</span></button>) : <p className="muted small">No previous chats.</p>}
      </div>}
      <div className="ai-body">
        {!available ? <div className="alert info">{reason || "AI isn't available."}</div> : items.length === 0 ? (
          <div className="ai-empty">
            <p className="muted">Ask about your numbers, a journal, a variance, a KRA tax issue — or what to do next. I look things up in this company's data and can propose tasks and reports for you to approve.</p>
            {agentId !== "auto" && byId[agentId] && <p className="small"><strong>{byId[agentId].name}:</strong> <span className="muted">{byId[agentId].description}</span></p>}
            <div className="ai-quick">{(agentId !== "auto" && byId[agentId]?.quick?.length ? byId[agentId].quick : QUICK).map(([label, q]) => <button key={label} className="btn sm" onClick={() => send(q)}>{label}</button>)}</div>
            {agentId !== "auto" && byId[agentId] && <div className="ai-quick" style={{ marginTop: 8 }}><button className="btn sm ghost" onClick={() => queueTask(agentId)}>Generate full {byId[agentId].shortLabel.toLowerCase()} pack in background{ctx.period ? ` (${ctx.period})` : ""}</button></div>}
          </div>
        ) : items.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            {m.role === "assistant" ? <>
              {m.agent && byId[m.agent] && <div className="ai-agent-badge" title={m.routedBy ? `Routed by ${m.routedBy}` : undefined}>{byId[m.agent].name}</div>}
              {m.tools?.length > 0 && <div className="ai-tools faint small">Looked at: {m.tools.map((t) => TOOL_LABELS[t] || t).join(", ")}</div>}
              <AiMarkdown text={m.text} />
              {(m.proposals || []).map((pid) => proposals[pid] && <Proposal key={pid} p={proposals[pid]} canEdit={canEdit} onDecide={onDecide} />)}
              {m.heavy && m.agent && byId[m.agent] && <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => queueTask(m.agent, items[i - 1]?.text)}>Generate full report in background</button>}
              <div className="ai-label">AI-generated — check before relying on it</div>
            </> : <div className="ai-user-text">{m.text}</div>}
          </div>
        ))}
        {busy && <div className="ai-msg assistant"><div className="ai-typing" aria-live="polite"><span /><span /><span /> Looking into it…</div></div>}
        {error && <div className="alert error small">{error}</div>}
        <div ref={endRef} />
      </div>
      {available && <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={inputRef} rows={2} value={input} maxLength={4000} placeholder={`Ask ${agentId !== "auto" && byId[agentId] ? byId[agentId].name : "Variaq AI"}…  (Enter to send, Shift+Enter for a new line)`}
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Message" />
        <button className="btn primary" disabled={busy || !input.trim()}>{busy ? "…" : "Send"}</button>
      </form>}
    </section>
  );

  if (mode === "inline") return panel;
  return (
    <>
      {!open && <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Open Variaq AI assistant (Ctrl+J)" title="Variaq AI (Ctrl+J)">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" /></svg>
        <span>Ask AI</span></button>}
      {open && <div className="ai-scrim" onClick={() => setOpen(false)} />}
      {open && panel}
    </>
  );
}

function Proposal({ p, canEdit, onDecide }) {
  const isTask = p.type === "CREATE_TASK";
  const d = p.payload || {};
  return (
    <div className="ai-proposal">
      <div className="small faint">{isTask ? "Proposed task" : "Proposed report"}</div>
      <strong>{d.title}</strong>
      {isTask ? <div className="small muted">{d.description}{d.assigneeName ? ` · for ${d.assigneeName}` : ""}{d.dueDate ? ` · due ${d.dueDate}` : ""}{d.priority && d.priority !== "NORMAL" ? ` · ${d.priority.toLowerCase()} priority` : ""}</div>
        : <div className="small muted">{d.template?.toLowerCase()} report{d.periodFrom ? ` · ${d.periodFrom} – ${d.periodTo}` : ""}{d.instructions ? ` · ${d.instructions.slice(0, 120)}` : ""}</div>}
      {p.error && <div className="small" style={{ color: "var(--bad)" }}>{p.error}</div>}
      {p.status === "PROPOSED" ? (
        <div className="row" style={{ marginTop: ".4rem" }}>
          <button className="btn sm primary" disabled={p.pending || (isTask && !canEdit)} onClick={() => onDecide(p.id, true)}>{p.pending ? (isTask ? "Creating…" : "Writing report…") : isTask ? "Create task" : "Generate report"}</button>
          <button className="btn sm" disabled={p.pending} onClick={() => onDecide(p.id, false)}>Dismiss</button>
        </div>
      ) : <div className="small" style={{ marginTop: ".3rem" }}><span className={`badge ${p.status === "APPROVED" ? "good" : ""}`}>{p.status === "APPROVED" ? "Approved" : "Dismissed"}</span>{p.link && <> · <Link href={p.link}>Open</Link></>}</div>}
    </div>
  );
}
