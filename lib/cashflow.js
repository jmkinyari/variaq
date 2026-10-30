// 13-week cash flow forecast. Pure functions shared by the server (actuals) and the browser
// (live recalculation as assumptions change). Weeks run Monday–Sunday. Amounts are cents.
const { CF_CATEGORIES, CF_ORDER } = require("./statements");
const { normalizeMonthly } = require("./forecast/monthly");

const DAY = 86400000;
const toDate = (iso) => new Date(iso + "T00:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => iso(new Date(toDate(isoDate).getTime() + n * DAY));
/** Monday of the week containing the date. */
function weekStart(isoDate) { const d = toDate(isoDate); const dow = (d.getUTCDay() + 6) % 7; return addDays(isoDate, -dow); }

/** count weeks starting at `start` (a Monday). */
function weekList(start, count) { return Array.from({ length: count }, (_, i) => { const s = addDays(start, i * 7); return { start: s, end: addDays(s, 6) }; }); }

/** Sum classified flows into weeks: returns {CAT: [cents per week]} */
function bucketFlows(flows, weeks) {
  const out = Object.fromEntries(CF_ORDER.map((k) => [k, weeks.map(() => 0)]));
  if (!weeks.length) return out;
  const first = weeks[0].start;
  for (const f of flows) {
    const i = Math.floor((toDate(f.date) - toDate(first)) / (7 * DAY));
    if (i >= 0 && i < weeks.length && out[f.category]) out[f.category][i] += f.amount;
  }
  return out;
}

const SCENARIOS = { BASE: "Base", BEST: "Best", WORST: "Worst" };
const isInflow = (k) => CF_CATEGORIES[k].group === "IN";
const isOutflow = (k) => CF_CATEGORIES[k].group === "OUT";

function defaultScenario(kind) {
  const r = kind === "BEST" ? 10 : kind === "WORST" ? -15 : 0; // receipts adjustment %
  const p = kind === "BEST" ? -5 : kind === "WORST" ? 10 : 0;  // payments adjustment %
  return {
    adj: Object.fromEntries(CF_ORDER.map((k) => [k, isInflow(k) ? r : isOutflow(k) ? p : 0])),
    growth: 0,                        // % compounding per week applied to every line
    receiptLag: kind === "WORST" ? 1 : 0, // weeks of delayed customer collections
    overrides: {},                    // "CAT|YYYY-MM-DD" -> cents (manual cell values)
  };
}

function defaultSettings() {
  return { lookback: 3, minCash: 0, scenarios: { BASE: defaultScenario("BASE"), BEST: defaultScenario("BEST"), WORST: defaultScenario("WORST") }, actualOverrides: {}, monthly: normalizeMonthly({}) };
}

// Corrections to ACTUAL weeks (e.g. a receipt posted to the wrong week, or a known misclassification).
// Shared by every scenario, each needs a note, and they also feed the run-rate. "CAT|YYYY-MM-DD" -> {cents, note, by, at}
function normalizeActualOverrides(o) {
  const out = {};
  for (const [key, v] of Object.entries(o || {})) {
    if (!/^[A-Z_]+\|\d{4}-\d{2}-\d{2}$/.test(key) || !CF_CATEGORIES[key.split("|")[0]] || !v || !Number.isFinite(+v.cents)) continue;
    const note = String(v.note || "").trim().slice(0, 300);
    if (!note) continue;
    out[key] = { cents: Math.round(+v.cents), note, by: v.by ? String(v.by).slice(0, 80) : null, at: v.at ? String(v.at).slice(0, 30) : null };
  }
  return out;
}

/** Fill gaps in saved settings so older/partial JSON always works. */
function normalizeSettings(s) {
  const d = defaultSettings();
  const out = { lookback: clampInt(s?.lookback, 1, 13, d.lookback), minCash: Number.isFinite(+s?.minCash) ? Math.round(+s.minCash) : 0, scenarios: {}, actualOverrides: normalizeActualOverrides(s?.actualOverrides), monthly: normalizeMonthly(s?.monthly) };
  for (const k of Object.keys(SCENARIOS)) {
    const src = s?.scenarios?.[k] || {}, def = d.scenarios[k];
    out.scenarios[k] = {
      adj: Object.fromEntries(CF_ORDER.map((c) => [c, Number.isFinite(+src.adj?.[c]) ? +src.adj[c] : def.adj[c]])),
      growth: Number.isFinite(+src.growth) ? +src.growth : def.growth,
      receiptLag: clampInt(src.receiptLag, 0, 12, def.receiptLag),
      overrides: Object.fromEntries(Object.entries(src.overrides || {}).filter(([key, v]) => /^[A-Z_]+\|\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(+v)).map(([key, v]) => [key, Math.round(+v)])),
    };
  }
  return out;
}
function clampInt(v, lo, hi, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }

/**
 * model: { history: [{start,end}] (oldest first, ends the week before the forecast),
 *          actuals: {CAT: [cents per history week]}, openingBeforeHistory: cents,
 *          forecastWeeks: [{start,end}] }
 * Returns per-scenario { baseline, rows: {CAT: [values for shown actual + forecast weeks]}, totals..., closing[] }
 */
function computeForecast(model, settings, { showActual = 3 } = {}) { // eslint-disable-line no-param-reassign
  const s = normalizeSettings(settings);
  const H = model.history.length;
  // Apply corrections to actual weeks first so the run-rate and opening balance use them too.
  const rawActuals = model.actuals;
  const actuals = Object.fromEntries(CF_ORDER.map((k) => [k, model.history.map((w, i) => {
    const o = s.actualOverrides[`${k}|${w.start}`];
    return o ? o.cents : rawActuals[k]?.[i] || 0;
  })]));
  model = { ...model, actuals };
  const L = Math.min(s.lookback, H) || 1;
  const baseline = Object.fromEntries(CF_ORDER.map((k) => [k, Math.round((model.actuals[k] || []).slice(H - L).reduce((a, x) => a + x, 0) / L)]));
  const shown = Math.min(showActual, H);
  const actualIdx = Array.from({ length: shown }, (_, i) => H - shown + i);
  let opening = model.openingBeforeHistory;
  for (let i = 0; i < H - shown; i++) for (const k of CF_ORDER) opening += model.actuals[k]?.[i] || 0;
  const actualWeeks = actualIdx.map((i) => ({ ...model.history[i], actual: true }));
  const weeks = [...actualWeeks, ...model.forecastWeeks.map((w) => ({ ...w, actual: false }))];

  const result = {};
  for (const sc of Object.keys(SCENARIOS)) {
    const p = s.scenarios[sc];
    const rows = {}, computed = {}, overridden = {}, actualOverridden = {}, actualOriginal = {};
    for (const k of CF_ORDER) {
      const act = actualIdx.map((i) => model.actuals[k]?.[i] || 0);
      actualOverridden[k] = actualIdx.map((i) => Object.prototype.hasOwnProperty.call(s.actualOverrides, `${k}|${model.history[i].start}`));
      actualOriginal[k] = actualIdx.map((i) => rawActuals[k]?.[i] || 0);
      const fc = model.forecastWeeks.map((w, j) => {
        const n = j + 1;
        let v = baseline[k] * (1 + (p.adj[k] || 0) / 100) * Math.pow(1 + (p.growth || 0) / 100, n);
        if (k === "CUSTOMER_RECEIPTS" && n <= p.receiptLag) v = 0;
        return Math.round(v);
      });
      computed[k] = fc;
      overridden[k] = model.forecastWeeks.map((w) => Object.prototype.hasOwnProperty.call(p.overrides, `${k}|${w.start}`));
      rows[k] = [...act, ...fc.map((v, j) => overridden[k][j] ? p.overrides[`${k}|${model.forecastWeeks[j].start}`] : v)];
    }
    const n = weeks.length;
    const col = (pred) => Array.from({ length: n }, (_, i) => CF_ORDER.filter(pred).reduce((a, k) => a + rows[k][i], 0));
    const inflows = col(isInflow), outflows = col(isOutflow), financing = col((k) => CF_CATEGORIES[k].group === "FIN");
    const net = inflows.map((v, i) => v + outflows[i] + financing[i]);
    const openingArr = [], closing = [];
    let bal = opening;
    for (let i = 0; i < n; i++) { openingArr.push(bal); bal += net[i]; closing.push(bal); }
    const fStart = shown;
    const fClosing = closing.slice(fStart);
    let low = { value: fClosing.length ? fClosing[0] : bal, week: weeks[fStart]?.start };
    fClosing.forEach((v, i) => { if (v < low.value) low = { value: v, week: weeks[fStart + i].start }; });
    result[sc] = {
      rows, computed, overridden, actualOverridden, actualOriginal, inflows, outflows, financing, net, opening: openingArr, closing,
      summary: {
        startCash: openingArr[fStart] ?? bal, endCash: closing[n - 1] ?? bal,
        forecastNet: net.slice(fStart).reduce((a, x) => a + x, 0),
        lowest: low, weeksBelowMin: fClosing.filter((v) => v < s.minCash).length,
      },
    };
  }
  return { weeks, baseline, actualCount: shown, scenarios: result, settings: s };
}

/** Pick the default first forecast week: this week if the ledger is current, else the week after the latest entry. */
function defaultAnchor(latestLedgerDate, today = iso(new Date())) {
  const thisWeek = weekStart(today);
  if (!latestLedgerDate) return thisWeek;
  if (latestLedgerDate >= addDays(thisWeek, -21)) return thisWeek;
  return addDays(weekStart(latestLedgerDate), 7);
}

module.exports = { normalizeActualOverrides, SCENARIOS, weekStart, weekList, addDays, bucketFlows, defaultSettings, normalizeSettings, computeForecast, defaultAnchor };
