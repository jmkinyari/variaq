// Annual budget generation from the company's own ledger history. Pure functions.
//
// Sign convention for budgets: NATURAL sign, i.e. income accounts (revenue, other income) are
// stored as positive income and cost accounts (cost of sales, expenses) as positive cost. Use
// toNatural/fromNatural to convert from/to ledger sign (debit-positive).
//
// history: Map(code -> number[]) monthly NATURAL actuals, oldest first, ending the month before
// the budget year starts (up to 24 months; shorter histories are padded with zeros at the front).

const BUDGET_CLASSES = ["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME"];
const INCOME = new Set(["REVENUE", "OTHER_INCOME"]);
const toNatural = (cls, ledgerCents) => (INCOME.has(cls) ? -ledgerCents : ledgerCents);
const fromNatural = (cls, naturalCents) => (INCOME.has(cls) ? -naturalCents : naturalCents);
const PAYROLL_RE = /(salar|wage|payroll|staff cost|casual|nssf|shif|nhif|housing levy|paye|gratuity|bonus)/i;

const METHODS = {
  PRIOR_YEAR: "Prior year × growth",
  TREND: "Trend (linear regression, last 24 months)",
  SEASONAL: "Seasonal (growth, spread by historical seasonality)",
  DRIVER: "Driver-based (revenue growth, COGS %, inflation, payroll)",
  ZERO_BASED: "Zero-based (start from blank)",
};

function defaultAssumptions() {
  return {
    growth: { REVENUE: 10, COGS: 8, EXPENSE: 6, OTHER_INCOME: 0 }, // % vs last 12 months
    revGrowth: 10, cogsPct: null, inflation: 6, payrollPct: 8, payrollMonth: 0, oneOffs: [], // [{code, monthIdx, amount (cents, natural)}]
    rounding: 100000, // round generated cells to KES 1,000 (in cents)
  };
}
function normalizeAssumptions(a = {}) {
  const d = defaultAssumptions();
  const num = (v, dflt) => (Number.isFinite(+v) ? +v : dflt);
  return {
    ...a,
    growth: Object.fromEntries(BUDGET_CLASSES.map((c) => [c, num(a.growth?.[c], d.growth[c])])),
    revGrowth: num(a.revGrowth, d.revGrowth), cogsPct: a.cogsPct === null || a.cogsPct === undefined || a.cogsPct === "" ? null : num(a.cogsPct, null),
    inflation: num(a.inflation, d.inflation), payrollPct: num(a.payrollPct, d.payrollPct),
    payrollMonth: Math.min(11, Math.max(0, parseInt(a.payrollMonth ?? 0, 10) || 0)),
    oneOffs: Array.isArray(a.oneOffs) ? a.oneOffs.filter((o) => o && o.code && Number.isFinite(+o.amount)).map((o) => ({ code: String(o.code), monthIdx: Math.min(11, Math.max(0, +o.monthIdx || 0)), amount: Math.round(+o.amount), note: o.note || "" })) : [],
    rounding: num(a.rounding, d.rounding),
  };
}

const pad24 = (arr) => { const a = (arr || []).slice(-24); return [...new Array(24 - a.length).fill(0), ...a]; };
const last12 = (arr) => pad24(arr).slice(12);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const roundTo = (v, r) => (r > 1 ? Math.round(v / r) * r : Math.round(v));

/** Seasonality index per budget month position (12 numbers summing to 1) from up to 2 years of history. */
function seasonality(arr) {
  const h = pad24(arr);
  // Only (near-)complete years shape seasonality: a year with data in just some months (e.g. the
  // ledger starts in May) would otherwise push all the weight into those months.
  const years = [h.slice(0, 12), h.slice(12)].filter((y) => y.filter((v) => v !== 0).length >= 10);
  if (!years.length) return new Array(12).fill(1 / 12);
  const idx = new Array(12).fill(0);
  for (const y of years) { const t = sum(y); if (!t) continue; y.forEach((v, m) => { idx[m] += v / t; }); }
  const tot = sum(idx);
  // Guard against negative / degenerate shares (refunds etc.): fall back to flat.
  if (!tot || idx.some((x) => x < 0)) return new Array(12).fill(1 / 12);
  return idx.map((x) => x / tot);
}

/** Least-squares line over the last 24 points, projected 12 months ahead. */
function trend(arr) {
  const h = (arr || []).slice(-24);
  const n = h.length;
  if (n < 3) return new Array(12).fill(n ? Math.round(sum(h) / n) : 0);
  const xs = h.map((_, i) => i);
  const sx = sum(xs), sy = sum(h), sxx = sum(xs.map((x) => x * x)), sxy = sum(xs.map((x, i) => x * h[i]));
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), a = (sy - b * sx) / n;
  return Array.from({ length: 12 }, (_, j) => a + b * (n + j));
}

