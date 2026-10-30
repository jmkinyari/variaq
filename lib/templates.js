// Starter content. Nothing here assumes a tax rate — rates are left blank on purpose so the
// finance team fills them in from an authoritative source and marks them verified.
const CLOSE_TEMPLATE = [
  ["Cash", "Reconcile all bank accounts"],
  ["Cash", "Reconcile M-Pesa / mobile money accounts"],
  ["Cash", "Count and review petty cash"],
  ["Receivables", "Post customer receipts and review aged receivables"],
  ["Payables", "Post supplier invoices and review aged payables"],
  ["Payables", "Record accruals and prepayments"],
  ["Payroll", "Post payroll journal"],
  ["Payroll", "Reconcile statutory deductions (PAYE, NSSF, SHIF, Housing Levy)"],
  ["Tax", "Review VAT on sales and purchases"],
  ["Tax", "Reconcile withholding tax"],
  ["Inventory", "Review inventory adjustments and stock counts"],
  ["Inventory", "Post cost of sales entries"],
  ["Fixed assets", "Post depreciation"],
  ["Reporting", "Run and review the variance report"],
  ["Reporting", "Management review and sign-off"],
  ["Reporting", "Lock the period in the accounting system"],
];

const KENYA_TAX_STARTER = [
  ["VAT-STD", "VAT — standard rated", "BOTH"],
  ["VAT-ZERO", "VAT — zero rated", "BOTH"],
  ["VAT-EXEMPT", "VAT — exempt", "BOTH"],
  ["WHT", "Withholding income tax", "PURCHASES"],
  ["WHT-VAT", "Withholding VAT", "SALES"],
  ["PAYE", "Pay As You Earn", "PAYROLL"],
  ["NSSF", "NSSF contributions", "PAYROLL"],
  ["SHIF", "Social Health Insurance Fund", "PAYROLL"],
  ["AHL", "Affordable Housing Levy", "PAYROLL"],
  ["EXCISE", "Excise duty", "SALES"],
];

module.exports = { CLOSE_TEMPLATE, KENYA_TAX_STARTER };
