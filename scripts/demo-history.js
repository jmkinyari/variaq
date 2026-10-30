// Deterministic journal history for the demo company: May 2024 – Feb 2026 (22 months) with
// seasonality, growth, journal numbers, users and timestamps — plus a handful of deliberately
// planted control issues so the journal-audit, completeness and misposting engines have
// something real to find. All names are fictional.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r100 = (n) => Math.round(n / 100) * 100;

const A = {
  bank: ["1010", "KCB Operating Account"], mpesa: ["1020", "M-Pesa Till 552211"], ar: ["1100", "Accounts Receivable"], inv: ["1200", "Inventory"], prepay: ["1300", "Prepayments"],
  vehicles: ["1500", "Motor Vehicles"], equipment: ["1510", "Office Equipment"], accdep: ["1590", "Accumulated Depreciation"], suspense: ["1900", "Suspense Account"],
  ap: ["2000", "Accounts Payable"], accruals: ["2100", "Accruals"], vat: ["2200", "VAT Payable"], paye: ["2300", "PAYE & Statutory Payable"], loan: ["2500", "KCB Term Loan"],
  capital: ["3000", "Share Capital"], retained: ["3100", "Retained Earnings"],
  sales: ["4000", "Sales"], mat: ["5000", "Cost of Sales"], fuel: ["6100", "Fuel & Delivery"], power: ["6200", "Electricity"], wages: ["6300", "Salaries & Wages"],
  charges: ["6400", "Bank Charges"], rent: ["6500", "Rent"], repairs: ["6600", "Repairs & Maintenance"], dep: ["6700", "Depreciation"], insurance: ["6800", "Insurance"],
  airtime: ["6900", "Airtime & Internet"], interest: ["8100", "Interest Expense"],
};
const CUSTOMERS = ["Kilele Supermarkets", "Upper Hill Clinics", "Savannah Hotels Ltd", "Westlands Offices Ltd", "Lakeview Schools", "Coastline Logistics", "Rift Valley Agrovet"];
const SUPPLIERS = ["Riverside Wholesalers", "Mlimani Packaging Ltd", "Eastlands Paper Co", "Thika Road Distributors", "Pwani Imports Ltd"];
const USERS = ["jane.wanjiku", "tom.otieno", "grace.achieng"];
// Retail seasonality: school terms (Jan, May, Sep) and December peak.
const SEASON = [1.12, 0.92, 0.97, 0.95, 1.08, 0.96, 0.94, 0.97, 1.1, 1.0, 1.02, 1.17];

