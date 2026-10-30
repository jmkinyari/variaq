// Journal-entry testing engine (ISA 240 / ISA 330 style "JET" procedures) over ledger lines.
//
// Input lines are the canonical ledger shape:
//   { id, date, journalNo, reference, description, accountCode, accountName, amountCents,
//     counterparty, postedBy, approvedBy, postedAt, entryType, source }
// Pass every line up to `periodTo` (with ~12 months of history before `periodFrom`); only lines
// inside [periodFrom, periodTo] are tested — earlier lines are used to learn what's normal.
// All rules are single-pass map/group operations so 200k lines run in well under a second or two.
const crypto = require("crypto");
const { nonWorkingDay, toEat } = require("./calendar");
const { detectMispostings, reclassJournal } = require("./misposting");
const { benford } = require("./stats");

const RULES = {
  UNBALANCED_JOURNAL: { severity: "HIGH", title: "Journal doesn't balance", explain: "Debits and credits in this journal don't net to zero, so the ledger is out of balance or a line is missing from the export.", action: "Find the missing or mis-keyed line in the ERP and post the correction. Until then the difference sits in suspense." },
  SINGLE_LINE: { severity: "HIGH", title: "Single-sided journal", explain: "The journal has only one line — there is no contra entry.", action: "Confirm whether the other side was posted under a different journal number; otherwise post the contra entry." },
  WEEKEND_HOLIDAY: { severity: "LOW", title: "Posted on a weekend or public holiday", explain: "Entries posted on non-working days are a classic fraud-risk indicator (ISA 240) because fewer reviewers are around.", action: "Check the journal has support and was reviewed. Ask the poster why it was posted on a non-working day." },
  AFTER_HOURS: { severity: "LOW", title: "Posted outside working hours", explain: "The system timestamp is outside 07:00–19:00 East Africa Time.", action: "Confirm the user was authorised to post at that time and that the entry has support." },
  BACKDATED: { severity: "MEDIUM", title: "Back-dated posting", explain: "The journal was keyed long after its accounting date, or into a period that had already been locked/closed.", action: "Obtain the reason for the late posting and approval from the finance lead; if it changes a reported period, assess whether reported figures need restating." },
  ROUND_AMOUNT: { severity: "LOW", title: "Large round-sum journal", explain: "Large round amounts are often estimates, plugs or manual adjustments rather than transactions from source documents.", action: "Get the calculation or document behind the amount. Replace estimates with actuals when known." },
  JUST_BELOW_THRESHOLD: { severity: "MEDIUM", title: "Just below the approval limit", explain: "The journal value sits just under the approval threshold, which can indicate splitting to avoid approval.", action: "Look for related journals on the same day/by the same user that together exceed the limit, and get retrospective approval." },
  DUPLICATE_JOURNAL: { severity: "MEDIUM", title: "Possible duplicate journal", explain: "Another journal with the same accounts and amounts was posted within a few days.", action: "If it's a duplicate, reverse it (proposed journal below). If both are valid, document why." },
  SELF_APPROVED: { severity: "HIGH", title: "Posted and approved by the same person", explain: "Segregation of duties failure: the preparer approved their own journal.", action: "Have an independent reviewer approve it retrospectively and restrict self-approval in the ERP workflow." },
  MISSING_APPROVAL: { severity: "MEDIUM", title: "No approver on a large journal", explain: "The journal exceeds the approval limit but no approver is recorded.", action: "Obtain and record approval; check the ERP approval workflow is enforced." },
  SUSPENSE_BALANCE: { severity: "MEDIUM", title: "Suspense / clearing account not cleared", explain: "A suspense, clearing or unallocated account carries a balance at period end.", action: "Analyse the items in the account and clear them to their correct accounts before the period is closed." },
  ABNORMAL_BALANCE: { severity: "MEDIUM", title: "Account has an abnormal balance", explain: "The balance is on the opposite side to the account's nature (e.g. a credit balance on an asset or a debit on revenue), which usually means misposting or a missing entry.", action: "Review recent postings to the account; reclassify (e.g. customer credit balances to payables) or correct the misposted entries." },
  RARE_ACCOUNT_PAIR: { severity: "LOW", title: "Unusual account combination", explain: "These accounts have never (or almost never) been debited and credited together before in this ledger.", action: "Confirm the double entry is right — unusual pairings are a common sign of misposting." },
  MANUAL_TO_REVENUE_OR_CASH: { severity: "MEDIUM", title: "Manual journal to revenue or cash", explain: "Revenue and cash should normally be posted by sub-ledgers (sales, receipts, bank). Manual journals here carry higher misstatement risk.", action: "Check the support and approval; consider whether the entry should have gone through the sales or cashbook module." },
  VAGUE_DESCRIPTION: { severity: "LOW", title: "Missing or vague description", explain: "Descriptions like “adjustment”, “misc” or blank make the entry hard to audit.", action: "Update the narration to state what the entry is and reference the supporting document." },
  STATISTICAL_OUTLIER: { severity: "MEDIUM", title: "Unusually large amount for this account", explain: "The amount is far outside this account's normal range (robust z-score using median and MAD).", action: "Vouch the entry to source documents and confirm it belongs to this account and period." },
  BENFORD: { severity: "LOW", title: "Amounts don't follow Benford's law", explain: "The first-digit distribution of amounts deviates from Benford's expected distribution (Nigrini MAD test), which can indicate fabricated or manipulated figures.", action: "Drill into the over-represented digits and the users/accounts driving them." },
  CUTOFF: { severity: "MEDIUM", title: "Period-end entry reversed next period", explain: "An income-statement entry posted in the last days of the period was reversed early in the next one — a cut-off/window-dressing indicator.", action: "Confirm the accrual was valid at period end with support (delivery notes, contracts). If not, it belongs in the next period." },
  DORMANT_ACCOUNT: { severity: "LOW", title: "Posting to a dormant account", explain: "The account had no activity for a long time before this period.", action: "Confirm the account is still meant to be used; if not, reclassify and block it in the ERP." },
  MISPOSTING: { severity: "MEDIUM", title: "Probable misposting", explain: "Based on this company's own posting history and accounting rules, the line looks like it belongs in a different account.", action: "Review the line; if confirmed, post the proposed reclass journal." },
};

