// VAT reconciliation: ERP registers vs KRA iTax/eTIMS auto-populated data. Pure functions.
//
// A document (either source):
//   { id, source: "ERP"|"ITAX", period: "YYYY-MM", pin, counterparty, invoiceNo, invoiceKey, cuInvoiceNo,
//     date, docType: "INVOICE"|"CREDIT_NOTE", relatedInvoice, taxableCents, vatCents, rateCode, description }
//
// Matching runs in passes, each only over documents still unmatched:
//   1 EXACT  — same PIN and same invoice key (ERP invoice no. or its eTIMS CU number)
//   2 KEY    — same invoice key, taxable value within tolerance (PIN missing/different)
//   3 PIN    — same PIN, taxable value within tolerance, dates within ±7 days (closest wins)
//   4 FUZZY  — invoice keys within edit distance 2 or one is a suffix of the other, value within tolerance
// Pairs are then classified (PIN_MISMATCH > AMOUNT_MISMATCH > VAT_MISMATCH > DATE_PERIOD_MISMATCH > MATCHED);
// leftovers are MISSING_IN_ITAX (ERP only) or MISSING_IN_ERP (iTax only). Every item carries
// document-level issues and a concrete action point.
const { invoiceKey, normPin, validPin, invoiceNoTooLong, levenshtein, monthEnd, addMonths } = require("./keys");
const { VAT, WHVAT } = require("./kenya");

const STATUS = {
  MATCHED: { label: "Matched", tone: "good", severity: 0 },
  DATE_PERIOD_MISMATCH: { label: "Different period", tone: "warn", severity: 1 },
  VAT_MISMATCH: { label: "VAT differs", tone: "bad", severity: 2 },
  AMOUNT_MISMATCH: { label: "Amount differs", tone: "bad", severity: 2 },
  PIN_MISMATCH: { label: "PIN differs", tone: "bad", severity: 2 },
  MISSING_IN_ITAX: { label: "Not on iTax/eTIMS", tone: "bad", severity: 3 },
  MISSING_IN_ERP: { label: "Not in ERP", tone: "bad", severity: 3 },
};

const ISSUE = {
  INVALID_PIN: "warn", NO_PIN: "info", SELF_SUPPLY: "bad", RATE: "warn", ZERO_VAT: "info", EXPIRED_INPUT: "bad", LATE_CLAIM: "info",
  DUPLICATE: "bad", CREDIT_NO_ORIGINAL: "warn", CREDIT_NOTE_LATE: "warn", INVOICE_NO_TOO_LONG: "warn", PROHIBITED_INPUT: "warn",
};

