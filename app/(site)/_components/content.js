// Shared marketing copy for the public site. Kept in one place so nav, home, product pages and
// pricing stay consistent. Only describe what the codebase actually does (see README + docs/).

export const MODULES = [
  {
    slug: "close", href: "/product/close", eyebrow: "Month-end close", title: "Close & reconciliations",
    blurb: "Bank and M-Pesa matching with reasons, an exception queue, and a close checklist with owners, reviewers and period locks.",
  },
  {
    slug: "tax", href: "/product/tax", eyebrow: "KRA tax", title: "VAT & KRA compliance",
    blurb: "Reconcile ERP registers against KRA's auto-populated VAT return, prepare VAT3 sheet O, check eTIMS deductibility and track filing dates.",
  },
  {
    slug: "audit", href: "/product/audit", eyebrow: "Journal audit", title: "Journal audit & auditor queries",
    blurb: "21 automated journal-entry tests, completeness checks, correcting journals and evidence packs for your external auditors.",
  },
  {
    slug: "reporting", href: "/product/reporting", eyebrow: "CFO reporting", title: "KPIs, budgets & board packs",
    blurb: "Live KPIs, budget vs actual with suggested causes, 13-week and 12-month cash forecasts, and approvable board packs.",
  },
  {
    slug: "ai", href: "/product/ai", eyebrow: "Variaq AI", title: "Specialist AI agents",
    blurb: "Five finance specialists that read your workspace through read-only tools, draft reports in the background and never approve anything themselves.",
  },
];

export const AGENTS = [
  ["CFO Reporting", "KPIs, management accounts, board packs and statement commentary."],
  ["Budget Forecast", "Budget vs actual, reforecasts and cash outlook narratives."],
  ["Month-End Close", "Checklist status, blockers and close summaries — works without an AI key."],
  ["Journal Audit", "Open findings, auditor queries and audit-pack drafts."],
  ["KRA Tax", "VAT reconciliation status, eTIMS gaps and tax-period summaries."],
];

// Single price plan — the only plan Variaq sells. Edit amounts here; home, pricing, FAQ and
// contact pages all read from this object.
export const PLAN = {
  id: "variaq", name: "Variaq", currency: "USD",
  basePrice: 40, includedUsers: 5, extraUserPrice: 5,
  price: "$40", per: "per month, per company workspace — includes 5 users",
  extra: "Additional users: $5 per user per month",
  tagline: "One plan with every module. Pay for the users you add, nothing else.",
  items: [
    "1 company workspace (each additional company is another $40/month)",
    "5 users included; read-only viewers & board members free",
    "Data hub (CSV/Excel), ledger & financial statements",
    "Bank & M-Pesa reconciliation, exception queue",
    "Month-end close checklist, tasks & period locks",
    "Tax centre, VAT reconciliation vs KRA, eTIMS checks, filing calendar",
    "Journal audit (21 tests), completeness tests, auditor queries & evidence packs",
    "KPI dashboard, budgets, forecasts & board packs",
    "Chart mapping, ERP connectors & REST API",
  ],
  ai: "Five AI specialists (CFO Reporting, Budget Forecast, Month-End Close, Journal Audit, KRA Tax) with a fair-use monthly allowance. AI is optional and can be switched off.",
  sla: "Email support, business hours; self-serve onboarding guides",
  taxNote: "Prices in US dollars. Local taxes (e.g. 16% Kenyan VAT) may apply.",
  cta: ["Get started", "/signup"],
  cta2: ["Contact us", "/contact?topic=sales&plan=variaq"],
};

/** Monthly price in USD for a workspace with `users` paid users. */
export function monthlyPrice(users = PLAN.includedUsers) {
  const extra = Math.max(0, Math.ceil(Number(users) || 0) - PLAN.includedUsers);
  return PLAN.basePrice + extra * PLAN.extraUserPrice;
}
