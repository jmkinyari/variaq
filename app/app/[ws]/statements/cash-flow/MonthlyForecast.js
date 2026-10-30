"use client";
import { useMemo, useState, useTransition } from "react";
import { computeMonthly, MONTHLY_SCENARIOS } from "@/lib/forecast/monthly";
import { normalizeSettings } from "@/lib/cashflow";
import { CF_CATEGORIES } from "@/lib/statements";
import { parseAmount } from "@/lib/money";
import { LineChart } from "@/components/charts";
import { saveForecastVersioned } from "./actions";

const LABEL = { BASE: "Base", BEST: "Best", WORST: "Worst" };
const SECTIONS = [
  ["Cash in", ["CUSTOMER_RECEIPTS", "OTHER_RECEIPTS"], "inflows", "Total cash in"],
  ["Cash out", ["SUPPLIER_PAYMENTS", "PAYROLL", "OPEX", "TAX", "OTHER_PAYMENTS", "CAPEX"], "outflows", "Total cash out"],
  ["Financing", ["FINANCING"], "financing", "Net financing"],
];
const fmt0 = (c) => { if (c === null || c === undefined) return ""; const r = Math.round(c / 100); if (r === 0) return "–"; const s = Math.abs(r).toLocaleString("en-KE"); return r < 0 ? `(${s})` : s; };
const mLabel = (ym) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

