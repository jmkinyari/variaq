// Project Variaq specialist registry: routing (explicit id, page, keywords, default), tool subsets, deep links.
const test = require("node:test");
const assert = require("node:assert");
const { AGENTS, JOB_TYPES, resolveAgent, listAgents, toolsFor, getAgent, modulePath, agentForJobType, ARTIFACT_KINDS } = require("../lib/ai/agents");
const { agentHref, periodBounds, AGENT_IDS } = require("../lib/ai/deep-links");

const route = (o) => resolveAgent(o).id;

test("five specialists with unique ids and agent.* job types", () => {
  assert.deepStrictEqual(AGENTS.map((a) => a.id).sort(), ["budget-forecast", "cfo-reporting", "journal-audit", "kra-tax", "month-end-close"]);
  assert.deepStrictEqual([...AGENT_IDS].sort(), AGENTS.map((a) => a.id).sort());
  assert.strictEqual(new Set(JOB_TYPES).size, 5);
  for (const t of JOB_TYPES) assert.match(t, /^agent\./);
  assert.strictEqual(agentForJobType("agent.kra_tax").id, "kra-tax");
  for (const a of AGENTS) assert.ok(ARTIFACT_KINDS.includes(a.artifactKind));
});

test("explicit agent id wins over page and keywords", () => {
  assert.strictEqual(route({ agentId: "kra-tax", path: "/app/acme/close", message: "budget variance" }), "kra-tax");
  assert.strictEqual(resolveAgent({ agentId: "journal-audit" }).routedBy, "explicit");
});

test("unknown or 'auto' agent id falls through to routing", () => {
  assert.strictEqual(route({ agentId: "auto", path: "/app/acme/budgets/123" }), "budget-forecast");
  assert.strictEqual(route({ agentId: "nope", path: "/app/acme/tax" }), "kra-tax");
});

test("page prefixes route to the module's specialist", () => {
  const cases = {
    "/app/acme/tax": "kra-tax", "/app/acme/tax/vat?period=2026-04": "kra-tax", "/app/acme/tax/etims": "kra-tax",
    "/app/acme/close": "month-end-close", "/app/acme/journal-audit/abc": "journal-audit", "/app/acme/audit": "journal-audit",
    "/app/acme/queries/q1": "journal-audit", "/app/acme/budgets": "budget-forecast", "/app/acme/board-packs/p1": "cfo-reporting",
    "/app/acme/dashboard": "cfo-reporting", "/app/acme/statements": "cfo-reporting", "/app/acme/reports": "cfo-reporting",
  };
  for (const [path, id] of Object.entries(cases)) {
    const r = resolveAgent({ path, message: "explain this page" });
    assert.strictEqual(r.id, id, path);
    assert.strictEqual(r.routedBy, "page", path);
  }
});

test("prefixes match whole segments only", () => {
  assert.strictEqual(modulePath("/app/acme/taxonomy"), "/taxonomy");
  assert.notStrictEqual(resolveAgent({ path: "/app/acme/taxonomy" }).routedBy, "page");
  assert.notStrictEqual(resolveAgent({ path: "/app/acme/closet" }).routedBy, "page");
});

test("keywords route when the page doesn't decide", () => {
  assert.strictEqual(route({ path: "/app/acme", message: "What's our VAT position vs eTIMS for March?" }), "kra-tax");
  assert.strictEqual(route({ path: "/app/acme/ai", message: "Which journals were self-approved or duplicated?" }), "journal-audit");
  assert.strictEqual(route({ message: "Show the biggest budget variances year to date" }), "budget-forecast");
  assert.strictEqual(route({ message: "Which month-end close tasks are overdue?" }), "month-end-close");
  assert.strictEqual(route({ message: "Prepare the board pack KPIs" }), "cfo-reporting");
  assert.strictEqual(resolveAgent({ message: "kra filing" }).routedBy, "keywords");
});

test("no signal falls back to CFO Reporting", () => {
  const r = resolveAgent({ message: "hello there" });
  assert.strictEqual(r.id, "cfo-reporting");
  assert.strictEqual(r.routedBy, "default");
  assert.strictEqual(resolveAgent().id, "cfo-reporting");
});

test("tool subsets reference real tool names and always allow proposals", () => {
  const all = ["get_company_overview", "get_kpis", "get_financial_statements", "search_ledger", "get_account_activity", "get_journal", "list_audit_findings", "list_tasks", "get_budget_vs_actual", "get_vat_status", "list_auditor_queries", "list_team", "propose_task", "propose_report"];
  const tools = all.map((name) => ({ name }));
  for (const a of AGENTS) {
    for (const n of a.toolNames) assert.ok(all.includes(n), `${a.id}: ${n}`);
    const t = toolsFor(a, tools).map((x) => x.name);
    assert.ok(t.includes("propose_task") && t.includes("propose_report"), a.id);
  }
  assert.ok(toolsFor(getAgent("kra-tax"), tools).some((t) => t.name === "get_vat_status"));
  assert.ok(!toolsFor(getAgent("kra-tax"), tools).some((t) => t.name === "list_audit_findings"));
  assert.strictEqual(toolsFor(null, tools).length, tools.length);
});

test("listAgents is serialisable and hides prompts", () => {
  const l = listAgents();
  assert.strictEqual(l.length, 5);
  for (const a of l) { assert.ok(!("system" in a) && !("toolNames" in a)); assert.ok(a.quick.length > 0); }
  JSON.stringify(l);
});

test("deep links carry agent, period and entity", () => {
  assert.strictEqual(agentHref("acme", "kra-tax", { period: "2026-04" }), "/app/acme/ai?agent=kra-tax&period=2026-04");
  assert.strictEqual(agentHref("acme", "month-end-close", { period: "bad", entity: "Nairobi branch" }), "/app/acme/ai?agent=month-end-close&entity=Nairobi+branch");
  assert.strictEqual(agentHref("acme", "evil"), "/app/acme/ai");
  assert.deepStrictEqual(periodBounds("2026-02"), ["2026-02-01", "2026-02-28"]);
  assert.deepStrictEqual(periodBounds("2024-02"), ["2024-02-01", "2024-02-29"]);
  assert.deepStrictEqual(periodBounds("2026-04-15"), ["2026-04-15", "2026-04-15"]);
  assert.deepStrictEqual(periodBounds("x"), [null, null]);
});
