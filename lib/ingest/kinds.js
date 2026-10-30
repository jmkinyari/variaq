// Dataset registry for the Data hub. Each kind describes the fields we understand, how to spot
// them in arbitrary exports (header hints), their types, and which are required. Shared by the
// browser (preview) and the server (authoritative validation). Add a kind here + an importer in
// lib/importers/ and it appears in the Data hub automatically.
//
// Field types: date | datetime | money | text | code | pin | int | number | enum
const H = (...xs) => xs;

const KINDS = {
  ledger: {
    label: "General ledger / journal lines",
    module: "Ledger & journals",
    description: "Journal lines from your ERP: one row per debit or credit line.",
    signature: H("journal", "account", "debit", "credit", "narration", "voucher"),
    amountMode: "signedOrSplit", // amount OR debit/credit
    fields: [
      { key: "date", label: "Posting date", type: "date", required: true, hints: H("date", "posting date", "gl date", "txn date", "transaction date", "doc date", "document date", "entry date", "value date") },
      { key: "journalNo", label: "Journal / voucher no.", type: "code", journalLevel: true, hints: H("journal no", "journal number", "journal", "je no", "je number", "voucher no", "voucher", "batch", "entry no", "transaction no", "move", "jv no", "document no", "doc no") },
      { key: "lineNo", label: "Line no.", type: "int", hints: H("line no", "line", "line number", "seq") },
      { key: "description", label: "Description", type: "text", required: true, fillFrom: "reference", hints: H("description", "narration", "memo", "details", "particulars", "line description", "label", "remarks", "comment") },
      { key: "reference", label: "Reference", type: "text", journalLevel: true, hints: H("reference", "ref", "external ref", "invoice no", "cheque no", "source document") },
      { key: "accountCode", label: "Account code", type: "code", required: true, hints: H("account code", "gl code", "gl account", "account no", "account number", "acct", "nominal code", "ledger code", "account", "code") },
      { key: "accountName", label: "Account name", type: "text", hints: H("account name", "gl name", "account description", "nominal name", "ledger name", "account title") },
      { key: "amount", label: "Amount (signed)", type: "money", hints: H("amount", "net amount", "value", "balance amount", "amount lcy", "amount (lcy)") },
      { key: "debit", label: "Debit", type: "money", hints: H("debit", "dr", "debit amount", "debit lcy") },
      { key: "credit", label: "Credit", type: "money", hints: H("credit", "cr", "credit amount", "credit lcy") },
      { key: "counterparty", label: "Customer / supplier", type: "text", hints: H("counterparty", "customer", "supplier", "vendor", "payee", "contact", "partner", "party", "customer name", "supplier name") },
      { key: "entryType", label: "Entry type / source", type: "text", journalLevel: true, hints: H("source", "journal type", "entry type", "source code", "module", "type") },
      { key: "postedBy", label: "Posted by", type: "text", journalLevel: true, hints: H("posted by", "created by", "user", "user id", "entered by", "prepared by", "author") },
      { key: "approvedBy", label: "Approved by", type: "text", journalLevel: true, hints: H("approved by", "authorised by", "authorized by", "approver", "reviewed by") },
      { key: "postedAt", label: "Posted at (timestamp)", type: "datetime", journalLevel: true, hints: H("posted at", "created at", "entry timestamp", "created on", "system date", "posting timestamp", "date created") },
      { key: "currency", label: "Currency", type: "code", hints: H("currency", "curr", "ccy", "currency code") },
      { key: "taxCode", label: "Tax code", type: "code", hints: H("tax code", "vat code", "tax", "vat") },
      { key: "costCenter", label: "Cost centre", type: "code", hints: H("cost centre", "cost center", "cc", "profit centre") },
      { key: "department", label: "Department", type: "text", hints: H("department", "dept", "division") },
      { key: "project", label: "Project", type: "text", hints: H("project", "job", "project code") },
    ],
  },
  trial_balance: {
    label: "Trial balance",
    module: "Chart mapping & completeness",
    description: "Closing balance per account at a date (from any ERP, subsidiary or prior system).",
    signature: H("trial balance", "closing balance", "opening balance", "account"),
    antiSignature: H("date", "narration", "journal", "jv", "voucher", "posted by"),
    amountMode: "signedOrSplit",
    fields: [
      { key: "accountCode", label: "Account code", type: "code", required: true, hints: H("account code", "gl code", "account no", "account number", "code", "account", "nominal code") },
      { key: "accountName", label: "Account name", type: "text", hints: H("account name", "description", "name", "account description", "account title") },
      { key: "amount", label: "Balance (signed)", type: "money", hints: H("balance", "closing balance", "net balance", "amount", "ending balance", "ytd balance") },
      { key: "debit", label: "Debit balance", type: "money", hints: H("debit", "dr", "closing debit", "debit balance") },
      { key: "credit", label: "Credit balance", type: "money", hints: H("credit", "cr", "closing credit", "credit balance") },
    ],
  },
  coa: {
    label: "Chart of accounts",
    module: "Chart of accounts mapping",
    description: "List of accounts (code, name, type) for a ledger or a group reporting chart.",
    signature: H("account type", "category", "parent", "account class"),
    antiSignature: H("debit", "credit", "balance", "amount", "date"),
    fields: [
      { key: "accountCode", label: "Account code", type: "code", required: true, hints: H("account code", "code", "account no", "gl code", "number", "account number") },
      { key: "accountName", label: "Account name", type: "text", required: true, hints: H("account name", "name", "description", "title") },
      { key: "accountType", label: "Type / class", type: "text", hints: H("account type", "type", "class", "category", "classification", "group", "account class") },
      { key: "parentCode", label: "Parent code", type: "code", hints: H("parent", "parent code", "parent account", "header", "rollup") },
    ],
  },
  bank: {
    label: "Bank / M-Pesa statement",
    module: "Bank accounts",
    description: "Statement lines from a bank or mobile-money account.",
    signature: H("money in", "money out", "withdrawal", "deposit", "running balance", "paid in"),
    amountMode: "signedOrInOut",
    fields: [
      { key: "date", label: "Date", type: "date", required: true, hints: H("date", "transaction date", "value date", "txn date", "posting date", "completion time") },
      { key: "description", label: "Description", type: "text", required: true, hints: H("description", "narration", "details", "particulars", "transaction details") },
      { key: "reference", label: "Reference", type: "text", hints: H("reference", "ref", "cheque", "receipt", "receipt no", "transaction id", "mpesa ref") },
      { key: "amount", label: "Amount (signed)", type: "money", hints: H("amount", "value") },
      { key: "moneyIn", label: "Money in", type: "money", hints: H("money in", "credit", "deposit", "paid in", "cr") },
      { key: "moneyOut", label: "Money out", type: "money", hints: H("money out", "debit", "withdrawal", "withdrawn", "paid out", "dr") },
      { key: "balance", label: "Balance", type: "money", hints: H("balance", "running balance", "closing balance") },
    ],
  },
  sales_invoices: {
    label: "Sales invoice register (ERP)",
    module: "Tax — VAT reconciliation",
    description: "Your ERP's sales invoices and credit notes with customer PIN and VAT.",
    signature: H("customer pin", "invoice no", "vat", "customer"),
    fields: invoiceFields("customer"),
  },
  purchase_invoices: {
    label: "Purchase invoice register (ERP)",
    module: "Tax — VAT reconciliation",
    description: "Supplier invoices and credit notes posted in your ERP with supplier PIN and VAT.",
    signature: H("supplier pin", "supplier invoice", "vendor", "input vat"),
    fields: invoiceFields("supplier"),
  },
  itax_sales: {
    label: "iTax / eTIMS sales (VAT3 Section B)",
    module: "Tax — VAT reconciliation",
    description: "KRA auto-populated sales: SEC_B_WITH_VAT_PIN / Section B of the VAT3 return.",
    signature: H("pin of purchaser", "name of purchaser", "etr serial number", "relevant invoice number"),
    fields: itaxFields("Purchaser"),
  },
  itax_purchases: {
    label: "iTax / eTIMS purchases (VAT3 Section F)",
    module: "Tax — VAT reconciliation",
    description: "KRA auto-populated purchases: SEC_F_WITH_VAT_PIN / SEC_F_IMPORT / Section F.",
    signature: H("pin of supplier", "name of supplier", "type of purchases", "custom entry number"),
    fields: [{ key: "purchaseType", label: "Type of purchases", type: "text", hints: H("type of purchases", "purchase type") }, ...itaxFields("Supplier"), { key: "customsEntry", label: "Customs entry no.", type: "code", hints: H("custom entry number", "customs entry number", "entry number") }],
  },
  wht_vat: {
    label: "Withholding VAT certificates",
    module: "Tax — VAT reconciliation",
    description: "WHVAT certificates issued to you (iTax) — claimed in VAT3 sheet L.",
    signature: H("withholder pin", "certificate number", "withholding", "withholdee"),
    fields: [
      { key: "pin", label: "Withholder PIN", type: "pin", required: true, hints: H("withholder pin", "pin of withholder", "agent pin", "withholding agent pin", "pin") },
      { key: "counterparty", label: "Withholder name", type: "text", hints: H("withholder name", "name of withholder", "agent name", "name") },
      { key: "certificateNo", label: "Certificate no.", type: "code", required: true, hints: H("certificate number", "certificate no", "wht certificate", "cert no") },
      { key: "invoiceNo", label: "Invoice no.", type: "code", hints: H("invoice number", "invoice no", "invoice") },
      { key: "date", label: "Certificate date", type: "date", required: true, hints: H("certificate date", "date", "payment date", "withholding date") },
      { key: "taxable", label: "Taxable value", type: "money", hints: H("taxable value", "taxable amount", "gross amount", "invoice amount") },
      { key: "vat", label: "VAT withheld", type: "money", required: true, hints: H("vat withheld", "withheld amount", "amount withheld", "wht amount", "withholding amount") },
    ],
  },
  budget: {
    label: "Budget (by account and month)",
    module: "Budgets & variance",
    description: "An existing budget: account rows with 12 month columns, or account/month/amount rows.",
    signature: H("budget", "jan", "feb", "mar", "month 1", "fy"),
    wideMonths: true,
    fields: [
      { key: "accountCode", label: "Account code", type: "code", required: true, hints: H("account code", "gl code", "account", "code") },
      { key: "accountName", label: "Account name", type: "text", hints: H("account name", "description", "name") },
      { key: "month", label: "Month (long format)", type: "text", hints: H("month", "period") },
      { key: "amount", label: "Amount (long format)", type: "money", hints: H("amount", "budget", "budget amount", "value") },
    ],
  },
  ar_aging: agingKind("Receivables ageing", "customer"),
  ap_aging: agingKind("Payables ageing", "supplier"),
};

