// File drop: a GL export (CSV or Excel) published at an HTTPS URL — e.g. a scheduled report from
// Sage, Tally or SAP saved to SharePoint/OneDrive/S3 with a pre-signed link. Each sync re-reads the
// file and runs it through the same cleaning pipeline as the Data hub.
const crypto = require("crypto");
const { readBuffer } = require("../ingest/read");
const { analyse, semanticClean, validate } = require("../ingest/clean");
const { assertOk } = require("./common");

/** Validated ledger records → canonical lines with content-derived ids. Pure (unit-tested). */
function normalize(records) {
  const seen = new Map();
  return records.map((r) => {
    const base = [r.journalNo, r.date, r.accountCode, r.amountCents, r.description, r.reference].join("|");
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    return {
      externalId: "f:" + crypto.createHash("sha1").update(base + "#" + n).digest("hex").slice(0, 24),
      journalNo: r.journalNo, lineNo: r.lineNo, date: r.date, accountCode: r.accountCode, accountName: r.accountName, description: r.description, reference: r.reference,
      amountCents: r.amountCents, currency: r.currency, counterparty: r.counterparty, entryType: r.entryType, postedBy: r.postedBy, approvedBy: r.approvedBy, postedAt: r.postedAt,
      taxCode: r.taxCode, costCenter: r.costCenter, department: r.department, project: r.project,
    };
  });
}

function parse(fileName, buf) {
  const sheets = readBuffer(fileName, buf);
  if (!sheets.length) throw new Error("The file is empty.");
  const sheet = sheets.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
  const a = analyse(sheet.rows, { kind: "ledger" });
  const sem = semanticClean("ledger", a.rows, a.mapping);
  const v = validate("ledger", sem.rows, a.mapping, a.formats);
  return { ...v, mapping: a.mapping, report: [...a.report, ...sem.report] };
}

module.exports = {
  type: "FILE_DROP", label: "Scheduled file (CSV / Excel URL)", vendor: "Any ERP",
  description: "Pulls a general-ledger export from an HTTPS link on a schedule and cleans it automatically.",
  fields: [
    { key: "url", label: "File URL (https)", type: "url", required: true, secret: true, help: "Pre-signed / share links are stored encrypted because they act as credentials." },
    { key: "fileName", label: "File name (to detect the format)", type: "text", placeholder: "gl-export.xlsx" },
    { key: "token", label: "Bearer token (optional)", type: "password", secret: true },
  ],
  async test(cfg, ctx) {
    const r = await this.fetch(cfg, null, ctx);
    return { ok: true, message: `Read ${r.lines.length} valid journal lines${r.rejected ? `, ${r.rejected} rows rejected` : ""}.` };
  },
  async fetch(cfg, cursor, { http, log }) {
    const res = await http(cfg.url, { headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {} });
    assertOk(res, "File download");
    const name = cfg.fileName || new URL(cfg.url).pathname.split("/").pop() || "export.csv";
    const buf = typeof res.buffer === "function" ? res.buffer() : Buffer.from(res.text(), "utf8");
    const parsed = parse(name, buf);
    for (const r of parsed.report) log(`Clean: ${r.text}`);
    if (parsed.errors.length) log(`${parsed.errors.length} rows rejected, e.g. line ${parsed.errors[0].row}: ${parsed.errors[0].messages.join(" ")}`);
    return { lines: normalize(parsed.valid), nextCursor: null, done: true, rejected: parsed.errors.length, fullSnapshot: true };
  },
  normalize, parse,
};