const kes = (c) => `KES ${(Math.abs(c || 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tolFor = (a, b, opts) => Math.max(opts.absTolCents, Math.round(Math.max(Math.abs(a || 0), Math.abs(b || 0)) * opts.relTol));
const within = (a, b, opts) => Math.abs((a || 0) - (b || 0)) <= tolFor(a, b, opts);
const dayDiff = (a, b) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 86400000 : Infinity);

const DEFAULTS = { absTolCents: 100, relTol: 0.005, dateWindowDays: 7, fuzzyDistance: 2 };

function keysOf(d) {
  const ks = new Set();
  const a = d.invoiceKey || invoiceKey(d.invoiceNo); if (a) ks.add(a);
  const b = invoiceKey(d.cuInvoiceNo); if (b) ks.add(b);
  return [...ks];
}

/** Document-level checks that don't depend on matching. */
function documentIssues(d, side, ctx) {
  const out = [];
  const pin = normPin(d.pin);
  if (pin && !validPin(pin)) out.push({ code: "INVALID_PIN", text: `PIN “${d.pin}” isn't a valid KRA PIN format (A/P + 9 digits + letter).` });
  if (!pin && side === "PURCHASES" && d.source === "ERP") out.push({ code: "NO_PIN", text: "No supplier PIN in the ERP — input VAT can only be claimed on invoices issued to/with a valid PIN." });
  if (pin && ctx.ownPin && pin === ctx.ownPin) out.push({ code: "SELF_SUPPLY", text: "Counterparty PIN is your own PIN — iTax rejects self-supply line items; move it to the lump sum." });
  if (invoiceNoTooLong(d.invoiceNo)) out.push({ code: "INVOICE_NO_TOO_LONG", text: `Invoice number is longer than ${VAT.invoiceNoMaxLen.value} characters — iTax will reject it.` });
  // Rate check (taxable × 16%, or 8% for fuel, or 0 for zero-rated/exempt).
  const t = d.taxableCents || 0, v = d.vatCents || 0;
  if (t) {
    const code = String(d.rateCode || "").toUpperCase();
    const fuel = /\b8(\.0+)?%?\b|FUEL|PETROL|DIESEL/.test(code + " " + String(d.description || "").toUpperCase());
    const zeroish = /^(Z|E|EX|ZR|0|0%|ZERO|EXEMPT)/.test(code);
    if (v === 0 && !zeroish) out.push({ code: "ZERO_VAT", text: "No VAT on a taxable value — if zero-rated or exempt it belongs in Section D/E (or H/I), not B/F." });
    else if (v !== 0) {
      const rate = (v / t) * 100;
      const ok = [VAT.standardRate.value, ...(fuel ? [VAT.fuelRate.value] : [])].some((r) => Math.abs(t * r / 100 - v) <= Math.max(100, Math.abs(v) * 0.005));
      if (!ok) out.push({ code: "RATE", text: `VAT is ${rate.toFixed(2)}% of the taxable value (expected ${VAT.standardRate.value}%${fuel ? " or 8% for fuel" : ""}). Check the tax code on this invoice.` });
    }
  }
  if (side === "PURCHASES" && d.date && ctx.period) {
    const deadline = monthEnd(addMonths(d.date.slice(0, 7), VAT.inputClaimMonths.value));
    if (monthEnd(ctx.period) > deadline) out.push({ code: "EXPIRED_INPUT", text: `Input VAT expired: invoices dated ${d.date.slice(0, 7)} had to be claimed by ${deadline} (6-month rule, VAT Act s.17(2)).` });
    else if (d.date.slice(0, 7) < ctx.period) out.push({ code: "LATE_CLAIM", text: `Dated ${d.date} (earlier period) — still claimable until ${deadline}.` });
    if (/(saloon|passenger car|minibus|entertain|restaurant|hotel|accommodation|lodging)/i.test(String(d.description || ""))) out.push({ code: "PROHIBITED_INPUT", text: "Looks like a prohibited input (cars, entertainment, restaurant, accommodation — VAT Act s.17(4)). Confirm before claiming." });
  }
  if (d.docType === "CREDIT_NOTE") {
    if (!d.relatedInvoice) out.push({ code: "CREDIT_NO_ORIGINAL", text: "Credit note without the original (relevant) invoice number — iTax requires it." });
    else if (ctx.knownKeys && !ctx.knownKeys.has(invoiceKey(d.relatedInvoice))) out.push({ code: "CREDIT_NO_ORIGINAL", text: `Original invoice ${d.relatedInvoice} isn't in the data for this period — make sure it was declared as a line item.` });
    if (side === "SALES" && d.relatedDate && d.date && dayDiff(d.relatedDate, d.date) > 183) out.push({ code: "CREDIT_NOTE_LATE", text: "Credit note issued more than 6 months after the original invoice — not claimable." });
  }
  return out;
}

function findDuplicates(docs) {
  const seen = new Map(), dup = new Set();
  for (const d of docs) {
    const k = `${normPin(d.pin) || "-"}|${keysOf(d)[0] || d.id}|${d.docType}`;
    if (seen.has(k)) { dup.add(d.id); dup.add(seen.get(k)); } else seen.set(k, d.id);
  }
  return dup;
}

