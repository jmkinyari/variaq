// Specialist agent registry and router for Project Variaq. Pure CommonJS (no DB, no secrets) so the
// same definitions serve server code, API routes, the job worker and unit tests. The coordinator
// ("Project Variaq") resolves which specialist handles a message: explicit id → page → keywords → default.
const { periodBounds, agentHref } = require("./deep-links");

const TOOL = {
  overview: "get_company_overview", kpis: "get_kpis", fs: "get_financial_statements", ledger: "search_ledger", account: "get_account_activity",
  journal: "get_journal", findings: "list_audit_findings", tasks: "list_tasks", bva: "get_budget_vs_actual", vat: "get_vat_status",
  queries: "list_auditor_queries", team: "list_team", pTask: "propose_task", pReport: "propose_report",
};
const COMMON = [TOOL.overview, TOOL.team, TOOL.pTask, TOOL.pReport];

const AGENTS = [
  {
    id: "cfo-reporting", name: "CFO Reporting", shortLabel: "CFO", jobType: "agent.cfo_report", artifactKind: "REPORT",
    description: "KPIs, management accounts, board packs and statement commentary.",
    pagePrefixes: ["/board-packs", "/dashboard", "/statements", "/reports"],
    keywords: ["kpi", "board", "board pack", "management report", "management accounts", "ebitda", "margin", "revenue", "profit", "p&l", "income statement", "balance sheet", "runway", "dso", "dpo"],
    toolNames: [...COMMON, TOOL.kpis, TOOL.fs, TOOL.ledger, TOOL.account, TOOL.journal, TOOL.bva, TOOL.findings, TOOL.vat, TOOL.tasks],
    defaultTemplates: ["MANAGEMENT", "BOARD", "CASH"],
    system: "You are the CFO Reporting specialist. Focus on performance and position: KPIs, P&L, balance sheet, cash and runway, and board-ready narrative. Lead with the headline number and its driver; compare with prior period and budget where available. Prefer MANAGEMENT or BOARD templates when proposing reports.",
    quick: [["Month in review", "Summarise the latest month: revenue, margins, profit, cash and the biggest movements versus the prior month, with reasons."], ["KPI health check", "Which KPIs are off-track this month and why?"], ["Board summary", "Propose a board summary report for the latest month."]],
  },
  {
    id: "budget-forecast", name: "Budget Forecast", shortLabel: "Budget", jobType: "agent.budget_forecast", artifactKind: "FORECAST",
    description: "Budgets, budget-vs-actual variance, reforecasts and cash outlook.",
    pagePrefixes: ["/budgets"],
    keywords: ["budget", "variance", "forecast", "reforecast", "outlook", "cash forecast", "full-year", "full year", "ytd", "over budget", "under budget"],
    toolNames: [...COMMON, TOOL.bva, TOOL.kpis, TOOL.fs, TOOL.account, TOOL.ledger],
    defaultTemplates: ["BUDGET", "CASH"],
    system: "You are the Budget Forecast specialist. Focus on budget vs actual (month and YTD), the main favourable/adverse variances with causes traced to transactions, full-year implications and cash outlook. State whether each variance is favourable or adverse. Prefer the BUDGET or CASH template when proposing reports.",
    quick: [["Top variances", "What are the biggest budget variances this month and year-to-date, and what caused them?"], ["Full-year outlook", "Based on YTD actuals, where will we land against the full-year budget?"], ["Variance report", "Propose a budget variance commentary report for the latest month."]],
  },
  {
    id: "month-end-close", name: "Month-End Close", shortLabel: "Close", jobType: "agent.month_end_close", artifactKind: "CLOSE_SUMMARY",
    description: "Close checklist, overdue tasks, reconciliations and completeness.",
    pagePrefixes: ["/close", "/tasks", "/reconciliations", "/completeness", "/bank"],
    keywords: ["close", "month-end", "month end", "checklist", "reconciliation", "reconcile", "overdue", "sign-off", "sign off", "completeness", "accrual", "cut-off", "bank rec"],
    toolNames: [...COMMON, TOOL.tasks, TOOL.account, TOOL.ledger, TOOL.journal, TOOL.findings],
    defaultTemplates: ["MANAGEMENT"],
    system: "You are the Month-End Close specialist. Focus on getting the period closed: open and overdue close tasks, blockers, reconciliations, accruals and cut-off, and completeness of ledger data. Give a prioritised list with owners and dates, and propose tasks for concrete next steps.",
    quick: [["Close status", "Where are we on this month's close? List overdue and blocked tasks by owner."], ["Blockers", "What is blocking sign-off for the current period, and what should happen today?"], ["Accruals check", "Are there accruals or cut-off issues I should post before closing?"]],
  },
  {
    id: "journal-audit", name: "Journal Audit", shortLabel: "Audit", jobType: "agent.journal_audit", artifactKind: "AUDIT_PACK",
    description: "Journal findings, mispostings, auditor queries and evidence packs.",
    pagePrefixes: ["/journal-audit", "/audit", "/queries", "/ledger"],
    keywords: ["audit", "auditor", "finding", "journal", "misposting", "misposted", "self-approved", "self approved", "duplicate", "unbalanced", "evidence", "query", "queries", "isa", "benford", "back-dated"],
    toolNames: [...COMMON, TOOL.findings, TOOL.journal, TOOL.ledger, TOOL.account, TOOL.queries, TOOL.tasks],
    defaultTemplates: ["AUDIT"],
    system: "You are the Journal Audit specialist. Focus on journal-entry testing results, high-risk findings, mispostings and their corrections, external auditor queries and the evidence needed to answer them. Cite journal numbers, accounts and amounts. Prefer the AUDIT template when proposing reports.",
    quick: [["High-risk findings", "List the open high-severity journal findings and the corrective action for each."], ["Auditor queries", "Which auditor queries are open or overdue, and what evidence do we need?"], ["Audit pack", "Propose an audit & controls report for the latest period."]],
  },
  {
    id: "kra-tax", name: "KRA Tax", shortLabel: "Tax", jobType: "agent.kra_tax", artifactKind: "TAX_RECON",
    description: "VAT reconciliation vs iTax/eTIMS, filing deadlines and KRA compliance.",
    pagePrefixes: ["/tax"],
    keywords: ["kra", "vat", "etims", "itax", "tax", "paye", "wht", "withholding", "vat3", "filing", "penalty", "pin", "deductib"],
    toolNames: [...COMMON, TOOL.vat, TOOL.ledger, TOOL.account, TOOL.tasks],
    defaultTemplates: ["TAX"],
    system: "You are the KRA Tax specialist. Focus on Kenyan tax compliance: VAT reconciliation against iTax and eTIMS, exceptions and their fixes, input VAT deductibility, filing deadlines, and penalty exposure. Always note that rates and rules should be confirmed against current KRA guidance. Prefer the TAX template when proposing reports.",
    quick: [["VAT position", "What is our VAT position for the latest period and which exceptions need clearing?"], ["eTIMS risk", "Which purchase invoices are at risk of input VAT being disallowed for missing eTIMS?"], ["Tax report", "Propose a KRA tax compliance report for the latest month."]],
  },
];
const BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const DEFAULT_AGENT_ID = "cfo-reporting";
const ARTIFACT_KINDS = ["REPORT", "AUDIT_PACK", "TAX_RECON", "CLOSE_SUMMARY", "FORECAST", "OTHER"];
const COORDINATOR = { id: "auto", name: "Project Variaq", shortLabel: "Auto", description: "Routes each question to the right specialist." };

