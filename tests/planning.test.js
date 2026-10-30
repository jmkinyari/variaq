// Unit tests for the planning engines: KPIs, budget generation, BvA & variance explanations, forecasts.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSeries, computeKpis, topMovers, monthRange, projectLinear } = require("../lib/kpi");
const { generateBudget, seasonality, trend, spread, classTotals, fyMonths, toNatural, fromNatural } = require("../lib/budget/engine");
const { computeBva, explainVariance } = require("../lib/budget/variance");
const { computeForecast, normalizeSettings, weekList } = require("../lib/cashflow");
const { computeMonthly } = require("../lib/forecast/monthly");

const chart = new Map([
  ["1010", { code: "1010", name: "KCB Bank", cls: "CURRENT_ASSET", isCash: true }],
  ["1100", { code: "1100", name: "Trade receivables", cls: "CURRENT_ASSET", isCash: false }],
  ["1200", { code: "1200", name: "Inventory", cls: "CURRENT_ASSET", isCash: false }],
  ["1600", { code: "1600", name: "Accumulated depreciation", cls: "NONCURRENT_ASSET", isCash: false }],
  ["2000", { code: "2000", name: "Trade payables", cls: "CURRENT_LIABILITY", isCash: false }],
  ["2600", { code: "2600", name: "Bank loan", cls: "NONCURRENT_LIABILITY", isCash: false }],
  ["3000", { code: "3000", name: "Share capital", cls: "EQUITY", isCash: false }],
  ["4000", { code: "4000", name: "Sales", cls: "REVENUE", isCash: false }],
  ["5000", { code: "5000", name: "Cost of sales", cls: "COGS", isCash: false }],
  ["6100", { code: "6100", name: "Salaries and wages", cls: "EXPENSE", isCash: false }],
  ["6200", { code: "6200", name: "Rent", cls: "EXPENSE", isCash: false }],
  ["6900", { code: "6900", name: "Depreciation", cls: "EXPENSE", isCash: false }],
  ["7000", { code: "7000", name: "Interest on loan", cls: "EXPENSE", isCash: false }],
]);

function ledgerModel() {
  const months = monthRange("2026-03", 3);
  const mov = new Map();
  const put = (code, ym, v) => { if (!mov.has(code)) mov.set(code, new Map()); mov.get(code).set(ym, (mov.get(code).get(ym) || 0) + v); };
  months.forEach((ym, i) => {
    const rev = 1_000_000_00 + i * 100_000_00; // 1.0m, 1.1m, 1.2m KES
    put("4000", ym, -rev); put("1100", ym, rev);           // credit sale
    put("1100", ym, -rev * 0.8); put("1010", ym, rev * 0.8); // 80% collected
    put("5000", ym, rev * 0.6); put("1200", ym, -rev * 0.6);  // COGS from stock
    put("6100", ym, 150_000_00); put("1010", ym, -150_000_00);
    put("6200", ym, 50_000_00); put("2000", ym, -50_000_00);
    put("6900", ym, 20_000_00); put("1600", ym, -20_000_00);
    put("7000", ym, 10_000_00); put("1010", ym, -10_000_00);
  });
  const opening = new Map([["1010", 500_000_00], ["1200", 3_000_000_00], ["3000", -3_500_000_00]]);
  return { chart, months, mov, opening };
}

test("KPI series: revenue, gross margin, EBITDA excludes D&A and interest", () => {
  const m = ledgerModel();
  const s = buildSeries(m);
  assert.deepEqual(s.revenue, [1_000_000_00, 1_100_000_00, 1_200_000_00]);
  assert.equal(s.cogs[2], 720_000_00);
  assert.equal(s.da[2], 20_000_00);
  assert.equal(s.interest[2], 10_000_00);
  assert.equal(s.ebitda[2], 1_200_000_00 - 720_000_00 - 200_000_00);
  assert.equal(s.netProfit[2], s.ebitda[2] - 20_000_00 - 10_000_00);
  const k = Object.fromEntries(computeKpis(s, m.months).map((x) => [x.key, x]));
  assert.equal(k.gross_margin.value, 40);
  assert.equal(k.revenue_growth.value, 9.1);
  assert.equal(k.gross_margin.status, "good");
  assert.ok(k.dso.value > 0, "DSO computed from receivables");
  assert.ok(k.current_ratio.value > 1);
  assert.equal(k.payroll_pct.value, 12.5);
});

test("KPI: equity includes accumulated earnings so the balance sheet ties", () => {
  const m = ledgerModel();
  const s = buildSeries(m);
  const last = s.totalAssets.length - 1;
  assert.equal(s.totalAssets[last], s.totalLiabilities[last] + s.equity[last]);
});

