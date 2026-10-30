// Financial statements from the general ledger: account classification, balance sheet,
// income statement, and cash & cash equivalents. Pure functions (no database access) so they
// can be unit-tested and reused. Amounts are integer cents; positive = debit, negative = credit.

const CLASSES = {
  CURRENT_ASSET: "Current asset",
  NONCURRENT_ASSET: "Non-current asset",
  CURRENT_LIABILITY: "Current liability",
  NONCURRENT_LIABILITY: "Non-current liability",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  COGS: "Cost of sales",
  EXPENSE: "Operating expense",
  OTHER_INCOME: "Other income / expense",
};
const PL_CLASSES = new Set(["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME"]);

// Cash-flow categories used to classify every movement on a cash account (by its contra account).
const CF_CATEGORIES = {
  CUSTOMER_RECEIPTS: { label: "Receipts from customers", group: "IN", activity: "OPERATING" },
  OTHER_RECEIPTS: { label: "Other receipts", group: "IN", activity: "OPERATING" },
  SUPPLIER_PAYMENTS: { label: "Payments to suppliers", group: "OUT", activity: "OPERATING" },
  PAYROLL: { label: "Salaries & wages", group: "OUT", activity: "OPERATING" },
  OPEX: { label: "Operating expenses", group: "OUT", activity: "OPERATING" },
  TAX: { label: "Taxes & statutory", group: "OUT", activity: "OPERATING" },
  OTHER_PAYMENTS: { label: "Other payments", group: "OUT", activity: "OPERATING" },
  CAPEX: { label: "Capital expenditure", group: "OUT", activity: "INVESTING" },
  FINANCING: { label: "Loans, capital & dividends", group: "FIN", activity: "FINANCING" },
};
const CF_ORDER = Object.keys(CF_CATEGORIES);
// "OTHER" on an account means: Other receipts if cash came in, Other payments if it went out.
const CF_CHOICES = { OTHER: "Other (by direction)", ...Object.fromEntries(CF_ORDER.filter((k) => !k.startsWith("OTHER_")).map((k) => [k, CF_CATEGORIES[k].label])) };
const ACTIVITIES = { OPERATING: "Operating activities", INVESTING: "Investing activities", FINANCING: "Financing activities" };

const has = (s, re) => re.test(String(s || "").toLowerCase());
const TAX_RE = /\b(vat|tax|paye|nssf|shif|nhif|housing levy|ahl|withholding|wht|kra|excise|statutory)\b/;
const PAYROLL_RE = /(salar|wage|payroll|net pay|staff cost|casual)/;
const CASH_RE = /(cash|bank|m-?pesa|petty|till|mobile money|call deposit)/;

function defaultClass(code, name) {
  const c = String(code || "").trim();
  const m = c.match(/^(\d)(\d*)/);
  if (m) {
    const block = Number((m[1] + m[2] + "000").slice(1, 4)); // position within its thousand block
    switch (m[1]) {
      case "1": return block >= 500 ? "NONCURRENT_ASSET" : "CURRENT_ASSET";
      case "2": return block >= 500 ? "NONCURRENT_LIABILITY" : "CURRENT_LIABILITY";
      case "3": return "EQUITY";
      case "4": return "REVENUE";
      case "5": return "COGS";
      case "8": return "OTHER_INCOME";
      case "6": case "7": case "9": return "EXPENSE";
      default: break;
    }
  }
  if (has(name, CASH_RE) || has(name, /(receivable|debtor|inventory|stock|prepay|deposit)/)) return "CURRENT_ASSET";
  if (has(name, /(equipment|vehicle|furniture|building|land|machinery|computer|fixed asset|depreciation)/)) return "NONCURRENT_ASSET";
  if (has(name, /(long[- ]term|term loan|mortgage)/)) return "NONCURRENT_LIABILITY";
  if (has(name, /(payable|creditor|accru|overdraft|loan|liabil)/) || has(name, TAX_RE)) return "CURRENT_LIABILITY";
  if (has(name, /(capital|equity|retained|reserve|drawings|dividend)/)) return "EQUITY";
  if (has(name, /^(sales|revenue)|\b(sales|revenue|turnover)\b/)) return "REVENUE";
  if (has(name, /(cost of (sales|goods)|cogs|purchases)/)) return "COGS";
  if (has(name, /(other income|interest income|gain|forex)/)) return "OTHER_INCOME";
  return "EXPENSE";
}

