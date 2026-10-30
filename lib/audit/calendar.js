// Kenyan public-holiday calendar and East Africa Time helpers for journal testing.
// Fixed holidays per the Public Holidays Act (as amended); a holiday falling on a Sunday is observed
// on the Monday. Movable Christian holidays are computed; Eid dates depend on moon sighting and are
// gazetted each year, so pass them in via `extra` (ISO dates).

function easterSunday(y) {
  // Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const FIXED = [["01-01", "New Year's Day"], ["05-01", "Labour Day"], ["06-01", "Madaraka Day"], ["10-10", "Mazingira Day"], ["10-20", "Mashujaa Day"], ["12-12", "Jamhuri Day"], ["12-25", "Christmas Day"], ["12-26", "Boxing Day"]];

const cache = new Map();
/** Map(isoDate -> holiday name) for a year. `extra` = [{date, name}] e.g. Eid al-Fitr, gazetted days. */
function kenyaHolidays(year, extra = []) {
  const key = `${year}|${extra.map((e) => e.date).join(",")}`;
  if (cache.has(key)) return cache.get(key);
  const out = new Map();
  for (const [md, name] of FIXED) {
    const d = new Date(`${year}-${md}T00:00:00Z`);
    out.set(iso(d), name);
    if (d.getUTCDay() === 0) out.set(iso(addDays(d, 1)), `${name} (observed)`);
  }
  const easter = easterSunday(year);
  out.set(iso(addDays(easter, -2)), "Good Friday");
  out.set(iso(addDays(easter, 1)), "Easter Monday");
  for (const e of extra) if (String(e.date).startsWith(String(year))) out.set(e.date, e.name || "Public holiday");
  cache.set(key, out);
  return out;
}

/** Holiday name or "Saturday"/"Sunday" for an ISO date, else null. */
function nonWorkingDay(isoDate, extra = []) {
  if (!isoDate) return null;
  const d = new Date(isoDate.slice(0, 10) + "T00:00:00Z");
  if (isNaN(d)) return null;
  const h = kenyaHolidays(d.getUTCFullYear(), extra).get(isoDate.slice(0, 10));
  if (h) return h;
  const wd = d.getUTCDay();
  return wd === 0 ? "Sunday" : wd === 6 ? "Saturday" : null;
}

/** Convert an ISO timestamp to East Africa Time (UTC+3, no DST) → { date, hour, minute }. */
function toEat(ts) {
  const ms = Date.parse(ts);
  if (isNaN(ms)) return null;
  const d = new Date(ms + 3 * 3600000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

module.exports = { easterSunday, kenyaHolidays, nonWorkingDay, toEat };
