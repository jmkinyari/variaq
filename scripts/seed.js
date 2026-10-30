// Seeds a demo workspace: 24 months of journals (with planted control issues), bank statement and
// reconciliation, variance report, trial balance from a legacy ERP, group chart, ageing, team with
// an accountant and an external auditor, plus module demo data where a module provides it.
// Demo logins (local testing only) — password for all: variaq-demo-2026
//   demo@variaq.test (Owner / CFO) · accountant@variaq.test (Accountant) · auditor@variaq.test (External auditor)
//   admin@variaq.test (Variaq system administrator: /admin console, AI service)
require("./load-env");
const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");
const bcrypt = require("bcryptjs");
const db = require("../lib/db");
const { validateRows, guessMapping } = require("../lib/csv-import");
const { detectDateFormat } = require("../lib/dates");
const { createWorkspace } = require("../lib/workspace");
const { runMatching } = require("../lib/recon");
const { computeFlux } = require("../lib/flux");
const { KENYA_TAX_STARTER } = require("../lib/templates");
const { generateHistory } = require("./demo-history");
const { sealWorkspace } = require("../lib/audit-chain");

const PASSWORD = "variaq-demo-2026";
const ADMIN_EMAIL = "admin@variaq.test";
const USERS = [
  { email: "demo@variaq.test", name: "Wanjiru Mwangi (CFO)", role: "OWNER" },
  { email: "accountant@variaq.test", name: "Jane Wanjiku", role: "MEMBER" },
  { email: "auditor@variaq.test", name: "Peter Kamau (External auditor)", role: "AUDITOR" },
];
const LEDGER_COLS = ["id", "workspace_id", "import_id", "date", "description", "reference", "account_code", "account_name", "amount_cents", "counterparty", "created_at",
  "journal_no", "line_no", "source", "entry_type", "posted_by", "approved_by", "posted_at", "currency"];

function readCsv(name) {
  const text = fs.readFileSync(path.join(__dirname, "..", "public", "samples", name), "utf8");
  const res = Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return { headers: res.meta.fields, rows: res.data };
}