test("top movers rank by absolute change", () => {
  const m = ledgerModel();
  const t = topMovers(m);
  assert.equal(t[0].code, "4000");
  assert.equal(t[0].change, 100_000_00);
});

test("linear projection continues a trend", () => {
  assert.deepEqual(projectLinear([10, 20, 30, 40], 2), [50, 60]);
});

const hist = (fn) => Array.from({ length: 24 }, (_, i) => fn(i));
const bchart = new Map([["4000", { code: "4000", name: "Sales", cls: "REVENUE" }], ["5000", { code: "5000", name: "Cost of sales", cls: "COGS" }], ["6100", { code: "6100", name: "Salaries", cls: "EXPENSE" }], ["6200", { code: "6200", name: "Rent", cls: "EXPENSE" }]]);

test("seasonality index sums to 1 and follows history", () => {
  const h = hist((i) => (i % 12 === 11 ? 300 : 100)); // December-ish peak
  const idx = seasonality(h);
  assert.ok(Math.abs(idx.reduce((a, x) => a + x, 0) - 1) < 1e-9);
  assert.ok(idx[11] > idx[0] * 2.5);
  assert.deepEqual(seasonality([]), new Array(12).fill(1 / 12));
});

test("spread keeps the exact annual total", () => {
  const row = spread(1_000_001, new Array(12).fill(1 / 12));
  assert.equal(row.reduce((a, x) => a + x, 0), 1_000_001);
});

test("budget methods: prior-year growth, trend, seasonal, driver, zero-based", () => {
  const history = new Map([
    ["4000", hist((i) => 1_000_000 + i * 10_000)],
    ["5000", hist((i) => 600_000 + i * 6_000)],
    ["6100", hist(() => 200_000)],
    ["6200", hist(() => 50_000)],
  ]);
  const a = { growth: { REVENUE: 10, COGS: 10, EXPENSE: 0, OTHER_INCOME: 0 }, rounding: 1, revGrowth: 10, inflation: 5, payrollPct: 10, payrollMonth: 6, cogsPct: null };
  const py = generateBudget({ chart: bchart, history, method: "PRIOR_YEAR", assumptions: a });
  assert.equal(py.get("4000")[0], Math.round((1_000_000 + 12 * 10_000) * 1.1));
  const tr = generateBudget({ chart: bchart, history, method: "TREND", assumptions: a });
  assert.equal(tr.get("4000")[0], 1_000_000 + 24 * 10_000);
  const se = generateBudget({ chart: bchart, history, method: "SEASONAL", assumptions: a });
  const last12 = history.get("4000").slice(12).reduce((x, y) => x + y, 0);
  assert.equal(se.get("4000").reduce((x, y) => x + y, 0), Math.round(last12 * 1.1));
  const dr = generateBudget({ chart: bchart, history, method: "DRIVER", assumptions: a });
  const rev = dr.get("4000"), cogs = dr.get("5000");
  assert.ok(Math.abs(cogs[3] / rev[3] - 0.6) < 0.001, "COGS follows the historical % of revenue");
  assert.equal(dr.get("6100")[5], 200_000); // before the pay rise month
  assert.equal(dr.get("6100")[6], 220_000); // payroll increment from month 6
  assert.equal(dr.get("6200")[0], 52_500);  // inflation on non-payroll opex
  const zb = generateBudget({ chart: bchart, history, method: "ZERO_BASED", assumptions: { oneOffs: [{ code: "6200", monthIdx: 2, amount: 999 }] } });
  assert.equal(zb.get("4000").reduce((x, y) => x + y, 0), 0);
  assert.equal(zb.get("6200")[2], 999);
  const t = classTotals(py, bchart);
  assert.equal(t.netProfit[0], t.REVENUE[0] - t.COGS[0] - t.EXPENSE[0]);
  assert.equal(trend([5, 5, 5]).length, 12);
});

test("natural sign conversion round-trips", () => {
  assert.equal(toNatural("REVENUE", -500), 500);
  assert.equal(fromNatural("REVENUE", 500), -500);
  assert.equal(toNatural("EXPENSE", 500), 500);
  assert.deepEqual(fyMonths("2026-07").slice(0, 2), ["2026-07", "2026-08"]);
});