function defaultIsCash(code, name, cls, bankCodes) {
  if (bankCodes && bankCodes.has(String(code))) return true;
  if (cls !== "CURRENT_ASSET") return false;
  if (/^10\d\d$/.test(String(code).trim())) return true;
  return has(name, CASH_RE) && !has(name, /(receivable|debtor)/);
}

function defaultCf(code, name, cls) {
  const c = String(code || "").trim();
  if (has(name, TAX_RE)) return "TAX";
  if (has(name, PAYROLL_RE)) return "PAYROLL";
  switch (cls) {
    case "CURRENT_ASSET":
      if (/^11/.test(c) || has(name, /(receivable|debtor)/)) return "CUSTOMER_RECEIPTS";
      if (/^12/.test(c) || has(name, /(inventory|stock)/)) return "SUPPLIER_PAYMENTS";
      return "OTHER";
    case "NONCURRENT_ASSET": return "CAPEX";
    case "CURRENT_LIABILITY":
      if (has(name, /(loan|overdraft|borrow)/)) return "FINANCING";
      if (/^20/.test(c) || has(name, /(payable|creditor|supplier)/)) return "SUPPLIER_PAYMENTS";
      return "OTHER";
    case "NONCURRENT_LIABILITY": case "EQUITY": return "FINANCING";
    case "REVENUE": return "CUSTOMER_RECEIPTS";
    case "COGS": return "SUPPLIER_PAYMENTS";
    case "EXPENSE": return "OPEX";
    default: return "OTHER";
  }
}

/**
 * accounts: [{account_code, account_name}], overrides: [{account_code, class, is_cash, cf_category}],
 * bankCodes: Set of ledger codes linked to bank accounts.
 * Returns Map(code -> {code, name, cls, isCash, cf, overridden})
 */
function buildChart(accounts, overrides = [], bankCodes = new Set()) {
  const ov = new Map(overrides.map((o) => [String(o.account_code), o]));
  const chart = new Map();
  for (const a of accounts) {
    const code = String(a.account_code), name = a.account_name || "";
    const o = ov.get(code) || {};
    const autoCls = defaultClass(code, name);
    const cls = CLASSES[o.class] ? o.class : autoCls;
    const autoCash = defaultIsCash(code, name, cls, bankCodes);
    const isCash = o.is_cash === null || o.is_cash === undefined ? autoCash : !!o.is_cash;
    const autoCf = defaultCf(code, name, cls);
    const cf = o.cf_category && CF_CHOICES[o.cf_category] ? o.cf_category : autoCf;
    chart.set(code, { code, name, cls, isCash, cf, auto: { cls: autoCls, isCash: autoCash, cf: autoCf }, overridden: !!(o.class || o.is_cash !== undefined && o.is_cash !== null || o.cf_category) });
  }
  return chart;
}

const sum = (xs) => xs.reduce((a, x) => a + x, 0);
const sortByCode = (a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true });

/** balances: Map(code -> cents) of cumulative balances at a date. */
function balanceSheet(chart, balances) {
  const lines = (cls, sign) => [...chart.values()].filter((a) => a.cls === cls)
    .map((a) => ({ code: a.code, name: a.name, isCash: a.isCash, amount: sign * (balances.get(a.code) || 0) }))
    .filter((l) => l.amount !== 0).sort(sortByCode);
  const ca = lines("CURRENT_ASSET", 1), nca = lines("NONCURRENT_ASSET", 1);
  const cl = lines("CURRENT_LIABILITY", -1), ncl = lines("NONCURRENT_LIABILITY", -1);
  const eq = lines("EQUITY", -1);
  let pl = 0;
  for (const a of chart.values()) if (PL_CLASSES.has(a.cls)) pl += balances.get(a.code) || 0;
  const earnings = -pl;
  // Unknown accounts in balances but not in chart (shouldn't happen) are counted as suspense.
  let suspense = 0;
  for (const [code, v] of balances) if (!chart.has(code)) suspense += v;
  const t = (ls) => sum(ls.map((l) => l.amount));
  const totalAssets = t(ca) + t(nca);
  const totalLiabilities = t(cl) + t(ncl);
  const totalEquity = t(eq) + earnings;
  return {
    sections: [
      { key: "CA", title: "Current assets", lines: ca, total: t(ca) },
      { key: "NCA", title: "Non-current assets", lines: nca, total: t(nca) },
      { key: "CL", title: "Current liabilities", lines: cl, total: t(cl) },
      { key: "NCL", title: "Non-current liabilities", lines: ncl, total: t(ncl) },
      { key: "EQ", title: "Equity", lines: [...eq, { code: "", name: "Accumulated profit / (loss)", amount: earnings, computed: true }], total: totalEquity },
    ],
    totalAssets, totalLiabilities, totalEquity, earnings, suspense,
    difference: totalAssets - totalLiabilities - totalEquity,
  };
}

