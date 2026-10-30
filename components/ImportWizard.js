"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { IMPORT_KINDS, guessMapping, checkMapping, validateRows } from "@/lib/csv-import";
import { detectDateFormat, DATE_FORMATS } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

/**
 * Three-step CSV import: choose file → map columns → review validation → import.
 * `onImport(payload)` is a server action returning { error } or { ok, redirect }.
 */
export default function ImportWizard({ kind, onImport, currency = "KES", extra }) {
  const router = useRouter();
  const def = IMPORT_KINDS[kind];
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [decimal, setDecimal] = useState(".");
  const [step, setStep] = useState(1);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function onFile(f) {
    setError("");
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) { setError("Please choose a .csv file. In Excel, use File → Save As → CSV."); return; }
    Papa.parse(f, {
      header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim(),
      complete: (res) => {
        const hs = (res.meta.fields || []).filter(Boolean);
        if (!hs.length || !res.data.length) { setError("That file doesn't have a header row and data rows."); return; }
        const m = guessMapping(kind, hs);
        setFile(f); setHeaders(hs); setRows(res.data); setMapping(m);
        if (m.date) setDateFormat(detectDateFormat(res.data.map((r) => r[m.date])));
        setStep(2);
      },
      error: (e) => setError(`Couldn't read the file: ${e.message}`),
    });
  }

  const mappingProblems = useMemo(() => (step >= 2 ? checkMapping(kind, mapping) : []), [kind, mapping, step]);
  const result = useMemo(() => (step === 3 ? validateRows(kind, rows, mapping, { dateFormat, decimal }) : null), [step, kind, rows, mapping, dateFormat, decimal]);

  async function submit() {
    setBusy(true); setError("");
    try {
      const res = await onImport({ fileName: file.name, rows, mapping, dateFormat, decimal, skipInvalid, ...(extra || {}) });
      if (res?.error) { setError(res.error); setBusy(false); return; }
      router.push(res.redirect); router.refresh();
    } catch (e) { setError(e.message || "Import failed."); setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="row small muted">
        {["Choose file", "Map columns", "Review & import"].map((s, i) => (
          <span key={s} className={`badge ${step === i + 1 ? "accent" : step > i + 1 ? "good" : ""}`}>{i + 1}. {s}</span>
        ))}
      </div>
      {error && <div className="alert error">{error}</div>}

      {step === 1 && (
        <label className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
          <div className="display" style={{ fontSize: "1.2rem", color: "var(--text)" }}>Drop a CSV file here, or click to choose</div>
          <div className="muted small" style={{ marginTop: ".4rem" }}>The first row must contain column headers. Any column names work — you'll map them next.</div>
        </label>
      )}

      {step === 2 && (
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Map columns in {file.name}</h3><span className="muted small">{rows.length.toLocaleString()} rows</span></div>
          <p className="muted small">We guessed from the headers. Fields marked * are required.</p>
          <div className="mapping-grid">
            {def.fields.map((f) => (
              <div key={f.key}>
                <label>{f.label}{f.required ? " *" : ""}</label>
                <select value={mapping[f.key] || ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                  <option value="">— not in file —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
            <div><label>Date format</label>
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>{DATE_FORMATS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
            <div><label>Decimal separator</label>
              <select value={decimal} onChange={(e) => setDecimal(e.target.value)}><option value=".">1,234.56 (point)</option><option value=",">1.234,56 (comma)</option></select></div>
          </div>
          <p className="help">
            {kind === "ledger" ? "Signed amount: positive = debit, negative = credit. Or map separate Debit and Credit columns." : "Signed amount: positive = money in, negative = money out. Or map separate Money in / Money out columns."}
          </p>
          <h3 style={{ marginTop: "1.2rem" }}>First rows</h3>
          <div className="table-wrap"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 4).map((r, i) => <tr key={i}>{headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody></table></div>
          {mappingProblems.length > 0 && <div className="alert warn" style={{ marginTop: "1rem" }}>{mappingProblems.map((p) => <div key={p}>{p}</div>)}</div>}
          <div className="row" style={{ marginTop: "1rem" }}>
            <button className="btn" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" disabled={mappingProblems.length > 0} onClick={() => setStep(3)}>Validate rows</button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="card stack">
          <div className="grid grid-3">
            <div className="stat"><div className="label">Rows in file</div><div className="value">{(result.valid.length + result.errors.length).toLocaleString()}</div></div>
            <div className="stat"><div className="label">Ready to import</div><div className="value" style={{ color: "var(--good)" }}>{result.valid.length.toLocaleString()}</div></div>
            <div className="stat"><div className="label">With errors</div><div className="value" style={{ color: result.errors.length ? "var(--bad)" : undefined }}>{result.errors.length.toLocaleString()}</div></div>
          </div>
          {result.errors.length > 0 && <>
            <h3>Rows that need fixing</h3>
            <div className="table-wrap" style={{ maxHeight: 280, overflowY: "auto" }}><table><thead><tr><th>Line</th><th>Problems</th></tr></thead>
              <tbody>{result.errors.slice(0, 200).map((e) => <tr key={e.row} className="err"><td>{e.row}</td><td>{e.messages.join(" ")}</td></tr>)}</tbody></table></div>
            {result.errors.length > 200 && <p className="muted small">Showing the first 200 of {result.errors.length}.</p>}
            <label className="row" style={{ fontWeight: 400, color: "var(--text)" }}><input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} /> Import the {result.valid.length} valid rows and skip the {result.errors.length} with errors</label>
          </>}
          {result.valid.length > 0 && <>
            <h3>Preview</h3>
            <div className="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Reference</th>{kind === "ledger" && <th>Account</th>}<th className="num">Amount</th></tr></thead>
              <tbody>{result.valid.slice(0, 6).map((r) => <tr key={r.line}><td>{r.date}</td><td className="wrap">{r.description}</td><td>{r.reference || "—"}</td>{kind === "ledger" && <td>{r.accountCode}{r.accountName ? ` · ${r.accountName}` : ""}</td>}<td className="num">{formatMoney(r.amountCents, currency)}</td></tr>)}</tbody></table></div>
          </>}
          <div className="row">
            <button className="btn" onClick={() => setStep(2)} disabled={busy}>Back to mapping</button>
            <button className="btn primary" onClick={submit} disabled={busy || !result.valid.length || (result.errors.length > 0 && !skipInvalid)}>
              {busy ? "Importing…" : `Import ${result.valid.length.toLocaleString()} rows`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
