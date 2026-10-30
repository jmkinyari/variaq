// Budget vs Actual, reforecast (full-year landing) and the variance explanation engine. Pure.
// All amounts NATURAL sign (income positive, costs positive) — see lib/budget/engine.js.
const { BUDGET_CLASSES, INCOME } = require("./engine");

const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
const pct = (a, b) => (b ? Math.round((a / Math.abs(b)) * 1000) / 10 : null);

/** Favourable when income beats budget or costs come in under budget. */
const isFavourable = (cls, variance) => (INCOME.has(cls) ? variance >= 0 : variance <= 0);

/** Effective actual row after reviewer overrides ({ "code|idx": {cents, note} }). */
function effectiveActual(code, row, actualOverrides = {}) {
  return row.map((v, m) => { const o = actualOverrides[`${code}|${m}`]; return o && Number.isFinite(+o.cents) ? Math.round(+o.cents) : v; });
}

/**
 * Compute BvA + reforecast.
 * opts: { chart, budget: Map(code->[12]), actuals: Map(code->[12]), closedMonths, monthIdx,
 *         materiality: {pct, cents}, reforecast: {"code|idx": cents}, actualOverrides, landingBasis: "BUDGET"|"RUN_RATE" }
 */
function computeBva({ chart, budget, actuals, closedMonths, monthIdx = closedMonths - 1, materiality = { pct: 10, cents: 5000000 }, reforecast = {}, actualOverrides = {}, landingBasis = "BUDGET" }) {
  const k = Math.max(0, Math.min(12, closedMonths));
  const mi = Math.max(0, Math.min(11, monthIdx));
  const codes = new Set([...budget.keys(), ...[...actuals.keys()].filter((c) => BUDGET_CLASSES.includes(chart.get(c)?.cls))]);
  const rows = [];
  for (const code of codes) {
    const acct = chart.get(code);
    if (!acct || !BUDGET_CLASSES.includes(acct.cls)) continue;
    const b = budget.get(code) || new Array(12).fill(0);
    const a = effectiveActual(code, actuals.get(code) || new Array(12).fill(0), actualOverrides);
    const ytdB = sum(b.slice(0, mi + 1)), ytdA = sum(a.slice(0, mi + 1));
    const runRate = k ? sum(a.slice(Math.max(0, k - 3), k)) / Math.min(3, k) : 0;
    const forecast = Array.from({ length: 12 }, (_, m) => {
      if (m < k) return a[m];
      const key = `${code}|${m}`;
      if (Object.prototype.hasOwnProperty.call(reforecast, key)) return Math.round(+reforecast[key]);
      return landingBasis === "RUN_RATE" ? Math.round(runRate) : b[m];
    });
    const mVar = a[mi] - b[mi], yVar = ytdA - ytdB;
    const landing = sum(forecast), fyBudget = sum(b);
    const material = (v, base) => Math.abs(v) >= materiality.cents && (base === 0 || Math.abs(pct(v, base) ?? 100) >= materiality.pct);
    rows.push({
      code, name: acct.name, cls: acct.cls, budget: b, actual: a, forecast,
      overridden: a.map((_, m) => !!actualOverrides[`${code}|${m}`]),
      reforecastOverridden: forecast.map((_, m) => m >= k && Object.prototype.hasOwnProperty.call(reforecast, `${code}|${m}`)),
      month: { budget: b[mi], actual: a[mi], variance: mVar, pct: pct(mVar, b[mi]), favourable: isFavourable(acct.cls, mVar), material: material(mVar, b[mi]) },
      ytd: { budget: ytdB, actual: ytdA, variance: yVar, pct: pct(yVar, ytdB), favourable: isFavourable(acct.cls, yVar), material: material(yVar, ytdB) },
      fy: { budget: fyBudget, landing, variance: landing - fyBudget, pct: pct(landing - fyBudget, fyBudget), favourable: isFavourable(acct.cls, landing - fyBudget) },
      runRate: Math.round(runRate),
    });
  }
  rows.sort((x, y) => BUDGET_CLASSES.indexOf(x.cls) - BUDGET_CLASSES.indexOf(y.cls) || String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
  // Class and profit totals.
  const tot = (cls, pick) => sum(rows.filter((r) => r.cls === cls).map(pick));
  const classes = Object.fromEntries(BUDGET_CLASSES.map((c) => [c, {
    month: { budget: tot(c, (r) => r.month.budget), actual: tot(c, (r) => r.month.actual) },
    ytd: { budget: tot(c, (r) => r.ytd.budget), actual: tot(c, (r) => r.ytd.actual) },
    fy: { budget: tot(c, (r) => r.fy.budget), landing: tot(c, (r) => r.fy.landing) },
    budgetByMonth: Array.from({ length: 12 }, (_, m) => tot(c, (r) => r.budget[m])),
    actualByMonth: Array.from({ length: 12 }, (_, m) => tot(c, (r) => r.actual[m])),
    forecastByMonth: Array.from({ length: 12 }, (_, m) => tot(c, (r) => r.forecast[m])),
  }]));
  const profit = (sel) => { const g = (c) => sel(classes[c]); return g("REVENUE") - g("COGS") - g("EXPENSE") + g("OTHER_INCOME"); };
  const netProfit = {
    month: { budget: profit((c) => c.month.budget), actual: profit((c) => c.month.actual) },
    ytd: { budget: profit((c) => c.ytd.budget), actual: profit((c) => c.ytd.actual) },
    fy: { budget: profit((c) => c.fy.budget), landing: profit((c) => c.fy.landing) },
  };
  return { rows, classes, netProfit, closedMonths: k, monthIdx: mi };
}

/**
 * Explain one material variance. ctx:
 *  row (from computeBva), monthIdx, txns: [{date, description, counterparty, amount (natural)}] for the month,
 *  history: [{count, total}] for the 3 prior months (for price/volume), siblings: other rows of the same class.
 * Returns { types: [...], headline, drivers: top txns, priceVolume?, actions: [...] }
 */
function explainVariance(row, { monthIdx, txns = [], history = [], siblings = [], materiality = { pct: 10, cents: 5000000 } }) {
  const m = row.month, y = row.ytd;
  const income = INCOME.has(row.cls);
  const fav = m.favourable ? "favourable" : "adverse";
  const types = [];
  const actions = [];
  const abs = Math.abs(m.variance);
  const drivers = [...txns].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5);
  const amounts = txns.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0;

  if (m.budget === 0 && m.actual !== 0) {
    types.push({ key: "UNBUDGETED", label: "Unbudgeted activity", detail: "There's activity on an account with no budget this month." });
    actions.push("Confirm the postings belong in this account; if it's a genuine new cost/revenue stream, add it to the reforecast.");
  }
  if (!income && m.budget > 0 && m.actual === 0 && row.actual.slice(Math.max(0, monthIdx - 3), monthIdx).some((v) => v > 0)) {
    types.push({ key: "MISSING_ACCRUAL", label: "Possible missing accrual", detail: "A recurring cost has no postings this month although earlier months did." });
    actions.push("Check whether the invoice/accrual for this month was missed and post an accrual before closing the period.");
  }
  // Timing: material in the month but YTD back within materiality, or reverses last month's variance.
  const prevVar = monthIdx > 0 ? row.actual[monthIdx - 1] - row.budget[monthIdx - 1] : 0;
  if (m.material && (!y.material || (prevVar && Math.sign(prevVar) === -Math.sign(m.variance) && Math.abs(prevVar) >= abs * 0.5))) {
    types.push({ key: "TIMING", label: "Timing difference", detail: `The year-to-date variance is ${y.material ? "partly offset" : "within materiality"} — this looks like phasing between months rather than a permanent change.` });
    actions.push("Re-phase the remaining budget/reforecast months rather than treating this as a full-year change.");
  }
  // One-off: a single transaction explains most of the variance and is far bigger than typical.
  const big = drivers[0];
  if (big && abs > 0 && Math.abs(big.amount) >= abs * 0.5 && Math.abs(big.amount) >= Math.max(median * 3, materiality.cents)) {
    types.push({ key: "ONE_OFF", label: "One-off transaction", detail: `A single entry (${big.description || "no description"}${big.counterparty ? `, ${big.counterparty}` : ""}) accounts for most of the variance.` });
    actions.push("Confirm the one-off is correctly classified (expense vs capital/prepayment) and exclude it from the run-rate in the reforecast.");
  }
  // Run-rate shift: last 3 months all on the same side of budget by a similar amount.
  const last3 = [0, 1, 2].map((d) => monthIdx - d).filter((i) => i >= 0).map((i) => row.actual[i] - row.budget[i]);
  if (last3.length === 3 && last3.every((v) => Math.sign(v) === Math.sign(m.variance) && Math.abs(v) >= materiality.cents * 0.5)) {
    types.push({ key: "RUN_RATE", label: "Run-rate shift (permanent)", detail: "Actuals have differed from budget in the same direction for three months running." });
    actions.push(income ? "Update the reforecast to the new run-rate and review pricing/volume assumptions with sales." : "Update the reforecast to the new run-rate and agree a cost action (renegotiate, cut, or re-approve the budget).");
  }
  // Price / volume using transaction counts vs the 3-month base.
  let priceVolume = null;
  const hist = history.filter((h) => h && h.count > 0);
  if (txns.length && hist.length) {
    const baseCount = sum(hist.map((h) => h.count)) / hist.length;
    const baseAvg = sum(hist.map((h) => h.total)) / sum(hist.map((h) => h.count));
    const cnt = txns.length, avg = sum(txns.map((t) => t.amount)) / cnt;
    const volume = Math.round((cnt - baseCount) * baseAvg), price = Math.round((avg - baseAvg) * cnt);
    if (Math.abs(volume) + Math.abs(price) > 0) {
      priceVolume = { count: cnt, baseCount: Math.round(baseCount * 10) / 10, avg: Math.round(avg), baseAvg: Math.round(baseAvg), volume, price };
      const k = Math.abs(volume) >= Math.abs(price) ? "VOLUME" : "PRICE";
      types.push({ key: k, label: k === "VOLUME" ? "Volume driven" : "Price / rate driven", detail: k === "VOLUME" ? `${cnt} transactions vs a usual ${priceVolume.baseCount}.` : `Average transaction ${Math.round(avg / 100).toLocaleString("en-KE")} vs a usual ${Math.round(baseAvg / 100).toLocaleString("en-KE")}.` });
    }
  }
  // Possible misposting: a sibling account in the same class has an opposite variance of similar size.
  const mirror = siblings.find((s) => s.code !== row.code && Math.sign(s.month.variance) === -Math.sign(m.variance) && Math.abs(s.month.variance) >= abs * 0.8 && Math.abs(s.month.variance) <= abs * 1.25 && abs >= materiality.cents);
  if (mirror) {
    types.push({ key: "MISPOSTING", label: "Possible misposting", detail: `${mirror.code} ${mirror.name} has an opposite variance of a similar amount — the cost may have been posted to the wrong account.`, related: mirror.code });
    actions.push(`Review the largest entries in ${row.code} and ${mirror.code}; post a reclassification journal if they were coded to the wrong account.`);
  }
  if (!types.length) {
    types.push({ key: "UNEXPLAINED", label: "Needs explanation", detail: "No pattern detected automatically." });
    actions.push("Review the top transactions below with the account owner and record an explanation.");
  }
  const headline = `${row.code} ${row.name}: ${fav} variance of ${Math.round(abs / 100).toLocaleString("en-KE")} (${m.pct === null ? "unbudgeted" : `${m.pct > 0 ? "+" : ""}${m.pct}%`}) — ${types.map((t) => t.label.toLowerCase()).join(", ")}.`;
  return { types, headline, drivers, priceVolume, actions: [...new Set(actions)] };
}

/** Explanations for every material row, ordered by size. */
function explainAll(bva, { txnsByCode = new Map(), historyByCode = new Map(), materiality } = {}) {
  return bva.rows.filter((r) => r.month.material || r.ytd.material)
    .sort((a, b) => Math.abs(b.month.variance) - Math.abs(a.month.variance))
    .map((r) => ({ code: r.code, row: r, ...explainVariance(r, { monthIdx: bva.monthIdx, txns: txnsByCode.get(r.code) || [], history: historyByCode.get(r.code) || [], siblings: bva.rows.filter((s) => s.cls === r.cls), materiality }) }));
}

module.exports = { computeBva, explainVariance, explainAll, isFavourable, effectiveActual };
