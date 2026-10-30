// Statistical helpers for audit analytics.

const BENFORD_EXPECTED = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));

/**
 * Benford first-digit test with Nigrini's Mean Absolute Deviation conformity ranges:
 * ≤0.006 close, ≤0.012 acceptable, ≤0.015 marginal, otherwise nonconformity.
 * Also returns per-digit z-statistics (with continuity correction).
 */
function benford(values) {
  const counts = new Array(9).fill(0);
  let n = 0;
  for (const v of values) {
    const x = Math.abs(v);
    if (!x) continue;
    const d = +String(Math.round(x))[0];
    if (d >= 1 && d <= 9) { counts[d - 1]++; n++; }
  }
  const digits = counts.map((c, i) => {
    const e = BENFORD_EXPECTED[i], o = n ? c / n : 0;
    const z = n ? Math.max(0, Math.abs(o - e) - 1 / (2 * n)) / Math.sqrt((e * (1 - e)) / n) : 0;
    return { digit: i + 1, count: c, observed: o, expected: e, z: Math.round(z * 100) / 100 };
  });
  const mad = n ? digits.reduce((a, d) => a + Math.abs(d.observed - d.expected), 0) / 9 : 0;
  const conformity = !n ? "No data" : mad <= 0.006 ? "Close conformity" : mad <= 0.012 ? "Acceptable conformity" : mad <= 0.015 ? "Marginal conformity" : "Nonconformity";
  return { n, digits, mad: Math.round(mad * 100000) / 100000, conformity, reliable: n >= 300 };
}

function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function stdev(xs) { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); }

module.exports = { benford, median, mean, stdev, BENFORD_EXPECTED };
