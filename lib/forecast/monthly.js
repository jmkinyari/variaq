// 12-month rolling cash flow forecast with Base / Best / Worst scenarios. Pure; runs in the browser
// for instant recalculation. Driven by the approved budget when one covers the month (receipts from
// budgeted revenue × historical collection rate, payments from budgeted costs), otherwise by the
// trailing 3-month run-rate of each cash-flow line. Amounts in cents, cash-flow sign (in +, out −).
const { CF_CATEGORIES, CF_ORDER } = require("../statements");

const SC = ["BASE", "BEST", "WORST"];
const isIn = (k) => CF_CATEGORIES[k].group === "IN";
const isOut = (k) => CF_CATEGORIES[k].group === "OUT";

function defaultMonthlyScenario(kind) {
  return {
    adjIn: kind === "BEST" ? 5 : kind === "WORST" ? -15 : 0,     // % on receipts
    adjOut: kind === "BEST" ? -3 : kind === "WORST" ? 8 : 0,     // % on payments (+ = pay more)
    growth: kind === "BEST" ? 1 : kind === "WORST" ? -1 : 0,     // % per month compounding on trend lines
    collectionLag: kind === "WORST" ? 1 : 0,                      // months of slower collections
    overrides: {},                                                 // "CAT|YYYY-MM" -> cents
  };
}
function normalizeMonthly(m) {
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const out = { basis: ["AUTO", "TREND", "BUDGET"].includes(m?.basis) ? m.basis : "AUTO", minCash: Math.round(num(m?.minCash, 0)), scenarios: {} };
  for (const k of SC) {
    const src = m?.scenarios?.[k] || {}, d = defaultMonthlyScenario(k);
    out.scenarios[k] = {
      adjIn: num(src.adjIn, d.adjIn), adjOut: num(src.adjOut, d.adjOut), growth: num(src.growth, d.growth),
      collectionLag: Math.min(6, Math.max(0, parseInt(src.collectionLag ?? d.collectionLag, 10) || 0)),
      overrides: Object.fromEntries(Object.entries(src.overrides || {}).filter(([key, v]) => /^[A-Z_]+\|\d{4}-\d{2}$/.test(key) && CF_CATEGORIES[key.split("|")[0]] && Number.isFinite(+v)).map(([key, v]) => [key, Math.round(+v)])),
    };
  }
  return out;
}

/**
 * model: {
 *   histMonths: ["YYYY-MM"], hist: {CAT: [cents per hist month]}, openingCash (cash at end of last hist month),
 *   months: ["YYYY-MM" x12],
 *   budget: null | { revenue: {ym: cents}, cogs: {ym}, payroll: {ym}, opex: {ym} }   (natural sign, cash-relevant)
 *   histRevenue: [cents per hist month] (natural)  — for the collection rate
 * }
 */
function computeMonthly(model, settings) {
  const s = normalizeMonthly(settings);
  const H = model.histMonths.length;
  const L = Math.min(3, H) || 1;
  const avg = Object.fromEntries(CF_ORDER.map((k) => [k, Math.round((model.hist[k] || []).slice(H - L).reduce((a, x) => a + x, 0) / L)]));
  const histRec = (model.hist.CUSTOMER_RECEIPTS || []).reduce((a, x) => a + x, 0);
  const histRev = (model.histRevenue || []).reduce((a, x) => a + x, 0);
  const collectionRate = histRev > 0 ? Math.min(1.25, Math.max(0.3, histRec / histRev)) : 1;
  const histSup = -(model.hist.SUPPLIER_PAYMENTS || []).reduce((a, x) => a + x, 0);
  const histCogs = (model.histCogs || []).reduce((a, x) => a + x, 0);
  const payRate = histCogs > 0 ? Math.min(1.5, Math.max(0.3, histSup / histCogs)) : 1;
  const useBudget = (ym) => s.basis !== "TREND" && model.budget && model.budget.revenue && Object.prototype.hasOwnProperty.call(model.budget.revenue, ym);
  const result = {};
  for (const sc of SC) {
    const p = s.scenarios[sc];
    const rows = {}, computed = {}, overridden = {}, source = [];
    for (const k of CF_ORDER) { rows[k] = []; computed[k] = []; overridden[k] = []; }
    model.months.forEach((ym, j) => {
      const fromBudget = useBudget(ym);
      source.push(fromBudget ? "BUDGET" : "TREND");
      const g = Math.pow(1 + (p.growth || 0) / 100, j + 1);
      for (const k of CF_ORDER) {
        let v;
        if (fromBudget && k === "CUSTOMER_RECEIPTS") {
          // Collections lag sales: month j collects revenue budgeted `lag` months earlier; before the
          // window starts, it collects the existing run-rate (sales already in receivables).
          const srcYm = model.months[j - p.collectionLag];
          v = srcYm ? (model.budget.revenue[srcYm] || 0) * collectionRate : avg[k];
        } else if (fromBudget && k === "SUPPLIER_PAYMENTS") v = -(model.budget.cogs?.[ym] || 0) * payRate;
        else if (fromBudget && k === "PAYROLL") v = -(model.budget.payroll?.[ym] || 0);
        else if (fromBudget && k === "OPEX") v = -(model.budget.opex?.[ym] || 0);
        else {
          v = avg[k] * g;
          // Slower collections on a trend basis: half of a month's receipts slip in each lag month.
          if (k === "CUSTOMER_RECEIPTS" && j < p.collectionLag) v *= 0.5;
        }
        if (isIn(k)) v *= 1 + p.adjIn / 100;
        if (isOut(k)) v *= 1 + p.adjOut / 100;
        v = Math.round(v);
        computed[k].push(v);
        const key = `${k}|${ym}`;
        const ov = Object.prototype.hasOwnProperty.call(p.overrides, key);
        overridden[k].push(ov);
        rows[k].push(ov ? p.overrides[key] : v);
      }
    });
    const n = model.months.length;
    const col = (pred) => Array.from({ length: n }, (_, i) => CF_ORDER.filter(pred).reduce((a, k) => a + rows[k][i], 0));
    const inflows = col(isIn), outflows = col(isOut), financing = col((k) => CF_CATEGORIES[k].group === "FIN");
    const net = inflows.map((v, i) => v + outflows[i] + financing[i]);
    const opening = [], closing = [];
    let bal = model.openingCash;
    for (let i = 0; i < n; i++) { opening.push(bal); bal += net[i]; closing.push(bal); }
    let low = { value: closing[0] ?? bal, month: model.months[0] };
    closing.forEach((v, i) => { if (v < low.value) low = { value: v, month: model.months[i] }; });
    const below = closing.map((v, i) => (v < s.minCash ? model.months[i] : null)).filter(Boolean);
    result[sc] = {
      rows, computed, overridden, source, inflows, outflows, financing, net, opening, closing,
      summary: { endCash: closing[n - 1] ?? bal, net12: net.reduce((a, x) => a + x, 0), lowest: low, monthsBelowMin: below, fundingGap: Math.max(0, s.minCash - low.value), firstBreach: below[0] || null },
    };
  }
  return { months: model.months, runRate: avg, collectionRate, payRate, scenarios: result, settings: s };
}

module.exports = { normalizeMonthly, defaultMonthlyScenario, computeMonthly, MONTHLY_SCENARIOS: SC };
