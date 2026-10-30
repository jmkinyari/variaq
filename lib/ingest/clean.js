// Data cleaning and understanding for arbitrary CSV / Excel exports. Pure functions, shared by the
// browser (instant preview) and the server (authoritative re-validation before anything is saved).
//
// Pipeline:  matrix (string[][])  →  findHeaderRow  →  buildTable (structural clean)
//            →  detectKind / guessMapping / detectFormats  →  semanticClean (kind-aware)
//            →  validate (typed, normalised records + row errors + warnings)
const { KINDS, ALL_HINTS } = require("./kinds");
const { parseAmount } = require("../money");
const { parseDate, DATE_FORMATS } = require("../dates");

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const EXCEL_ERR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!)$/i;
const TOTAL_RE = /^(grand\s+)?total\b|\bsub-?total\b|^totals?\s*:|balance\s+(b\/?f|c\/?f|brought|carried)|^(opening|closing)\s+balance\b|^end of report|^report total/i;

/** Normalise one cell: unicode, invisible chars, smart quotes, whitespace, Excel errors. */
function cleanCell(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
  let s = String(v).normalize("NFKC").replace(/[​-‍﻿­]/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/ /g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (EXCEL_ERR.test(s)) return "";
  // Defuse spreadsheet formula injection if this value is ever exported again.
  return s;
}

/** Which row holds the headers? Scores the first 30 rows by known-header matches and text density. */
function findHeaderRow(matrix) {
  let best = 0, bestScore = -Infinity;
  const limit = Math.min(matrix.length, 30);
  for (let i = 0; i < limit; i++) {
    const cells = (matrix[i] || []).map(cleanCell).filter(Boolean);
    if (cells.length < 2) continue;
    const known = cells.filter((c) => ALL_HINTS.has(norm(c)) || [...ALL_HINTS].some((h) => h.length > 4 && norm(c).includes(h))).length;
    const texty = cells.filter((c) => !/^[-+()\d.,\s%]+$/.test(c) && c.length < 60).length;
    const numeric = cells.filter((c) => /^[-+()\d.,\s]+$/.test(c)).length;
    const nextCells = (matrix[i + 1] || []).map(cleanCell).filter(Boolean).length;
    const score = known * 4 + texty - numeric * 2 + (nextCells >= cells.length * 0.5 ? 1 : -2);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/** Structural clean: header row, unique headers, drop empty rows/cols, repeated headers, totals. */
function buildTable(matrix, { headerRow } = {}) {
  const report = [];
  const m = (matrix || []).map((r) => (Array.isArray(r) ? r : []).map(cleanCell));
  const h = headerRow ?? findHeaderRow(m);
  if (h > 0) report.push({ op: "title_rows", count: h, text: `Skipped ${h} title row(s) above the header (report name, company, dates).` });
  const width = Math.max(0, ...m.slice(h, h + 200).map((r) => r.length));
  const rawHeaders = Array.from({ length: width }, (_, i) => m[h]?.[i] || "");
  // Unique, non-empty header names.
  const seen = new Map();
  let headers = rawHeaders.map((x, i) => {
    let name = x || `Column ${i + 1}`;
    const n = seen.get(name) || 0; seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
  const renamed = rawHeaders.filter((x) => !x).length;
  if (renamed) report.push({ op: "blank_headers", count: renamed, text: `Named ${renamed} unlabeled column(s) “Column N”.` });

  const headerSig = rawHeaders.map(norm).join("|");
  let blank = 0, repeated = 0, totals = 0;
  const rows = [];
  for (let i = h + 1; i < m.length; i++) {
    const r = m[i];
    if (!r || r.every((c) => !c)) { blank++; continue; }
    if (r.map(norm).join("|") === headerSig) { repeated++; continue; }
    const firstText = r.find((c) => c && !/^[-+()\d.,\s]+$/.test(c)) || "";
    const filled = r.filter(Boolean).length;
    if (TOTAL_RE.test(firstText) && filled <= Math.max(3, width / 2)) { totals++; continue; }
    const o = { __line: i + 1 };
    headers.forEach((name, j) => { o[name] = r[j] ?? ""; });
    rows.push(o);
  }
  // Drop columns that are empty in every row.
  const emptyCols = headers.filter((name) => rows.every((r) => !r[name]));
  if (emptyCols.length && emptyCols.length < headers.length) {
    headers = headers.filter((x) => !emptyCols.includes(x));
    for (const r of rows) for (const c of emptyCols) delete r[c];
    report.push({ op: "empty_columns", count: emptyCols.length, text: `Removed ${emptyCols.length} empty column(s).` });
  }
  if (blank) report.push({ op: "blank_rows", count: blank, text: `Removed ${blank} blank row(s).` });
  if (repeated) report.push({ op: "repeated_headers", count: repeated, text: `Removed ${repeated} repeated header row(s) (page breaks in the export).` });
  if (totals) report.push({ op: "total_rows", count: totals, text: `Removed ${totals} total / subtotal / balance-forward row(s) so nothing is double counted.` });
  return { headers, rows, headerRow: h, report };
}

/** Column profile: share of non-empty values that look like dates, numbers, PINs, etc. */
function profileColumns(headers, rows, sample = 400) {
  const out = {};
  const s = rows.slice(0, sample);
  for (const name of headers) {
    const vals = s.map((r) => r[name]).filter(Boolean);
    const n = vals.length || 1;
    const share = (fn) => vals.filter(fn).length / n;
    out[name] = {
      filled: vals.length / (s.length || 1),
      date: share((v) => DATE_FORMATS.some((f) => parseDate(v, f.value)) || isExcelSerial(v)),
      money: share((v) => parseAmount(v) !== null),
      pin: share((v) => /^[AP]\d{9}[A-Z]$/i.test(v.replace(/\s/g, ""))),
      distinct: new Set(vals).size,
      avgLen: vals.reduce((a, v) => a + v.length, 0) / n,
      examples: [...new Set(vals)].slice(0, 3),
    };
  }
  return out;
}

const TYPE_FIT = {
  date: (p) => p.date, datetime: (p) => p.date, money: (p) => p.money, pin: (p) => Math.max(p.pin, 0.3),
  int: (p) => p.money, number: (p) => p.money, code: (p) => (p.avgLen < 30 ? 0.8 : 0.3), text: (p) => (p.money > 0.9 ? 0.2 : 0.8), enum: () => 0.6,
};

/** Suggest a column for each field: exact hint, then contains-hint, both weighted by type fit. */
function guessMapping(kind, headers, profile = {}) {
  const def = KINDS[kind];
  const used = new Set();
  const mapping = {};
  // Required fields first so they get the best columns.
  const order = [...def.fields].sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));
  for (const f of order) {
    let best = "", bestScore = 0;
    for (const hname of headers) {
      if (used.has(hname)) continue;
      const nh = norm(hname);
      let s = 0;
      f.hints.forEach((hint, rank) => {
        const w = 1 - rank * 0.03;
        if (nh === hint) s = Math.max(s, 3 * w);
        else if (hint.length > 2 && (nh.startsWith(hint + " ") || nh.endsWith(" " + hint))) s = Math.max(s, 2 * w);
        else if (hint.length > 3 && nh.includes(hint)) s = Math.max(s, 1.4 * w);
      });
      if (!s) continue;
      const p = profile[hname];
      if (p) s *= 0.4 + 0.6 * (TYPE_FIT[f.type]?.(p) ?? 0.5);
      if (s > bestScore) { bestScore = s; best = hname; }
    }
    if (best && bestScore >= 0.6) { used.add(best); mapping[f.key] = best; } else mapping[f.key] = "";
  }
  if (def.amountMode === "signedOrSplit" && mapping.debit && mapping.credit && mapping.amount) mapping.amount = "";
  if (def.amountMode === "signedOrInOut" && mapping.moneyIn && mapping.moneyOut && mapping.amount) mapping.amount = "";
  return mapping;
}

/** Rank dataset kinds by how well the headers fit. Returns [{kind, label, score, mapped, missing}]. */
function detectKind(headers, profile = {}) {
  const nh = headers.map(norm);
  return Object.entries(KINDS).map(([kind, def]) => {
    const mapping = guessMapping(kind, headers, profile);
    const req = def.fields.filter((f) => f.required);
    const mappedReq = req.filter((f) => mapping[f.key]).length;
    const mappedAll = def.fields.filter((f) => mapping[f.key]).length;
    const sig = def.signature.filter((s) => nh.some((h) => h === s || h.includes(s))).length;
    let score = (req.length ? mappedReq / req.length : 0.5) * 60 + (mappedAll / def.fields.length) * 25 + Math.min(sig, 3) * 5;
    if (def.amountMode === "signedOrSplit" && !(mapping.amount || mapping.debit || mapping.credit)) score -= 30;
    if (def.amountMode === "signedOrInOut" && !(mapping.amount || mapping.moneyIn || mapping.moneyOut)) score -= 30;
    if (def.wideMonths && monthColumns(headers).length >= 6) score += 35;
    const anti = (def.antiSignature || []).filter((s) => nh.some((h) => h === s || h.includes(s))).length;
    score -= Math.min(anti, 2) * 10;
    return { kind, label: def.label, score: Math.round(Math.max(0, Math.min(100, score))), mapped: mappedAll, missing: req.filter((f) => !mapping[f.key]).map((f) => f.label) };
  }).sort((a, b) => b.score - a.score);
}

const isExcelSerial = (v) => /^\d{5}(\.\d+)?$/.test(String(v)) && +v > 20000 && +v < 80000;
function excelSerialToIso(v) {
  const ms = Math.round((+v - 25569) * 86400000); // 25569 = days from 1899-12-30 to 1970-01-01
  return new Date(ms).toISOString().slice(0, 10);
}

/** Guess date format and decimal separator from the mapped columns. */
function detectFormats(rows, mapping, kind) {
  const def = KINDS[kind];
  const dateCols = def.fields.filter((f) => f.type === "date" && mapping[f.key]).map((f) => mapping[f.key]);
  const vals = rows.slice(0, 300).flatMap((r) => dateCols.map((c) => r[c])).filter((v) => v && !isExcelSerial(v));
  let dateFormat = "YYYY-MM-DD", best = -1;
  for (const f of DATE_FORMATS) {
    const score = vals.filter((v) => parseDate(v, f.value)).length;
    // Tie-break DD/MM vs MM/DD: Kenya uses day-first, so prefer it on ties.
    if (score > best || (score === best && f.value === "DD/MM/YYYY")) { dateFormat = f.value; best = score; }
  }
  const moneyCols = def.fields.filter((f) => f.type === "money" && mapping[f.key]).map((f) => mapping[f.key]);
  const mv = rows.slice(0, 300).flatMap((r) => moneyCols.map((c) => r[c])).filter(Boolean).map((v) => String(v).replace(/^[-+(\s]+|[)\s]+$|\s*(CR|DR)$/gi, ""));
  const commaDecimal = mv.filter((v) => /\d\.\d{3},\d{1,2}$|^\d+,\d{1,2}$/.test(v)).length;
  const pointDecimal = mv.filter((v) => /\d,\d{3}\.\d{1,2}$|^\d+\.\d{1,2}$/.test(v)).length;
  return { dateFormat, decimal: commaDecimal > pointDecimal ? "," : "." };
}

/** Kind-aware clean after mapping: forward-fill journal-level fields on continuation lines. */
function semanticClean(kind, rows, mapping) {
  const def = KINDS[kind];
  const report = [];
  const fillKeys = def.fields.filter((f) => f.journalLevel || (kind === "ledger" && f.key === "date")).map((f) => mapping[f.key]).filter(Boolean);
  if (!fillKeys.length) return { rows, report };
  const out = [];
  let prev = null, filled = 0;
  const hasAmount = (r) => ["amount", "debit", "credit"].some((k) => mapping[k] && r[mapping[k]]);
  for (const r0 of rows) {
    const r = { ...r0 };
    if (prev && hasAmount(r) && (mapping.accountCode ? r[mapping.accountCode] : true)) {
      for (const c of fillKeys) if (!r[c] && prev[c]) { r[c] = prev[c]; filled++; }
    }
    out.push(r);
    prev = r;
  }
  if (filled) report.push({ op: "forward_fill", count: filled, text: `Filled ${filled} blank journal-level cell(s) (date, journal no., posted by…) from the line above — common in ERP exports that print them only on a journal's first line.` });
  return { rows: out, report };
}

function parseDateCell(v, fmt) {
  if (!v) return null;
  if (isExcelSerial(v)) return excelSerialToIso(v);
  // The chosen format first; unambiguous ISO dates (e.g. from Excel cells) are always accepted.
  return parseDate(v, fmt) || (fmt !== "YYYY-MM-DD" ? parseDate(v, "YYYY-MM-DD") : null);
}
function parseDateTime(v, fmt) {
  if (!v) return null;
  if (isExcelSerial(v)) { const ms = Math.round((+v - 25569) * 86400000); return new Date(ms).toISOString(); }
  const iso = Date.parse(v);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) && !isNaN(iso)) return new Date(v.replace(" ", "T") + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? "" : "+03:00")).toISOString();
  const d = parseDate(v, fmt);
  const time = String(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!d) return null;
  let hh = time ? +time[1] : 0; if (time?.[4]) hh = (hh % 12) + (/pm/i.test(time[4]) ? 12 : 0);
  return new Date(`${d}T${String(hh).padStart(2, "0")}:${time ? time[2] : "00"}:${time?.[3] || "00"}+03:00`).toISOString();
}
const normCode = (v) => String(v).replace(/\.0+$/, "").replace(/\s+/g, "").slice(0, 60);
const normPin = (v) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
const PIN_RE = /^[AP]\d{9}[A-Z]$/;