/** Spread an annual total over 12 months using an index (flat if none). */
function spread(total, index = null) {
  const idx = index || new Array(12).fill(1 / 12);
  const raw = idx.map((w) => total * w);
  // Put rounding residue in the last month so the row adds back to the total exactly.
  const out = raw.map((v) => Math.round(v));
  out[11] += Math.round(total) - sum(out);
  return out;
}

/**
 * Generate a budget. chart: Map(code -> {cls, name}). Returns Map(code -> number[12]) natural cents.
 */
function generateBudget({ chart, history, method, assumptions }) {
  const a = normalizeAssumptions(assumptions);
  const out = new Map();
  const accounts = [...chart.values()].filter((x) => BUDGET_CLASSES.includes(x.cls));
  const g = (cls) => 1 + (a.growth[cls] || 0) / 100;
  const r = (v) => roundTo(v, a.rounding);
  if (method === "ZERO_BASED") { for (const acct of accounts) out.set(acct.code, new Array(12).fill(0)); }
  else if (method === "PRIOR_YEAR") {
    for (const acct of accounts) out.set(acct.code, last12(history.get(acct.code)).map((v) => r(v * g(acct.cls))));
  } else if (method === "TREND") {
    for (const acct of accounts) {
      const t = trend(history.get(acct.code));
      // Revenue and costs don't go negative in a plan; keep sign for other income.
      out.set(acct.code, t.map((v) => r(acct.cls === "OTHER_INCOME" ? v : Math.max(0, v))));
    }
  } else if (method === "SEASONAL") {
    for (const acct of accounts) {
      const h = history.get(acct.code);
      out.set(acct.code, spread(sum(last12(h)) * g(acct.cls), seasonality(h)).map(r));
    }
  } else if (method === "DRIVER") {
    const revAccts = accounts.filter((x) => x.cls === "REVENUE");
    const cogsAccts = accounts.filter((x) => x.cls === "COGS");
    const revLast = sum(revAccts.map((x) => sum(last12(history.get(x.code)))));
    const cogsLast = sum(cogsAccts.map((x) => sum(last12(history.get(x.code)))));
    const cogsPct = a.cogsPct !== null ? a.cogsPct / 100 : revLast ? cogsLast / revLast : 0;
    const revByMonth = new Array(12).fill(0);
    for (const acct of revAccts) {
      const h = history.get(acct.code);
      const row = spread(sum(last12(h)) * (1 + a.revGrowth / 100), seasonality(h));
      row.forEach((v, m) => { revByMonth[m] += v; });
      out.set(acct.code, row.map(r));
    }
    for (const acct of cogsAccts) {
      const share = cogsLast ? sum(last12(history.get(acct.code))) / cogsLast : 1 / Math.max(1, cogsAccts.length);
      out.set(acct.code, revByMonth.map((v) => r(v * cogsPct * share)));
    }
    for (const acct of accounts.filter((x) => x.cls === "EXPENSE" || x.cls === "OTHER_INCOME")) {
      const h = last12(history.get(acct.code));
      const base = sum(h) / 12;
      const isPayroll = PAYROLL_RE.test(acct.name || "");
      out.set(acct.code, Array.from({ length: 12 }, (_, m) => {
        if (acct.cls === "OTHER_INCOME") return r(h[m]);
        if (isPayroll) return r(base * (m >= a.payrollMonth ? 1 + a.payrollPct / 100 : 1));
        return r(base * (1 + a.inflation / 100));
      }));
    }
  } else throw new Error(`Unknown budget method ${method}`);
  for (const o of a.oneOffs) {
    if (!out.has(o.code)) out.set(o.code, new Array(12).fill(0));
    out.get(o.code)[o.monthIdx] += o.amount;
  }
  return out;
}

/** Budget-year month labels from FY start "YYYY-MM". */
function fyMonths(fyStart) {
  const [y, m] = fyStart.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7));
}

/** Totals by class for a budget map: { REVENUE: [12], ..., netProfit: [12] } */
function classTotals(lines, chart) {
  const t = Object.fromEntries(BUDGET_CLASSES.map((c) => [c, new Array(12).fill(0)]));
  for (const [code, row] of lines) { const cls = chart.get(code)?.cls; if (t[cls]) row.forEach((v, m) => { t[cls][m] += v; }); }
  t.grossProfit = t.REVENUE.map((v, m) => v - t.COGS[m]);
  t.netProfit = t.grossProfit.map((v, m) => v - t.EXPENSE[m] + t.OTHER_INCOME[m]);
  return t;
}

/** Apply a % change to a row (or every row in a class) — used by the grid's bulk tools. */
function applyPct(row, pctChange) { return row.map((v) => Math.round(v * (1 + pctChange / 100))); }

const METHOD_LABELS = { ...METHODS, UPLOAD: "Uploaded from a file" };

module.exports = { METHOD_LABELS, METHODS, BUDGET_CLASSES, INCOME, toNatural, fromNatural, defaultAssumptions, normalizeAssumptions, seasonality, trend, spread, generateBudget, fyMonths, classTotals, applyPct, PAYROLL_RE };
