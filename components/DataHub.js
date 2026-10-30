"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readFile } from "@/lib/ingest/read";
import { KINDS } from "@/lib/ingest/kinds";
import { analyse, guessMapping, detectFormats, semanticClean, validate, profileColumns, buildTable } from "@/lib/ingest/clean";
import { DATE_FORMATS } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

/**
 * Universal upload: any CSV or Excel export → pick sheet → auto-detected dataset type → column
 * mapping (pre-filled) → cleaning report + validation preview → import into the right module.
 */
export default function DataHub({ slug, importerOptions, choices, currency = "KES", presetKind, onImport }) {
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(null);
  const [kind, setKind] = useState(presetKind || "");
  const [mapping, setMapping] = useState({});
  const [formats, setFormats] = useState({ dateFormat: "YYYY-MM-DD", decimal: "." });
  const [options, setOptions] = useState({});
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const base = useMemo(() => {
    if (!sheets[sheetIdx]) return null;
    return analyse(sheets[sheetIdx].rows, { kind: presetKind || undefined, headerRow: headerRow ?? undefined });
  }, [sheets, sheetIdx, headerRow, presetKind]);

  function adopt(a, k) {
    const kk = k || a.kind;
    const m = k ? guessMapping(kk, a.headers, a.profile) : a.mapping;
    setKind(kk); setMapping(m);
    setFormats(detectFormats(a.rows, m, kk));
    const opts = {};
    for (const o of importerOptions[kk] || []) if (o.default) opts[o.key] = o.default;
    setOptions(opts);
  }

  async function onFile(f) {
    setError("");
    if (!f) return;
    try {
      const sh = await readFile(f);
      if (!sh.length) throw new Error("That file has no data.");
      // Prefer the first visible sheet with the most rows.
      const idx = sh.reduce((best, s, i) => (!s.hidden && s.rows.length > (sh[best]?.rows.length || 0) ? i : best), 0);
      setFile(f); setSheets(sh); setSheetIdx(idx); setHeaderRow(null);
      adopt(analyse(sh[idx].rows, { kind: presetKind || undefined }), presetKind);
    } catch (e) { setError(e.message || "Couldn't read that file."); }
  }

  const sem = useMemo(() => (base && kind ? semanticClean(kind, base.rows, mapping) : null), [base, kind, mapping]);
  const result = useMemo(() => (sem ? validate(kind, sem.rows, mapping, formats) : null), [sem, kind, mapping, formats]);
  const def = KINDS[kind];
  const report = [...(base?.report || []), ...(sem?.report || [])];
  const missingRequired = def ? def.fields.filter((f) => f.required && !mapping[f.key] && !(f.key === "description" && mapping.reference)).map((f) => f.label) : [];
  const opts = importerOptions[kind] || [];
  const missingOpts = opts.filter((o) => o.required && !options[o.key]).map((o) => o.label);

  async function submit() {
    setBusy(true); setError("");
    try {
      const rows = base.rows; // structural clean only; the server redoes the rest
      const res = await onImport(slug, { kind, rows, mapping, formats, options, fileName: file.name, sheet: sheets[sheetIdx]?.name, cleanReport: base.report, skipInvalid });
      if (res?.error) { setError(res.error); setBusy(false); return; }
      router.push(res.redirect); router.refresh();
    } catch (e) { setError(e.message || "Import failed."); setBusy(false); }
  }

  if (!file) return (
    <div className="stack">
      {error && <div className="alert error">{error}</div>}
      <label className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
        <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,.ods" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
        <div className="display" style={{ fontSize: "1.2rem", color: "var(--text)" }}>Drop a CSV or Excel file here, or click to choose</div>
        <div className="muted small" style={{ marginTop: ".4rem" }}>Any layout works: title rows, page-break headers, totals, merged journal lines and Excel dates are cleaned automatically. Nothing is saved until you confirm.</div>
      </label>
    </div>
  );

  return (
    <div className="stack">
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <div className="row between">
          <div><strong>{file.name}</strong> <span className="muted small">· {(file.size / 1024).toFixed(0)} KB · {base?.rows.length.toLocaleString()} data rows</span></div>
          <button className="btn sm" onClick={() => { setFile(null); setSheets([]); setError(""); }}>Choose another file</button>
        </div>
        <div className="form-row" style={{ marginTop: ".8rem" }}>
          {sheets.length > 1 && <div><label>Sheet</label><select value={sheetIdx} onChange={(e) => { const i = +e.target.value; setSheetIdx(i); setHeaderRow(null); adopt(analyse(sheets[i].rows, { kind: presetKind || undefined }), presetKind); }}>{sheets.map((s, i) => <option key={i} value={i}>{s.name} ({s.rows.length} rows){s.hidden ? " — hidden" : ""}</option>)}</select></div>}
          <div><label>Header row</label><select value={base?.headerRow ?? 0} onChange={(e) => { const h = +e.target.value; setHeaderRow(h); const t = buildTable(sheets[sheetIdx].rows, { headerRow: h }); adopt({ ...t, profile: profileColumns(t.headers, t.rows), kind }, kind); }}>
            {sheets[sheetIdx]?.rows.slice(0, 30).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.filter(Boolean).slice(0, 4).join(" | ").slice(0, 60)}</option>)}</select></div>
          <div><label>Dataset type {presetKind ? "" : "(auto-detected)"}</label>
            <select value={kind} disabled={!!presetKind} onChange={(e) => adopt(base, e.target.value)}>
              {(base?.ranking || []).map((k) => <option key={k.kind} value={k.kind}>{KINDS[k.kind].label} — {k.score}% fit</option>)}
            </select>
            {def && <div className="help">{def.description} Goes to: <strong>{def.module}</strong>.</div>}</div>
        </div>
      </div>

      {report.length > 0 && <div className="alert info"><strong>Cleaning applied</strong><ul style={{ margin: ".3rem 0 0", paddingLeft: "1.2rem" }}>{report.map((r, i) => <li key={i}>{r.text}</li>)}</ul></div>}

      {def && <div className="card">
        <h3>Map columns</h3>
        <p className="muted small">Matched automatically from header names and the values in each column. Fields marked * are required.</p>
        <div className="mapping-grid">
          {def.fields.map((f) => (
            <div key={f.key}>
              <label>{f.label}{f.required ? " *" : ""}</label>
              <select value={mapping[f.key] || ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                <option value="">— not in file —</option>
                {base.headers.map((h) => <option key={h} value={h}>{h}{base.profile[h]?.examples?.[0] ? ` (e.g. ${String(base.profile[h].examples[0]).slice(0, 18)})` : ""}</option>)}
              </select>
            </div>
          ))}
          <div><label>Date format</label><select value={formats.dateFormat} onChange={(e) => setFormats({ ...formats, dateFormat: e.target.value })}>{DATE_FORMATS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
          <div><label>Number format</label><select value={formats.decimal} onChange={(e) => setFormats({ ...formats, decimal: e.target.value })}><option value=".">1,234.56</option><option value=",">1.234,56</option></select></div>
        </div>
        {missingRequired.length > 0 && <div className="alert warn" style={{ marginTop: "1rem" }}>Choose a column for: {missingRequired.join(", ")}.</div>}
      </div>}

      {opts.length > 0 && <div className="card">
        <h3>Import settings</h3>
        <div className="form-row">{opts.map((o) => (
          <div key={o.key}><label>{o.label}{o.required ? " *" : ""}</label>
            {o.type === "select" ? <select value={options[o.key] || ""} onChange={(e) => setOptions({ ...options, [o.key]: e.target.value })}><option value="">Choose…</option>{(choices[o.choices] || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              : <input type={o.type === "date" ? "date" : o.type === "month" ? "month" : "text"} value={options[o.key] || ""} placeholder={o.placeholder || ""} onChange={(e) => setOptions({ ...options, [o.key]: e.target.value })} />}
            {o.help && <div className="help">{o.help}</div>}
          </div>))}</div>
      </div>}

      {result && missingRequired.length === 0 && <div className="card stack">
        <div className="grid grid-4">
          <div className="stat"><div className="label">Rows after cleaning</div><div className="value">{(result.valid.length + result.errors.length).toLocaleString()}</div></div>
          <div className="stat"><div className="label">Ready to import</div><div className="value" style={{ color: "var(--good)" }}>{result.valid.length.toLocaleString()}</div></div>
          <div className="stat"><div className="label">With errors</div><div className="value" style={{ color: result.errors.length ? "var(--bad)" : undefined }}>{result.errors.length.toLocaleString()}</div></div>
          <div className="stat"><div className="label">Warnings</div><div className="value" style={{ color: result.warningCount ? "var(--warn)" : undefined }}>{result.warningCount.toLocaleString()}</div></div>
        </div>
        {kind === "ledger" && <LedgerChecks rows={result.valid} currency={currency} />}
        {result.errors.length > 0 && <>
          <h3>Rows that need fixing</h3>
          <div className="table-wrap" style={{ maxHeight: 240, overflowY: "auto" }}><table><thead><tr><th>Line</th><th>Problems</th></tr></thead>
            <tbody>{result.errors.slice(0, 200).map((e) => <tr key={e.row}><td>{e.row}</td><td className="wrap">{e.messages.join(" ")}</td></tr>)}</tbody></table></div>
          <label className="row" style={{ fontWeight: 400, color: "var(--text)" }}><input type="checkbox" style={{ width: "auto" }} checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} /> Import the {result.valid.length} valid rows and skip the {result.errors.length} with errors</label>
        </>}
        {result.warnings.length > 0 && <details><summary className="small">Show warnings ({result.warningCount})</summary><ul className="small">{result.warnings.slice(0, 50).map((w, i) => <li key={i}>Line {w.row}: {w.message}</li>)}</ul></details>}
        {result.valid.length > 0 && <>
          <h3>Preview (cleaned)</h3>
          <div className="table-wrap"><table>
            <thead><tr>{def.fields.filter((f) => mapping[f.key]).slice(0, 8).map((f) => <th key={f.key} className={f.type === "money" ? "num" : ""}>{f.label}</th>)}</tr></thead>
            <tbody>{result.valid.slice(0, 8).map((r) => <tr key={r.line}>{def.fields.filter((f) => mapping[f.key]).slice(0, 8).map((f) => <td key={f.key} className={f.type === "money" ? "num" : "wrap"}>{f.type === "money" ? (r[f.key + "Cents"] !== undefined ? formatMoney(r[f.key + "Cents"], currency) : "") : String(r[f.key] ?? "")}</td>)}</tr>)}</tbody>
          </table></div>
        </>}
        {missingOpts.length > 0 && <div className="alert warn">Fill in: {missingOpts.join(", ")}.</div>}
        <div className="row">
          <button className="btn primary" onClick={submit} disabled={busy || !result.valid.length || (result.errors.length > 0 && !skipInvalid) || missingOpts.length > 0}>
            {busy ? "Importing…" : `Import ${result.valid.length.toLocaleString()} rows`}
          </button>
        </div>
      </div>}
    </div>
  );
}

function LedgerChecks({ rows, currency }) {
  const stats = useMemo(() => {
    let dr = 0, cr = 0;
    const j = new Map();
    for (const r of rows) { if (r.amountCents > 0) dr += r.amountCents; else cr -= r.amountCents; if (r.journalNo) j.set(r.journalNo, (j.get(r.journalNo) || 0) + r.amountCents); }
    const unbalanced = [...j].filter(([, s]) => s !== 0);
    const dates = rows.map((r) => r.date).sort();
    return { dr, cr, journals: j.size, unbalanced, from: dates[0], to: dates[dates.length - 1] };
  }, [rows]);
  return (
    <div className={`alert ${stats.dr === stats.cr && !stats.unbalanced.length ? "success" : "warn"}`}>
      {stats.from} → {stats.to} · {stats.journals ? `${stats.journals.toLocaleString()} journals · ` : ""}debits {formatMoney(stats.dr, currency)} · credits {formatMoney(stats.cr, currency)}
      {stats.dr !== stats.cr && <> · <strong>out of balance by {formatMoney(stats.dr - stats.cr, currency)}</strong></>}
      {stats.unbalanced.length > 0 && <div className="small">{stats.unbalanced.length} journal(s) don't balance, e.g. {stats.unbalanced.slice(0, 3).map(([k, s]) => `${k} (${formatMoney(s, currency)})`).join(", ")}. You can still import; Journal audit will flag them.</div>}
    </div>
  );
}
