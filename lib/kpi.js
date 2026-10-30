// CFO KPI engine. Pure functions (no database) so they can be unit-tested and reused by the
// dashboard, board packs and the overview page. Ledger convention: positive = debit, cents.
//
// Input model:
//   chart:   Map(code -> { code, name, cls, isCash })            (lib/statements buildChart)
//   months:  ["YYYY-MM", ...] oldest first
//   mov:     Map(code -> Map(ym -> cents))  net movement per account per month
//   opening: Map(code -> cents)              balance immediately before months[0]
//   aging:   optional { AR: {total, d90}, AP: {total, d90} } latest ageing snapshot (cents)

const PL = new Set(["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME"]);
const has = (s, re) => re.test(String(s || "").toLowerCase());
const RE = {
  da: /(depreciat|amorti[sz])/,
  interest: /(interest|finance cost|finance charge|loan charge)/,
  incomeTax: /(income tax|corporation tax|corporate tax|deferred tax|tax expense)/,
  payroll: /(salar|wage|payroll|staff cost|casual|nssf|shif|nhif|housing levy|paye|gratuity|bonus|allowance)/,
  receivable: /(receivable|debtor)/,
  inventory: /(inventor|stock)/,
  payable: /(payable|creditor|supplier|accrued)/,
  debt: /(loan|borrow|overdraft|mortgage|lease liab|debenture|bond)/,
};

/** Account roles derived from class + name + code conventions. */
function roles(acct) {
  const { cls, name, code } = acct;
  const c = String(code);
  return {
    da: cls === "EXPENSE" && has(name, RE.da),
    interest: (cls === "EXPENSE" || cls === "OTHER_INCOME") && has(name, RE.interest),
    incomeTax: (cls === "EXPENSE" || cls === "OTHER_INCOME") && has(name, RE.incomeTax),
    payroll: (cls === "EXPENSE" || cls === "COGS") && has(name, RE.payroll),
    receivable: cls === "CURRENT_ASSET" && !acct.isCash && (has(name, RE.receivable) || /^11/.test(c)),
    inventory: cls === "CURRENT_ASSET" && !acct.isCash && (has(name, RE.inventory) || /^12/.test(c)),
    payable: cls === "CURRENT_LIABILITY" && (has(name, RE.payable) || /^20/.test(c)),
    debt: (cls === "CURRENT_LIABILITY" || cls === "NONCURRENT_LIABILITY") && has(name, RE.debt),
  };
}

/** Month list "YYYY-MM" ending at `endYm` (inclusive), n months long. */
function monthRange(endYm, n) {
  const [y, m] = endYm.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}
