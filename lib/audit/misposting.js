// Misposting detection that learns from the company's own ledger.
//
// 1. A multinomial naive Bayes classifier predicts the account for a journal line from its
//    description tokens, counterparty, side (Dr/Cr) and amount size, trained on historical lines.
//    A line is flagged when the model is confident a *different* account fits and gives the posted
//    account almost no probability. Scoring uses an inverted index (token → accounts), so each line
//    is only scored against accounts that share a feature — fast enough for 200k-line ledgers.
// 2. A keyword dictionary encodes accounting common sense (fuel isn't a fixed asset, PAYE isn't
//    revenue, a KES 180k laptop isn't a repair) and flags class contradictions even with no history.
// Every flag is explainable (top tokens / matched keyword) and comes with a reclass journal.
const STOP = new Set("the and for from with being of to in on at by a an is was being payment paid pay ref no invoice inv txn transaction amount kes ksh being being month being re per via ltd limited co company".split(" "));
const tokenize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
const normParty = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(ltd|limited|plc|co|company|enterprises?|kenya|k)\b/g, "").trim();
const amountBucket = (c) => `amt:${Math.min(9, Math.floor(Math.log10(Math.max(1, Math.abs(c) / 100))))}`;

function features(line) {
  const f = tokenize(line.description);
  const p = normParty(line.counterparty);
  if (p) f.push(`cp:${p}`);
  f.push(line.amountCents >= 0 ? "side:dr" : "side:cr");
  f.push(amountBucket(line.amountCents));
  return f;
}

/** Train on lines [{accountCode, description, counterparty, amountCents}]. */
function train(lines, { minTokens = 1 } = {}) {
  const acc = new Map(); // code -> { docs, total, counts: Map }
  const index = new Map(); // token -> Set(code)
  let docs = 0;
  for (const l of lines) {
    const fs = features(l);
    if (fs.length - 2 < minTokens) continue; // need at least one descriptive token
    const code = String(l.accountCode);
    let a = acc.get(code);
    if (!a) acc.set(code, (a = { docs: 0, total: 0, counts: new Map() }));
    a.docs++; docs++;
    for (const t of fs) {
      a.counts.set(t, (a.counts.get(t) || 0) + 1); a.total++;
      let s = index.get(t); if (!s) index.set(t, (s = new Set())); s.add(code);
    }
  }
  return { acc, index, docs, vocab: index.size };
}

/** Posterior over candidate accounts for one line. Returns [{code, p, logp}] sorted desc. */
function predict(model, line, extraCandidates = []) {
  const fs = features(line);
  const cands = new Set(extraCandidates.map(String));
  for (const t of fs) if (!t.startsWith("side:") && !t.startsWith("amt:")) for (const c of model.index.get(t) || []) cands.add(c);
  const V = model.vocab + 1;
  const scored = [];
  for (const code of cands) {
    const a = model.acc.get(code);
    if (!a) continue;
    let s = Math.log(a.docs / model.docs);
    const denom = Math.log(a.total + V);
    for (const t of fs) s += Math.log((a.counts.get(t) || 0) + 1) - denom;
    scored.push({ code, logp: s });
  }
  if (!scored.length) return [];
  const mx = Math.max(...scored.map((x) => x.logp));
  const z = scored.reduce((acc2, x) => acc2 + Math.exp(x.logp - mx), 0);
  return scored.map((x) => ({ ...x, p: Math.exp(x.logp - mx) / z })).sort((a, b) => b.p - a.p);
}

/** Tokens that most favour `code` over `other` (log-likelihood ratio). */
function explain(model, line, code, other) {
  const a = model.acc.get(code), b = model.acc.get(other);
  const V = model.vocab + 1;
  return features(line).filter((t) => !t.startsWith("side:") && !t.startsWith("amt:"))
    .map((t) => ({ t, w: Math.log(((a?.counts.get(t) || 0) + 1) / ((a?.total || 0) + V)) - Math.log(((b?.counts.get(t) || 0) + 1) / ((b?.total || 0) + V)) }))
    .filter((x) => x.w > 0).sort((x, y) => y.w - x.w).slice(0, 4).map((x) => x.t.replace(/^cp:/, "counterparty “") + (x.t.startsWith("cp:") ? "”" : ""));
}

