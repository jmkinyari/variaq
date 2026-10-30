// Identifier normalisation shared by tax importers and the matcher. Pure.
const { PIN_RE, VAT } = require("./kenya");

/** Invoice key for matching: uppercase, no spaces/punctuation, leading zeros removed. */
function invoiceKey(v) {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.replace(/^0+(?=.)/, "") || null;
}
const normPin = (v) => (v ? String(v).toUpperCase().replace(/[^A-Z0-9]/g, "") : null);
const validPin = (v) => PIN_RE.test(normPin(v) || "");
const pinType = (v) => (!validPin(v) ? null : normPin(v)[0] === "A" ? "INDIVIDUAL" : "NON_INDIVIDUAL");
const invoiceNoTooLong = (v) => String(v ?? "").length > VAT.invoiceNoMaxLen.value;

function levenshtein(a, b, max = 3) {
  a = String(a); b = String(b);
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Credit-note detection: negative value, document type text, or a reference to an original invoice. */
function isCreditNote({ docType, taxableCents, vatCents, relatedInvoice }) {
  if (/credit|cn\b|refund|return/i.test(String(docType || ""))) return true;
  if ((taxableCents || 0) < 0 || (vatCents || 0) < 0) return true;
  return !!relatedInvoice && (taxableCents || 0) <= 0;
}

const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

module.exports = { invoiceKey, normPin, validPin, pinType, invoiceNoTooLong, levenshtein, isCreditNote, monthEnd, addMonths };