const getAgent = (id) => BY_ID[String(id || "")] || null;

/** Strip "/app/<slug>" so prefixes match module paths. */
function modulePath(path) {
  const p = String(path || "").split(/[?#]/)[0];
  const m = p.match(/^\/app\/[^/]+(\/.*)?$/);
  return m ? m[1] || "/" : p || "/";
}

function byPath(path) {
  const mp = modulePath(path);
  let best = null, len = 0;
  for (const a of AGENTS) for (const pre of a.pagePrefixes) {
    if ((mp === pre || mp.startsWith(pre + "/")) && pre.length > len) { best = a; len = pre.length; }
  }
  return best;
}

function byKeywords(message) {
  const t = ` ${String(message || "").toLowerCase()} `;
  let best = null, score = 0;
  for (const a of AGENTS) {
    let s = 0;
    for (const k of a.keywords) if (t.includes(k)) s += k.length > 4 ? 2 : 1;
    if (s > score) { best = a; score = s; }
  }
  return best;
}

/**
 * Pick the specialist. Explicit id wins (unless "auto"), then a strong keyword match in the message
 * when no page matches, then the page, then keywords, then CFO Reporting. Returns { ...agent, routedBy }.
 */
function resolveAgent({ agentId, path, message } = {}) {
  const explicit = agentId && agentId !== "auto" ? getAgent(agentId) : null;
  if (explicit) return { ...explicit, routedBy: "explicit" };
  const page = byPath(path);
  if (page) return { ...page, routedBy: "page" };
  const kw = byKeywords(message);
  if (kw) return { ...kw, routedBy: "keywords" };
  return { ...BY_ID[DEFAULT_AGENT_ID], routedBy: "default" };
}

/** Public, serialisable view for the UI / API (no prompts). */
function listAgents() {
  return AGENTS.map(({ id, name, shortLabel, description, pagePrefixes, defaultTemplates, jobType, artifactKind, quick }) => ({ id, name, shortLabel, description, pagePrefixes, defaultTemplates, jobType, artifactKind, quick }));
}

/** Filter a tool list to the agent's subset (falls back to all tools). */
function toolsFor(agent, tools) {
  if (!agent?.toolNames?.length) return tools;
  const allow = new Set(agent.toolNames);
  return tools.filter((t) => allow.has(t.name));
}

const JOB_TYPES = AGENTS.map((a) => a.jobType);
const agentForJobType = (type) => AGENTS.find((a) => a.jobType === type) || null;

module.exports = { AGENTS, COORDINATOR, DEFAULT_AGENT_ID, ARTIFACT_KINDS, JOB_TYPES, getAgent, resolveAgent, listAgents, toolsFor, modulePath, periodBounds, agentHref, agentForJobType };