const DEFAULTS = {
  approvalLimitCents: 50_000_000,        // KES 500,000
  belowThresholdPct: 10,                 // within 10% under the limit
  materialityCents: 100_000_000,         // KES 1,000,000 bumps severity
  roundMinCents: 10_000_000,             // KES 100,000
  roundUnitCents: 1_000_000,             // multiples of KES 10,000
  backdateDays: 30,
  duplicateWindowDays: 5,
  outlierZ: 6,
  outlierMinCents: 5_000_000,            // ignore outliers under KES 50,000
  dormantDays: 180,
  rareHistoryMinJournals: 300,
  suspenseAccount: "9999",
  suspenseRe: "suspense|clearing|unallocated|unidentified|holding|wash|unreconciled",
  extraHolidays: [],                     // [{date:"2026-03-20", name:"Eid al-Fitr"}]
  enabled: null,                         // null = all rules; else array of rule ids
};

const fp = (...parts) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const DAY = 86400000;
const dms = (d) => Date.parse(d + "T00:00:00Z");
const ym = (d) => d.slice(0, 7);
const lastDay = (d) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const NORMAL_SIDE = { CURRENT_ASSET: 1, NONCURRENT_ASSET: 1, COGS: 1, EXPENSE: 1, CURRENT_LIABILITY: -1, NONCURRENT_LIABILITY: -1, EQUITY: -1, REVENUE: -1 };
const CONTRA_RE = /accum|provision|allowance|impair|contra|discount|returns|drawings|dividend|depreciation/i;
const VAGUE_RE = /^(adj(ustment|mt)?s?|misc(ellaneous)?|correction|various|sundry|others?|test|plug|balancing( figure)?|to correct|being adjustment|journal|jv|entry|n\/?a|-|\.)$/i;
const MANUAL_RE = /manual|general journal|^gj$|^jv$|^mj$|adjust|^journal$/i;

const journalKey = (l) => l.journalNo ? `J:${l.journalNo}` : `D:${l.date}|${l.reference || l.description || ""}`;
const isManual = (j) => (j.entryType ? MANUAL_RE.test(j.entryType) : /^(jv|gj|mj|je|adj)/i.test(j.journalNo || ""));

