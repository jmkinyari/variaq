// Completeness and integrity tests over the ledger — "is everything that should be in the books
// there, exactly once, in the right period?" Pure functions over pre-aggregated data so they can be
// unit-tested and fed from the database, an ERP connector or an upload alike.
// Each test returns { id, title, status: PASS|WARN|FAIL|SKIP, summary, details[], actions[] }.

const result = (id, title, status, summary, details = [], actions = []) => ({ id, title, status, summary, details, actions });

/** Sequence gaps and duplicates in document numbers, per prefix (e.g. JV-000123, INV2026/0042). */
function sequenceGaps(numbers, { minSeries = 10, maxGapReport = 50, maxSpan = 20000 } = {}) {
  const series = new Map();
  const dupes = new Map();
  const seen = new Set();
  for (const raw of numbers) {
    const s = String(raw || "").trim();
    if (!s) continue;
    if (seen.has(s)) dupes.set(s, (dupes.get(s) || 1) + 1); else seen.add(s);
    const m = s.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const key = `${m[1]}#${m[2].length}`;
    if (!series.has(key)) series.set(key, { prefix: m[1], width: m[2].length, nums: [] });
    series.get(key).nums.push(Number(m[2]));
  }
  const out = [];
  for (const sr of series.values()) {
    if (sr.nums.length < minSeries) continue;
    const nums = [...new Set(sr.nums)].sort((a, b) => a - b);
    const gaps = [];
    let missing = 0;
    for (let i = 1; i < nums.length; i++) {
      const d = nums[i] - nums[i - 1];
      if (d > 1 && d <= maxSpan) { missing += d - 1; if (gaps.length < maxGapReport) gaps.push(d === 2 ? fmt(sr, nums[i - 1] + 1) : `${fmt(sr, nums[i - 1] + 1)} – ${fmt(sr, nums[i] - 1)}`); }
    }
    out.push({ prefix: sr.prefix || "(no prefix)", first: fmt(sr, nums[0]), last: fmt(sr, nums[nums.length - 1]), count: nums.length, missing, gaps });
  }
  return { series: out, duplicates: [...dupes].map(([n, c]) => ({ number: n, count: c })).slice(0, 100) };
}
const fmt = (sr, n) => `${sr.prefix}${String(n).padStart(sr.width, "0")}`;

function sequenceTest(id, title, numbers, unit) {
  const r = sequenceGaps(numbers);
  if (!r.series.length) return result(id, title, "SKIP", `Not enough numbered ${unit} to test a sequence (need 10+ in a series).`);
  const missing = r.series.reduce((a, s) => a + s.missing, 0);
  const details = r.series.map((s) => `${s.prefix}: ${s.first} → ${s.last}, ${s.count} present, ${s.missing} missing${s.gaps.length ? ` (${s.gaps.slice(0, 8).join(", ")}${s.gaps.length > 8 ? ", …" : ""})` : ""}`);
  if (r.duplicates.length) details.push(`Duplicate numbers: ${r.duplicates.slice(0, 10).map((d) => `${d.number} ×${d.count}`).join(", ")}`);
  const status = missing || r.duplicates.length ? (missing > 20 || r.duplicates.length > 5 ? "FAIL" : "WARN") : "PASS";
  return result(id, title, status, status === "PASS" ? `All ${unit} numbers are in unbroken sequences.` : `${missing} missing and ${r.duplicates.length} duplicated ${unit} number(s).`, details,
    status === "PASS" ? [] : [`Obtain explanations for missing ${unit} numbers (cancelled, voided, or not exported?) and check the ERP's void register.`, "Confirm duplicates are not double postings; reverse any true duplicates."]);
}

/** Opening TB + GL movements = closing TB, per account. Maps code -> cents. */
function rollforward({ opening, movements, closing, names = new Map(), toleranceCents = 100 }) {
  const codes = new Set([...opening.keys(), ...movements.keys(), ...closing.keys()]);
  const diffs = [];
  for (const c of codes) {
    const expected = (opening.get(c) || 0) + (movements.get(c) || 0);
    const actual = closing.get(c) || 0;
    if (Math.abs(expected - actual) > toleranceCents) diffs.push({ code: c, name: names.get(c) || "", openingCents: opening.get(c) || 0, movementCents: movements.get(c) || 0, expectedCents: expected, closingCents: actual, diffCents: actual - expected });
  }
  return diffs.sort((a, b) => Math.abs(b.diffCents) - Math.abs(a.diffCents));
}