function invoiceFields(party) {
  return [
    { key: "invoiceNo", label: "Invoice no.", type: "code", required: true, hints: H("invoice no", "invoice number", "invoice", "document no", "doc no", "bill no", `${party} invoice`, "supplier invoice no", "reference") },
    { key: "cuInvoiceNo", label: "eTIMS CU invoice no.", type: "code", hints: H("cu invoice no", "cu invoice number", "etims invoice", "control unit invoice", "etims no", "kra invoice no", "trader invoice") },
    { key: "date", label: "Invoice date", type: "date", required: true, hints: H("invoice date", "date", "document date", "bill date", "posting date") },
    { key: "pin", label: `${cap(party)} KRA PIN`, type: "pin", hints: H(`${party} pin`, "kra pin", "pin", "tax id", "vat no", "tin", "pin no") },
    { key: "counterparty", label: `${cap(party)} name`, type: "text", required: true, hints: H(party, `${party} name`, "name", party === "customer" ? "client" : "vendor", "partner") },
    { key: "docType", label: "Document type", type: "text", hints: H("document type", "doc type", "type", "transaction type") },
    { key: "relatedInvoice", label: "Original invoice (credit notes)", type: "code", hints: H("relevant invoice number", "original invoice", "applies to", "related invoice") },
    { key: "taxable", label: "Taxable value (excl. VAT)", type: "money", required: true, hints: H("taxable value", "taxable amount", "net amount", "amount excl", "amount excluding vat", "subtotal", "net") },
    { key: "vat", label: "VAT amount", type: "money", required: true, hints: H("vat amount", "vat", "tax amount", "output vat", "input vat", "tax") },
    { key: "total", label: "Total (incl. VAT)", type: "money", hints: H("total", "gross", "amount incl", "invoice total", "total amount") },
    { key: "rateCode", label: "VAT rate / code", type: "text", hints: H("vat rate", "rate", "vat code", "tax code", "tax rate") },
    { key: "description", label: "Description", type: "text", hints: H("description", "details", "item", "narration", "memo") },
  ];
}
function itaxFields(who) {
  return [
    { key: "pin", label: `PIN of ${who}`, type: "pin", hints: H(`pin of ${who.toLowerCase()}`, "pin") },
    { key: "counterparty", label: `Name of ${who}`, type: "text", hints: H(`name of ${who.toLowerCase()}`, "name") },
    { key: "etrSerial", label: "ETR / CU serial no.", type: "code", hints: H("etr serial number", "etr serial", "cu serial", "cu serial number") },
    { key: "date", label: "Invoice date", type: "date", required: true, hints: H("invoice date", "date") },
    { key: "invoiceNo", label: "Invoice number", type: "code", required: true, hints: H("invoice number", "invoice no", "cu invoice number", "invoice") },
    { key: "description", label: "Description", type: "text", hints: H("description of goods/services", "description of goods", "description") },
    { key: "taxable", label: "Taxable value", type: "money", required: true, hints: H("taxable value (ksh)", "taxable value", "taxable amount") },
    { key: "vat", label: "Amount of VAT", type: "money", hints: H("amount of vat (ksh)", "amount of vat", "vat amount", "vat") },
    { key: "relatedInvoice", label: "Relevant invoice no.", type: "code", hints: H("relevant invoice number", "relevant invoice no") },
    { key: "relatedDate", label: "Relevant invoice date", type: "date", hints: H("relevant invoice date") },
  ];
}
function agingKind(label, party) {
  return {
    label, module: "CFO dashboard (DSO/DPO)", description: `Open ${party} balances by age bucket.`,
    signature: H("current", "30 days", "60 days", "90 days", "over 90"),
    fields: [
      { key: "counterparty", label: cap(party), type: "text", required: true, hints: H(party, `${party} name`, "name", "account name") },
      { key: "current", label: "Current", type: "money", hints: H("current", "not due", "0-30", "0 30", "1-30") },
      { key: "d30", label: "31–60 days", type: "money", hints: H("31-60", "31 60", "30 days", "30-60") },
      { key: "d60", label: "61–90 days", type: "money", hints: H("61-90", "61 90", "60 days", "60-90") },
      { key: "d90", label: "Over 90 days", type: "money", hints: H("over 90", "90+", "91+", "90 days", ">90", "91-120", "120+") },
      { key: "total", label: "Total", type: "money", hints: H("total", "balance", "total due", "outstanding") },
    ],
  };
}
function cap(s) { return s[0].toUpperCase() + s.slice(1); }

const ALL_HINTS = new Set(Object.values(KINDS).flatMap((k) => [...k.fields.flatMap((f) => f.hints), ...k.signature]));

module.exports = { KINDS, ALL_HINTS };
