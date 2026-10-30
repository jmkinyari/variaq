// File readers: CSV / TSV / TXT via Papa Parse, Excel (.xlsx, .xls, .xlsm, .ods) via SheetJS.
// Returns sheets as raw string matrices so the cleaning pipeline sees exactly what was in the file.
// Works in the browser (File / ArrayBuffer) and in Node (Buffer) for server-side connector drops.
const Papa = require("papaparse");
const XLSX = require("xlsx");

const MAX_ROWS = 200_000;
const EXCEL_RE = /\.(xlsx|xlsm|xlsb|xls|ods)$/i;
const TEXT_RE = /\.(csv|tsv|txt)$/i;

function readText(text) {
  const res = Papa.parse(String(text).replace(/^﻿/, ""), { skipEmptyLines: false, delimiter: "" }); // auto-detect , ; \t |
  return [{ name: "Sheet1", rows: res.data.slice(0, MAX_ROWS), delimiter: res.meta.delimiter }];
}

function readWorkbook(data) {
  const wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? "array" : "buffer", cellDates: true, dense: true, WTF: false });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    // raw:false gives the displayed text (keeps leading zeros in codes); dates come out formatted.
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: true, dateNF: "yyyy-mm-dd" });
    return { name, rows: rows.slice(0, MAX_ROWS), hidden: !!wb.Workbook?.Sheets?.find((s) => s.name === name)?.Hidden };
  }).filter((s) => s.rows.some((r) => r.some((c) => String(c).trim())));
}

/** Browser: File → [{name, rows}] */
async function readFile(file) {
  if (file.size > 60 * 1024 * 1024) throw new Error("Files are limited to 60 MB. Split the export by period.");
  if (EXCEL_RE.test(file.name)) return readWorkbook(await file.arrayBuffer());
  if (TEXT_RE.test(file.name) || /text|csv/.test(file.type)) return readText(await file.text());
  throw new Error("Unsupported file type. Use CSV, TXT or an Excel workbook (.xlsx, .xls, .xlsm, .ods).");
}

/** Node: (fileName, Buffer) → [{name, rows}] */
function readBuffer(fileName, buf) {
  if (EXCEL_RE.test(fileName)) return readWorkbook(buf);
  return readText(buf.toString("utf8"));
}

module.exports = { readFile, readBuffer, readText, readWorkbook, MAX_ROWS };