const RECURRING_RE = /(rent|salar|wage|payroll|depreciation|amortis|electric|kplc|water|internet|telephone|insurance|security|cleaning|service charge|paye|nssf|shif|housing levy|interest|lease)/i;
/**
 * Monthly postings that normally happen but are missing in `targetYm`.
 * monthly: Map(code -> Map(ym -> {n, cents})) ; names: Map(code -> name)
 */
function missingRecurring(monthly, targetYm, names = new Map()) {
  const prev = [1, 2, 3, 4].map((k) => shiftYm(targetYm, -k));
  const out = [];
  for (const [code, byYm] of monthly) {
    const present = prev.filter((m) => byYm.get(m)?.n);
    if (present.length < 3 || byYm.get(targetYm)?.n) continue;
    const nm = names.get(code) || "";
    const typical = Math.round(present.reduce((a, m) => a + Math.abs(byYm.get(m).cents), 0) / present.length);
    out.push({ code, name: nm, typicalCents: typical, keyword: RECURRING_RE.test(nm), monthsSeen: present });
  }
  return out.sort((a, b) => (b.keyword - a.keyword) || b.typicalCents - a.typicalCents);
}
function shiftYm(ym, k) { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); }

/** Month volumes vs trailing average. stats: [{ym, n, drCents}] sorted ascending. */
function volumeAnomalies(stats, { lowPct = 50, highPct = 200 } = {}) {
  const out = [];
  for (let i = 3; i < stats.length; i++) {
    const trail = stats.slice(Math.max(0, i - 6), i);
    const avgN = trail.reduce((a, s) => a + s.n, 0) / trail.length;
    const avgV = trail.reduce((a, s) => a + s.drCents, 0) / trail.length;
    const s = stats[i];
    const pn = avgN ? (s.n / avgN) * 100 : 100, pv = avgV ? (s.drCents / avgV) * 100 : 100;
    if (pn < lowPct || pn > highPct || pv < lowPct || pv > highPct) out.push({ ym: s.ym, n: s.n, avgN: Math.round(avgN), drCents: s.drCents, avgDrCents: Math.round(avgV), countPct: Math.round(pn), valuePct: Math.round(pv) });
  }
  return out;
}

/**
 * Run the full completeness suite.
 * data: { journalNumbers[], invoiceNumbers[], tb?: {opening, closing, movements, names, label}, monthly, targetYm,
 *         monthStats[], futureDated[], outsideYear[], glNotInChart[], chartNotInGl[], chartLabel, bank[] }
 */