const addMonths = (ym, k) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); };
const daysInMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** Build monthly series for every metric the dashboard needs. */
function buildSeries({ chart, months, mov, opening }) {
  const n = months.length;
  const z = () => new Array(n).fill(0);
  const s = {
    revenue: z(), cogs: z(), opex: z(), da: z(), interest: z(), incomeTax: z(), otherNet: z(), payroll: z(),
    cash: z(), receivables: z(), inventory: z(), payables: z(), currentAssets: z(), currentLiabilities: z(),
    debt: z(), equity: z(), totalAssets: z(), totalLiabilities: z(),
  };
  const byCode = new Map();
  let accumulatedPl = 0; // cumulative P&L balance before months[0] (debit-positive)
  for (const [code, acct] of chart) {
    const r = roles(acct);
    const bal0 = opening.get(code) || 0;
    if (PL.has(acct.cls)) accumulatedPl += bal0;
    byCode.set(code, { acct, r, bal0 });
  }
  const balances = new Map([...byCode].map(([code, x]) => [code, x.bal0]));
  for (let i = 0; i < n; i++) {
    const ym = months[i];
    for (const [code, { acct, r }] of byCode) {
      const mv = mov.get(code)?.get(ym) || 0;
      const b = (balances.get(code) || 0) + mv;
      balances.set(code, b);
      switch (acct.cls) {
        case "REVENUE": s.revenue[i] += -mv; break;
        case "COGS": s.cogs[i] += mv; if (r.payroll) s.payroll[i] += mv; break;
        case "EXPENSE":
          if (r.da) s.da[i] += mv; else if (r.interest) s.interest[i] += mv; else if (r.incomeTax) s.incomeTax[i] += mv; else s.opex[i] += mv;
          if (r.payroll) s.payroll[i] += mv;
          break;
        case "OTHER_INCOME":
          if (r.interest && mv > 0) s.interest[i] += mv; else if (r.incomeTax) s.incomeTax[i] += mv; else s.otherNet[i] += -mv;
          break;
        default: break;
      }
      if (PL.has(acct.cls)) accumulatedPl += mv;
      if (acct.isCash) s.cash[i] += b;
      if (r.receivable) s.receivables[i] += b;
      if (r.inventory) s.inventory[i] += b;
      if (r.payable) s.payables[i] += -b;
      if (r.debt) s.debt[i] += -b;
      if (acct.cls === "CURRENT_ASSET") s.currentAssets[i] += b;
      if (acct.cls === "CURRENT_ASSET" || acct.cls === "NONCURRENT_ASSET") s.totalAssets[i] += b;
      if (acct.cls === "CURRENT_LIABILITY") s.currentLiabilities[i] += -b;
      if (acct.cls === "CURRENT_LIABILITY" || acct.cls === "NONCURRENT_LIABILITY") s.totalLiabilities[i] += -b;
      if (acct.cls === "EQUITY") s.equity[i] += -b;
    }
    s.equity[i] += -accumulatedPl; // retained / current-year earnings
  }
  s.grossProfit = s.revenue.map((v, i) => v - s.cogs[i]);
  s.ebitda = s.grossProfit.map((v, i) => v - s.opex[i]);
  s.ebit = s.ebitda.map((v, i) => v - s.da[i]);
  s.netProfit = s.ebit.map((v, i) => v - s.interest[i] - s.incomeTax[i] + s.otherNet[i]);
  s.expenses = s.cogs.map((v, i) => v + s.opex[i] + s.da[i] + s.interest[i] + s.incomeTax[i]);
  s.workingCapital = s.currentAssets.map((v, i) => v - s.currentLiabilities[i]);
  s.netCashFlow = s.cash.map((v, i) => (i === 0 ? null : v - s.cash[i - 1]));
  return s;
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const ratio = (a, b) => (b ? Math.round((a / b) * 100) / 100 : null);
const sumLast = (arr, i, k) => arr.slice(Math.max(0, i - k + 1), i + 1).reduce((a, x) => a + (x || 0), 0);

/**
 * KPI catalogue at month index i (default: last). Each KPI:
 * { key, label, value, prior, delta, unit ('money'|'pct'|'x'|'days'|'months'), status ('good'|'warn'|'bad'|null), definition, series }
 */
function computeKpis(series, months, { i = months.length - 1, aging = null } = {}) {
  const S = series;
  const p = i - 1;
  const yoy = i - 12;
  const days = (k) => months.slice(Math.max(0, i - k + 1), i + 1).reduce((a, m) => a + daysInMonth(m), 0);
  const marginSeries = (num) => S.revenue.map((r, j) => pct(num[j], r));
  const rec = aging?.AR?.total ?? S.receivables[i];
  const pay = aging?.AP?.total ?? S.payables[i];
  const rev3 = sumLast(S.revenue, i, 3), cogs3 = sumLast(S.cogs, i, 3), purch3 = sumLast(S.cogs, i, 3) + sumLast(S.opex, i, 3) - sumLast(S.payroll, i, 3);
  const d3 = days(3);
  const avgNet3 = [1, 2, 3].map((k) => S.netCashFlow[i - k + 1]).filter((x) => x !== null && x !== undefined);
  const burn = avgNet3.length ? -avgNet3.reduce((a, x) => a + x, 0) / avgNet3.length : null;
  const quickAssets = S.currentAssets[i] - S.inventory[i];
  const kpi = (key, label, unit, value, prior, status, definition, seriesArr) => ({ key, label, unit, value, prior, delta: value !== null && prior !== null && prior !== undefined ? Math.round((value - prior) * 100) / 100 : null, status, definition, series: seriesArr });
  const st = (v, goodFn, warnFn) => (v === null || v === undefined ? null : goodFn(v) ? "good" : warnFn(v) ? "warn" : "bad");
  const gm = pct(S.grossProfit[i], S.revenue[i]), nm = pct(S.netProfit[i], S.revenue[i]), em = pct(S.ebitda[i], S.revenue[i]);
  const mom = S.revenue[p] ? pct(S.revenue[i] - S.revenue[p], Math.abs(S.revenue[p])) : null;
  const yoyG = yoy >= 0 && S.revenue[yoy] ? pct(S.revenue[i] - S.revenue[yoy], Math.abs(S.revenue[yoy])) : null;
  const cr = ratio(S.currentAssets[i], S.currentLiabilities[i]);
  const qr = ratio(quickAssets, S.currentLiabilities[i]);
  const de = S.equity[i] > 0 ? ratio(S.debt[i], S.equity[i]) : null;
  const dso = rev3 > 0 ? Math.round((rec / rev3) * d3) : null;
  const dpo = purch3 > 0 ? Math.round((pay / purch3) * d3) : null;
  const dio = cogs3 > 0 ? Math.round((S.inventory[i] / cogs3) * d3) : null;
  const runway = burn && burn > 0 ? Math.round((S.cash[i] / burn) * 10) / 10 : null;
  const opexRatio = pct(S.opex[i], S.revenue[i]);
  const payrollPct = pct(S.payroll[i], S.revenue[i]);
  return [
    kpi("revenue", "Revenue", "money", S.revenue[i], S.revenue[p] ?? null, st(mom, (v) => v >= 0, (v) => v > -10), "Income from sales in the month (revenue accounts, net of returns).", S.revenue),
    kpi("revenue_growth", "Revenue growth (MoM)", "pct", mom, null, st(mom, (v) => v >= 0, (v) => v > -10), "Change in monthly revenue vs the previous month.", null),
    kpi("revenue_yoy", "Revenue growth (YoY)", "pct", yoyG, null, st(yoyG, (v) => v >= 5, (v) => v >= 0), "Change vs the same month last year (needs 13 months of data).", null),
    kpi("gross_margin", "Gross margin", "pct", gm, pct(S.grossProfit[p], S.revenue[p]), st(gm, (v) => v >= 30, (v) => v >= 15), "Gross profit ÷ revenue. Gross profit = revenue − cost of sales.", marginSeries(S.grossProfit)),
    kpi("ebitda", "EBITDA", "money", S.ebitda[i], S.ebitda[p] ?? null, st(S.ebitda[i], (v) => v > 0, (v) => v === 0), "Earnings before interest, tax, depreciation and amortisation (gross profit − operating expenses excluding D&A, interest and income tax).", S.ebitda),
    kpi("ebitda_margin", "EBITDA margin", "pct", em, pct(S.ebitda[p], S.revenue[p]), st(em, (v) => v >= 15, (v) => v >= 5), "EBITDA ÷ revenue.", marginSeries(S.ebitda)),
    kpi("net_profit", "Net profit", "money", S.netProfit[i], S.netProfit[p] ?? null, st(S.netProfit[i], (v) => v > 0, (v) => v === 0), "Profit after all income and expenses in the month.", S.netProfit),
    kpi("net_margin", "Net margin", "pct", nm, pct(S.netProfit[p], S.revenue[p]), st(nm, (v) => v >= 10, (v) => v >= 0), "Net profit ÷ revenue.", marginSeries(S.netProfit)),
    kpi("opex_ratio", "Opex ratio", "pct", opexRatio, pct(S.opex[p], S.revenue[p]), st(opexRatio, (v) => v <= 30, (v) => v <= 45), "Operating expenses (excl. D&A) ÷ revenue. Lower is leaner.", null),
    kpi("payroll_pct", "Payroll cost % of revenue", "pct", payrollPct, pct(S.payroll[p], S.revenue[p]), st(payrollPct, (v) => v <= 25, (v) => v <= 40), "Salaries, wages and statutory payroll costs ÷ revenue.", null),
    kpi("cash", "Cash balance", "money", S.cash[i], S.cash[p] ?? null, st(S.cash[i], (v) => v > 0, () => false), "Sum of all cash, bank and mobile-money accounts at month end.", S.cash),
    kpi("burn", "Net cash burn / month", "money", burn !== null ? Math.round(burn) : null, null, st(burn, (v) => v <= 0, () => false), "Average monthly decrease in cash over the last 3 months (negative = cash is growing).", null),
    kpi("runway", "Cash runway", "months", runway, null, runway === null ? (burn !== null && burn <= 0 ? "good" : null) : st(runway, (v) => v >= 12, (v) => v >= 6), "Months of cash left at the current burn rate. Blank when cash is growing.", null),
    kpi("working_capital", "Working capital", "money", S.workingCapital[i], S.workingCapital[p] ?? null, st(S.workingCapital[i], (v) => v > 0, () => false), "Current assets − current liabilities.", S.workingCapital),
    kpi("current_ratio", "Current ratio", "x", cr, ratio(S.currentAssets[p], S.currentLiabilities[p]), st(cr, (v) => v >= 1.5, (v) => v >= 1), "Current assets ÷ current liabilities. Below 1 means short-term obligations exceed liquid assets.", null),
    kpi("quick_ratio", "Quick ratio", "x", qr, null, st(qr, (v) => v >= 1, (v) => v >= 0.7), "(Current assets − inventory) ÷ current liabilities.", null),
    kpi("debt_equity", "Debt to equity", "x", de, null, st(de, (v) => v <= 1, (v) => v <= 2), "Interest-bearing debt (loans, overdrafts, leases) ÷ total equity.", null),
    kpi("dso", "Days sales outstanding", "days", dso, null, st(dso, (v) => v <= 45, (v) => v <= 75), `Receivables ÷ last-3-month revenue × days${aging?.AR ? " (receivables from the latest ageing upload)" : ""}.`, null),
    kpi("dpo", "Days payables outstanding", "days", dpo, null, st(dpo, (v) => v >= 30 && v <= 75, (v) => v <= 100), `Payables ÷ last-3-month purchases (cost of sales + non-payroll opex) × days${aging?.AP ? " (payables from the latest ageing upload)" : ""}.`, null),
    kpi("dio", "Days inventory outstanding", "days", dio, null, st(dio, (v) => v <= 60, (v) => v <= 120), "Inventory ÷ last-3-month cost of sales × days.", null),
    kpi("ccc", "Cash conversion cycle", "days", dso !== null && dpo !== null ? (dso + (dio || 0) - dpo) : null, null, null, "DSO + DIO − DPO: days between paying suppliers and collecting from customers.", null),
  ];
}

/** Expense accounts that moved most vs the prior month and vs the 3-month average. */
function topMovers({ chart, months, mov }, { i = months.length - 1, limit = 8 } = {}) {
  const ym = months[i], prev = months[i - 1];
  const out = [];
  for (const [code, acct] of chart) {
    if (!["COGS", "EXPENSE", "REVENUE", "OTHER_INCOME"].includes(acct.cls)) continue;
    const m = mov.get(code);
    if (!m) continue;
    const sign = acct.cls === "REVENUE" || acct.cls === "OTHER_INCOME" ? -1 : 1;
    const cur = sign * (m.get(ym) || 0), pr = sign * (m.get(prev) || 0);
    const avg3 = sign * [1, 2, 3].map((k) => m.get(months[i - k]) || 0).reduce((a, x) => a + x, 0) / 3;
    const change = cur - pr;
    if (!change && !cur) continue;
    out.push({ code, name: acct.name, cls: acct.cls, current: cur, prior: pr, avg3: Math.round(avg3), change, changePct: pr ? pct(change, Math.abs(pr)) : null });
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, limit);
}

/** Simple linear continuation of a series (least squares over the last k points). */
function projectLinear(values, ahead, k = 6) {
  const pts = values.slice(-k).map((v, j) => [j, v]).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 2) return new Array(ahead).fill(values[values.length - 1] ?? 0);
  const n = pts.length, sx = pts.reduce((a, [x]) => a + x, 0), sy = pts.reduce((a, [, y]) => a + y, 0);
  const sxx = pts.reduce((a, [x]) => a + x * x, 0), sxy = pts.reduce((a, [x, y]) => a + x * y, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), a = (sy - b * sx) / n;
  return Array.from({ length: ahead }, (_, j) => Math.round(a + b * (pts[n - 1][0] + j + 1)));
}

module.exports = { roles, monthRange, addMonths, daysInMonth, buildSeries, computeKpis, topMovers, projectLinear, PL };