function actionFor(status, side, e, i, ctx) {
  const party = (e || i)?.counterparty || (side === "SALES" ? "the customer" : "the supplier");
  const inv = (e || i)?.invoiceNo || "";
  const vat = kes((e || i)?.vatCents);
  const deadline = e?.date ? monthEnd(addMonths(e.date.slice(0, 7), VAT.inputClaimMonths.value)) : null;
  switch (status) {
    case "MATCHED": return "No action needed.";
    case "MISSING_IN_ITAX": return side === "PURCHASES"
      ? `Input VAT of ${vat} can't be claimed: ${party} hasn't transmitted invoice ${inv} on eTIMS (or issued it without your PIN). Ask them to transmit/correct it${deadline ? ` before ${deadline} (claim deadline)` : ""}. Without an eTIMS invoice the expense is also not tax-deductible (ITA s.16(1)(c)).`
      : `Invoice ${inv} (${vat} VAT) isn't on eTIMS/iTax. Transmit it from your eTIMS/TIMS device now; until then declare it in the lump sum — never under-declare. Unreported e-invoices attract penalties (TPA s.86 as amended by Finance Act 2026).`;
    case "MISSING_IN_ERP": return side === "PURCHASES"
      ? `eTIMS shows invoice ${inv} from ${party} (${vat} VAT) that isn't in your ERP. Confirm the goods/services were received, then post the bill (expense/asset + payable) and claim the input VAT; if it isn't yours, ask ${party} to cancel it via a credit note.`
      : `eTIMS shows a sale ${inv} to ${party} (${vat} VAT) that isn't in your ERP — possible unrecorded revenue. Find and post the invoice, or if it was issued in error cancel it with an eTIMS credit note. iTax won't accept sales below the eTIMS total.`;
    case "AMOUNT_MISMATCH": return side === "PURCHASES"
      ? `Taxable value differs by ${kes((e?.taxableCents || 0) - (i?.taxableCents || 0))}. Only the eTIMS value (${kes(i?.taxableCents)}) can be claimed and iTax won't let you increase it. Ask ${party} for a debit/credit note or correct the ERP posting.`
      : `Taxable value differs by ${kes((e?.taxableCents || 0) - (i?.taxableCents || 0))}. The eTIMS amount is locked in the return — correct the ERP invoice, or issue an eTIMS credit/debit note so both agree.`;
    case "VAT_MISMATCH": return `VAT differs: ERP ${kes(e?.vatCents)} vs eTIMS ${kes(i?.vatCents)}. Check the VAT code/rate on the invoice; ${side === "PURCHASES" ? "claim only the eTIMS VAT" : "correct the ERP to the eTIMS figure or re-issue via credit note"}.`;
    case "PIN_MISMATCH": return `PIN differs: ERP ${normPin(e?.pin) || "—"} vs eTIMS ${normPin(i?.pin) || "—"}. Fix the ${side === "SALES" ? "customer" : "supplier"} master data in the ERP${side === "PURCHASES" ? "; if the supplier used the wrong PIN for you, ask them to cancel and re-issue — otherwise it can't be claimed" : ""}.`;
    case "DATE_PERIOD_MISMATCH": return `Dated in different months (ERP ${e?.date}, eTIMS ${i?.date}). ${side === "SALES" ? "Sales are declared by invoice date — align the ERP posting date with eTIMS." : `Claim it in the eTIMS period; it stays claimable until ${deadline || "6 months after that period"}.`}`;
    default: return "";
  }
}

/**
 * Reconcile one side (SALES or PURCHASES) for a period.
 * Returns { items, stats }.
 */