const B = (v) => new Array(12).fill(v);
test("BvA: favourable/adverse, YTD, reforecast landing and overrides", () => {
  const budget = new Map([["4000", B(1000_00)], ["6200", B(500_00)]]);
  const actuals = new Map([["4000", [1200_00, 900_00, 1100_00, ...B(0).slice(3)]], ["6200", [500_00, 700_00, 500_00, ...B(0).slice(3)]]]);
  const bva = computeBva({ chart: bchart, budget, actuals, closedMonths: 3, materiality: { pct: 10, cents: 100_00 }, reforecast: { "4000|5": 2000_00 }, actualOverrides: { "6200|1": { cents: 500_00, note: "Reclass to prepayments" } } });
  const rev = bva.rows.find((r) => r.code === "4000"), rent = bva.rows.find((r) => r.code === "6200");
  assert.equal(rev.month.variance, 100_00);
  assert.equal(rev.month.favourable, true);
  assert.equal(rev.ytd.actual, 3200_00);
  assert.equal(rev.fy.landing, 3200_00 + 2000_00 + 1000_00 * 8);
  assert.equal(rent.actual[1], 500_00, "actual override applied");
  assert.equal(rent.overridden[1], true);
  const over = computeBva({ chart: bchart, budget, actuals: new Map([["6200", [800_00, ...B(0).slice(1)]]]), closedMonths: 1, materiality: { pct: 10, cents: 100_00 } });
  assert.equal(over.rows.find((r) => r.code === "6200").month.favourable, false);
  const rr = computeBva({ chart: bchart, budget, actuals, closedMonths: 3, landingBasis: "RUN_RATE" });
  assert.equal(rr.rows.find((r) => r.code === "4000").forecast[11], Math.round((1200_00 + 900_00 + 1100_00) / 3));
});

test("variance engine classifies one-off, unbudgeted, missing accrual, timing, misposting and run-rate", () => {
  const mat = { pct: 10, cents: 100_00 };
  const mk = (code, cls, budget, actual) => computeBva({ chart: new Map([[code, { code, name: code, cls }]]), budget: new Map([[code, budget]]), actuals: new Map([[code, actual]]), closedMonths: 4, materiality: mat }).rows[0];
  const oneOff = mk("6200", "EXPENSE", B(500_00), [500_00, 500_00, 500_00, 1500_00, ...B(0).slice(4)]);
  const e1 = explainVariance(oneOff, { monthIdx: 3, txns: [{ amount: 1000_00, description: "Office partition" }, { amount: 250_00 }, { amount: 250_00 }], materiality: mat });
  assert.ok(e1.types.some((t) => t.key === "ONE_OFF"));
  assert.ok(e1.actions.length);
  const unb = mk("6300", "EXPENSE", B(0), [0, 0, 0, 400_00, ...B(0).slice(4)]);
  assert.ok(explainVariance(unb, { monthIdx: 3, materiality: mat }).types.some((t) => t.key === "UNBUDGETED"));
  const miss = mk("6400", "EXPENSE", B(300_00), [300_00, 300_00, 300_00, 0, ...B(0).slice(4)]);
  assert.ok(explainVariance(miss, { monthIdx: 3, materiality: mat }).types.some((t) => t.key === "MISSING_ACCRUAL"));
  const timing = mk("4000", "REVENUE", B(1000_00), [1000_00, 1000_00, 700_00, 1300_00, ...B(0).slice(4)]);
  assert.ok(explainVariance(timing, { monthIdx: 3, materiality: mat }).types.some((t) => t.key === "TIMING"));
  const runRate = mk("4100", "REVENUE", B(1000_00), [1000_00, 800_00, 800_00, 800_00, ...B(0).slice(4)]);
  assert.ok(explainVariance(runRate, { monthIdx: 3, materiality: mat }).types.some((t) => t.key === "RUN_RATE"));
  const a = mk("6500", "EXPENSE", B(500_00), [500_00, 500_00, 500_00, 900_00, ...B(0).slice(4)]);
  const b = { ...mk("6600", "EXPENSE", B(500_00), [500_00, 500_00, 500_00, 100_00, ...B(0).slice(4)]) };
  const e = explainVariance(a, { monthIdx: 3, siblings: [a, b], materiality: mat });
  assert.ok(e.types.some((t) => t.key === "MISPOSTING" && t.related === "6600"));
  const pv = explainVariance(a, { monthIdx: 3, txns: Array.from({ length: 9 }, () => ({ amount: 100_00 })), history: [{ count: 5, total: 500_00 }, { count: 5, total: 500_00 }], materiality: mat });
  assert.ok(pv.priceVolume && pv.priceVolume.volume === 400_00);
});