/** movements: Map(code -> cents) for the period. */
function incomeStatement(chart, movements) {
  const lines = (cls) => [...chart.values()].filter((a) => a.cls === cls)
    .map((a) => ({ code: a.code, name: a.name, amount: -(movements.get(a.code) || 0) }))
    .filter((l) => l.amount !== 0).sort(sortByCode);
  // Revenue shown positive; costs shown as positive costs (sign flipped) for readability.
  const rev = lines("REVENUE");
  const cogs = lines("COGS").map((l) => ({ ...l, amount: -l.amount }));
  const opex = lines("EXPENSE").map((l) => ({ ...l, amount: -l.amount }));
  const other = lines("OTHER_INCOME");
  const t = (ls) => sum(ls.map((l) => l.amount));
  const revenue = t(rev), costOfSales = t(cogs), grossProfit = revenue - costOfSales;
  const operatingExpenses = t(opex), operatingProfit = grossProfit - operatingExpenses;
  const otherNet = t(other), netProfit = operatingProfit + otherNet;
  return {
    revenue: { lines: rev, total: revenue },
    cogs: { lines: cogs, total: costOfSales },
    opex: { lines: opex, total: operatingExpenses },
    other: { lines: other, total: otherNet },
    grossProfit, operatingProfit, netProfit,
    grossMargin: revenue ? Math.round((grossProfit / revenue) * 1000) / 10 : null,
    netMargin: revenue ? Math.round((netProfit / revenue) * 1000) / 10 : null,
  };
}

/**
 * Classify every movement on a cash account by its contra account.
 * entries: [{id,date,reference,description,accountCode,amountCents}] — all accounts in the window,
 * so the other side of each transaction can be found (grouped by date + reference, or date + description).
 * Returns [{id, date, amount, category, contra, description}] (transfers between cash accounts are dropped).
 */
function classifyCashFlows(entries, chart) {
  const key = (e) => `${e.date}|${e.reference ? "R:" + String(e.reference).trim() : "D:" + String(e.description || "").trim()}`;
  const groups = new Map();
  for (const e of entries) { const k = key(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const out = [];
  for (const e of entries) {
    const acct = chart.get(String(e.accountCode));
    if (!acct || !acct.isCash || !e.amountCents) continue;
    const sibs = groups.get(key(e)).filter((s) => s !== e);
    const nonCash = sibs.filter((s) => !(chart.get(String(s.accountCode))?.isCash));
    if (!nonCash.length && sibs.length) continue; // transfer between cash accounts
    // Prefer contra lines on the opposite side; take the largest.
    const opp = nonCash.filter((s) => Math.sign(s.amountCents) === -Math.sign(e.amountCents));
    const pool = opp.length ? opp : nonCash;
    const contra = pool.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents))[0];
    let cat = contra ? chart.get(String(contra.accountCode))?.cf || "OTHER" : "OTHER";
    if (cat === "OTHER") cat = e.amountCents > 0 ? "OTHER_RECEIPTS" : "OTHER_PAYMENTS";
    out.push({ id: e.id, date: e.date, amount: e.amountCents, category: cat, contra: contra ? String(contra.accountCode) : null, description: e.description });
  }
  return out;
}

/** Direct-method cash flow summary grouped by activity. flows from classifyCashFlows. */
function cashFlowByActivity(flows) {
  const byCat = Object.fromEntries(CF_ORDER.map((k) => [k, 0]));
  for (const f of flows) byCat[f.category] = (byCat[f.category] || 0) + f.amount;
  const acts = Object.keys(ACTIVITIES).map((a) => {
    const lines = CF_ORDER.filter((k) => CF_CATEGORIES[k].activity === a && byCat[k] !== 0).map((k) => ({ key: k, label: CF_CATEGORIES[k].label, amount: byCat[k] }));
    return { key: a, title: ACTIVITIES[a], lines, total: sum(lines.map((l) => l.amount)) };
  });
  return { activities: acts, byCategory: byCat, net: sum(acts.map((a) => a.total)) };
}

module.exports = { CLASSES, PL_CLASSES, CF_CATEGORIES, CF_ORDER, CF_CHOICES, ACTIVITIES, defaultClass, defaultIsCash, defaultCf, buildChart, balanceSheet, incomeStatement, classifyCashFlows, cashFlowByActivity };
