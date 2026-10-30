// Ledger ↔ tax cross-checks. Pure functions; lib/tax/data.js loads the inputs.
//  1. VAT control accounts: ledger output/input VAT movement vs ERP register vs iTax/eTIMS.
//  2. Revenue completeness: ledger revenue vs taxable sales in the register and on eTIMS.
//  3. eTIMS deductibility (ITA s.16(1)(c), Finance Act 2023): expenses per supplier not backed by
//     an eTIMS purchase invoice are at risk of being disallowed (full validation from 1 Jan 2026).
const { ETIMS } = require("./kenya");

const kes = (c) => `KES ${(Math.abs(c || 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TOL = 100; // 1 shilling

function line(label, a, b, aLabel, bLabel, action) {
  const diff = (a || 0) - (b || 0);
  return { label, a: a || 0, b: b || 0, aLabel, bLabel, diffCents: diff, ok: Math.abs(diff) <= TOL, action: Math.abs(diff) <= TOL ? "Agrees." : action(diff) };
}

/**
 * VAT control reconciliation for one period. All amounts are positive VAT values:
 * ledgerOutput = credits less debits on the output VAT account in the period; ledgerInput = debits less credits on input VAT.
 */
function vatControl({ ledgerOutputCents, ledgerInputCents, registerOutputCents, registerInputCents, itaxOutputCents, itaxInputCents, hasAccounts }) {
  if (!hasAccounts) return { configured: false, lines: [] };
  return {
    configured: true,
    lines: [
      line("Output VAT: ledger vs ERP sales register", ledgerOutputCents, registerOutputCents, "Ledger", "Register",
        (d) => d > 0 ? `Ledger has ${kes(d)} more output VAT than the invoice register — look for manual journals to the VAT account or invoices missing from the register export.` : `Register has ${kes(d)} more output VAT than the ledger — invoices may be posted without VAT or to a different account.`),
      line("Output VAT: ledger vs iTax/eTIMS", ledgerOutputCents, itaxOutputCents, "Ledger", "eTIMS",
        (d) => d > 0 ? `${kes(d)} of output VAT in the ledger isn't on eTIMS — transmit the missing invoices (see VAT reconciliation).` : `eTIMS shows ${kes(d)} more output VAT than the ledger — likely unrecorded sales. You can't declare less than eTIMS.`),
      line("Input VAT: ledger vs ERP purchase register", ledgerInputCents, registerInputCents, "Ledger", "Register",
        (d) => d > 0 ? `Ledger claims ${kes(d)} more input VAT than the purchase register supports — check manual VAT journals.` : `Register has ${kes(d)} more input VAT than the ledger — bills may be posted gross without VAT split.`),
      line("Input VAT: ledger vs claimable on eTIMS", ledgerInputCents, itaxInputCents, "Ledger", "Claimable",
        (d) => d > 0 ? `${kes(d)} of input VAT in the ledger isn't claimable (not on eTIMS, expired or reduced). Reverse it to expense or chase suppliers to transmit.` : `${kes(d)} more is claimable per eTIMS than booked — post the missing supplier bills.`),
    ],
  };
}

function revenueCheck({ ledgerRevenueCents, registerTaxableCents, itaxTaxableCents, exemptAndZeroCents = 0 }) {
  return [
    line("Revenue: ledger vs ERP sales register (taxable)", ledgerRevenueCents - exemptAndZeroCents, registerTaxableCents, "Ledger", "Register",
      (d) => d > 0 ? `Ledger revenue exceeds taxable invoices by ${kes(d)} — revenue booked by journal without an invoice, or exempt/zero-rated sales not separated. Each sale needs an eTIMS invoice.` : `Invoices exceed ledger revenue by ${kes(d)} — invoices not posted to revenue accounts, or posted to the wrong account.`),
    line("Revenue: ledger vs eTIMS declared sales", ledgerRevenueCents - exemptAndZeroCents, itaxTaxableCents, "Ledger", "eTIMS",
      (d) => d > 0 ? `${kes(d)} of revenue has no eTIMS invoice. KRA uses the higher of declared and eTIMS income — transmit or explain.` : `eTIMS sales exceed ledger revenue by ${kes(d)} — KRA will assess on the higher eTIMS figure. Record the missing sales or cancel erroneous eTIMS invoices.`),
  ];
}

const normName = (s) => String(s || "").toLowerCase().replace(/\b(limited|ltd|plc|co|company|kenya|k|ke|the|and|&|enterprises?|llp|inc)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
function exemptCategory(e) {
  const text = `${e.accountName || ""} ${e.description || ""}`;
  return ETIMS.exemptCategories.find((c) => c.re.test(text)) || null;
}

/**
 * expenses: [{ id, date, accountCode, accountName, description, counterparty, amountCents (debit +) }]
 * etims: [{ pin, counterparty, taxableCents }] — eTIMS purchase invoices for the same year.
 * Returns { rows: per supplier, totals }.
 */
function etimsDeductibility({ expenses, etims, year }) {
  const backed = new Map();
  for (const p of etims) { const k = normName(p.counterparty); if (k) backed.set(k, (backed.get(k) || 0) + (p.taxableCents || 0)); }
  const groups = new Map();
  let exemptTotal = 0, noCounterparty = 0;
  const exemptByCat = {};
  for (const e of expenses) {
    if (!e.amountCents) continue;
    const cat = exemptCategory(e);
    if (cat) { exemptTotal += e.amountCents; exemptByCat[cat.label] = (exemptByCat[cat.label] || 0) + e.amountCents; continue; }
    const k = normName(e.counterparty);
    if (!k) { noCounterparty += e.amountCents; continue; }
    if (!groups.has(k)) groups.set(k, { counterparty: e.counterparty, expenseCents: 0, entries: 0, accounts: new Set() });
    const g = groups.get(k); g.expenseCents += e.amountCents; g.entries++; g.accounts.add(e.accountCode);
  }
  const rows = [...groups].map(([k, g]) => {
    const backedCents = backed.get(k) || 0;
    const unsupported = Math.max(0, g.expenseCents - backedCents);
    return { counterparty: g.counterparty, expenseCents: g.expenseCents, etimsCents: backedCents, unsupportedCents: unsupported, entries: g.entries, accounts: [...g.accounts].join(", "),
      action: unsupported <= TOL ? "Supported by eTIMS invoices." : backedCents ? `${kes(unsupported)} of spend with this supplier isn't covered by eTIMS invoices. Request the missing eTIMS invoices before filing the ${year} return.` : `No eTIMS invoices at all from this supplier. Ask them to onboard on eTIMS and issue invoices, or treat ${kes(unsupported)} as non-deductible.` };
  }).sort((a, b) => b.unsupportedCents - a.unsupportedCents);
  const unsupported = rows.reduce((a, r) => a + r.unsupportedCents, 0) + noCounterparty;
  return {
    rows, exemptByCat,
    totals: { expensesCents: expenses.reduce((a, e) => a + (e.amountCents || 0), 0), exemptCents: exemptTotal, noCounterpartyCents: noCounterparty, unsupportedCents: unsupported, taxAtRiskCents: Math.round(unsupported * 0.3) },
  };
}

module.exports = { vatControl, revenueCheck, etimsDeductibility, normName, exemptCategory };