// Keyword → classes the line must NOT be posted to (and the class it probably belongs in).
const KEYWORDS = [
  { re: /\b(fuel|petrol|diesel|lubricant)\b/, label: "fuel", forbid: ["NONCURRENT_ASSET", "REVENUE", "EQUITY"], expect: "EXPENSE" },
  { re: /\b(salar(y|ies)|wages?|payroll|net pay|casuals?)\b/, label: "payroll", forbid: ["NONCURRENT_ASSET", "REVENUE"], expect: "EXPENSE" },
  { re: /\b(airtime|bundles?|internet|wifi)\b/, label: "airtime/internet", forbid: ["NONCURRENT_ASSET", "REVENUE"], expect: "EXPENSE" },
  { re: /\b(kplc|electricity|power bill|water bill|nairobi water|utilit(y|ies))\b/, label: "utilities", forbid: ["NONCURRENT_ASSET", "REVENUE"], expect: "EXPENSE" },
  { re: /\b(rent|rental|lease)\b/, label: "rent", forbid: ["REVENUE", "NONCURRENT_ASSET"], expect: "EXPENSE", unlessSide: "cr" },
  { re: /\bdepreciation\b/, label: "depreciation", forbid: ["REVENUE", "CURRENT_LIABILITY", "CURRENT_ASSET"], expect: "EXPENSE" },
  { re: /\binsurance (premium|cover)\b|\bpremium\b/, label: "insurance", forbid: ["REVENUE"], expect: "EXPENSE" },
  { re: /\b(paye|nssf|shif|nhif|housing levy|withholding|wht|vat payable|kra)\b/, label: "statutory/tax", forbid: ["REVENUE", "NONCURRENT_ASSET"], expect: "CURRENT_LIABILITY" },
  { re: /\b(dividends?)\b/, label: "dividend", forbid: ["EXPENSE", "COGS"], expect: "EQUITY" },
  { re: /\b(drawings|director'?s? personal|personal use)\b/, label: "drawings/personal", forbid: ["EXPENSE", "COGS"], expect: "EQUITY" },
  { re: /\b(loan (repayment|principal)|principal repayment)\b/, label: "loan principal", forbid: ["EXPENSE", "REVENUE", "COGS"], expect: "CURRENT_LIABILITY", unless: /\binterest\b/ },
  { re: /\b(sales? invoice|sale of goods|customer invoice|cash sales?)\b/, label: "sales", forbid: ["EXPENSE", "COGS", "NONCURRENT_ASSET"], expect: "REVENUE" },
];
const CAPEX = { re: /\b(laptops?|computers?|desktops?|printers?|servers?|motor vehicles?|vehicle purchase|furniture|machinery|generator|equipment purchase|forklift)\b/, unless: /\b(repair|service|servicing|maintenance|parts?|toner|cartridge|hire|rental|fuel)\b/ };

/**
 * Detect mispostings in `lines` (the population under test) using `history` for learning.
 * chart: Map(code -> {cls, name}) from lib/statements buildChart.
 * Returns [{line, suggestedCode, suggestedName, confidence, method, reasons, expectedClass}]
 */
function detectMispostings(lines, history, chart, { minPosterior = 0.85, maxActual = 0.05, minDocs = 5, capexThresholdCents = 5_000_000, maxFlags = 500 } = {}) {
  const model = train(history.length >= 200 ? history : history.concat(lines));
  const byClassTop = new Map(); // class -> most used account (fallback suggestion)
  for (const [code, a] of model.acc) {
    const cls = chart.get(code)?.cls;
    if (cls && (!byClassTop.has(cls) || a.docs > model.acc.get(byClassTop.get(cls)).docs)) byClassTop.set(cls, code);
  }
  // Accounts used in each journal: a line whose "better" account is already the other leg of the
  // same journal is just the counter-entry (e.g. the AR and VAT legs of a sales invoice), not a misposting.
  const jkey = (l) => l.journalNo || `${l.date}|${l.reference || l.description || ""}`;
  const journalAccounts = new Map();
  for (const l of lines) { const k = jkey(l); if (!journalAccounts.has(k)) journalAccounts.set(k, new Set()); journalAccounts.get(k).add(String(l.accountCode)); }
  const inJournal = (l, code) => journalAccounts.get(jkey(l))?.has(String(code));
  const journalHasClass = (l, c) => [...(journalAccounts.get(jkey(l)) || [])].some((a) => a !== String(l.accountCode) && chart.get(a)?.cls === c);
  const out = [];
  for (const l of lines) {
    if (out.length >= maxFlags) break;
    const code = String(l.accountCode);
    const cls = chart.get(code)?.cls;
    const desc = String(l.description || "").toLowerCase();
    const side = l.amountCents >= 0 ? "dr" : "cr";

    // 1) Keyword class contradictions.
    let hit = null;
    for (const k of KEYWORDS) {
      if (!k.re.test(desc) || (k.unless && k.unless.test(desc)) || (k.unlessSide && k.unlessSide === side)) continue;
      if (cls && k.forbid.includes(cls)) { hit = k; break; }
    }
    if (!hit && cls === "EXPENSE" && side === "dr" && Math.abs(l.amountCents) >= capexThresholdCents && CAPEX.re.test(desc) && !CAPEX.unless.test(desc)) {
      hit = { label: "capital item", expect: "NONCURRENT_ASSET", capex: true };
    }
    if (hit && !hit.capex && journalHasClass(l, hit.expect)) hit = null; // the expected class is the other leg
    if (hit) {
      // Suggest the account in the expected class that the model likes best for this text.
      const pred = predict(model, l).filter((p) => chart.get(p.code)?.cls === hit.expect);
      const sugg = pred[0]?.code || byClassTop.get(hit.expect) || null;
      out.push({
        line: l, suggestedCode: sugg, suggestedName: sugg ? chart.get(sugg)?.name || "" : null, expectedClass: hit.expect,
        confidence: pred[0] ? Math.round(Math.max(0.6, pred[0].p) * 100) : 60, method: "KEYWORD",
        reasons: hit.capex
          ? [`“${desc.match(CAPEX.re)[0]}” costing more than the capitalisation threshold was expensed — it is probably a fixed asset.`]
          : [`Description mentions ${hit.label}, which shouldn't be posted to a ${String(cls).toLowerCase().replace(/_/g, " ")} account.`],
      });
      continue;
    }

    // 2) Learned model.
    if (tokenize(l.description).length < 1) continue;
    const pred = predict(model, l, [code]);
    if (pred.length < 2) continue;
    const top = pred[0];
    const actual = pred.find((p) => p.code === code);
    if (top.code === code || top.p < minPosterior || inJournal(l, top.code)) continue;
    // Which bank/till paid is a payment choice, not a classification error.
    if (chart.get(code)?.isCash && chart.get(top.code)?.isCash) continue;
    if ((actual?.p || 0) > maxActual) continue;
    if ((model.acc.get(top.code)?.docs || 0) < minDocs) continue;
    const tokens = explain(model, l, top.code, code);
    if (tokens.length < 2) continue; // one shared word is too thin to call a misposting
    out.push({
      line: l, suggestedCode: top.code, suggestedName: chart.get(top.code)?.name || "", expectedClass: chart.get(top.code)?.cls || null,
      confidence: Math.round(top.p * 100), method: "MODEL",
      reasons: [`In your own history, lines like this (${tokens.join(", ")}) are posted to ${top.code}${chart.get(top.code)?.name ? ` ${chart.get(top.code).name}` : ""} — ${Math.round(top.p * 100)}% likely vs ${Math.round((actual?.p || 0) * 1000) / 10}% for ${code}.`],
    });
  }
  return out;
}

/** Balanced reclass journal moving a line from its posted account to the suggested one. */
function reclassJournal(line, toCode, toName, chart) {
  const amt = Math.abs(line.amountCents);
  const desc = `Reclass: ${String(line.description || "").slice(0, 60)}${line.journalNo ? ` (JV ${line.journalNo})` : ""}`;
  const from = { accountCode: String(line.accountCode), accountName: chart?.get(String(line.accountCode))?.name || line.accountName || "", description: desc };
  const to = { accountCode: String(toCode), accountName: toName || chart?.get(String(toCode))?.name || "", description: desc };
  return line.amountCents >= 0
    ? [{ ...to, debitCents: amt, creditCents: 0 }, { ...from, debitCents: 0, creditCents: amt }]
    : [{ ...from, debitCents: amt, creditCents: 0 }, { ...to, debitCents: 0, creditCents: amt }];
}

module.exports = { tokenize, features, train, predict, explain, detectMispostings, reclassJournal, KEYWORDS };