/**
 * Validate and normalise rows for a kind. Returns { valid, errors, warnings }.
 * valid: [{ line, ...fields }] with money as integer cents (keys suffixed "Cents"), dates as ISO.
 */
function validate(kind, rows, mapping, { dateFormat = "YYYY-MM-DD", decimal = "." } = {}) {
  const def = KINDS[kind];
  const valid = [], errors = [], warnings = [];
  const pick = (r, k) => (mapping[k] ? String(r[mapping[k]] ?? "").trim() : "");
  rows.forEach((r, i) => {
    const line = r.__line || i + 2;
    const msgs = [];
    const rec = { line };
    for (const f of def.fields) {
      const raw = pick(r, f.key);
      if (!raw) { if (f.required && !(f.key === "description" && f.fillFrom && pick(r, f.fillFrom))) msgs.push(`${f.label} is empty.`); continue; }
      switch (f.type) {
        case "date": { const d = parseDateCell(raw, dateFormat); if (!d) msgs.push(`${f.label} “${raw}” isn't a date in ${dateFormat}.`); else rec[f.key] = d; break; }
        case "datetime": { const d = parseDateTime(raw, dateFormat); if (d) rec[f.key] = d; else warnings.push({ row: line, message: `${f.label} “${raw}” wasn't understood and was left blank.` }); break; }
        case "money": { const c = parseAmount(raw, { decimal }); if (c === null) msgs.push(`${f.label} “${raw}” isn't a number.`); else rec[f.key + "Cents"] = c; break; }
        case "int": case "number": { const n = Number(raw.replace(/,/g, "")); if (Number.isFinite(n)) rec[f.key] = f.type === "int" ? Math.trunc(n) : n; break; }
        case "code": rec[f.key] = normCode(raw); break;
        case "pin": { const p = normPin(raw); rec[f.key] = p; if (!PIN_RE.test(p)) warnings.push({ row: line, message: `PIN “${raw}” isn't a valid KRA PIN format (A/P + 9 digits + letter).` }); break; }
        default: rec[f.key] = raw.slice(0, 500);
      }
    }
    if (def.fields.some((f) => f.key === "description") && !rec.description && pick(r, "reference")) rec.description = pick(r, "reference");
    // Amount combinations.
    if (def.amountMode === "signedOrSplit") {
      if (rec.amountCents === undefined) {
        const d = rec.debitCents, c = rec.creditCents;
        if (d === undefined && c === undefined) msgs.push("Amount (or Debit/Credit) is empty.");
        // A negative/bracketed debit is a reversal (i.e. a credit). Credit columns are often exported
        // as negative numbers, so their sign is ignored.
        else rec.amountCents = (d || 0) - Math.abs(c || 0);
      }
    }
    if (def.amountMode === "signedOrInOut") {
      if (rec.amountCents === undefined) {
        const a = rec.moneyInCents, b = rec.moneyOutCents;
        if (a === undefined && b === undefined) msgs.push("Amount (or Money in/out) is empty.");
        else rec.amountCents = Math.abs(a || 0) - Math.abs(b || 0);
      }
    }
    if (msgs.length) errors.push({ row: line, messages: msgs });
    else valid.push(rec);
  });
  return { valid, errors, warnings: warnings.slice(0, 500), warningCount: warnings.length };
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Find month columns in a wide layout (Jan…Dec, M1…M12, 2026-01…). Returns [{header, monthIdx (0-11) | ym}]. */
function monthColumns(headers) {
  const out = [];
  for (const h of headers) {
    const n = norm(h);
    let m;
    if ((m = n.match(/^(\d{4}) (\d{1,2})$/))) out.push({ header: h, ym: `${m[1]}-${m[2].padStart(2, "0")}` });
    else if ((m = n.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*( (\d{2,4}))?$/))) out.push({ header: h, monthIdx: MONTH_NAMES.indexOf(m[1].slice(0, 3)), year: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null });
    else if ((m = n.match(/^(m|month|p|period) ?(\d{1,2})$/)) && +m[2] >= 1 && +m[2] <= 12) out.push({ header: h, position: +m[2] - 1 });
  }
  return out;
}

/** One call for the browser preview: matrix → table, detection, mapping, formats, cleaned rows. */
function analyse(matrix, { kind: forcedKind, headerRow } = {}) {
  const table = buildTable(matrix, { headerRow });
  const profile = profileColumns(table.headers, table.rows);
  const ranking = detectKind(table.headers, profile);
  const kind = forcedKind || ranking[0]?.kind;
  const mapping = guessMapping(kind, table.headers, profile);
  const formats = detectFormats(table.rows, mapping, kind);
  return { ...table, profile, ranking, kind, mapping, formats };
}

module.exports = { cleanCell, findHeaderRow, buildTable, profileColumns, guessMapping, detectKind, detectFormats, semanticClean, validate, monthColumns, analyse, excelSerialToIso, isExcelSerial, PIN_RE, normPin, normCode, TOTAL_RE };