(async () => {
  await db.ensureSchema();
  if (await db.get("SELECT id FROM users WHERE email = ?", [USERS[0].email])) { console.log(`Demo data already exists. Sign in with ${USERS[0].email} / ${PASSWORD}`); return; }
  const t = db.now();
  const hash = await bcrypt.hash(PASSWORD, 12);
  const ids = {};
  for (const u of USERS) { ids[u.email] = db.id(); await db.run("INSERT INTO users (id, email, name, password_hash, created_at, password_changed_at) VALUES (?,?,?,?,?,?)", [ids[u.email], u.email, u.name, hash, t, t]); }
  const userId = ids[USERS[0].email];
  const { id: wsId, slug } = await createWorkspace({ name: "Demo Supplies Ltd", industry: "Business supplies distribution", ownerId: userId, period: "2026-04" });
  for (const u of USERS.slice(1)) await db.run("INSERT INTO memberships (id, user_id, workspace_id, role, created_at) VALUES (?,?,?,?,?)", [db.id(), ids[u.email], wsId, u.role, t]);

  // ---- 22 months of history from the "ERP" ---------------------------------------------------
  const hist = generateHistory();
  const histImp = db.id();
  await db.batch([
    { sql: "INSERT INTO ledger_imports (id, workspace_id, file_name, row_count, skipped, created_by, created_at, source) VALUES (?,?,?,?,?,?,?,?)", args: [histImp, wsId, "Sage300_GL_May2024-Feb2026.xlsx", hist.length, 0, userId, t, "Sage 300 (demo)"] },
    ...db.insertMany("ledger_entries", LEDGER_COLS, hist.map((r) => [db.id(), wsId, histImp, r.date, r.description, r.reference, r.accountCode, r.accountName, r.amountCents, r.counterparty, t, r.journalNo, r.lineNo, "Sage 300 (demo)", r.entryType, r.postedBy, r.approvedBy, r.postedAt, r.currency])),
  ]);

  // ---- March–April 2026 sample ledger (CSV) ---------------------------------------------------
  const L = readCsv("ledger-sample.csv");
  const lm = guessMapping("ledger", L.headers);
  const lv = validateRows("ledger", L.rows, lm, { dateFormat: detectDateFormat(L.rows.map((r) => r[lm.date])) });
  // Give the CSV lines journal numbers by grouping date + reference, as an ERP export would.
  const jmap = new Map(); let jn = 90000;
  const impId = db.id();
  const rows = lv.valid.map((r, i) => {
    const k = `${r.date}|${r.reference || r.description}`;
    if (!jmap.has(k)) jmap.set(k, { no: `JV-${++jn}`, line: 0 });
    const j = jmap.get(k); j.line++;
    const posted = new Date(Date.parse(r.date + "T10:00:00+03:00") + (i % 7) * 3600000).toISOString();
    return [db.id(), wsId, impId, r.date, r.description, r.reference, r.accountCode, r.accountName, r.amountCents, r.counterparty, t, j.no, j.line, "Sage 300 (demo)", "SYSTEM", ["jane.wanjiku", "tom.otieno"][i % 2], null, posted, "KES"];
  });
  await db.batch([
    { sql: "INSERT INTO ledger_imports (id, workspace_id, file_name, row_count, skipped, created_by, created_at, source) VALUES (?,?,?,?,?,?,?,?)", args: [impId, wsId, "ledger-sample.csv", lv.valid.length, lv.errors.length, userId, t, "Sage 300 (demo)"] },
    ...db.insertMany("ledger_entries", LEDGER_COLS, rows),
  ]);

  // ---- Bank account, statement and reconciliation --------------------------------------------
  const bankId = db.id();
  await db.run("INSERT INTO bank_accounts (id, workspace_id, name, bank_name, account_mask, currency, ledger_account_code, created_at) VALUES (?,?,?,?,?,?,?,?)", [bankId, wsId, "KCB Operating Account", "KCB", "4471", "KES", "1010", t]);
  await db.run("INSERT INTO bank_accounts (id, workspace_id, name, bank_name, account_mask, currency, ledger_account_code, created_at) VALUES (?,?,?,?,?,?,?,?)", [db.id(), wsId, "M-Pesa Till 552211", "Safaricom", "2211", "KES", "1020", t]);
  const B = readCsv("bank-statement-sample.csv");
  const bm = guessMapping("bank", B.headers);
  const bv = validateRows("bank", B.rows, bm, { dateFormat: detectDateFormat(B.rows.map((r) => r[bm.date])) });
  const stId = db.id();
  await db.batch([
    { sql: "INSERT INTO bank_statements (id, workspace_id, bank_account_id, file_name, period_start, period_end, row_count, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", args: [stId, wsId, bankId, "bank-statement-sample.csv", "2026-04-01", "2026-04-30", bv.valid.length, userId, t] },
    ...bv.valid.map((r) => ({ sql: "INSERT INTO bank_transactions (id, workspace_id, statement_id, date, description, reference, amount_cents, balance_cents) VALUES (?,?,?,?,?,?,?,?)", args: [db.id(), wsId, stId, r.date, r.description, r.reference, r.amountCents, r.balanceCents] })),
  ]);
  const recId = db.id();
  await db.run("INSERT INTO reconciliations (id, workspace_id, bank_account_id, statement_id, name, status, date_window, large_amount_cents, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [recId, wsId, bankId, stId, "KCB Operating · April 2026", "IN_PROGRESS", 3, 100000000, userId, t, t]);
  const r = await runMatching(recId);

  // ---- Variance report April vs March ---------------------------------------------------------
  const entries = await db.all("SELECT id, date, description, reference, account_code accountCode, account_name accountName, amount_cents amountCents, counterparty FROM ledger_entries WHERE workspace_id = ? AND date >= '2026-03-01'", [wsId]);
  const p = { baseStart: "2026-03-01", baseEnd: "2026-03-31", compStart: "2026-04-01", compEnd: "2026-04-30", thresholdPct: 10, thresholdCents: 5000000 };
  const flux = computeFlux(entries, p);
  await db.run("INSERT INTO reports (id, workspace_id, name, base_start, base_end, comp_start, comp_end, threshold_pct, threshold_cents, data, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [db.id(), wsId, "April 2026 vs March 2026", p.baseStart, p.baseEnd, p.compStart, p.compEnd, 10, 5000000, JSON.stringify(flux), userId, t, t]);

  // ---- Legacy ERP trial balance (different chart) + group reporting chart ----------------------
  const LEGACY = { "1010": ["BNK-001", "Bank - KCB Current"], "1020": ["BNK-002", "Mobile Money Till"], "1100": ["DR-100", "Debtors Control"], "1200": ["STK-100", "Stock on Hand"], "1500": ["FA-200", "Motor Vehicles at Cost"], "1510": ["FA-210", "Office Furniture & Computers"], "1590": ["FA-290", "Acc. Depn - Fixed Assets"], "1900": ["SUS-999", "Suspense"], "2000": ["CR-100", "Creditors Control"], "2100": ["CR-200", "Accrued Expenses"], "2200": ["TAX-100", "Output/Input VAT Control"], "2300": ["TAX-200", "PAYE NSSF SHIF Payable"], "2500": ["LN-100", "Long Term Loan KCB"], "3000": ["EQ-100", "Ordinary Share Capital"], "3100": ["EQ-200", "Retained Profits"], "4000": ["INC-100", "Turnover"], "5000": ["COS-100", "Cost of Goods Sold"], "6100": ["EXP-110", "Motor Fuel"], "6200": ["EXP-120", "Power & Lighting"], "6300": ["EXP-130", "Staff Salaries"], "6400": ["EXP-140", "Bank Charges & Commissions"], "6500": ["EXP-150", "Rent - Warehouse"], "6600": ["EXP-160", "Repairs"], "6700": ["EXP-170", "Depreciation Charge"], "6800": ["EXP-180", "Insurance Premiums"], "6900": ["EXP-190", "Telephone & Internet"], "8100": ["FIN-100", "Interest on Loans"] };
  const tbRows = await db.all("SELECT account_code, MAX(account_name) n, SUM(amount_cents) bal FROM ledger_entries WHERE workspace_id = ? AND date <= '2025-12-31' GROUP BY account_code", [wsId]);
  const tbId = db.id();
  const legacyLines = tbRows.filter((x) => LEGACY[x.account_code]).map((x) => {
    let bal = x.bal;
    if (x.account_code === "6100") bal += 5150000; // the legacy system had the fuel misposting on the right account
    if (x.account_code === "1500") bal -= 5150000;
    return [db.id(), wsId, tbId, LEGACY[x.account_code][0], LEGACY[x.account_code][1], bal];
  });
  await db.batch([
    { sql: "INSERT INTO tb_imports (id, workspace_id, chart, as_at, file_name, row_count, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)", args: [tbId, wsId, "Legacy ERP", "2025-12-31", "legacy_tb_dec2025.xlsx", legacyLines.length, userId, t] },
    ...db.insertMany("tb_lines", ["id", "workspace_id", "import_id", "account_code", "account_name", "balance_cents"], legacyLines),
    ...db.insertMany("coa_accounts", ["workspace_id", "chart", "code", "name", "class", "parent_code", "created_at"], Object.values(LEGACY).map(([c, n]) => [wsId, "Legacy ERP", c, n, null, null, t])),
  ]);
  const GROUP = [["GA-110", "Cash and cash equivalents", "CURRENT_ASSET"], ["GA-120", "Trade receivables", "CURRENT_ASSET"], ["GA-130", "Inventories", "CURRENT_ASSET"], ["GA-140", "Prepayments and other receivables", "CURRENT_ASSET"], ["GA-210", "Property, plant and equipment", "NONCURRENT_ASSET"], ["GA-290", "Accumulated depreciation", "NONCURRENT_ASSET"], ["GL-110", "Trade payables", "CURRENT_LIABILITY"], ["GL-120", "Accruals and other payables", "CURRENT_LIABILITY"], ["GL-130", "Tax payable", "CURRENT_LIABILITY"], ["GL-210", "Borrowings", "NONCURRENT_LIABILITY"], ["GE-100", "Share capital", "EQUITY"], ["GE-200", "Retained earnings", "EQUITY"], ["GR-100", "Revenue", "REVENUE"], ["GC-100", "Cost of sales", "COGS"], ["GX-100", "Staff costs", "EXPENSE"], ["GX-200", "Premises costs", "EXPENSE"], ["GX-300", "Distribution and vehicle costs", "EXPENSE"], ["GX-400", "Administrative expenses", "EXPENSE"], ["GX-500", "Depreciation", "EXPENSE"], ["GF-100", "Finance costs", "OTHER_INCOME"], ["GS-999", "Suspense / unallocated", "CURRENT_ASSET"]];
  await db.batch(db.insertMany("coa_accounts", ["workspace_id", "chart", "code", "name", "class", "parent_code", "created_at"], GROUP.map(([c, n, k]) => [wsId, "GROUP", c, n, k, null, t])));

  // ---- AR / AP ageing at 30 April 2026 -------------------------------------------------------
  const aging = [["AR", "Kilele Supermarkets", 1820000, 640000, 0, 0], ["AR", "Upper Hill Clinics", 950000, 0, 310000, 0], ["AR", "Savannah Hotels Ltd", 2240000, 1180000, 0, 425000], ["AR", "Lakeview Schools", 410000, 0, 0, 0], ["AR", "Coastline Logistics", 0, 0, 0, 780000],
    ["AP", "Riverside Wholesalers", 1460000, 0, 0, 0], ["AP", "Mlimani Packaging Ltd", 820000, 400200, 0, 0], ["AP", "Pwani Imports Ltd", 2100000, 0, 0, 0], ["AP", "Eastlands Paper Co", 0, 295000, 0, 0]];
  const agBatch = db.id();
  await db.batch(db.insertMany("aging_lines", ["id", "workspace_id", "side", "as_at", "batch_id", "counterparty", "current_cents", "d30_cents", "d60_cents", "d90_cents", "total_cents", "created_at"],
    aging.map(([s, cp, a, b, c2, d]) => [db.id(), wsId, s, "2026-04-30", agBatch, cp, a * 100, b * 100, c2 * 100, d * 100, (a + b + c2 + d) * 100, t])));

  // ---- Tax starter codes, assignments on close tasks, period lock ----------------------------
  await db.batch(KENYA_TAX_STARTER.map(([code, name, applies]) => ({ sql: "INSERT INTO tax_mappings (id, workspace_id, tax_code, name, applies_to, source_url, verified, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [db.id(), wsId, code, name, applies, "https://www.kra.go.ke/", 0, "Starter entry — confirm the current rate with KRA guidance or your tax adviser.", t, t] })));
  const accountant = ids["accountant@variaq.test"];
  const tasks = await db.all("SELECT id, sort_order FROM close_tasks WHERE workspace_id = ? AND period = '2026-04' ORDER BY sort_order", [wsId]);
  await db.batch(tasks.map((k, i) => ({ sql: "UPDATE close_tasks SET assignee_id = ?, reviewer_id = ?, due_date = ?, status = ?, priority = ? WHERE id = ?", args: [i % 3 === 2 ? userId : accountant, userId, `2026-05-${String(3 + (i % 6)).padStart(2, "0")}`, i < 5 ? "DONE" : i < 8 ? "IN_PROGRESS" : "TODO", i < 3 ? "HIGH" : "NORMAL", k.id] })));
  await db.run("INSERT INTO period_locks (workspace_id, period, locked_by, locked_at, note) VALUES (?,?,?,?,?)", [wsId, "2025-12", userId, t, "FY2025 closed and audited"]);

  // ---- Module demo data (each module may provide a seeder) -----------------------------------
  const summaries = [];
  for (const [mod, fn] of [["../lib/tax/demo", "seedTaxDemo"], ["../lib/audit/demo", "seedAuditDemo"], ["../lib/budget/demo", "seedPlanningDemo"], ["../lib/connectors/demo", "seedPlatformDemo"]]) {
    let m; try { m = require(mod); } catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; continue; }
    if (typeof m[fn] === "function") summaries.push(await m[fn](wsId, userId, { accountantId: accountant, auditorId: ids["auditor@variaq.test"] }));
  }

  // ---- Variaq platform administrator (staff account, not a member of any company) ---------
  const adminId = db.id();
  await db.run("INSERT INTO users (id, email, name, password_hash, created_at, password_changed_at, is_platform_admin) VALUES (?,?,?,?,?,?,1)", [adminId, ADMIN_EMAIL, "Variaq System Admin", hash, t, t]);
  // AI is included for the demo company; its owner still has to give consent under Settings → AI.
  await db.run("INSERT INTO ai_entitlements (workspace_id, enabled, monthly_token_limit, updated_by, updated_at) VALUES (?,?,?,?,?)", [wsId, 1, null, adminId, t]);

  await db.run("INSERT INTO audit_events (id, workspace_id, user_id, action, entity_type, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)", [db.id(), wsId, userId, "workspace.seeded", "workspace", wsId, JSON.stringify({ history: hist.length, ledger: lv.valid.length, bank: bv.valid.length, ...r }), db.now()]);
  await sealWorkspace(wsId);

  console.log(`Seeded "Demo Supplies Ltd": ${(hist.length + lv.valid.length).toLocaleString()} journal lines (May 2024 – Apr 2026), ${bv.valid.length} bank lines, ${r.suggested} suggested matches, ${r.exceptions} items to review, ${flux.totals.material} material movements.`);
  for (const s of summaries.filter(Boolean)) console.log(`  ${typeof s === "string" ? s : JSON.stringify(s)}`);
  console.log(`Sign in at http://localhost:3000/login  →  /app/${slug}   (password for all demo users: ${PASSWORD})`);
  for (const u of USERS) console.log(`  ${u.email.padEnd(26)} ${u.role}`);
  console.log(`  ${ADMIN_EMAIL.padEnd(26)} VARIAQ SYSTEM ADMIN → /admin (add the AI key there)`);
})().catch((e) => { console.error(e); process.exit(1); });
