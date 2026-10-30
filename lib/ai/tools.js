// Tools the AI assistant can call. Every data tool is READ-ONLY and scoped to the caller's
// workspace (the workspace id comes from the server session, never from the model). The only
// tools that "do" anything create PROPOSALS in ai_actions, which a person must approve in the UI.
import "server-only";
import db from "../db";
import { loadChart, balancesAt, movements, ledgerRange } from "../statements-data";
import { balanceSheet, incomeStatement, CLASSES } from "../statements";
import { loadKpiInputs, monthlyMovements, loadBudget } from "../budget/data";
import { buildSeries, computeKpis } from "../kpi";
import { toNatural, fyMonths } from "../budget/engine";
import { loadAlerts } from "../boardpack/alerts";
import { latestRun, runResults, dataStatus } from "../tax/data";

const kes = (c) => (c === null || c === undefined ? null : Math.round(c) / 100);
const ISO = /^\d{4}-\d{2}-\d{2}$/, YM = /^\d{4}-\d{2}$/;
const str = (v, max = 200) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));
const lim = (v, d, max) => Math.max(1, Math.min(max, parseInt(v, 10) || d));
const lastDay = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const date = (d) => ({ type: "string", description: `${d} (YYYY-MM-DD)` });

export const TOOLS = [
  { name: "get_company_overview", description: "Company profile, ledger date range, and current alerts across modules (overdue close tasks, open high-risk audit findings, tax exceptions, cash warnings). Call this first when the question is broad ('what needs attention?').", input_schema: S({}) },
  { name: "get_kpis", description: "CFO KPIs for a month (revenue, gross margin, EBITDA, net margin, cash, runway, liquidity ratios, DSO/DPO/DIO, growth) with prior-period values, status and definitions. Defaults to the latest month with data.", input_schema: S({ month: { type: "string", description: "Month YYYY-MM (optional)" } }) },
  { name: "get_financial_statements", description: "Income statement for a period and balance sheet at its end date, by account, built from the general ledger.", input_schema: S({ from: date("Period start"), to: date("Period end") }, ["from", "to"]) },
  { name: "search_ledger", description: "Search general-ledger lines. Use to find specific transactions, journals, counterparties or amounts. Amounts are signed: positive = debit, negative = credit, in the company currency.", input_schema: S({ account_code: { type: "string" }, from: date("From"), to: date("To"), text: { type: "string", description: "Words in the description or reference" }, counterparty: { type: "string" }, journal_no: { type: "string" }, min_abs_amount: { type: "number", description: "Only lines at least this large (absolute, currency units)" }, limit: { type: "integer", description: "Max lines (default 50, max 100)" } }) },
  { name: "get_account_activity", description: "One account's opening balance, debits, credits, closing balance, monthly movement and top counterparties for a period.", input_schema: S({ account_code: { type: "string" }, from: date("From"), to: date("To") }, ["account_code", "from", "to"]) },
  { name: "get_journal", description: "All lines of one journal with posting/approval details and balance check, plus any audit findings on it.", input_schema: S({ journal_no: { type: "string" } }, ["journal_no"]) },
  { name: "list_audit_findings", description: "Journal-audit findings (unbalanced, self-approved, duplicates, mispostings, cut-off, etc.) with suggested corrective actions.", input_schema: S({ status: { type: "string", enum: ["OPEN", "CORRECTED", "ACCEPTED_RISK", "FALSE_POSITIVE", "CLEARED", "ANY"] }, severity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "ANY"] }, limit: { type: "integer" } }) },
  { name: "list_tasks", description: "Month-end close and team tasks with owner, reviewer, due date, status and priority.", input_schema: S({ status: { type: "string", enum: ["OPEN", "DONE", "ANY"] }, period: { type: "string", description: "YYYY-MM (optional)" }, overdue_only: { type: "boolean" } }) },
  { name: "get_budget_vs_actual", description: "Budget vs actual by account for a month and year-to-date, using the approved budget covering that month (or the latest budget).", input_schema: S({ month: { type: "string", description: "YYYY-MM (optional, defaults to latest ledger month)" } }) },
  { name: "get_vat_status", description: "KRA VAT reconciliation status for a period: data uploaded, match rates, exceptions by type, VAT3 amounts due.", input_schema: S({ period: { type: "string", description: "YYYY-MM" } }, ["period"]) },
  { name: "list_auditor_queries", description: "External auditor queries: reference, title, status, assignee, due date.", input_schema: S({ status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESPONDED", "CLOSED", "ANY"] } }) },
  { name: "list_team", description: "People in this company workspace (name, email, role) — use before proposing a task for someone.", input_schema: S({}) },
  { name: "propose_task", description: "PROPOSE a follow-up task (e.g. post a correcting journal, chase a supplier for an eTIMS invoice, explain a variance). It is NOT created until a person approves it in the chat. Use for concrete, actionable next steps only.", input_schema: S({ title: { type: "string" }, description: { type: "string" }, assignee_email: { type: "string" }, due_date: date("Due date"), priority: { type: "string", enum: ["HIGH", "NORMAL", "LOW"] } }, ["title", "description"]) },
  { name: "propose_report", description: "PROPOSE generating a saved HTML report (management report, board summary, audit summary, tax compliance, cash outlook, budget variance, or custom). Generated only when a person approves.", input_schema: S({ title: { type: "string" }, template: { type: "string", enum: ["MANAGEMENT", "BOARD", "AUDIT", "TAX", "CASH", "BUDGET", "CUSTOM"] }, period_from: date("Start"), period_to: date("End"), instructions: { type: "string" } }, ["title", "template"]) },
];
/** Tools allowed when generating a report (data only; no proposals). */
export const REPORT_TOOLS = TOOLS.filter((t) => !t.name.startsWith("propose_"));

const MAX_RESULT = 40_000;
const out = (o) => { const s = JSON.stringify(o); return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + '…"(truncated)"' : s; };

/** Execute a tool for a workspace. Returns a JSON string (or throws → is_error result). */
export async function runTool(name, input, ctx) {
  const { ws, user, conversationId } = ctx;
  const i = input && typeof input === "object" ? input : {};
  switch (name) {
    case "get_company_overview": {
      const [range, alerts, counts] = await Promise.all([
        ledgerRange(ws.id), loadAlerts(ws.id),
        db.get(`SELECT (SELECT COUNT(*) FROM audit_findings WHERE workspace_id = ?1 AND status = 'OPEN') findings,
          (SELECT COUNT(*) FROM close_tasks WHERE workspace_id = ?1 AND status <> 'DONE') tasks,
          (SELECT COUNT(*) FROM auditor_queries WHERE workspace_id = ?1 AND status IN ('OPEN','IN_PROGRESS')) queries,
          (SELECT COUNT(*) FROM memberships WHERE workspace_id = ?1) members`, [ws.id]),
      ]);
      return out({ company: ws.name, country: "Kenya", currency: ws.currency, industry: ws.industry, ledger: { from: range?.mn, to: range?.mx, lines: range?.n }, open: counts, alerts: (alerts || []).slice(0, 15) });
    }
    case "get_kpis": {
      const inputs = await loadKpiInputs(ws.id, YM.test(i.month || "") ? i.month : null, 24);
      if (!inputs) return out({ message: "No ledger data yet." });
      const series = buildSeries(inputs);
      const k = computeKpis(series, inputs.months, { aging: inputs.aging });
      return out({ month: inputs.end, currency: ws.currency, note: "money values in cents ÷ 100 are currency units", kpis: k.map((x) => ({ key: x.key, label: x.label, value: x.unit === "money" ? kes(x.value) : x.value, prior: x.unit === "money" ? kes(x.prior) : x.prior, unit: x.unit, status: x.status, definition: x.definition })) });
    }
    case "get_financial_statements": {
      if (!ISO.test(i.from) || !ISO.test(i.to)) throw new Error("from and to must be YYYY-MM-DD dates.");
      const [{ chart }, mv, bal] = await Promise.all([loadChart(ws.id), movements(ws.id, i.from, i.to), balancesAt(ws.id, i.to)]);
      const is = incomeStatement(chart, mv), bs = balanceSheet(chart, bal);
      const L = (ls) => ls.map((l) => ({ code: l.code, name: l.name, amount: kes(l.amount) }));
      return out({ currency: ws.currency, period: [i.from, i.to],
        incomeStatement: { revenue: L(is.revenue.lines), totalRevenue: kes(is.revenue.total), costOfSales: L(is.cogs.lines), grossProfit: kes(is.grossProfit), grossMarginPct: is.grossMargin, operatingExpenses: L(is.opex.lines), operatingProfit: kes(is.operatingProfit), otherIncomeExpense: L(is.other.lines), netProfit: kes(is.netProfit), netMarginPct: is.netMargin },
        balanceSheet: { asAt: i.to, sections: bs.sections.map((s) => ({ title: s.title, total: kes(s.total), lines: L(s.lines) })), totalAssets: kes(bs.totalAssets), totalLiabilities: kes(bs.totalLiabilities), totalEquity: kes(bs.totalEquity), outOfBalanceBy: kes(bs.difference) } });
    }
    case "search_ledger": {
      const where = ["workspace_id = ?"], args = [ws.id];
      if (i.account_code) { where.push("account_code = ?"); args.push(str(i.account_code, 40)); }
      if (ISO.test(i.from || "")) { where.push("date >= ?"); args.push(i.from); }
      if (ISO.test(i.to || "")) { where.push("date <= ?"); args.push(i.to); }
      if (i.journal_no) { where.push("journal_no = ?"); args.push(str(i.journal_no, 60)); }
      if (i.text) { where.push("(description LIKE ? OR reference LIKE ?)"); const q = `%${str(i.text, 80)}%`; args.push(q, q); }
      if (i.counterparty) { where.push("counterparty LIKE ?"); args.push(`%${str(i.counterparty, 80)}%`); }
      if (Number.isFinite(+i.min_abs_amount) && +i.min_abs_amount > 0) { where.push("ABS(amount_cents) >= ?"); args.push(Math.round(+i.min_abs_amount * 100)); }
      const rows = await db.all(`SELECT date, journal_no, line_no, account_code, account_name, description, reference, counterparty, amount_cents, posted_by, approved_by, entry_type FROM ledger_entries WHERE ${where.join(" AND ")} ORDER BY date DESC, journal_no LIMIT ${lim(i.limit, 50, 100)}`, args);
      return out({ currency: ws.currency, count: rows.length, lines: rows.map((r) => ({ ...r, amount: kes(r.amount_cents), amount_cents: undefined })) });
    }
    case "get_account_activity": {
      if (!ISO.test(i.from) || !ISO.test(i.to)) throw new Error("from and to must be YYYY-MM-DD dates.");
      const code = str(i.account_code, 40);
      const [open, mv, monthly, cps, name] = await Promise.all([
        db.get("SELECT COALESCE(SUM(amount_cents),0) b FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date < ?", [ws.id, code, i.from]),
        db.get("SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END),0) dr, COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END),0) cr, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ?", [ws.id, code, i.from, i.to]),
        db.all("SELECT substr(date,1,7) ym, SUM(amount_cents) net, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ? GROUP BY ym ORDER BY ym", [ws.id, code, i.from, i.to]),
        db.all("SELECT COALESCE(counterparty,'(none)') cp, SUM(amount_cents) net, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ? GROUP BY cp ORDER BY ABS(SUM(amount_cents)) DESC LIMIT 10", [ws.id, code, i.from, i.to]),
        db.get("SELECT MAX(account_name) n FROM ledger_entries WHERE workspace_id = ? AND account_code = ?", [ws.id, code]),
      ]);
      if (!name?.n && !mv.n && !open.b) return out({ message: `No account ${code} in the ledger.` });
      return out({ account: code, name: name?.n, currency: ws.currency, opening: kes(open.b), debits: kes(mv.dr), credits: kes(mv.cr), closing: kes(open.b + mv.dr + mv.cr), lines: mv.n, monthly: monthly.map((m) => ({ month: m.ym, net: kes(m.net), lines: m.n })), topCounterparties: cps.map((c) => ({ counterparty: c.cp, net: kes(c.net), lines: c.n })) });
    }
    case "get_journal": {
      const no = str(i.journal_no, 60);
      const [lines, findings] = await Promise.all([
        db.all("SELECT date, line_no, account_code, account_name, description, reference, counterparty, amount_cents, posted_by, approved_by, posted_at, entry_type, source FROM ledger_entries WHERE workspace_id = ? AND journal_no = ? ORDER BY line_no", [ws.id, no]),
        db.all("SELECT rule, severity, title, status, suggestion FROM audit_findings WHERE workspace_id = ? AND journal_no = ?", [ws.id, no]),
      ]);
      if (!lines.length) return out({ message: `Journal ${no} not found.` });
      const sum = lines.reduce((a, l) => a + l.amount_cents, 0);
      return out({ journal_no: no, balanced: sum === 0, difference: kes(sum), lines: lines.map((l) => ({ ...l, amount: kes(l.amount_cents), amount_cents: undefined })), findings });
    }
    case "list_audit_findings": {
      const where = ["workspace_id = ?"], args = [ws.id];
      const st = i.status || "OPEN"; if (st !== "ANY") { where.push("status = ?"); args.push(st); }
      if (i.severity && i.severity !== "ANY") { where.push("severity = ?"); args.push(i.severity); }
      const rows = await db.all(`SELECT id, rule, severity, title, journal_no, account_code, amount_cents, entry_date, suggestion, status FROM audit_findings WHERE ${where.join(" AND ")} ORDER BY CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, ABS(COALESCE(amount_cents,0)) DESC LIMIT ${lim(i.limit, 25, 60)}`, args);
      const totals = await db.all("SELECT severity, COUNT(*) n FROM audit_findings WHERE workspace_id = ? AND status = 'OPEN' GROUP BY severity", [ws.id]);
      return out({ openBySeverity: totals, findings: rows.map((r) => ({ ...r, amount: kes(r.amount_cents), amount_cents: undefined })) });
    }
    case "list_tasks": {
      const where = ["t.workspace_id = ?"], args = [ws.id];
      if (i.status === "OPEN" || !i.status) where.push("t.status <> 'DONE'"); else if (i.status === "DONE") where.push("t.status = 'DONE'");
      if (YM.test(i.period || "")) { where.push("t.period = ?"); args.push(i.period); }
      if (i.overdue_only) { where.push("t.due_date < ? AND t.status <> 'DONE'"); args.push(new Date().toISOString().slice(0, 10)); }
      const rows = await db.all(`SELECT t.period, t.title, t.category, t.status, t.priority, t.due_date, a.name owner, r.name reviewer FROM close_tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users r ON r.id = t.reviewer_id WHERE ${where.join(" AND ")} ORDER BY t.period DESC, t.due_date LIMIT 80`, args);
      return out({ count: rows.length, tasks: rows });
    }
    case "get_budget_vs_actual": {
      const range = await ledgerRange(ws.id);
      const ym = YM.test(i.month || "") ? i.month : range?.mx?.slice(0, 7);
      if (!ym) return out({ message: "No ledger data yet." });
      const b = await db.get("SELECT id, name, fy_start, status FROM budgets WHERE workspace_id = ? AND fy_start <= ? ORDER BY CASE status WHEN 'APPROVED' THEN 0 WHEN 'LOCKED' THEN 0 ELSE 1 END, fy_start DESC, updated_at DESC LIMIT 1", [ws.id, ym]);
      if (!b) return out({ message: "No budget covers this month yet. Create one under Budgets & variance." });
      const loaded = await loadBudget(ws.id, b.id);
      const months = fyMonths(b.fy_start);
      const idx = months.indexOf(ym);
      if (idx < 0) return out({ message: `Budget "${b.name}" doesn't cover ${ym}.` });
      const [{ chart }, mv] = await Promise.all([loadChart(ws.id), monthlyMovements(ws.id, months[0], ym)]);
      const rows = [];
      for (const [code, line] of loaded.lines) {
        const cls = chart.get(code)?.cls;
        if (!cls) continue;
        const act = (m) => toNatural(cls, mv.get(code)?.get(m) || 0);
        const mA = act(ym), ytdA = months.slice(0, idx + 1).reduce((a, m) => a + act(m), 0);
        const ytdB = line.slice(0, idx + 1).reduce((a, v) => a + v, 0);
        rows.push({ code, name: chart.get(code)?.name, class: CLASSES[cls], monthBudget: kes(line[idx]), monthActual: kes(mA), monthVariance: kes(mA - line[idx]), ytdBudget: kes(ytdB), ytdActual: kes(ytdA), ytdVariance: kes(ytdA - ytdB) });
      }
      rows.sort((a, c) => Math.abs(c.ytdVariance) - Math.abs(a.ytdVariance));
      return out({ budget: b.name, status: b.status, month: ym, note: "Natural sign: income and costs both positive. For income, actual above budget is favourable; for costs, below budget is favourable.", accounts: rows.slice(0, 40) });
    }
    case "get_vat_status": {
      if (!YM.test(i.period || "")) throw new Error("period must be YYYY-MM.");
      const [status, run] = await Promise.all([dataStatus(ws.id, i.period), latestRun(ws.id, i.period)]);
      const res = run ? await runResults(ws.id, run.id) : null;
      return out({ period: i.period, dataUploaded: status, lastRun: run ? { at: run.created_at, stats: safeJson(run.stats) } : null, results: res ? summariseVat(res) : "No reconciliation run yet for this period." });
    }
    case "list_auditor_queries": {
      const where = ["q.workspace_id = ?"], args = [ws.id];
      if (i.status && i.status !== "ANY") { where.push("q.status = ?"); args.push(i.status); }
      const rows = await db.all(`SELECT q.ref, q.title, q.status, q.priority, q.due_date, q.account_code, q.journal_no, u.name assignee, q.created_at FROM auditor_queries q LEFT JOIN users u ON u.id = q.assignee_id WHERE ${where.join(" AND ")} ORDER BY q.created_at DESC LIMIT 40`, args);
      return out({ queries: rows });
    }
    case "list_team": {
      const rows = await db.all("SELECT u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name", [ws.id]);
      return out({ members: rows });
    }
    case "propose_task": {
      const title = str(i.title, 200);
      if (!title) throw new Error("A task needs a title.");
      let assignee = null;
      if (i.assignee_email) assignee = await db.get("SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND lower(u.email) = lower(?)", [ws.id, str(i.assignee_email, 200)]);
      const payload = { title, description: str(i.description, 2000), assigneeId: assignee?.id || null, assigneeName: assignee?.name || null, dueDate: ISO.test(i.due_date || "") ? i.due_date : null, priority: ["HIGH", "NORMAL", "LOW"].includes(i.priority) ? i.priority : "NORMAL" };
      const id = await saveProposal(ws.id, conversationId, "CREATE_TASK", payload, user.id);
      return out({ proposalId: id, status: "PROPOSED — shown to the user for approval; not created yet.", ...(i.assignee_email && !assignee ? { warning: `${i.assignee_email} isn't a member of this workspace, so the task will be unassigned.` } : {}) });
    }
    case "propose_report": {
      const payload = { title: str(i.title, 150) || "AI report", template: ["MANAGEMENT", "BOARD", "AUDIT", "TAX", "CASH", "BUDGET", "CUSTOM"].includes(i.template) ? i.template : "CUSTOM", periodFrom: ISO.test(i.period_from || "") ? i.period_from : null, periodTo: ISO.test(i.period_to || "") ? i.period_to : null, instructions: str(i.instructions, 2000) };
      const id = await saveProposal(ws.id, conversationId, "GENERATE_REPORT", payload, user.id);
      return out({ proposalId: id, status: "PROPOSED — shown to the user for approval; not generated yet." });
    }
    default:
      throw new Error(`Unknown tool ${name}.`);
  }
}

async function saveProposal(wsId, conversationId, type, payload, userId) {
  const id = db.id();
  await db.run("INSERT INTO ai_actions (id, workspace_id, conversation_id, type, payload, status, proposed_for, created_at) VALUES (?,?,?,?,?,?,?,?)", [id, wsId, conversationId || null, type, JSON.stringify(payload), "PROPOSED", userId, db.now()]);
  return id;
}
function safeJson(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }
function summariseVat(res) {
  // Counts per side/status plus the largest exceptions — the full item list is too long to pass on.
  const all = res?.all || [];
  const counts = {};
  for (const it of all) { const k = `${it.side || it.kind || "?"}:${it.status}`; counts[k] = (counts[k] || 0) + 1; }
  const exceptions = all.filter((it) => it.status && it.status !== "MATCHED")
    .sort((a, b) => Math.abs(b.diff_cents ?? b.diffCents ?? 0) - Math.abs(a.diff_cents ?? a.diffCents ?? 0)).slice(0, 15)
    .map((it) => ({ side: it.side || it.kind, status: it.status, counterparty: it.counterparty, pin: it.pin, invoice: it.invoice_no ?? it.invoiceNo, vatDifference: kes(it.diff_cents ?? it.diffCents), action: it.action }));
  return { countsBySideAndStatus: counts, largestExceptions: exceptions };
}
export { lastDay };
