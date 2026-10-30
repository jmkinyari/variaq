// Budget importer for the Data hub. Accepts either
//  - wide layout: one row per account with 12 month columns (Jan…Dec, M1…M12, P1…P12, 2026-01…), or
//  - long layout: account / month / amount rows.
// Creates a DRAFT budget. Values are taken as natural sign (income and costs positive); if an income
// account arrives with mostly negative values (ledger sign), it is flipped and reported.
import "server-only";
import db from "../db";
import { auditStmt } from "../auth";
import { monthColumns } from "../ingest/clean";
import { parseAmount } from "../money";
import { loadChart } from "../statements-data";
import { defaultClass } from "../statements";
import { INCOME } from "../budget/engine";
import { fyIndex, parseMonthLabel } from "../budget/months";

export const BUDGET_IMPORTERS = {
  budget: {
    options: [
      { key: "name", label: "Budget name", type: "text", required: true, default: "Imported budget" },
      { key: "fyStart", label: "First month of the financial year", type: "month", required: true, help: "Month columns are matched to budget months from here." },
    ],
    async run({ ws, user, records, rawRows, mapping, formats, fileName, options }) {
      const fyStart = String(options.fyStart || "");
      if (!/^\d{4}-\d{2}$/.test(fyStart)) throw new Error("Choose the first month of the financial year.");
      const name = String(options.name || "Imported budget").trim().slice(0, 100);
      const decimal = formats?.decimal || ".";
      const lines = new Map();
      const add = (code, idx, cents) => { if (idx < 0 || idx > 11 || !cents) return; if (!lines.has(code)) lines.set(code, new Array(12).fill(0)); lines.get(code)[idx] += cents; };
      const cols = monthColumns(Object.keys(rawRows[0] || {}).filter((h) => h !== "__line"));
      let unmatched = 0;
      if (cols.length >= 2) {
        const byLine = new Map(rawRows.map((r) => [r.__line, r]));
        for (const rec of records) {
          const raw = byLine.get(rec.line);
          if (!raw) continue;
          for (const c of cols) {
            const v = parseAmount(raw[c.header], { decimal });
            if (v === null) continue;
            const idx = fyIndex(c, fyStart);
            if (idx < 0) { unmatched++; continue; }
            add(rec.accountCode, idx, v);
          }
        }
      } else {
        if (!mapping.month || !mapping.amount) throw new Error("No month columns found. Use Jan…Dec (or M1…M12) columns, or map a Month and an Amount column.");
        for (const rec of records) {
          const idx = parseMonthLabel(rec.month, fyStart);
          if (idx < 0) { unmatched++; continue; }
          add(rec.accountCode, idx, rec.amountCents || 0);
        }
      }
      if (!lines.size) throw new Error("No budget amounts were found in the file.");
      const { chart } = await loadChart(ws.id);
      const names = new Map(records.map((r) => [r.accountCode, r.accountName]));
      const flipped = [];
      for (const [code, row] of lines) {
        const cls = chart.get(code)?.cls || defaultClass(code, names.get(code));
        const total = row.reduce((a, x) => a + x, 0);
        if (INCOME.has(cls) && total < 0) { lines.set(code, row.map((x) => -x)); flipped.push(code); }
        else if (!INCOME.has(cls) && total < 0 && row.every((x) => x <= 0)) { lines.set(code, row.map((x) => -x)); flipped.push(code); }
      }
      const id = db.id(), t = db.now();
      await db.batch([
        { sql: "INSERT INTO budgets (id, workspace_id, name, fy_start, status, method, assumptions, version, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", args: [id, ws.id, name, fyStart, "DRAFT", "UPLOAD", JSON.stringify({ source: fileName }), 1, user.id, t, t] },
        ...db.insertMany("budget_lines", ["budget_id", "workspace_id", "account_code", "month_idx", "amount_cents"], [...lines].flatMap(([code, row]) => row.map((v, m) => [id, ws.id, code, m, v]).filter((r) => r[4] !== 0))),
        auditStmt(ws.id, user.id, "budget.imported", "budget", id, { fileName, accounts: lines.size, flipped: flipped.length, unmatched }),
      ]);
      const unknown = [...lines.keys()].filter((c) => !chart.has(c)).length;
      return {
        message: `Created draft budget “${name}” with ${lines.size} accounts.${flipped.length ? ` Flipped the sign of ${flipped.length} account(s) supplied in ledger sign.` : ""}${unmatched ? ` ${unmatched} value(s) couldn't be placed in a budget month.` : ""}${unknown ? ` ${unknown} account code(s) aren't in the ledger yet.` : ""}`,
        redirect: `/app/${ws.slug}/budgets/${id}`, targetId: id, imported: lines.size,
      };
    },
  },
};
