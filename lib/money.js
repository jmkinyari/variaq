// Money helpers. All amounts are integer cents to avoid floating-point drift.

/** Parse "KES 1,234.50", "(500)", "-12.3", "1 200,00" (with decimal=",") into cents, or null. */
function parseAmount(input, { decimal = "." } = {}) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/(CR|DR)$/i.test(s)) { if (/DR$/i.test(s)) negative = !negative; s = s.replace(/(CR|DR)$/i, ""); }
  s = s.replace(/[A-Za-z$€£\s]/g, "");
  if (s.endsWith("-")) { negative = !negative; s = s.slice(0, -1); }
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2)) + (Number(frac[2] || 0) >= 5 ? 1 : 0);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

function formatMoney(cents, currency = "KES", { sign = false } = {}) {
  if (cents === null || cents === undefined) return "—";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const str = (abs / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefix = neg ? "−" : sign && cents > 0 ? "+" : "";
  return `${prefix}${currency} ${str}`;
}

module.exports = { parseAmount, formatMoney };
