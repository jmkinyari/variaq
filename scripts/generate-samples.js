// Generates realistic sample CSVs for a Kenyan business-supplies distributor (deterministic, fictional names).
// Run: node scripts/generate-samples.js
const fs = require("fs");
const path = require("path");

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const round = (n, to = 100) => Math.round(n / to) * to;

const ACCT = {
  bank: ["1010", "KCB Operating Account"], ar: ["1100", "Accounts Receivable"], inv: ["1200", "Inventory"],
  ap: ["2000", "Accounts Payable"], vat: ["2200", "VAT Payable"], paye: ["2300", "PAYE & Statutory Payable"],
  sales: ["4000", "Sales"], mat: ["5000", "Cost of Sales"], fuel: ["6100", "Fuel & Delivery"],
  power: ["6200", "Electricity"], wages: ["6300", "Salaries & Wages"], charges: ["6400", "Bank Charges"], rent: ["6500", "Rent"], repairs: ["6600", "Repairs & Maintenance"],
};
const CUSTOMERS = ["Kilele Supermarkets", "Upper Hill Clinics", "Savannah Hotels Ltd", "Westlands Offices Ltd", "Lakeview Schools", "Coastline Logistics", "Rift Valley Agrovet"];
const SUPPLIERS = ["Riverside Wholesalers", "Mlimani Packaging Ltd", "Eastlands Paper Co", "Thika Road Distributors", "Pwani Imports Ltd"];
const lines = []; // ledger lines
let jn = 1000;
function post(date, desc, ref, cp, legs) { // legs: [[acctKey, cents]] summing to zero
  for (const [k, c] of legs) lines.push({ date, desc, ref, acct: ACCT[k], cents: c, cp });
}
const d = (m, day) => `2026-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const bankEvents = []; // April movements that reach the bank, with bank-side details

for (const m of [3, 4]) {
  const scale = m === 4 ? 1 : 0.85;
  // Sales invoices and receipts
  for (let i = 0; i < 9; i++) {
    const cust = pick(CUSTOMERS); const net = round((180000 + rnd() * 900000) * scale); const vat = Math.round(net * 0.16 / 100) * 100;
    const inv = `INV-${m}${String(100 + i)}`; const day = 2 + i * 3;
    post(d(m, day), `Invoice ${inv} ${cust}`, inv, cust, [["ar", (net + vat) * 100], ["sales", -net * 100], ["vat", -vat * 100]]);
    if (i < 7) { // receipt
      const rday = Math.min(28, day + 2 + Math.floor(rnd() * 4));
      const amount = (net + vat) * 100;
      post(d(m, rday), `Receipt ${cust} ${inv}`, inv, cust, [["bank", amount], ["ar", -amount]]);
      if (m === 4) bankEvents.push({ date: d(m, Math.min(30, rday + (rnd() < 0.3 ? 1 : 0))), desc: `RTGS CR ${cust.toUpperCase()} ${inv}`, ref: `FT26${m}${rday}${i}${Math.floor(rnd() * 900 + 100)}`, cents: amount });
    }
  }
  // Supplier bills and payments
  for (let i = 0; i < 6; i++) {
    const sup = pick(SUPPLIERS); const net = round((120000 + rnd() * 500000) * scale); const vat = Math.round(net * 0.16 / 100) * 100;
    const po = `PO-${m}${String(70 + i)}`; const day = 3 + i * 4;
    post(d(m, day), `Bill ${po} ${sup}`, po, sup, [["inv", net * 100], ["vat", vat * 100], ["ap", -(net + vat) * 100]]);
    post(d(m, day), `Cost of goods sold ${po}`, po, sup, [["mat", net * 100], ["inv", -net * 100]]);
    if (i < 5) {
      const pday = Math.min(28, day + 3); const amount = (net + vat) * 100;
      post(d(m, pday), `Payment ${sup} ${po}`, po, sup, [["ap", amount], ["bank", -amount]]);
      if (m === 4) bankEvents.push({ date: d(m, pday), desc: `EFT DR ${sup.toUpperCase()} ${po}`, ref: po, cents: -amount });
    }
  }
  // Operating costs
  const fuelTotal = m === 4 ? 6 : 3; // April fuel spike for the variance report
  for (let i = 0; i < fuelTotal; i++) {
    const vendor = i % 2 ? "Highway Petroleum" : "Savanna Fuels"; const amt = round(38000 + rnd() * 30000) * 100; const day = 4 + i * 4;
    const ref = `QK${m}${String(day).padStart(2, "0")}${String.fromCharCode(65 + i)}X${Math.floor(rnd() * 9000 + 1000)}`;
    post(d(m, day), `Fuel ${vendor} delivery vans`, ref, vendor, [["fuel", amt], ["bank", -amt]]);
    if (m === 4) bankEvents.push({ date: d(m, day), desc: `MPESA B2B ${vendor.toUpperCase()} ${ref}`, ref, cents: -amt });
  }
  const power = round((m === 4 ? 212000 : 168000)) * 100;
  post(d(m, 18), "KPLC electricity warehouse", `KPLC-${m}`, "Kenya Power", [["power", power], ["bank", -power]]);
  if (m === 4) bankEvents.push({ date: d(m, 19), desc: "KPLC PREPAID/POSTPAID 4410023", ref: "KPLC-4", cents: -power });
  const rent = 250000 * 100;
  post(d(m, 1), "Warehouse rent Industrial Area", `RENT-${m}`, "Enterprise Road Properties", [["rent", rent], ["bank", -rent]]);
  if (m === 4) bankEvents.push({ date: d(m, 1), desc: "SO ENTERPRISE ROAD PROPERTIES RENT", ref: "RENT-4", cents: -rent });
  const gross = round(1450000 * (m === 4 ? 1.04 : 1)) * 100; const paye = round(gross / 100 * 0.18) * 100;
  post(d(m, 27), "Payroll net pay", `PAY-${m}`, "Staff", [["wages", gross], ["paye", -paye], ["bank", -(gross - paye)]]);
  if (m === 4) bankEvents.push({ date: d(m, 28), desc: "BULK PAYROLL APR 2026", ref: "PAY-4", cents: -(gross - paye) });
  const charges = (m === 4 ? 4850 : 3900) * 100;
  post(d(m, 30), "Monthly bank charges", `CHG-${m}`, "KCB", [["charges", charges], ["bank", -charges]]);
  if (m === 4) bankEvents.push({ date: d(m, 30), desc: "LEDGER FEES & CHARGES", ref: "", cents: -charges });
}
// April-only: a van repair paid by cheque that hasn't cleared the bank (unmatched ledger)
post(d(4, 26), "Repairs to delivery van - cheque 000412", "CHQ000412", "Mombasa Road Motors", [["repairs", 96000 * 100], ["bank", -96000 * 100]]);
// Bank-only items (unmatched bank): extra charges + an unidentified deposit
bankEvents.push({ date: d(4, 15), desc: "EXCISE DUTY ON BANK CHARGES", ref: "", cents: -1240 * 100 });
bankEvents.push({ date: d(4, 22), desc: "CASH DEPOSIT BRANCH 0412", ref: "CD220412", cents: 45000 * 100 });
// Amount mismatch: supplier paid KES 2,000 less at the bank than recorded (discount not posted)
const mm = bankEvents.find((e) => e.desc.startsWith("EFT DR")); mm.cents += 2000 * 100;
// Duplicate line on the statement
const dupSrc = bankEvents.find((e) => e.desc.startsWith("MPESA B2B")); bankEvents.push({ ...dupSrc });

// ---- write ledger CSV (Date, Journal, Narration, Account Code, Account Name, Debit, Credit, Counterparty)
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const fmt = (c) => (Math.abs(c) / 100).toFixed(2);
lines.sort((a, b) => a.date.localeCompare(b.date));
const ledgerRows = [["Date", "Reference", "Narration", "Account Code", "Account Name", "Debit", "Credit", "Counterparty"]];
for (const l of lines) ledgerRows.push([l.date, l.ref, l.desc, l.acct[0], l.acct[1], l.cents > 0 ? fmt(l.cents) : "", l.cents < 0 ? fmt(l.cents) : "", l.cp]);
// ---- write bank CSV (DD/MM/YYYY, Money in/out, running balance)
bankEvents.sort((a, b) => a.date.localeCompare(b.date));
let bal = 3250000 * 100;
const bankRows = [["Transaction Date", "Details", "Reference", "Money Out", "Money In", "Balance"]];
for (const e of bankEvents) { bal += e.cents; const [y, mo, da] = e.date.split("-"); bankRows.push([`${da}/${mo}/${y}`, e.desc, e.ref, e.cents < 0 ? fmt(e.cents) : "", e.cents > 0 ? fmt(e.cents) : "", (bal / 100).toFixed(2)]); }

const out = path.join(__dirname, "..", "public", "samples");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "ledger-sample.csv"), ledgerRows.map((r) => r.map(csv).join(",")).join("\n") + "\n");
fs.writeFileSync(path.join(out, "bank-statement-sample.csv"), bankRows.map((r) => r.map(csv).join(",")).join("\n") + "\n");
console.log(`ledger-sample.csv: ${lines.length} lines · bank-statement-sample.csv: ${bankEvents.length} lines`);
