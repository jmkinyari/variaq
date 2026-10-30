// Chart-of-accounts matcher: maps every account in a source chart (subsidiary, old ERP, another
// system) to the best account in a target chart (e.g. the GROUP reporting chart).
// Score (0–100) combines: exact code, code structure/prefix, name similarity (token Jaccard over
// synonym-canonicalised words + normalised Levenshtein), statement-class compatibility, and what
// people have already confirmed (learned mappings). Returns the top 3 candidates with reasons.
const { defaultClass } = require("../statements");

// Finance synonyms → one canonical token.
const SYN = [
  [["debtors", "receivable", "receivables", "ar", "trade debtors"], "receivable"],
  [["creditors", "payable", "payables", "ap", "trade creditors", "accounts payable"], "payable"],
  [["turnover", "revenue", "sales", "income"], "revenue"],
  [["stock", "inventory", "inventories", "stocks"], "inventory"],
  [["motor", "vehicle", "vehicles", "mv", "car", "cars"], "vehicle"],
  [["ppe", "property", "plant", "equipment", "fixed", "assets"], "ppe"],
  [["accum", "accumulated", "acc"], "accumulated"],
  [["dep", "depn", "depr", "depreciation"], "depreciation"],
  [["cogs", "cos", "cost of sales", "cost of goods sold", "purchases"], "costofsales"],
  [["salaries", "salary", "wages", "wage", "payroll", "staff", "emoluments"], "payroll"],
  [["bank", "banks", "cash", "current account"], "cash"],
  [["mpesa", "m-pesa", "mobile money", "till", "paybill"], "mpesa"],
  [["vat", "value added tax", "output tax", "input tax"], "vat"],
  [["paye", "income tax payable"], "paye"],
  [["electricity", "power", "kplc", "utilities", "utility", "water"], "utilities"],
  [["telephone", "phone", "airtime", "internet", "communication", "communications"], "telecom"],
  [["rent", "rental", "lease", "rates"], "rent"],
  [["loan", "loans", "borrowings", "borrowing", "overdraft"], "borrowings"],
  [["share capital", "capital", "equity"], "capital"],
  [["retained", "accumulated profit", "accumulated losses", "reserves", "revenue reserve"], "retained"],
  [["prepayments", "prepayment", "prepaid"], "prepaid"],
  [["accruals", "accrual", "accrued"], "accrued"],
  [["provision", "provisions", "allowance"], "provision"],
  [["repairs", "maintenance", "r&m"], "repairs"],
  [["travel", "travelling", "transport"], "travel"],
  [["fees", "professional", "consultancy", "legal", "audit"], "professional"],
  [["premises", "occupancy", "building costs"], "premise"],
  [["suspense", "clearing", "unallocated", "unreconciled"], "suspense"],
  [["finance costs", "finance cost", "interest expense", "interest on loans", "bank interest"], "interest"],
  [["charges", "charge", "commission", "commissions"], "charge"],
  [["insurance", "premiums", "premium"], "insurance"],
  [["staff costs", "employee costs", "personnel"], "staff"],
  [["computers", "computer", "furniture", "fittings", "office equipment"], "equipment"],
];
const PHRASES = [], WORD = new Map();
for (const [words, canon] of SYN) for (const w of words) (w.includes(" ") ? PHRASES.push([w, canon]) : WORD.set(w, canon));
PHRASES.sort((a, b) => b[0].length - a[0].length);
const STOP = new Set(["and", "of", "the", "a", "at", "by", "with", "cost", "costs", "for", "to", "in", "on", "account", "a/c", "ac", "gl", "control", "general", "other", "misc", "kes", "usd", "ksh"]);

function canonTokens(name) {
  let s = ` ${String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 \-]+/g, " ").replace(/\s+/g, " ")} `;
  for (const [p, c] of PHRASES) s = s.split(` ${p} `).join(` ${c} `);
  return [...new Set(s.trim().split(" ").filter((t) => t && !STOP.has(t)).map((t) => WORD.get(t) || t.replace(/s$/, "")))];
}

