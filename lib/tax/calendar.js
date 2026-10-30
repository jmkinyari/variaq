// Compliance calendar: statutory due dates per period with weekend/public-holiday roll-forward,
// and a penalty & interest estimator. Pure.
const { OBLIGATIONS, PENALTIES, FIXED_HOLIDAYS, MOVABLE_HOLIDAYS } = require("./kenya");

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(s + "T00:00:00Z");
function isHoliday(dateIso) {
  if (MOVABLE_HOLIDAYS.includes(dateIso)) return true;
  if (FIXED_HOLIDAYS.includes(dateIso.slice(5))) return true;
  // Gazetted rule: a holiday falling on Sunday is observed on Monday.
  const prev = iso(new Date(utc(dateIso).getTime() - 86400000));
  return utc(prev).getUTCDay() === 0 && (FIXED_HOLIDAYS.includes(prev.slice(5)) || MOVABLE_HOLIDAYS.includes(prev));
}
const isWorkingDay = (dateIso) => { const d = utc(dateIso).getUTCDay(); return d !== 0 && d !== 6 && !isHoliday(dateIso); };
/** Move a due date on a weekend/holiday to the next working day. */
function rollForward(dateIso) {
  let d = dateIso;
  for (let i = 0; i < 10 && !isWorkingDay(d); i++) d = iso(new Date(utc(d).getTime() + 86400000));
  return d;
}
function addWorkingDays(dateIso, n) {
  let d = dateIso, k = 0;
  while (k < n) { d = iso(new Date(utc(d).getTime() + 86400000)); if (isWorkingDay(d)) k++; }
  return d;
}
const nextMonthDay = (ym, day) => { const [y, m] = ym.split("-").map(Number); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return iso(new Date(Date.UTC(y, m, Math.min(day, last)))); };

/**
 * Obligations for a tax period (YYYY-MM). fyEndMonth: 1–12 (default 12). flags: { vat, paye, wht, whvatAgent, tot }
 * Returns [{ code, name, period, statutory, due, rolled, source, unverified, note }].
 */
function obligationsFor(period, { fyEndMonth = 12, flags = {} } = {}) {
  const f = { vat: true, paye: true, wht: true, whvatAgent: false, tot: false, ...flags };
  const out = [];
  const push = (o, statutory, extra = {}) => { const due = rollForward(statutory); out.push({ code: o.code, name: o.name, period, statutory, due, rolled: due !== statutory, source: o.source, unverified: !!o.unverified, note: o.note || "", ...extra }); };
  for (const o of OBLIGATIONS) {
    if (o.code === "VAT3" && !f.vat) continue;
    if ((o.code === "PAYE" || o.code === "SHIF") && !f.paye) continue;
    if (o.code === "WHT" && !f.wht) continue;
    if (o.code === "TOT" && !f.tot) continue;
    if (o.code === "WHVAT") { if (f.whvatAgent) out.push({ code: o.code, name: o.name, period, statutory: null, due: null, rule: "Within 5 working days of each deduction", source: o.source, unverified: false, note: o.note }); continue; }
    if (o.code === "INSTALMENT") {
      // Months 4, 6, 9, 12 of the financial year; fyEndMonth 12 → Apr, Jun, Sep, Dec.
      const [y, m] = period.split("-").map(Number);
      const fyMonth = ((m - fyEndMonth - 1 + 24) % 12) + 1;
      if (o.fyMonths.includes(fyMonth)) push(o, `${period}-20`, { note: `Instalment ${o.fyMonths.indexOf(fyMonth) + 1} of 4 for the financial year.` });
      continue;
    }
    if (o.code === "IT2C") {
      const [y, m] = period.split("-").map(Number);
      if (m === fyEndMonth) { const d = new Date(Date.UTC(y, m - 1 + o.monthsAfterYearEnd + 1, 0)); push(o, iso(d), { note: "Due within 6 months of the financial year end." }); }
      continue;
    }
    push(o, nextMonthDay(period, o.day));
  }
  return out.sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
}

/** Months between due date and the payment date, rounded up (interest accrues per month or part). */
function monthsLate(due, paidOn) {
  if (!due || !paidOn || paidOn <= due) return 0;
  const a = utc(due), b = utc(paidOn);
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() > a.getUTCDate()) m += 1;
  return Math.max(1, m);
}

/**
 * Estimate penalty + interest. taxCents: tax due; filedOn / paidOn: ISO dates (null = not yet → today).
 * Returns { lateFilingCents, latePaymentCents, interestCents, totalCents, lines, source }.
 */
function estimatePenalty(code, { taxCents = 0, due, filedOn, paidOn, today = new Date().toISOString().slice(0, 10), individual = false } = {}) {
  const p = PENALTIES[code];
  if (!p) return null;
  const filed = filedOn || today, paid = paidOn || today;
  const lines = [];
  let lateFiling = 0, latePayment = 0, interest = 0;
  if (p.lateFiling && filed > due) {
    lateFiling = Math.max(Math.round(taxCents * p.lateFiling.pct / 100), (p.lateFiling.minKes || 0) * 100);
    lines.push(`Late filing: higher of ${p.lateFiling.pct}% of tax or KES ${(p.lateFiling.minKes || 0).toLocaleString()}`);
  }
  if (p.lateFilingFlatMonthlyKes && filed > due) {
    lateFiling = monthsLate(due, filed) * p.lateFilingFlatMonthlyKes * 100;
    lines.push(`Late filing: KES ${p.lateFilingFlatMonthlyKes.toLocaleString()} per month`);
  }
  if (p.latePayment && paid > due && taxCents > 0) {
    latePayment = Math.round(taxCents * p.latePayment.pct / 100);
    const months = monthsLate(due, paid);
    interest = Math.round(taxCents * (p.latePayment.interestMonthlyPct || 0) / 100 * months);
    lines.push(`Late payment: ${p.latePayment.pct}% of tax${p.latePayment.interestMonthlyPct ? ` + interest ${p.latePayment.interestMonthlyPct}% per month × ${months}` : ""}`);
  }
  if (p.latePaymentMonthlyPct && paid > due && taxCents > 0) {
    const months = monthsLate(due, paid);
    interest = Math.round(taxCents * p.latePaymentMonthlyPct / 100 * months);
    lines.push(`Late payment: ${p.latePaymentMonthlyPct}% per month × ${months}`);
  }
  if (code === "ETIMS") {
    latePayment = Math.max(Math.round(taxCents * p.pct / 100), (individual ? p.minKesIndividual : p.minKesCompany) * 100);
    lines.push(`eTIMS non-compliance: higher of ${p.pct}% of tax or KES ${(individual ? p.minKesIndividual : p.minKesCompany).toLocaleString()}`);
  }
  return { lateFilingCents: lateFiling, latePaymentCents: latePayment, interestCents: interest, totalCents: lateFiling + latePayment + interest, lines, source: p.source, unverified: !!p.unverified };
}

module.exports = { obligationsFor, estimatePenalty, rollForward, isWorkingDay, addWorkingDays, monthsLate, isHoliday };