test("13-week forecast: actual overrides need a note, replace actuals and feed the run-rate", () => {
  const history = weekList("2026-01-05", 4);
  const model = { history, forecastWeeks: weekList("2026-02-02", 13), actuals: { CUSTOMER_RECEIPTS: [100, 100, 100, 100], OPEX: [-50, -50, -50, -50] }, openingBeforeHistory: 1000 };
  const s0 = normalizeSettings({});
  const r0 = computeForecast(model, s0);
  const key = `CUSTOMER_RECEIPTS|${history[3].start}`;
  const noNote = normalizeSettings({ actualOverrides: { [key]: { cents: 400 } } });
  assert.equal(Object.keys(noNote.actualOverrides).length, 0, "note is required");
  const s1 = normalizeSettings({ actualOverrides: { [key]: { cents: 400, note: "Receipt banked late" } } });
  const r1 = computeForecast(model, s1);
  const b1 = r1.scenarios.BASE;
  assert.equal(b1.rows.CUSTOMER_RECEIPTS[r1.actualCount - 1], 400);
  assert.equal(b1.actualOverridden.CUSTOMER_RECEIPTS[r1.actualCount - 1], true);
  assert.equal(b1.actualOriginal.CUSTOMER_RECEIPTS[r1.actualCount - 1], 100);
  assert.equal(r1.baseline.CUSTOMER_RECEIPTS, 200, "run-rate uses corrected actuals");
  assert.equal(b1.closing[r1.actualCount - 1] - r0.scenarios.BASE.closing[r0.actualCount - 1], 300);
});

test("12-month forecast: budget-driven receipts with collection lag, min-cash breach and overrides", () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  const budget = { revenue: Object.fromEntries(months.map((m) => [m, 1000])), cogs: Object.fromEntries(months.map((m) => [m, 500])), payroll: Object.fromEntries(months.map((m) => [m, 300])), opex: Object.fromEntries(months.map((m) => [m, 100])) };
  const model = { histMonths: ["2025-10", "2025-11", "2025-12"], hist: { CUSTOMER_RECEIPTS: [900, 900, 900], SUPPLIER_PAYMENTS: [-500, -500, -500], PAYROLL: [-300, -300, -300], OPEX: [-100, -100, -100] }, histRevenue: [1000, 1000, 1000], histCogs: [500, 500, 500], openingCash: 100, months, budget };
  const r = computeMonthly(model, { minCash: 0, scenarios: { WORST: { collectionLag: 1, adjIn: 0, adjOut: 0, growth: 0 } } });
  const base = r.scenarios.BASE;
  assert.equal(r.collectionRate, 0.9);
  assert.equal(base.rows.CUSTOMER_RECEIPTS[0], 900);
  assert.equal(base.source[0], "BUDGET");
  assert.equal(base.net[0], 0);
  const worst = r.scenarios.WORST;
  assert.equal(worst.rows.CUSTOMER_RECEIPTS[0], 900, "first lag month collects existing receivables");
  const trendOnly = computeMonthly({ ...model, budget: null }, { minCash: 1000 });
  assert.equal(trendOnly.scenarios.BASE.source[0], "TREND");
  assert.ok(trendOnly.scenarios.BASE.summary.fundingGap > 0);
  assert.equal(trendOnly.scenarios.BASE.summary.firstBreach, "2026-01");
  const ov = computeMonthly(model, { scenarios: { BASE: { overrides: { "OPEX|2026-03": -999 } } } });
  assert.equal(ov.scenarios.BASE.rows.OPEX[2], -999);
  assert.equal(ov.scenarios.BASE.overridden.OPEX[2], true);
});

test("budget upload: month columns and labels map onto the financial year", () => {
  const { fyIndex, parseMonthLabel } = require("../lib/budget/months");
  const { monthColumns } = require("../lib/ingest/clean");
  // July–June financial year.
  const cols = monthColumns(["Account", "Jul", "Aug", "Jan", "Jun"]);
  assert.deepEqual(cols.map((c) => fyIndex(c, "2026-07")), [0, 1, 6, 11]);
  assert.equal(fyIndex(monthColumns(["2027-02"])[0], "2026-07"), 7);
  assert.equal(fyIndex(monthColumns(["M3"])[0], "2026-07"), 2);
  assert.equal(parseMonthLabel("2026-09", "2026-07"), 2);
  assert.equal(parseMonthLabel("March 2027", "2026-07"), 8);
  assert.equal(parseMonthLabel("P12", "2026-07"), 11);
  assert.equal(parseMonthLabel("Mar-25", "2026-07"), -1, "outside the financial year");
});

test("a partial first year of history doesn't distort seasonality (ledger starting mid-year)", () => {
  // 8 months of data in year 1 (May–Dec), a full flat year 2: the index must stay flat.
  const h = [0, 0, 0, 0, ...new Array(8).fill(1400000), ...new Array(12).fill(1484000)];
  const idx = seasonality(h);
  for (const w of idx) assert.ok(Math.abs(w - 1 / 12) < 1e-9);
  const b = generateBudget({ chart: new Map([["6300", { code: "6300", cls: "EXPENSE", name: "Salaries & Wages" }]]), history: new Map([["6300", h]]), method: "SEASONAL", assumptions: { growth: { EXPENSE: 0 }, rounding: 100 } });
  assert.ok(b.get("6300").every((v) => Math.abs(v - 1484000) <= 100));
});