function levRatio(a, b) {
  a = a.slice(0, 60); b = b.slice(0, 60);
  if (!a.length || !b.length) return 0;
  const prev = new Array(b.length + 1), cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

function codeSimilarity(a, b) {
  // Alphanumeric codes keep their letters: "FA-200" and "GX-200" are different accounts.
  const alpha = /[a-z]/i.test(a) || /[a-z]/i.test(b);
  a = String(a).toUpperCase().replace(alpha ? /[^A-Z0-9]/g : /\D/g, ""); b = String(b).toUpperCase().replace(alpha ? /[^A-Z0-9]/g : /\D/g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p / Math.max(a.length, b.length);
}

const CLASS_GROUP = { CURRENT_ASSET: "A", NONCURRENT_ASSET: "A", CURRENT_LIABILITY: "L", NONCURRENT_LIABILITY: "L", EQUITY: "E", REVENUE: "P", COGS: "P", EXPENSE: "P", OTHER_INCOME: "P" };

// Alphanumeric charts (EXP-110, FA-200, CR-100…) carry their class in the prefix.
const PREFIX_CLASS = [
  [/^(exp|ex|oh|opx|adm|ga|sga|ovh)\b/i, "EXPENSE"], [/^(inc|rev|sal|sls|tur)\b/i, "REVENUE"], [/^(cos|cogs|dc)\b/i, "COGS"],
  [/^(fa|ppe|nca|fix)\b/i, "NONCURRENT_ASSET"], [/^(ln|ltl|ncl)\b/i, "NONCURRENT_LIABILITY"], [/^(eq|cap|res)\b/i, "EQUITY"],
  [/^(cr|ap|acc|tax|vat|cl)\b/i, "CURRENT_LIABILITY"], [/^(dr|ar|bnk|bank|cash|stk|inv|ca|pre)\b/i, "CURRENT_ASSET"], [/^(fin|oi|oth)\b/i, "OTHER_INCOME"],
];
// P&L words that override balance-sheet-sounding names ("Bank charges", "Depreciation charge", "Interest on loans").
const EXPENSE_WORDS = /\b(charges?|commissions?|expenses?|costs?|fees|rent|salar|wages|fuel|power|lighting|electricity|insurance|premiums?|telephone|internet|repairs?|stationery|travel|depreciation (charge|expense)|amortisation (charge|expense))\b/i;
const FINANCE_WORDS = /\binterest (on|expense|paid)|finance costs?\b/i;
function inferClass(code, name) {
  if (/\b(suspense|clearing|unallocated)\b/i.test(name) || /^sus/i.test(String(code))) return "CURRENT_ASSET";
  const p = PREFIX_CLASS.find(([re]) => re.test(String(code).replace(/[-_.\s]/g, " ")));
  if (FINANCE_WORDS.test(name)) return "OTHER_INCOME";
  if (p && p[1] !== "CURRENT_ASSET" && p[1] !== "CURRENT_LIABILITY") return p[1];
  if (EXPENSE_WORDS.test(name) && !/\b(accrued|payable|prepaid|accumulated)\b/i.test(name)) return "EXPENSE";
  return p ? p[1] : defaultClass(code, name);
}

// Reporting concepts: group-chart lines are often broader ("Premises costs") than ledger accounts
// ("Rent – warehouse"), so we add concept tokens that depend on the statement class.
function concepts(tokens, cls) {
  const has = (...xs) => xs.some((x) => tokens.includes(x));
  const out = [];
  const pl = cls === "EXPENSE" || cls === "COGS" || cls === "OTHER_INCOME";
  if (pl && has("rent", "utilities", "premise", "security", "cleaning")) out.push("premises");
  if (pl && has("vehicle", "fuel", "delivery", "distribution", "freight", "carriage")) out.push("distribution");
  if (pl && has("telecom", "insurance", "repairs", "professional", "stationery", "printing", "postage", "subscription", "administrative", "office", "travel") || (pl && has("cash") && tokens.includes("charge"))) out.push("administrative");
  if (pl && has("payroll", "staff", "pension", "nssf", "shif", "gratuity", "medical")) out.push("staffcost");
  if (pl && has("interest", "finance")) out.push("financecost");
  if (pl && has("depreciation", "amortisation")) out.push("depreciationcharge");
  if (cls === "NONCURRENT_ASSET" && has("vehicle", "furniture", "computer", "equipment", "building", "land", "machinery", "ppe")) out.push("ppe");
  if ((cls === "CURRENT_LIABILITY" || cls === "NONCURRENT_LIABILITY") && has("vat", "paye", "nssf", "shif", "withholding", "tax", "kra", "levy")) out.push("tax");
  if (has("payable", "receivable") && !has("tax", "vat", "paye")) out.push("trade");
  if (cls === "CURRENT_ASSET" && has("cash", "mpesa", "petty", "deposit") && !has("suspense")) out.push("cashequiv");
  return out;
}

function prep(accounts) {
  return accounts.map((a) => {
    const code = String(a.code), name = a.name || "";
    const cls = a.class || a.cls || inferClass(code, name);
    const base = canonTokens(name);
    const tokens = [...new Set([...base, ...concepts(base, cls)])];
    return { code, name, cls, tokens, flat: base.join(" ") };
  });
}

/** Score one pair. Returns { score, reasons }. */
function scorePair(s, t, learned) {
  const reasons = [];
  let score = 0;
  if (learned) { score += 45; reasons.push("matches a mapping confirmed before"); }
  const cs = codeSimilarity(s.code, t.code);
  if (cs === 1) { score += 30; reasons.push("same account code"); } else if (cs >= 0.5) { score += cs * 15; reasons.push(`similar code structure (${s.code} ~ ${t.code})`); }
  const inter = s.tokens.filter((x) => t.tokens.includes(x)).length;
  const jac = inter ? inter / new Set([...s.tokens, ...t.tokens]).size : 0;
  const lev = levRatio(s.flat, t.flat);
  const nameSim = Math.max(jac, lev * 0.9);
  if (s.flat && s.flat === t.flat) { score += 45; reasons.push("same name (after synonyms)"); }
  else if (nameSim >= 0.2) { score += nameSim * 45; reasons.push(`name similarity ${Math.round(nameSim * 100)}%${inter ? ` (shared: ${s.tokens.filter((x) => t.tokens.includes(x)).slice(0, 3).join(", ")})` : ""}`); }
  const CONCEPTS = ["premises", "distribution", "administrative", "staffcost", "financecost", "depreciationcharge", "ppe", "tax", "trade", "cashequiv"];
  const shared = CONCEPTS.filter((k) => s.tokens.includes(k) && t.tokens.includes(k));
  if (shared.length) { score += 15; reasons.push(`same reporting concept (${shared.join(", ")})`); }
  if (s.cls === t.cls) { score += 15; reasons.push("same statement class"); }
  else if (CLASS_GROUP[s.cls] === CLASS_GROUP[t.cls]) score += 6;
  else { score -= 25; reasons.push(`class differs (${s.cls} vs ${t.cls})`); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/**
 * source/target: [{code, name, class?}]
 * confirmed: [{sourceName, sourceCode, targetCode}] mappings people confirmed (any source chart).
 * Returns [{code, name, cls, candidates: [{code, name, cls, confidence, reasons}]}]
 */
function matchCharts(source, target, confirmed = []) {
  const S = prep(source), T = prep(target);
  const tByCode = new Map(T.map((t) => [t.code, t]));
  const learnedByName = new Map(), learnedByCode = new Map();
  for (const c of confirmed) {
    if (c.sourceName) learnedByName.set(canonTokens(c.sourceName).join(" "), String(c.targetCode));
    if (c.sourceCode) learnedByCode.set(String(c.sourceCode), String(c.targetCode));
  }
  // Inverted index on tokens and code prefixes to avoid scoring every pair on big charts.
  const idx = new Map();
  const put = (k, t) => { if (!idx.has(k)) idx.set(k, new Set()); idx.get(k).add(t); };
  for (const t of T) { for (const tok of t.tokens) put(`w:${tok}`, t); const d = t.code.replace(/\D/g, ""); if (d) { put(`c:${d.slice(0, 2)}`, t); put(`c1:${d[0]}`, t); } put(`k:${t.cls}`, t); }
  return S.map((s) => {
    const pool = new Set();
    for (const tok of s.tokens) for (const t of idx.get(`w:${tok}`) || []) pool.add(t);
    const d = s.code.replace(/\D/g, "");
    if (d) for (const t of idx.get(`c:${d.slice(0, 2)}`) || []) pool.add(t);
    if (pool.size < 5) for (const t of idx.get(`k:${s.cls}`) || []) pool.add(t);
    if (pool.size < 5 && d) for (const t of idx.get(`c1:${d[0]}`) || []) pool.add(t);
    if (tByCode.has(s.code)) pool.add(tByCode.get(s.code));
    const learnedTarget = learnedByCode.get(s.code) || learnedByName.get(s.flat);
    if (learnedTarget && tByCode.has(learnedTarget)) pool.add(tByCode.get(learnedTarget));
    const cands = [...pool].map((t) => ({ t, ...scorePair(s, t, learnedTarget === t.code) }))
      .sort((a, b) => b.score - a.score).slice(0, 3)
      .map((c) => ({ code: c.t.code, name: c.t.name, cls: c.t.cls, confidence: c.score, reasons: c.reasons }));
    return { code: s.code, name: s.name, cls: s.cls, candidates: cands };
  });
}

module.exports = { matchCharts, scorePair, canonTokens, levRatio, codeSimilarity, inferClass };
