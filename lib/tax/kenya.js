// Kenyan tax reference data used by the tax engine. Every item carries its source and effective
// date; items we could not confirm from a primary KRA/statutory source are flagged `unverified`.
// Research snapshot: 29 Oct 2026. Tax law changes every Finance Act — the UI shows these sources
// and asks the finance team to verify before relying on them.
const S = {
  vatGuide: "https://www.kra.go.ke/images/publications/Pre-populated-VAT-return-Step-by-Step-Guide-27-11-2023.pdf",
  vatFaq: "https://www.kra.go.ke/images/publications/FAQS-FOR-THE-VAT-AUTOPOPULATED-RETURN-090724.pdf",
  pwcOther: "https://taxsummaries.pwc.com/Kenya/Corporate/Other-taxes",
  pwcWht: "https://taxsummaries.pwc.com/Kenya/Corporate/Withholding-taxes",
  pwcAdmin: "https://taxsummaries.pwc.com/Kenya/Corporate/Tax-administration",
  pwcPit: "https://taxsummaries.pwc.com/Kenya/Individual/Taxes-on-personal-income",
  whvat: "https://www.kra.go.ke/images/publications/Overview-of-Withholding-VAT-December-2024.pdf",
  penalties: "https://www.kra.go.ke/business/business-compliance-penalties/business-how-to-file/business-offences-penalties",
  ey2026: "https://globaltaxnews.ey.com/news/2026-1445",
  payeGuide: "https://www.kra.go.ke/images/publications/STEP-BY-STEP-GUIDE-FOR-THE-SIMPLIFIED-PAYE-RETURN.pdf",
  payeTla2024: "https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act%2C-2024",
  nssf2026: "https://www.pwc.com/ke/en/assets/pdf/tax-alert-year-4nssf-rates-2026.pdf",
  etimsKpmg: "https://assets.kpmg.com/content/dam/kpmgsites/ke/pdf/thought_leaderships/tax/2026/eTIMS.pdf.coredownload.inline.pdf",
  itr2025: "https://www.kra.go.ke/news-center/public-notices/2375-filing-of-2025-income-tax-returns",
  whtBrochure: "https://www.kra.go.ke/images/publications/KRA-Withholding-Income-Tax-reviewed.pdf",
  tot: "https://www.kra.go.ke/news-center/public-notices/676-turnover-tax",
  sep: "https://taxnews.ey.com/news/2025-0233",
  pinStdnum: "https://arthurdejong.org/python-stdnum/doc/stdnum.ke.pin",
};

const VAT = {
  standardRate: { value: 16, effective: "2013-09-02", source: S.pwcOther },
  fuelRate: { value: 8, effective: "2023-07-01", source: S.pwcOther },
  zeroRate: { value: 0, source: S.pwcOther, note: "Finance Act 2026 narrows zero-rating (e-bikes, solar/lithium batteries) from 1 Jul 2026.", noteSource: S.ey2026 },
  registrationThresholdCents: { value: 5_000_000_00, source: S.pwcOther, note: "KES 5m taxable supplies in 12 months." },
  inputClaimMonths: { value: 6, source: S.vatFaq, note: "Input VAT claimable within 6 months after the end of the tax period of supply/import (VAT Act s.17(2))." },
  creditNoteMonths: { value: 6, source: S.vatFaq, note: "Sales credit notes within 6 months of the invoice date; original must be declared as a line item." },
  invoiceNoMaxLen: { value: 40, source: S.vatGuide },
  maxRowsPerCsv: { value: 50_000, source: S.vatGuide },
  prohibitedInput: { value: ["passenger cars and minibuses (and repairs)", "entertainment", "restaurant", "accommodation"], source: S.vatFaq, note: "VAT Act s.17(4), subject to exceptions." },
};
const WHVAT = { rate: { value: 2, source: S.whvat, note: "2% of taxable value withheld by appointed agents; supplier receives the other 14%." } };

