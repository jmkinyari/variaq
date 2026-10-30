// Shared (client + server) definitions and validation for CSV imports.
const { parseAmount } = require("./money");
const { parseDate } = require("./dates");

const IMPORT_KINDS = {
  ledger: {
    label: "Ledger",
    fields: [
      { key: "date", label: "Date", required: true, hints: ["date", "posting date", "txn date", "transaction date"] },
      { key: "description", label: "Description", required: true, hints: ["description", "narration", "memo", "details", "particulars"] },
      { key: "reference", label: "Reference", hints: ["reference", "ref", "doc no", "document", "voucher", "journal"] },
      { key: "accountCode", label: "Account code", required: true, hints: ["account code", "account", "gl code", "acct", "gl account", "code"] },
      { key: "accountName", label: "Account name", hints: ["account name", "gl name", "account description"] },
      { key: "amount", label: "Amount (signed)", hints: ["amount", "value", "net"] },
      { key: "debit", label: "Debit", hints: ["debit", "dr"] },
      { key: "credit", label: "Credit", hints: ["credit", "cr"] },
      { key: "counterparty", label: "Counterparty", hints: ["counterparty", "customer", "supplier", "vendor", "payee", "contact"] },
    ],
  },
  bank: {
    label: "Bank statement",
    fields: [
      { key: "date", label: "Date", required: true, hints: ["date", "transaction date", "value date", "txn date", "posting date"] },
      { key: "description", label: "Description", required: true, hints: ["description", "narration", "details", "particulars", "transaction details"] },
      { key: "reference", label: "Reference", hints: ["reference", "ref", "cheque", "receipt", "transaction id", "mpesa ref"] },
      { key: "amount", label: "Amount (signed)", hints: ["amount", "value"] },
      { key: "moneyIn", label: "Money in", hints: ["money in", "credit", "deposit", "paid in", "cr"] },
      { key: "moneyOut", label: "Money out", hints: ["money out", "debit", "withdrawal", "paid out", "dr"] },
      { key: "balance", label: "Balance", hints: ["balance", "running balance", "closing balance"] },
    ],
  },
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Suggest a column for each field based on header names. */
function guessMapping(kind, headers) {
  const def = IMPORT_KINDS[kind];
  const used = new Set();
  const mapping = {};
  for (const f of def.fields) {
    let found = "";
    for (const hint of f.hints) {
      const h = headers.find((x) => !used.has(x) && norm(x) === hint);
      if (h) { found = h; break; }
    }
    if (!found) for (const hint of f.hints) {
      const h = headers.find((x) => !used.has(x) && norm(x).includes(hint) && hint.length > 2);
      if (h) { found = h; break; }
    }
    if (found) used.add(found);
    mapping[f.key] = found;
  }
  // Prefer split columns if both are present; otherwise signed amount.
  if (kind === "ledger" && mapping.debit && mapping.credit && mapping.amount) mapping.amount = "";
  if (kind === "bank" && mapping.moneyIn && mapping.moneyOut && mapping.amount) mapping.amount = "";
  return mapping;
}

/** Check the mapping itself before validating rows. Returns list of problems. */
function checkMapping(kind, mapping) {
  const def = IMPORT_KINDS[kind];
  const problems = [];
  for (const f of def.fields) if (f.required && !mapping[f.key]) problems.push(`Choose a column for “${f.label}”.`);
  if (kind === "ledger" && !mapping.amount && !(mapping.debit || mapping.credit)) problems.push("Choose either a signed Amount column or Debit/Credit columns.");
  if (kind === "bank" && !mapping.amount && !(mapping.moneyIn || mapping.moneyOut)) problems.push("Choose either a signed Amount column or Money in/Money out columns.");
  const cols = Object.values(mapping).filter(Boolean);
  const dup = cols.find((c, i) => cols.indexOf(c) !== i);
  if (dup) problems.push(`The column “${dup}” is used for more than one field.`);
  return problems;
}

/**
 * Validate raw CSV rows (objects keyed by header) against a mapping.
 * Returns { valid: [normalized rows], errors: [{ row, messages }] }.
 * Row numbers are 1-based data rows (header excluded) + 1 to match spreadsheet line numbers.
 */
function validateRows(kind, rows, mapping, { dateFormat = "YYYY-MM-DD", decimal = "." } = {}) {
  const valid = [];
  const errors = [];
  const pick = (r, k) => (mapping[k] ? (r[mapping[k]] ?? "").toString().trim() : "");
  rows.forEach((r, i) => {
    const line = i + 2;
    const messages = [];
    const values = Object.values(r).map((v) => String(v ?? "").trim());
    if (values.every((v) => !v)) return; // skip blank lines silently
    const rawDate = pick(r, "date");
    const date = parseDate(rawDate, dateFormat);
    if (!date) messages.push(rawDate ? `Date “${rawDate}” doesn't match ${dateFormat}.` : "Date is empty.");
    const description = pick(r, "description");
    if (!description) messages.push("Description is empty.");
    let amountCents = null;
    const amtErr = (label, raw) => messages.push(`${label} “${raw}” isn't a number.`);
    if (kind === "ledger") {
      if (mapping.amount) {
        const raw = pick(r, "amount"); amountCents = parseAmount(raw, { decimal });
        if (amountCents === null) raw ? amtErr("Amount", raw) : messages.push("Amount is empty.");
      } else {
        const rd = pick(r, "debit"), rc = pick(r, "credit");
        const d = rd ? parseAmount(rd, { decimal }) : 0, c = rc ? parseAmount(rc, { decimal }) : 0;
        if (d === null) amtErr("Debit", rd);
        if (c === null) amtErr("Credit", rc);
        if (d !== null && c !== null) {
          if (!rd && !rc) messages.push("Debit and Credit are both empty.");
          else amountCents = Math.abs(d) - Math.abs(c);
        }
      }
      const accountCode = pick(r, "accountCode");
      if (!accountCode) messages.push("Account code is empty.");
      if (!messages.length) valid.push({ line, date, description, reference: pick(r, "reference") || null, accountCode, accountName: pick(r, "accountName") || null, amountCents, counterparty: pick(r, "counterparty") || null });
    } else {
      if (mapping.amount) {
        const raw = pick(r, "amount"); amountCents = parseAmount(raw, { decimal });
        if (amountCents === null) raw ? amtErr("Amount", raw) : messages.push("Amount is empty.");
      } else {
        const ri = pick(r, "moneyIn"), ro = pick(r, "moneyOut");
        const a = ri ? parseAmount(ri, { decimal }) : 0, b = ro ? parseAmount(ro, { decimal }) : 0;
        if (a === null) amtErr("Money in", ri);
        if (b === null) amtErr("Money out", ro);
        if (a !== null && b !== null) {
          if (!ri && !ro) messages.push("Money in and Money out are both empty.");
          else amountCents = Math.abs(a) - Math.abs(b);
        }
      }
      let balanceCents = null;
      const rb = pick(r, "balance");
      if (rb) { balanceCents = parseAmount(rb, { decimal }); if (balanceCents === null) amtErr("Balance", rb); }
      if (!messages.length) valid.push({ line, date, description, reference: pick(r, "reference") || null, amountCents, balanceCents });
    }
    if (amountCents === 0 && !messages.length) { /* zero-value rows are allowed but unusual */ }
    if (messages.length) errors.push({ row: line, messages });
  });
  return { valid, errors };
}

module.exports = { IMPORT_KINDS, guessMapping, checkMapping, validateRows };
