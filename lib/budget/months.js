// Map uploaded month columns/labels onto budget-year positions (0–11). Pure.
const { fyMonths } = require("./engine");

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Budget-year index for a spec from ingest/clean.monthColumns ({ym} | {position} | {monthIdx, year}), or -1. */
function fyIndex(spec, fyStart) {
  const months = fyMonths(fyStart);
  const startMonth = Number(fyStart.slice(5)) - 1;
  if (spec.ym) return months.indexOf(spec.ym);
  if (spec.position !== undefined) return spec.position;
  if (spec.monthIdx !== undefined) {
    if (spec.year) return months.indexOf(`${spec.year}-${String(spec.monthIdx + 1).padStart(2, "0")}`);
    return (spec.monthIdx - startMonth + 12) % 12;
  }
  return -1;
}

/** Long-format month value: "2026-03", "Mar", "March 2026", "Mar-26", "3", "M3", "P3". */
function parseMonthLabel(v, fyStart) {
  const s = String(v || "").trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})/))) return fyIndex({ ym: `${m[1]}-${m[2].padStart(2, "0")}` }, fyStart);
  if ((m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-/']*(\d{2,4})?$/))) return fyIndex({ monthIdx: MONTH_NAMES.indexOf(m[1]), year: m[2] ? (m[2].length === 2 ? 2000 + +m[2] : +m[2]) : null }, fyStart);
  if ((m = s.match(/^(?:m|p|month|period)?\s*(\d{1,2})$/)) && +m[1] >= 1 && +m[1] <= 12) return +m[1] - 1;
  return -1;
}

module.exports = { fyIndex, parseMonthLabel };