function runCompleteness(data) {
  const tests = [];
  tests.push(sequenceTest("JOURNAL_SEQUENCE", "Journal number sequence", data.journalNumbers || [], "journal"));
  tests.push(sequenceTest("INVOICE_SEQUENCE", "Invoice / reference number sequence", data.invoiceNumbers || [], "invoice"));

  if (data.tb) {
    const diffs = rollforward(data.tb);
    tests.push(result("TB_ROLLFORWARD", `Trial balance roll-forward (${data.tb.label})`, diffs.length ? "FAIL" : "PASS",
      diffs.length ? `${diffs.length} account(s) where opening balance + ledger movements ≠ closing trial balance.` : "Opening balances plus ledger movements agree to the closing trial balance for every account.",
      diffs.slice(0, 30).map((d) => `${d.code} ${d.name}: expected ${money(d.expectedCents)}, TB shows ${money(d.closingCents)} (difference ${money(d.diffCents)})`),
      diffs.length ? ["Export the missing journals for these accounts from the ERP (the ledger extract is probably incomplete) or explain TB adjustments made outside the GL."] : []));
  } else tests.push(result("TB_ROLLFORWARD", "Trial balance roll-forward", "SKIP", "Upload opening and closing trial balances (Data hub → Trial balance) to prove the ledger extract is complete."));

  if (data.targetYm && data.monthly) {
    const miss = missingRecurring(data.monthly, data.targetYm, data.names);
    tests.push(result("RECURRING_POSTINGS", `Recurring postings in ${data.targetYm}`, miss.some((m) => m.keyword) ? "FAIL" : miss.length ? "WARN" : "PASS",
      miss.length ? `${miss.length} account(s) posted in at least 3 of the previous 4 months have nothing in ${data.targetYm}.` : "Every regularly-posted account has activity this month.",
      miss.slice(0, 25).map((m) => `${m.code} ${m.name} — usually about ${money(m.typicalCents)} a month`),
      miss.length ? ["Check whether rent, payroll, depreciation, utilities and other accruals were posted for the month; post accruals for missing items."] : []));
  }

  if (data.monthStats?.length >= 4) {
    const an = volumeAnomalies(data.monthStats);
    tests.push(result("VOLUME", "Monthly volume vs trend", an.length ? "WARN" : "PASS",
      an.length ? `${an.length} month(s) with unusual entry counts or values compared with the trailing average.` : "Monthly entry counts and values are in line with the trend.",
      an.map((a) => `${a.ym}: ${a.n} lines (${a.countPct}% of average ${a.avgN}), debits ${money(a.drCents)} (${a.valuePct}% of average)`),
      an.length ? ["A sharp drop often means an incomplete extract or unposted batches; a spike may mean duplicates. Compare with ERP record counts."] : []));
  }

  const fut = data.futureDated || [], oy = data.outsideYear || [];
  tests.push(result("DATE_INTEGRITY", "Dates within range", fut.length || oy.length ? "WARN" : "PASS",
    fut.length || oy.length ? `${fut.length} future-dated and ${oy.length} out-of-year entries.` : "No future-dated or out-of-range entries.",
    [...fut.slice(0, 10).map((e) => `Future: ${e.date} ${e.journalNo || ""} ${e.description}`), ...oy.slice(0, 10).map((e) => `Out of year: ${e.date} ${e.journalNo || ""} ${e.description}`)],
    fut.length || oy.length ? ["Correct mis-keyed dates in the ERP; future-dated entries distort period reporting."] : []));

  if (data.chartLabel) {
    const a = data.glNotInChart || [], b = data.chartNotInGl || [];
    tests.push(result("CHART_COVERAGE", `Ledger accounts vs chart “${data.chartLabel}”`, a.length ? "FAIL" : b.length ? "WARN" : "PASS",
      a.length ? `${a.length} account(s) used in the ledger are not in the chart.` : b.length ? `All ledger accounts are in the chart; ${b.length} chart account(s) are unused.` : "Ledger and chart agree.",
      [...a.slice(0, 20).map((x) => `In ledger, not in chart: ${x}`), ...b.slice(0, 10).map((x) => `In chart, never used: ${x}`)],
      a.length ? ["Add the accounts to the chart (or map them) so they report in the right line."] : []));
  }

  if (data.bank?.length) {
    const off = data.bank.filter((b) => b.stmtBalanceCents !== null && b.ledgerBalanceCents !== b.stmtBalanceCents);
    tests.push(result("BANK_VS_LEDGER", "Bank statements vs ledger", off.length ? "WARN" : "PASS",
      off.length ? `${off.length} bank account(s) where the ledger balance differs from the latest statement balance.` : "Ledger cash balances agree with the latest statement balances.",
      data.bank.map((b) => `${b.name} (${b.code}): ledger ${money(b.ledgerBalanceCents)} vs statement ${b.stmtBalanceCents === null ? "—" : money(b.stmtBalanceCents)} on ${b.stmtDate || "—"}`),
      off.length ? ["Complete the bank reconciliation; differences should be explained only by timing items (uncleared cheques, deposits in transit)."] : []));
  }
  const score = tests.filter((t) => t.status !== "SKIP");
  return { tests, summary: { pass: score.filter((t) => t.status === "PASS").length, warn: score.filter((t) => t.status === "WARN").length, fail: score.filter((t) => t.status === "FAIL").length, skipped: tests.length - score.length } };
}

const money = (c) => `${c < 0 ? "−" : ""}${(Math.abs(c) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

module.exports = { runCompleteness, sequenceGaps, rollforward, missingRecurring, volumeAnomalies, shiftYm };