function reconcile({ side, period, erp = [], itax = [], ownPin = null, options = {} }) {
  const opts = { ...DEFAULTS, ...options };
  const ctx = { period, ownPin: normPin(ownPin), knownKeys: new Set([...erp, ...itax].flatMap(keysOf)) };
  const freeE = new Set(erp.map((d) => d.id)), freeI = new Set(itax.map((d) => d.id));
  const pairs = [];
  const take = (e, i, pass) => { freeE.delete(e.id); freeI.delete(i.id); pairs.push({ e, i, pass }); };

  // Index iTax docs by key and by PIN.
  const byKey = new Map(), byPin = new Map();
  for (const d of itax) {
    for (const k of keysOf(d)) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(d); }
    const p = normPin(d.pin); if (p) { if (!byPin.has(p)) byPin.set(p, []); byPin.get(p).push(d); }
  }
  const sameSign = (e, i) => Math.sign(e.taxableCents || 0) === Math.sign(i.taxableCents || 0) || !e.taxableCents || !i.taxableCents;

  // Pass 1: PIN + key.
  for (const e of erp) {
    const p = normPin(e.pin);
    const cand = keysOf(e).flatMap((k) => byKey.get(k) || []).find((i) => freeI.has(i.id) && p && normPin(i.pin) === p && sameSign(e, i));
    if (cand) take(e, cand, 1);
  }
  // Pass 2: key + amount.
  for (const e of erp) {
    if (!freeE.has(e.id)) continue;
    const cand = keysOf(e).flatMap((k) => byKey.get(k) || []).filter((i) => freeI.has(i.id) && sameSign(e, i));
    const hit = cand.find((i) => within(e.taxableCents, i.taxableCents, opts)) || (cand.length === 1 ? cand[0] : null);
    if (hit) take(e, hit, 2);
  }
  // Pass 3: PIN + amount + date window (closest date wins).
  for (const e of erp) {
    if (!freeE.has(e.id)) continue;
    const p = normPin(e.pin); if (!p) continue;
    const cand = (byPin.get(p) || []).filter((i) => freeI.has(i.id) && within(e.taxableCents, i.taxableCents, opts) && dayDiff(e.date, i.date) <= opts.dateWindowDays)
      .sort((a, b) => dayDiff(e.date, a.date) - dayDiff(e.date, b.date));
    if (cand[0]) take(e, cand[0], 3);
  }
  // Pass 4: fuzzy key + amount.
  const freeItax = () => itax.filter((i) => freeI.has(i.id));
  for (const e of erp) {
    if (!freeE.has(e.id)) continue;
    const ek = keysOf(e);
    if (!ek.length) continue;
    let best = null, bestD = Infinity;
    for (const i of freeItax()) {
      if (!within(e.taxableCents, i.taxableCents, opts)) continue;
      for (const a of ek) for (const b of keysOf(i)) {
        // Short numbers ("S1" vs "S2") are too ambiguous for fuzzy matching: allow 1 edit per 4 characters.
        const minLen = Math.min(a.length, b.length);
        if (minLen < 4) continue;
        const allowed = Math.min(opts.fuzzyDistance, Math.floor(minLen / 4));
        const suffix = minLen >= 5 && (a.endsWith(b) || b.endsWith(a));
        const d = suffix ? 0.5 : levenshtein(a, b, allowed);
        if (d <= allowed && d < bestD) { best = i; bestD = d; }
      }
    }
    if (best) take(e, best, 4);
  }

  const dupE = findDuplicates(erp), dupI = findDuplicates(itax);
  const issuesFor = (d) => (d ? [...documentIssues(d, side, ctx), ...((d.source === "ERP" ? dupE : dupI).has(d.id) ? [{ code: "DUPLICATE", text: `Appears more than once in the ${d.source === "ERP" ? "ERP register" : "iTax data"} (same PIN, invoice no. and type).` }] : [])] : []);
  const mergeIssues = (a, b) => { const seen = new Set(); return [...a, ...b].filter((x) => { const k = x.code + x.text; if (seen.has(k)) return false; seen.add(k); return true; }).map((x) => ({ ...x, severity: ISSUE[x.code] || "info" })); };

  const items = [];
  for (const { e, i, pass } of pairs) {
    let status = "MATCHED";
    const pe = normPin(e.pin), pi = normPin(i.pin);
    if (pe && pi && pe !== pi) status = "PIN_MISMATCH";
    else if (!within(e.taxableCents, i.taxableCents, opts)) status = "AMOUNT_MISMATCH";
    else if (!within(e.vatCents, i.vatCents, opts)) status = "VAT_MISMATCH";
    else if (e.date && i.date && e.date.slice(0, 7) !== i.date.slice(0, 7)) status = "DATE_PERIOD_MISMATCH";
    items.push(makeItem(status, side, e, i, pass, mergeIssues(issuesFor(e), issuesFor(i)), ctx));
  }
  for (const e of erp) if (freeE.has(e.id)) items.push(makeItem("MISSING_IN_ITAX", side, e, null, 0, mergeIssues(issuesFor(e), []), ctx));
  for (const i of itax) if (freeI.has(i.id)) items.push(makeItem("MISSING_IN_ERP", side, null, i, 0, mergeIssues(issuesFor(i), []), ctx));

  items.sort((a, b) => STATUS[b.status].severity - STATUS[a.status].severity || Math.abs(b.diffCents) - Math.abs(a.diffCents));
  return { items, stats: summarise(items, side) };
}

function makeItem(status, side, e, i, pass, issues, ctx) {
  const d = e || i;
  const erpVat = e ? e.vatCents || 0 : null, itaxVat = i ? i.vatCents || 0 : null;
  return {
    status, side, pass,
    erpId: e?.id || null, itaxId: i?.id || null,
    pin: normPin(d.pin), counterparty: d.counterparty || i?.counterparty || null,
    invoiceNo: e?.invoiceNo || i?.invoiceNo || null, itaxInvoiceNo: i?.invoiceNo || null,
    date: e?.date || i?.date || null, itaxDate: i?.date || null,
    erpTaxableCents: e ? e.taxableCents || 0 : null, itaxTaxableCents: i ? i.taxableCents || 0 : null,
    erpVatCents: erpVat, itaxVatCents: itaxVat,
    diffCents: (erpVat ?? 0) - (itaxVat ?? 0),
    issues,
    action: actionFor(status, side, e, i, ctx) + (issues.some((x) => x.code === "EXPIRED_INPUT") ? " Input VAT on this invoice has expired and must not be claimed." : ""),
  };
}