const WHT_RATES = [
  // [payment, resident %, non-resident %]
  ["Management / professional / training fees", 5, 20],
  ["Consultancy (EAC citizens)", 5, 15],
  ["Contractual fees", 3, 20],
  ["Royalties", 5, 20],
  ["Interest (general)", 15, 15],
  ["Bearer instruments", 25, 25],
  ["Dividends (voting power < 12.5%)", 5, 15],
  ["Dividends (voting power ≥ 12.5%)", 0, 15],
  ["Rent — immovable property", null, 30],
  ["Rent — other", null, 15],
  ["Sales promotion / marketing / advertising", 5, 20],
  ["Insurance premiums", 5, null],
  ["Digital content / digital marketplace", 5, 20],
  ["Goods supplied to public entities", 0.5, 5],
  ["Scrap metal", 1.5, 1.5],
  ["Winnings", 20, 20],
].map(([payment, resident, nonResident]) => ({ payment, resident, nonResident, source: S.pwcWht, reviewed: "2026-07-17" }));

const PAYE = {
  monthlyBands: [[24_000, 10], [8_333, 25], [467_667, 30], [300_000, 32.5], [Infinity, 35]],
  personalReliefMonthly: 2_400,
  insuranceReliefPct: 15, insuranceReliefCapMonthly: 5_000,
  effective: "2023-07-01", source: S.pwcPit,
  deductibleBeforePaye: { note: "SHIF, AHL, PRMF (≤15,000/m), mortgage interest (≤30,000/m), pension incl. NSSF (≤30,000/m) deducted before PAYE from 27 Dec 2024.", source: S.payeTla2024 },
};
const PAYROLL = {
  shif: { rate: 2.75, effective: "2024-10-01", source: S.pwcOther, note: "2.75% of gross, no cap." },
  ahl: { employee: 1.5, employer: 1.5, effective: "2024-03-01", source: S.pwcOther },
  nssf: { rate: 6, lel: 9_000, uel: 108_000, tier1Max: 540, tier2Max: 5_940, maxPerSide: 6_480, effective: "2026-02-01", source: S.nssf2026 },
  nita: { perEmployee: 50, source: S.payeGuide },
};
const OTHER = {
  corporationTax: { rate: 30, source: "https://aln.africa/?p=6196" },
  turnoverTax: { rate: 3, bandKes: [1_000_000, 25_000_000], source: S.tot, unverified: true, note: "Band from secondary sources, consistent with Finance Act 2023." },
  residentialRental: { rate: 7.5, source: S.pwcPit },
  sep: { effectiveRate: 3, effective: "2024-12-27", source: S.sep, note: "30% on deemed profit of 10% of turnover; DST repealed." },
};

// Filing deadlines (day of the following month unless stated). `rollForward`: KRA practice is to
// move a deadline falling on a weekend/public holiday to the next working day.
const OBLIGATIONS = [
  { code: "VAT3", name: "VAT return & payment", day: 20, source: S.vatGuide, unverified: true, note: "VAT Act s.44; nil returns are mandatory." },
  { code: "PAYE", name: "PAYE (P10), AHL, NITA", day: 9, source: S.pwcOther, unverified: true, note: "Simplified Excel P10 mandatory from July 2025 period." },
  { code: "SHIF", name: "SHIF contributions", day: 9, source: S.pwcOther },
  { code: "WHT", name: "Withholding income tax", day: 20, source: S.whtBrochure },
  { code: "WHVAT", name: "Withholding VAT remittance", workingDaysAfterDeduction: 5, source: S.whvat, note: "Within 5 working days of deduction (KRA leaflet also says '5th of following month')." },
  { code: "TOT", name: "Turnover tax", day: 20, source: S.tot, appliesIf: "tot" },
  { code: "INSTALMENT", name: "Instalment tax", fyMonths: [4, 6, 9, 12], day: 20, source: S.pwcAdmin },
  { code: "IT2C", name: "Company income tax return", monthsAfterYearEnd: 6, source: S.pwcAdmin },
];