/**
 * @returns {{ findings: object[], benford: object|null, stats: object }}
 */
function runJournalTests(allLines, ctx) {
  const p = { ...DEFAULTS, ...(ctx.params || {}) };
  const on = (r) => !p.enabled || p.enabled.includes(r);
  const { periodFrom: from, periodTo: to, chart, locks = new Map() } = ctx;
  const findings = [];
  const add = (rule, j, extra = {}) => {
    const R = RULES[rule];
    const amount = extra.amountCents ?? j?.totalCents ?? null;
    const severity = extra.severity || (R.severity === "LOW" && amount >= p.materialityCents ? "MEDIUM" : R.severity);
    findings.push({
      rule, severity, title: extra.title || R.title, journalNo: j?.journalNo || j?.key || null,
      entryIds: extra.entryIds || (j ? j.lines.slice(0, 200).map((l) => l.id) : []),
      accountCode: extra.accountCode || null, amountCents: amount, entryDate: extra.date || j?.date || null,
      suggestion: extra.suggestion || R.action, corrective: extra.corrective?.lines?.length ? extra.corrective : null,
      detail: { explain: R.explain, ...(extra.detail || {}) },
      fingerprint: fp(rule, j?.key || "", extra.accountCode || "", extra.fpExtra || ""),
    });
  };

  // ---- Single pass: split history/in-period, group journals, account stats ----
  const inPeriod = [], history = [];
  const journals = new Map();
  const lastSeen = new Map(); // account -> last date before `from`
  const balances = new Map(); // account -> balance at `to`
  for (const l of allLines) {
    if (l.date > to) continue;
    balances.set(l.accountCode, (balances.get(l.accountCode) || 0) + l.amountCents);
    if (l.date < from) {
      history.push(l);
      const ls = lastSeen.get(l.accountCode); if (!ls || l.date > ls) lastSeen.set(l.accountCode, l.date);
      continue;
    }
    inPeriod.push(l);
  }
  const groupInto = (lines, map) => {
    for (const l of lines) {
      const k = journalKey(l);
      let j = map.get(k);
      if (!j) map.set(k, (j = { key: k, journalNo: l.journalNo || null, date: l.date, lines: [], sum: 0, totalCents: 0, postedBy: l.postedBy, approvedBy: l.approvedBy, postedAt: l.postedAt, entryType: l.entryType }));
      j.lines.push(l); j.sum += l.amountCents; if (l.amountCents > 0) j.totalCents += l.amountCents;
      j.postedBy ||= l.postedBy; j.approvedBy ||= l.approvedBy; j.postedAt ||= l.postedAt; j.entryType ||= l.entryType;
    }
    return map;
  };
  groupInto(inPeriod, journals);
  const histJournals = groupInto(history, new Map());
  const anyApprover = inPeriod.some((l) => l.approvedBy) || history.some((l) => l.approvedBy);
  const cls = (code) => chart.get(String(code))?.cls;
  const name = (code) => chart.get(String(code))?.name || "";

  // Account-pair frequencies from history (Dr account → Cr account), capped per journal.
  const pairs = new Map();
  const pairKeys = (j) => {
    const dr = j.lines.filter((l) => l.amountCents > 0).sort((a, b) => b.amountCents - a.amountCents).slice(0, 5).map((l) => l.accountCode);
    const cr = j.lines.filter((l) => l.amountCents < 0).sort((a, b) => a.amountCents - b.amountCents).slice(0, 5).map((l) => l.accountCode);
    const out = new Set();
    for (const d of dr) for (const c of cr) if (d !== c) out.add(`${d}>${c}`);
    return out;
  };
  if (on("RARE_ACCOUNT_PAIR")) for (const j of histJournals.values()) for (const k of pairKeys(j)) pairs.set(k, (pairs.get(k) || 0) + 1);
  const known = new Set(lastSeen.keys()); // only flag pairs of accounts that both existed before the period

  // Duplicate signatures across history+period (history within the window counts too).
  const sigMap = new Map();
  const sig = (j) => j.lines.map((l) => `${l.accountCode}:${l.amountCents}`).sort().join(",");
  if (on("DUPLICATE_JOURNAL")) for (const j of [...histJournals.values()].filter((h) => dms(h.date) >= dms(from) - p.duplicateWindowDays * DAY)) {
    const s = sig(j); if (!sigMap.has(s)) sigMap.set(s, []); sigMap.get(s).push(j);
  }

  // ---- Journal-level rules ----
  for (const j of journals.values()) {
    const manual = isManual(j);
    if (j.lines.length === 1 && j.journalNo && on("SINGLE_LINE")) {
      const l = j.lines[0];
      add("SINGLE_LINE", j, { accountCode: l.accountCode, amountCents: Math.abs(l.amountCents), corrective: { lines: balancingLines(j, p.suspenseAccount, "Contra for single-sided journal") } });
    } else if (j.sum !== 0 && on("UNBALANCED_JOURNAL")) {
      add("UNBALANCED_JOURNAL", j, { amountCents: Math.abs(j.sum), detail: { differenceCents: j.sum }, corrective: { lines: balancingLines(j, p.suspenseAccount, "Balancing entry pending investigation") } });
    }
    const when = j.postedAt ? toEat(j.postedAt) : null;
    if (on("WEEKEND_HOLIDAY")) {
      const day = nonWorkingDay(when?.date || j.date, p.extraHolidays);
      if (day) add("WEEKEND_HOLIDAY", j, { detail: { day, basis: when ? "system posting time" : "accounting date" }, severity: manual && j.totalCents >= p.materialityCents ? "MEDIUM" : undefined });
    }
    if (when && on("AFTER_HOURS") && (when.hour < 7 || when.hour >= 19)) add("AFTER_HOURS", j, { detail: { postedAtEat: `${when.date} ${String(when.hour).padStart(2, "0")}:${String(when.minute).padStart(2, "0")}` }, severity: manual ? "MEDIUM" : undefined });
    if (when && on("BACKDATED")) {
      const lag = Math.round((dms(when.date) - dms(j.date)) / DAY);
      const lock = locks.get(ym(j.date));
      if (lock && j.postedAt > lock) add("BACKDATED", j, { severity: "HIGH", title: "Posted into a locked period", detail: { lagDays: lag, lockedAt: lock } });
      else if (lag > p.backdateDays) add("BACKDATED", j, { detail: { lagDays: lag } });
    }
    if (on("ROUND_AMOUNT") && j.totalCents >= p.roundMinCents && j.totalCents % p.roundUnitCents === 0) add("ROUND_AMOUNT", j, { severity: manual ? "MEDIUM" : undefined });
    if (on("JUST_BELOW_THRESHOLD") && manual && j.totalCents < p.approvalLimitCents && j.totalCents >= p.approvalLimitCents * (1 - p.belowThresholdPct / 100)) add("JUST_BELOW_THRESHOLD", j, { detail: { limitCents: p.approvalLimitCents } });
    if (on("SELF_APPROVED") && j.postedBy && j.approvedBy && String(j.postedBy).trim().toLowerCase() === String(j.approvedBy).trim().toLowerCase()) add("SELF_APPROVED", j, { detail: { user: j.postedBy }, severity: j.totalCents >= p.materialityCents ? "HIGH" : "MEDIUM" });
    // Approval workflows apply to manual journals; sub-ledger postings are approved at document level.
    if (on("MISSING_APPROVAL") && manual && anyApprover && !j.approvedBy && j.totalCents >= p.approvalLimitCents) add("MISSING_APPROVAL", j, { detail: { limitCents: p.approvalLimitCents } });
    if (on("MANUAL_TO_REVENUE_OR_CASH") && manual) {
      const hits = j.lines.filter((l) => cls(l.accountCode) === "REVENUE" || chart.get(String(l.accountCode))?.isCash);
      if (hits.length) add("MANUAL_TO_REVENUE_OR_CASH", j, { accountCode: hits[0].accountCode, severity: j.totalCents >= p.materialityCents ? "HIGH" : undefined, detail: { accounts: [...new Set(hits.map((h) => h.accountCode))] } });
    }
    if (on("VAGUE_DESCRIPTION")) {
      const vague = j.lines.filter((l) => !String(l.description || "").trim() || VAGUE_RE.test(String(l.description).trim()) || String(l.description).trim().length < 4);
      if (vague.length === j.lines.length) add("VAGUE_DESCRIPTION", j, { detail: { example: j.lines[0].description || "(blank)" } });
    }
    if (on("RARE_ACCOUNT_PAIR") && histJournals.size >= p.rareHistoryMinJournals) {
      const unseen = [...pairKeys(j)].filter((k) => !pairs.get(k));
      const real = unseen.filter((k) => { const [d, c] = k.split(">"); return known.has(d) && known.has(c); });
      if (real.length) add("RARE_ACCOUNT_PAIR", j, { fpExtra: real[0], detail: { pairs: real.slice(0, 5).map((k) => { const [d, c] = k.split(">"); return `Dr ${d} ${name(d)} / Cr ${c} ${name(c)}`; }) } });
    }
    if (on("DUPLICATE_JOURNAL") && j.lines.length >= 2) {
      const s = sig(j);
      const prior = (sigMap.get(s) || []).filter((o) => o !== j && Math.abs(dms(o.date) - dms(j.date)) <= p.duplicateWindowDays * DAY);
      if (prior.length) add("DUPLICATE_JOURNAL", j, {
        detail: { duplicateOf: prior.map((o) => o.journalNo || o.key).slice(0, 3), dates: prior.map((o) => o.date).slice(0, 3) },
        corrective: { lines: j.lines.map((l) => ({ accountCode: l.accountCode, accountName: name(l.accountCode) || l.accountName || "", description: `Reverse duplicate ${j.journalNo || j.date}`, debitCents: l.amountCents < 0 ? -l.amountCents : 0, creditCents: l.amountCents > 0 ? l.amountCents : 0 })) },
      });
      if (!sigMap.has(s)) sigMap.set(s, []); sigMap.get(s).push(j);
    }
  }

  // ---- Line / account-level rules ----
  if (on("STATISTICAL_OUTLIER")) {
    const byAcct = new Map();
    for (const l of history.concat(inPeriod)) { if (!byAcct.has(l.accountCode)) byAcct.set(l.accountCode, []); byAcct.get(l.accountCode).push(Math.abs(l.amountCents)); }
    const robust = new Map();
    for (const [a, xs] of byAcct) {
      if (xs.length < 20) continue;
      const s = Float64Array.from(xs).sort();
      const med = s[s.length >> 1];
      const dev = Float64Array.from(xs, (x) => Math.abs(x - med)).sort();
      const mad = dev[dev.length >> 1];
      if (mad > 0) robust.set(a, { med, mad });
    }
    for (const l of inPeriod) {
      const r = robust.get(l.accountCode); const x = Math.abs(l.amountCents);
      if (!r || x < p.outlierMinCents) continue;
      const z = (0.6745 * (x - r.med)) / r.mad;
      if (z >= p.outlierZ) add("STATISTICAL_OUTLIER", journals.get(journalKey(l)), { accountCode: l.accountCode, amountCents: x, entryIds: [l.id], date: l.date, fpExtra: l.id, detail: { robustZ: Math.round(z * 10) / 10, typicalCents: Math.round(r.med), line: l.description } });
    }
  }

  if (on("CUTOFF")) {
    const next = new Map();
    for (const l of inPeriod) {
      const d = +l.date.slice(8, 10);
      if (d <= 5) { const k = `${l.accountCode}|${-l.amountCents}|${ym(l.date)}`; if (!next.has(k)) next.set(k, l); }
    }
    for (const l of inPeriod) {
      const c = cls(l.accountCode);
      if (!["REVENUE", "COGS", "EXPENSE"].includes(c) || +l.date.slice(8, 10) < lastDay(l.date) - 2 || Math.abs(l.amountCents) < p.outlierMinCents) continue;
      const [y, m] = l.date.split("-").map(Number);
      const nextYm = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
      const rev = next.get(`${l.accountCode}|${l.amountCents}|${nextYm}`);
      if (rev) add("CUTOFF", journals.get(journalKey(l)), { accountCode: l.accountCode, amountCents: Math.abs(l.amountCents), entryIds: [l.id, rev.id], date: l.date, fpExtra: l.id, severity: c === "REVENUE" ? "HIGH" : undefined, detail: { reversedOn: rev.date, reversalJournal: rev.journalNo } });
    }
  }

  if (on("DORMANT_ACCOUNT")) {
    const seen = new Set();
    for (const l of inPeriod) {
      if (seen.has(l.accountCode)) continue;
      const last = lastSeen.get(l.accountCode);
      if (last && dms(from) - dms(last) > p.dormantDays * DAY) { seen.add(l.accountCode); add("DORMANT_ACCOUNT", journals.get(journalKey(l)), { accountCode: l.accountCode, amountCents: Math.abs(l.amountCents), date: l.date, fpExtra: l.accountCode, detail: { lastActivity: last } }); }
    }
  }

  if (on("SUSPENSE_BALANCE") || on("ABNORMAL_BALANCE")) {
    const susRe = new RegExp(p.suspenseRe, "i");
    for (const [code, bal] of balances) {
      if (!bal) continue;
      const acct = chart.get(String(code));
      const nm = acct?.name || "";
      if (on("SUSPENSE_BALANCE") && (susRe.test(nm) || String(code) === String(p.suspenseAccount))) {
        add("SUSPENSE_BALANCE", null, { accountCode: code, amountCents: Math.abs(bal), date: to, fpExtra: `${code}|${to}`, detail: { balanceCents: bal, account: nm } });
        continue;
      }
      const side = NORMAL_SIDE[acct?.cls];
      if (on("ABNORMAL_BALANCE") && side && Math.sign(bal) === -side && !CONTRA_RE.test(nm) && Math.abs(bal) >= p.outlierMinCents) {
        add("ABNORMAL_BALANCE", null, { accountCode: code, amountCents: Math.abs(bal), date: to, fpExtra: `${code}|${to}`, detail: { balanceCents: bal, account: nm, class: acct.cls, expected: side > 0 ? "debit" : "credit" } });
      }
    }
  }

  let benfordResult = null;
  if (on("BENFORD")) {
    benfordResult = benford(inPeriod.map((l) => Math.abs(l.amountCents)).filter((x) => x >= 1000));
    if (benfordResult.n >= 300 && benfordResult.conformity === "Nonconformity") {
      const over = benfordResult.digits.filter((d) => d.observed - d.expected > 0.01).map((d) => d.digit);
      add("BENFORD", null, { amountCents: null, date: to, fpExtra: `${from}|${to}`, detail: { mad: benfordResult.mad, n: benfordResult.n, overRepresented: over } });
    }
  }

  if (on("MISPOSTING")) {
    const flags = detectMispostings(inPeriod, history, chart, { capexThresholdCents: p.capexThresholdCents || 5_000_000 });
    for (const f of flags) {
      const l = f.line;
      add("MISPOSTING", journals.get(journalKey(l)), {
        accountCode: l.accountCode, amountCents: Math.abs(l.amountCents), entryIds: [l.id], date: l.date, fpExtra: l.id,
        severity: Math.abs(l.amountCents) >= p.materialityCents ? "HIGH" : "MEDIUM",
        suggestion: f.suggestedCode ? `Reclassify to ${f.suggestedCode} ${f.suggestedName || ""}`.trim() + ` (${f.confidence}% confidence).` : `Review: this probably belongs in a ${String(f.expectedClass).toLowerCase().replace(/_/g, " ")} account.`,
        corrective: f.suggestedCode ? { lines: reclassJournal(l, f.suggestedCode, f.suggestedName, chart) } : null,
        detail: { method: f.method, confidence: f.confidence, reasons: f.reasons, suggestedAccount: f.suggestedCode, expectedClass: f.expectedClass, line: l.description },
      });
    }
  }

  const bySev = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) bySev[f.severity]++;
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  return { findings, benford: benfordResult, stats: { lines: inPeriod.length, journals: journals.size, historyLines: history.length, findings: findings.length, bySeverity: bySev, byRule } };
}

function balancingLines(j, suspense, desc) {
  const diff = j.sum;
  if (!diff) return null;
  return [{ accountCode: String(suspense), accountName: "Suspense", description: `${desc} ${j.journalNo || ""}`.trim(), debitCents: diff < 0 ? -diff : 0, creditCents: diff > 0 ? diff : 0 }];
}

module.exports = { runJournalTests, RULES, DEFAULTS, journalKey };