/** Totals for the summary cards and the VAT3 computation. */
function summarise(items, side) {
  const byStatus = Object.fromEntries(Object.keys(STATUS).map((k) => [k, { count: 0, vatCents: 0 }]));
  let claimableVat = 0, atRiskVat = 0, unrecordedVat = 0, expiredVat = 0, declaredTaxable = 0, declaredVat = 0, issues = 0;
  for (const it of items) {
    const s = byStatus[it.status];
    s.count++; s.vatCents += it.erpVatCents ?? it.itaxVatCents ?? 0;
    issues += it.issues.filter((x) => x.severity !== "info").length;
    const expired = it.issues.some((x) => x.code === "EXPIRED_INPUT");
    if (it.itaxId) {
      // Purchases: claimable = lower of ERP and eTIMS when both exist; eTIMS-only items are claimable once posted.
      const v = it.erpId ? Math.min(it.erpVatCents, it.itaxVatCents) : it.itaxVatCents;
      if (expired) expiredVat += v; else claimableVat += v;
      declaredTaxable += it.itaxTaxableCents; declaredVat += it.itaxVatCents;
    }
    if (it.status === "MISSING_IN_ITAX") atRiskVat += it.erpVatCents;
    if (it.status === "MISSING_IN_ERP") unrecordedVat += it.itaxVatCents;
  }
  const total = items.length || 1;
  return {
    side, documents: items.length, byStatus, issues,
    matchRate: Math.round((byStatus.MATCHED.count / total) * 1000) / 10,
    // For purchases: input VAT you can claim now / that's blocked / that's expired. For sales: eTIMS output VAT.
    claimableVatCents: claimableVat, atRiskVatCents: atRiskVat, unrecordedVatCents: unrecordedVat, expiredVatCents: expiredVat,
    itaxTaxableCents: declaredTaxable, itaxVatCents: declaredVat,
    erpVatCents: items.reduce((a, x) => a + (x.erpVatCents || 0), 0),
    erpTaxableCents: items.reduce((a, x) => a + (x.erpTaxableCents || 0), 0),
  };
}

/**
 * Withholding VAT: certificates received vs your sales invoices to the withholding agents.
 * Each certificate should equal 2% of the taxable value of the invoice it relates to.
 */
function reconcileWhvat({ certificates = [], sales = [], options = {} }) {
  const opts = { ...DEFAULTS, ...options };
  const rate = WHVAT.rate.value / 100;
  const byKey = new Map();
  for (const s of sales) for (const k of keysOf(s)) byKey.set(k, s);
  const used = new Set();
  const items = certificates.map((c) => {
    let inv = c.invoiceNo ? byKey.get(invoiceKey(c.invoiceNo)) : null;
    if (!inv) {
      const p = normPin(c.pin);
      inv = sales.find((s) => !used.has(s.id) && normPin(s.pin) === p && within(Math.round((s.taxableCents || 0) * rate), c.vatCents, { ...opts, absTolCents: 200 }));
    }
    if (inv) used.add(inv.id);
    const expected = inv ? Math.round((inv.taxableCents || 0) * rate) : null;
    const status = !inv ? "CERT_NO_INVOICE" : within(expected, c.vatCents, { ...opts, absTolCents: 200 }) ? "CERT_MATCHED" : "CERT_AMOUNT_DIFF";
    return {
      status, certificateNo: c.certificateNo || c.invoiceNo, pin: normPin(c.pin), counterparty: c.counterparty, date: c.date,
      withheldCents: c.vatCents || 0, expectedCents: expected, invoiceNo: inv?.invoiceNo || c.invoiceNo || null, saleId: inv?.id || null,
      action: status === "CERT_MATCHED" ? "Claim in VAT3 sheet L (WHT credits)."
        : status === "CERT_AMOUNT_DIFF" ? `Withheld ${kes(c.vatCents)} but 2% of the invoice is ${kes(expected)}. Ask the agent to cancel and re-issue the certificate (Withholding Adjustment Voucher) — claim only what the certificate shows.`
          : "No matching sales invoice found. Check the invoice number on the certificate, or that the sale is recorded; if issued in error ask the agent to cancel it.",
    };
  });
  const credit = items.reduce((a, x) => a + x.withheldCents, 0);
  return { items, totalCreditCents: credit, counts: items.reduce((a, x) => ({ ...a, [x.status]: (a[x.status] || 0) + 1 }), {}) };
}

module.exports = { reconcile, reconcileWhvat, documentIssues, summarise, STATUS, ISSUE, DEFAULTS, keysOf };
