// Client-safe helpers for deep links into the AI workspace with a specialist + context preselected.
// No prompts or server code here, so module pages and client components can import it freely.
const YM = /^\d{4}-\d{2}$/, ISO = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_IDS = ["cfo-reporting", "budget-forecast", "month-end-close", "journal-audit", "kra-tax"];
const AGENT_NAMES = { "cfo-reporting": "CFO Reporting", "budget-forecast": "Budget Forecast", "month-end-close": "Month-End Close", "journal-audit": "Journal Audit", "kra-tax": "KRA Tax" };

/** "2026-04" → ["2026-04-01", "2026-04-30"]; an ISO date passes through as [d, d]. */
function periodBounds(period) {
  const p = String(period || "");
  if (ISO.test(p)) return [p, p];
  if (!YM.test(p)) return [null, null];
  const [y, m] = p.split("-").map(Number);
  return [`${p}-01`, `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`];
}

/** `/app/<slug>/ai?agent=kra-tax&period=2026-04&entity=…&q=…` */
function agentHref(slug, agentId, { period, entity, q } = {}) {
  const sp = new URLSearchParams();
  if (agentId && AGENT_IDS.includes(agentId)) sp.set("agent", agentId);
  if (period && (YM.test(period) || ISO.test(period))) sp.set("period", period);
  if (entity) sp.set("entity", String(entity).slice(0, 80));
  if (q) sp.set("q", String(q).slice(0, 400));
  const s = sp.toString();
  return `/app/${slug}/ai${s ? `?${s}` : ""}`;
}

module.exports = { AGENT_IDS, AGENT_NAMES, periodBounds, agentHref };