function generateHistory() {
  const lines = [];
  let jn = 1;
  const months = [];
  for (let y = 2024, m = 5; !(y === 2026 && m === 3); m === 12 ? (y++, m = 1) : m++) months.push([y, m]);
  const ds = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, "0")}`;
  const stamp = (date, hour = 9 + Math.floor(rnd() * 8), lagDays = 0) => new Date(Date.parse(date + "T00:00:00+03:00") + lagDays * 86400000 + hour * 3600000 + Math.floor(rnd() * 3600) * 1000).toISOString();
  function post(date, desc, ref, cp, legs, o = {}) {
    // Businesses post on working days: roll weekend dates to Monday unless a planted issue needs the date.
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    if (!o.keepDate && (dow === 0 || dow === 6)) date = new Date(Date.parse(date + "T00:00:00Z") + (dow === 6 ? 2 : 1) * 86400000).toISOString().slice(0, 10);
    const journalNo = o.journalNo || `JV-${String(jn++).padStart(5, "0")}`;
    const user = o.user || pick(USERS);
    const postedAt = o.postedAt || stamp(date, undefined, o.lag || 0);
    legs.forEach(([k, cents], i) => lines.push({
      date, description: o.lineDesc?.[i] ?? desc, reference: ref, accountCode: A[k][0], accountName: A[k][1], amountCents: cents, counterparty: cp,
      journalNo, lineNo: i + 1, postedBy: user, approvedBy: o.approvedBy === undefined ? (o.manual ? "cfo.mwangi" : null) : o.approvedBy, postedAt,
      entryType: o.manual ? "MANUAL" : o.type || "SYSTEM", currency: "KES",
    }));
    return journalNo;
  }

  // Opening position.
  post("2024-05-01", "Opening balances", "OB-2024", null, [["bank", 850000000], ["vehicles", 620000000], ["equipment", 95000000], ["inv", 310000000], ["capital", -500000000], ["loan", -900000000], ["retained", -475000000]], { manual: true, user: "grace.achieng" });

  months.forEach(([y, m], idx) => {
    const growth = 1 + idx * 0.012;
    const season = SEASON[m - 1];
    const nSales = 8 + Math.floor(rnd() * 4);
    for (let i = 0; i < nSales; i++) {
      const cust = pick(CUSTOMERS); const net = r100((200000 + rnd() * 800000) * growth * season); const vat = r100(net * 0.16);
      const inv = `INV-${y}${String(m).padStart(2, "0")}${String(i + 1).padStart(2, "0")}`; const day = 2 + i * 2 + Math.floor(rnd() * 2);
      post(ds(y, m, day), `Invoice ${inv} ${cust}`, inv, cust, [["ar", (net + vat) * 100], ["sales", -net * 100], ["vat", -vat * 100]], { type: "SALES" });
      post(ds(y, m, day), `Cost of goods sold ${inv}`, inv, cust, [["mat", r100(net * 0.62) * 100], ["inv", -r100(net * 0.62) * 100]], { type: "INVENTORY" });
      if (rnd() < 0.85) { const amt = (net + vat) * 100; post(ds(y, m, Math.min(28, day + 3 + Math.floor(rnd() * 10))), `Receipt ${cust} ${inv}`, inv, cust, [[rnd() < 0.2 ? "mpesa" : "bank", amt], ["ar", -amt]], { type: "RECEIPT" }); }
    }
    for (let i = 0; i < 5; i++) {
      const sup = pick(SUPPLIERS); const net = r100((150000 + rnd() * 450000) * growth); const vat = r100(net * 0.16);
      const bill = `BILL-${y}${String(m).padStart(2, "0")}${i + 1}`; const day = 3 + i * 5;
      post(ds(y, m, day), `Bill ${bill} ${sup}`, bill, sup, [["inv", net * 100], ["vat", vat * 100], ["ap", -(net + vat) * 100]], { type: "PURCHASE" });
      if (rnd() < 0.9) post(ds(y, m, Math.min(28, day + 6)), `Payment ${sup} ${bill}`, bill, sup, [["ap", (net + vat) * 100], ["bank", -(net + vat) * 100]], { type: "PAYMENT" });
    }
    const opex = (k, desc, ref, cp, base, day, acct = "bank") => { const amt = r100(base * (0.9 + rnd() * 0.2)) * 100; post(ds(y, m, day), desc, ref, cp, [[k, amt], [acct, -amt]], { type: "PAYMENT" }); };
    for (let i = 0; i < 3 + Math.floor(rnd() * 3); i++) opex("fuel", `Fuel ${i % 2 ? "Highway Petroleum" : "Savanna Fuels"} delivery vans`, `FUEL-${y}${m}${i}`, i % 2 ? "Highway Petroleum" : "Savanna Fuels", 42000 * growth, 4 + i * 5, "mpesa");
    opex("power", "KPLC electricity warehouse", `KPLC-${y}${m}`, "Kenya Power", 175000 * growth, 18);
    if (!(y === 2025 && m === 11)) post(ds(y, m, 1), "Warehouse rent Industrial Area", `RENT-${y}${m}`, "Enterprise Road Properties", [["rent", 25000000], ["bank", -25000000]], { type: "PAYMENT" }); // Nov 2025 rent missing → completeness test
    opex("airtime", "Safaricom airtime and internet bundles", `SAF-${y}${m}`, "Safaricom", 18000, 6, "mpesa");
    opex("insurance", "Jubilee motor insurance premium", `INS-${y}${m}`, "Jubilee Insurance", 32000, 10);
    const gross = r100(1400000 * (1 + Math.floor(idx / 12) * 0.06)) * 100; const stat = r100(gross / 100 * 0.24) * 100;
    post(ds(y, m, 27), "Payroll net pay", `PAY-${y}${m}`, "Staff", [["wages", gross], ["paye", -stat], ["bank", -(gross - stat)]], { type: "PAYROLL", user: "grace.achieng" });
    post(ds(y, m, 9), "PAYE, SHIF, NSSF and AHL remittance", `KRA-PAYE-${y}${m}`, "Kenya Revenue Authority", [["paye", stat], ["bank", -stat]], { type: "PAYMENT" });
    post(ds(y, m, 28), "Monthly depreciation vehicles and equipment", `DEP-${y}${m}`, null, [["dep", 1180000], ["accdep", -1180000]], { manual: true, user: "grace.achieng" });
    post(ds(y, m, 25), "KCB term loan instalment", `LOAN-${y}${m}`, "KCB Bank", [["loan", 2100000], ["interest", 940000], ["bank", -3040000]], { type: "PAYMENT" });
    opex("charges", "Monthly bank charges", `CHG-${y}${m}`, "KCB", 4200, 30);
  });

  // ---- Planted control issues -------------------------------------------------------------
  // 1. Large round manual journal on a Sunday night, self-approved, vague description.
  post("2025-06-29", "Adjustment", "ADJ-0629", null, [["sales", -500000000], ["suspense", 500000000]], { manual: true, user: "tom.otieno", approvedBy: "tom.otieno", postedAt: "2025-06-29T19:47:00.000Z", keepDate: true });
  // 2. Unbalanced journal (import error).
  post("2025-08-14", "Accrual for audit fees", "ACR-0814", "Kamau & Partners", [["repairs", 18000000], ["accruals", -17500000]], { manual: true, user: "jane.wanjiku" });
  // 3. Duplicate supplier bill posted twice.
  const dupLegs = [["inv", 34500000], ["vat", 5520000], ["ap", -40020000]];
  post("2025-09-05", "Bill BILL-DUP Mlimani Packaging Ltd", "MPL-55871", "Mlimani Packaging Ltd", dupLegs, { type: "PURCHASE" });
  post("2025-09-06", "Bill BILL-DUP Mlimani Packaging Ltd", "MPL-55871", "Mlimani Packaging Ltd", dupLegs, { type: "PURCHASE" });
  // 4. Mispostings: fuel to motor vehicles, a laptop to repairs, KPLC to rent.
  post("2025-10-12", "Fuel Savanna Fuels delivery vans", "FUEL-MIS1", "Savanna Fuels", [["vehicles", 5150000], ["mpesa", -5150000]], { type: "PAYMENT" });
  post("2025-11-03", "Dell laptop for finance team", "LAP-1103", "Hotpoint Electronics", [["repairs", 18500000], ["bank", -18500000]], { type: "PAYMENT" });
  post("2026-01-18", "KPLC electricity warehouse", "KPLC-MIS", "Kenya Power", [["rent", 19800000], ["bank", -19800000]], { type: "PAYMENT" });
  // 5. Backdated entry posted 40 days after its date, just below a 1,000,000 approval limit.
  post("2025-12-30", "Year-end stock write-down", "ADJ-1230", null, [["mat", 99950000], ["inv", -99950000]], { manual: true, user: "jane.wanjiku", approvedBy: null, lag: 40 });
  // 6. Cut-off: revenue booked on the last day of December and reversed on 3 January.
  post("2025-12-31", "Accrued revenue Savannah Hotels Ltd", "CUT-1231", "Savannah Hotels Ltd", [["ar", 116000000], ["sales", -100000000], ["vat", -16000000]], { manual: true, user: "tom.otieno" });
  post("2026-01-03", "Reverse accrued revenue Savannah Hotels Ltd", "CUT-1231R", "Savannah Hotels Ltd", [["ar", -116000000], ["sales", 100000000], ["vat", 16000000]], { manual: true, user: "tom.otieno" });
  // 7. Gap in the journal number sequence.
  jn += 3;
  post("2026-02-20", "Petty cash top-up", "PC-0220", null, [["mpesa", 2000000], ["bank", -2000000]], { user: "jane.wanjiku" });

  return lines;
}

module.exports = { generateHistory, ACCOUNTS: A };