const PENALTIES = {
  VAT3: { lateFiling: { pct: 5, minKes: 10_000 }, latePayment: { pct: 5, interestMonthlyPct: 1 }, source: S.penalties },
  PAYE: { lateFiling: { pct: 25, minKes: 10_000 }, latePayment: { pct: 5, interestMonthlyPct: 1 }, source: S.penalties },
  WHT: { latePayment: { pct: 5, interestMonthlyPct: 1 }, source: S.penalties },
  WHVAT: { latePayment: { pct: 10, interestMonthlyPct: 1 }, failureToDeduct: { pct: 10 }, source: S.whvat },
  SHIF: { latePayment: { pct: 0, interestMonthlyPct: 0 }, source: S.pwcOther, unverified: true },
  INSTALMENT: { latePayment: { pct: 0, interestMonthlyPct: 1 }, source: S.penalties, unverified: true },
  IT2C: { lateFiling: { pct: 5, minKes: 20_000 }, latePayment: { pct: 5, interestMonthlyPct: 1 }, source: S.penalties },
  TOT: { lateFilingFlatMonthlyKes: 1_000, latePayment: { pct: 5, interestMonthlyPct: 1 }, source: S.tot, unverified: true },
  ETIMS: { pct: 5, minKesCompany: 100_000, minKesIndividual: 10_000, source: S.ey2026, note: "Finance Act 2026 replacement of TPA s.86 — after notice and review." },
  AHL: { latePaymentMonthlyPct: 3, source: S.pwcOther },
};

// eTIMS: from 1 Jan 2024 an expense is deductible only if backed by an eTIMS/TIMS invoice
// (ITA s.16(1)(c) as amended by Finance Act 2023); full return-time validation from 1 Jan 2026.
const ETIMS = {
  deductibilityFrom: "2024-01-01", fullValidationFrom: "2026-01-01", source: S.etimsKpmg, validationSource: S.itr2025,
  exemptCategories: [
    { key: "PAYROLL", label: "Emoluments subject to PAYE", re: /(salar|wage|payroll|paye|nssf|shif|nhif|housing levy|ahl|pension|gratuity|staff cost|casual)/i },
    { key: "IMPORT", label: "Imports (customs) and imported services", re: /(import|customs|duty|idf|freight in|clearing|offshore|foreign supplier)/i },
    { key: "FINANCE", label: "Bank, insurance and financial-institution core fees, interest", re: /(bank charge|bank fee|interest|insurance|premium|commission on|ledger fee|mpesa charge|transaction fee|forex|exchange)/i },
    { key: "WHT_FINAL", label: "Payments subject to final WHT (dividends, some interest)", re: /(dividend)/i },
    { key: "INTERNAL", label: "Internal journals that are not supplies", re: /(depreciation|amortis|amortiz|accrual|provision|revaluation|write[- ]?off|impairment|reclass|allocation|unrealised|unrealized)/i },
    { key: "AIRLINE", label: "Airline passenger ticketing", re: /(air ticket|airline|flight ticket)/i },
  ],
  notExempt: "Government fees (licences, court fees) are NOT exempt.",
};

const PIN_RE = /^[AP]\d{9}[A-Z]$/;
const PIN_SOURCE = S.pinStdnum;

// Kenyan public holidays (fixed-date) plus known movable dates. Movable holidays (Easter, Eid)
// are listed for the years we support; add more years as KRA/Gazette notices are published.
const FIXED_HOLIDAYS = ["01-01", "05-01", "06-01", "10-10", "10-20", "12-12", "12-25", "12-26"];
const MOVABLE_HOLIDAYS = [
  "2024-03-29", "2024-04-01", "2024-04-10",
  "2025-03-31", "2025-04-18", "2025-04-21", "2025-06-06",
  "2026-03-20", "2026-04-03", "2026-04-06", "2026-05-27",
  "2027-03-10", "2027-03-26", "2027-03-29", "2027-05-17",
];

module.exports = { SOURCES: S, VAT, WHVAT, WHT_RATES, PAYE, PAYROLL, OTHER, OBLIGATIONS, PENALTIES, ETIMS, PIN_RE, PIN_SOURCE, FIXED_HOLIDAYS, MOVABLE_HOLIDAYS };