export default function MonthlyForecast({ slug, model, initialSettings, currency, canEdit, version: v0, budgetName }) {
  const [settings, setSettings] = useState(() => normalizeSettings(initialSettings));
  const [sc, setSc] = useState("BASE");
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [version, setVersion] = useState(v0);
  const [pending, start] = useTransition();
  const res = useMemo(() => computeMonthly(model, settings.monthly), [model, settings]);
  const r = res.scenarios[sc];
  const p = settings.monthly.scenarios[sc];
  const update = (fn) => { setSettings((s) => { const n = structuredClone(s); fn(n.monthly); return n; }); setDirty(true); setMsg(null); };
  const setOverride = (cat, ym, cents) => update((m) => { const k = `${cat}|${ym}`; if (cents === null) delete m.scenarios[sc].overrides[k]; else m.scenarios[sc].overrides[k] = cents; });
  const save = () => start(async () => {
    const out = await saveForecastVersioned(slug, settings, version);
    if (out?.error) setMsg({ err: out.error }); else { setVersion(out.version); setDirty(false); setMsg({ ok: "12-month forecast saved." }); }
  });
  const min = settings.monthly.minCash;
  const usesBudget = r.source.some((s) => s === "BUDGET");
  return (
    <div className="viz-root">
      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        {MONTHLY_SCENARIOS.map((k) => { const s = res.scenarios[k].summary; return (
          <button key={k} type="button" onClick={() => setSc(k)} className="card stat" aria-pressed={k === sc} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--text)", boxShadow: k === sc ? "0 0 0 2px var(--accent) inset" : undefined }}>
            <div className="label">{LABEL[k]} case · cash in 12 months</div>
            <div className="value" style={{ color: s.endCash < min ? "var(--bad)" : undefined }}>{fmt0(s.endCash)}</div>
            <div className="small muted">lowest {fmt0(s.lowest.value)} in {mLabel(s.lowest.month)}</div>
            <div className="small" style={{ marginTop: 4 }}>{s.monthsBelowMin.length ? <span className="badge bad">Below minimum from {mLabel(s.firstBreach)} · funding gap {currency} {fmt0(s.fundingGap)}</span> : <span className="badge good">Stays above minimum</span>}</div>
          </button>); })}
      </div>
      {res.scenarios[sc].summary.fundingGap > 0 && <div className="alert warn">In the {LABEL[sc].toLowerCase()} case cash falls below the minimum of {currency} {fmt0(min)} from {mLabel(r.summary.firstBreach)}. You need about <strong>{currency} {fmt0(r.summary.fundingGap)}</strong> of extra funding or savings (e.g. an overdraft facility, faster collections, or deferring capex) to stay above it.</div>}
      <LineChart title={`Month-end cash · ${currency}`} subtitle={usesBudget ? `Driven by the approved budget “${budgetName}” where it covers the month; trend elsewhere` : "Driven by the trailing 3-month run-rate (no approved budget covers these months)"}
        labels={res.months.map(mLabel)} series={MONTHLY_SCENARIOS.map((k) => ({ label: LABEL[k], values: res.scenarios[k].closing }))} refLine={{ value: min, label: "Minimum cash" }} />
      <div className="row between no-print" style={{ margin: "1rem 0 .75rem" }}>
        <div className="seg" role="tablist">{MONTHLY_SCENARIOS.map((k) => <button key={k} type="button" className={k === sc ? "on" : ""} onClick={() => setSc(k)}>{LABEL[k]}</button>)}</div>
        <div className="row">
          <label className="row small" style={{ margin: 0, gap: ".4rem" }}>Basis
            <select value={settings.monthly.basis} disabled={!canEdit} onChange={(e) => update((m) => { m.basis = e.target.value; })} style={{ width: "auto", padding: ".3rem .5rem" }}><option value="AUTO">Approved budget, else trend</option><option value="TREND">Trend only</option></select></label>
          <label className="row small" style={{ margin: 0, gap: ".4rem" }}>Minimum cash ({currency})
            <input defaultValue={Math.round(min / 100).toLocaleString("en-KE")} disabled={!canEdit} onBlur={(e) => { const c = parseAmount(e.target.value); update((m) => { m.minCash = c ?? 0; }); }} style={{ width: 130, padding: ".3rem .5rem" }} /></label>
          {canEdit && <button type="button" className="btn sm primary" disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : dirty ? "Save" : "Saved"}</button>}
        </div>
      </div>
      {msg?.ok && <div className="alert success">{msg.ok}</div>}
      {msg?.err && <div className="alert error">{msg.err}</div>}
      <div className="cf-grid"><table>
        <thead><tr><th>{LABEL[sc]} case · {currency}</th><th>Run-rate<br />/ month</th>{res.months.map((m, i) => <th key={m}>{mLabel(m)}<br /><span style={{ fontWeight: 400 }}>{r.source[i] === "BUDGET" ? "budget" : "trend"}</span></th>)}<th>12-month<br />total</th></tr></thead>
        <tbody>
          <tr className="bal"><td>Opening cash</td><td />{r.opening.map((v, i) => <td key={i}>{fmt0(v)}</td>)}<td /></tr>
          {SECTIONS.map(([title, cats, key, totLabel]) => [
            <tr key={title} className="sec"><td>{title}</td><td colSpan={res.months.length + 2} /></tr>,
            ...cats.map((c) => <tr key={c}><td>{CF_CATEGORIES[c].label}</td><td className="muted">{fmt0(res.runRate[c])}</td>
              {r.rows[c].map((v, j) => <td key={j} className={canEdit ? "edit" : ""}>{canEdit ? <Cell value={v} overridden={r.overridden[c][j]} computed={r.computed[c][j]} outflow={CF_CATEGORIES[c].group === "OUT"} onCommit={(cents) => setOverride(c, res.months[j], cents)} /> : <span style={r.overridden[c][j] ? { color: "var(--warn)", fontWeight: 600 } : undefined}>{fmt0(v)}</span>}</td>)}
              <td>{fmt0(r.rows[c].reduce((a, x) => a + x, 0))}</td></tr>),
            <tr key={title + "t"} className="tot"><td>{totLabel}</td><td />{r[key].map((v, i) => <td key={i}>{fmt0(v)}</td>)}<td>{fmt0(r[key].reduce((a, x) => a + x, 0))}</td></tr>,
          ])}
          <tr className="tot"><td>Net cash flow</td><td />{r.net.map((v, i) => <td key={i} style={{ color: v < 0 ? "var(--bad)" : undefined }}>{fmt0(v)}</td>)}<td>{fmt0(r.summary.net12)}</td></tr>
          <tr className="bal"><td>Closing cash</td><td />{r.closing.map((v, i) => <td key={i} className={v < min ? "low" : ""}>{fmt0(v)}</td>)}<td /></tr>
        </tbody>
      </table></div>
      <div className="grid grid-2" style={{ marginTop: "1rem", alignItems: "start" }}>
        <div className="card assume">
          <h3>{LABEL[sc]} case assumptions</h3>
          <div className="form-row">
            <div className="field"><label>Receipts adjustment %</label><input type="number" step="1" value={p.adjIn} disabled={!canEdit} onChange={(e) => update((m) => { m.scenarios[sc].adjIn = +e.target.value || 0; })} /></div>
            <div className="field"><label>Payments adjustment % (+ = pay more)</label><input type="number" step="1" value={p.adjOut} disabled={!canEdit} onChange={(e) => update((m) => { m.scenarios[sc].adjOut = +e.target.value || 0; })} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Monthly growth on trend lines %</label><input type="number" step="0.1" value={p.growth} disabled={!canEdit} onChange={(e) => update((m) => { m.scenarios[sc].growth = +e.target.value || 0; })} /></div>
            <div className="field"><label>Collections slower by (months)</label><select value={p.collectionLag} disabled={!canEdit} onChange={(e) => update((m) => { m.scenarios[sc].collectionLag = +e.target.value; })}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          </div>
          {canEdit && Object.keys(p.overrides).length > 0 && <button type="button" className="btn sm ghost" onClick={() => update((m) => { m.scenarios[sc].overrides = {}; })}>Clear {Object.keys(p.overrides).length} manual value(s)</button>}
        </div>
        <div className="card small">
          <h3>How this is calculated</h3>
          <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
            <li>Opening cash is the cash balance at the end of the latest month in the ledger.</li>
            <li>With an approved budget: customer receipts = budgeted revenue × historical collection rate ({Math.round(res.collectionRate * 100)}% of revenue is collected); supplier payments = budgeted cost of sales × historical payment rate ({Math.round(res.payRate * 100)}%); payroll and overheads (excluding depreciation) come from the budget.</li>
            <li>Other lines, and months the budget doesn&apos;t cover, use the last 3 months&apos; average per line.</li>
            <li>Click any cell to type your own figure; clear it to go back to the calculated value.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Cell({ value, overridden, computed, outflow, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState("");
  if (!editing) return <button type="button" className={`cf-cell ${overridden ? "ovr" : ""}`} title={overridden ? `Manual value · calculated ${fmt0(computed)}` : "Click to enter your own figure"} onClick={() => { setTxt(String(Math.round((outflow ? Math.abs(value) : value) / 100))); setEditing(true); }}>{fmt0(value)}</button>;
  const commit = () => { setEditing(false); const t = txt.trim(); if (!t) return onCommit(null); let c = parseAmount(t); if (c === null) return; if (outflow && c > 0) c = -c; if (c === computed) return onCommit(null); onCommit(c); };
  return <input autoFocus className="cf-cell" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(false); }} aria-label="Forecast amount" />;
}
