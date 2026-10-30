// Date parsing for imported statements. Output is always "YYYY-MM-DD".
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE_FORMATS = [
  { value: "YYYY-MM-DD", label: "2026-04-30 (YYYY-MM-DD)" },
  { value: "DD/MM/YYYY", label: "30/04/2026 (DD/MM/YYYY)" },
  { value: "MM/DD/YYYY", label: "04/30/2026 (MM/DD/YYYY)" },
  { value: "DD-MMM-YYYY", label: "30-Apr-2026 (DD-MMM-YYYY)" },
];

function valid(y, m, d) {
  if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDate(input, format = "YYYY-MM-DD") {
  if (!input) return null;
  const s = String(input).trim().split(/[ T]/)[0];
  let m;
  if (format === "YYYY-MM-DD" && (m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return valid(+m[1], +m[2], +m[3]);
  if ((format === "DD/MM/YYYY" || format === "MM/DD/YYYY") && (m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    let y = +m[3]; if (y < 100) y += 2000;
    return format === "DD/MM/YYYY" ? valid(y, +m[2], +m[1]) : valid(y, +m[1], +m[2]);
  }
  if (format === "DD-MMM-YYYY" && (m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,4})[-\s/](\d{2,4})$/))) {
    const mon = MONTHS[m[2].toLowerCase()]; let y = +m[3]; if (y < 100) y += 2000;
    return mon ? valid(y, mon, +m[1]) : null;
  }
  return null;
}

/** Guess the date format from sample values. */
function detectDateFormat(samples) {
  const vals = samples.filter(Boolean).slice(0, 50);
  let best = "YYYY-MM-DD", bestScore = -1;
  for (const f of DATE_FORMATS) {
    const score = vals.filter((v) => parseDate(v, f.value)).length;
    if (score > bestScore) { best = f.value; bestScore = score; }
  }
  return best;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function isWeekend(d) { const day = new Date(d + "T00:00:00Z").getUTCDay(); return day === 0 || day === 6; }
function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? d + "T00:00:00Z" : d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
}

module.exports = { parseDate, detectDateFormat, daysBetween, isWeekend, formatDate, formatDateTime, DATE_FORMATS };
