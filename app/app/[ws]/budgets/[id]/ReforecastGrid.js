"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { computeBva } from "@/lib/budget/variance";
import { parseAmount } from "@/lib/money";
import { saveReforecast } from "../actions";

const CLASS_ORDER = [["REVENUE", "Revenue"], ["COGS", "Cost of sales"], ["EXPENSE", "Operating expenses"], ["OTHER_INCOME", "Other income (net)"]];
const f0 = (c) => { const r = Math.round((c || 0) / 100); return r === 0 ? "–" : r < 0 ? `(${Math.abs(r).toLocaleString("en-KE")})` : r.toLocaleString("en-KE"); };

/**
 * Full-year landing: closed months show actuals (correctable with a note, e.g. a known misposting
 * awaiting a journal), open months show the forecast (budget or run-rate by default, overridable).
 */
export default function ReforecastGrid({ slug, budgetId, version: v0, monthLabels, accounts, budget, actuals, closedMonths, initial, editable, userName }) {
  const [reforecast, setReforecast] = useState(initial.reforecast || {});
  const [actualOverrides, setActualOverrides] = useState(initial.actualOverrides || {});
  const [basis, setBasis] = useState(initial.landingBasis || "BUDGET");
  const [version, setVersion] = useState(v0);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [noteFor, setNoteFor] = useState(null); // {code, m, cents}
  const [pending, start] = useTransition();
  const chart = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);
  const bva = useMemo(() => computeBva({
    chart, budget: new Map(Object.entries(budget)), actuals: new Map(Object.entries(actuals)), closedMonths,
    reforecast, actualOverrides, landingBasis: basis,
  }), [chart, budget, actuals, closedMonths, reforecast, actualOverrides, basis]);

  const touch = () => { setDirty(true); setMsg(null); };
  const setForecast = (code, m, cents) => { setReforecast((r) => { const n = { ...r }; if (cents === null) delete n[`${code}|${m}`]; else n[`${code}|${m}`] = cents; return n; }); touch(); };
  const setActual = (code, m, cents, note) => { setActualOverrides((o) => { const n = { ...o }; if (cents === null) delete n[`${code}|${m}`]; else n[`${code}|${m}`] = { cents, note, by: userName, at: new Date().toISOString() }; return n; }); touch(); };

  const save = () => start(async () => {
    const res = await saveReforecast(slug, budgetId, version, { reforecast, actualOverrides, landingBasis: basis });
    if (res?.error) setMsg({ err: res.error }); else { setVersion(res.version); setDirty(false); setMsg({ ok: "Reforecast saved." }); }
  });

  const np = bva.netProfit;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card stat"><div className="label">Full-year budget net profit</div><div className="value">{f0(np.fy.budget)}</div></div>
        <div className="card stat"><div className="label">Full-year landing (reforecast)</div><div className="value">{f0(np.fy.landing)}</div></div>
        <div className="card stat"><div className="label">Landing vs budget</div><div className="value" style={{ color: np.fy.landing >= np.fy.budget ? "var(--good)" : "var(--bad)" }}>{f0(np.fy.landing - np.fy.budget)}</div></div>
        <div className="card stat"><div className="label">Closed months</div><div className="value">{closedMonths} / 12</div></div>
      </div>
      <div className="row between">
        <label className="row small" style={{ margin: 0, gap: ".4rem" }}>Open months default to
          <select value={basis} disabled={!editable} onChange={(e) => { setBasis(e.target.value); touch(); }} style={{ width: "auto" }}><option value="BUDGET">Budget</option><option value="RUN_RATE">Run-rate (avg of last 3 closed months)</option></select></label>
        <div className="row">{dirty && <span className="small" style={{ color: "var(--warn)" }}>Unsaved changes</span>}{editable && <button type="button" className="btn sm primary" disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : "Save reforecast"}</button>}</div>
      </div>
      {msg?.ok && <div className="alert success">{msg.ok}</div>}
      {msg?.err && <div className="alert error">{msg.err}</div>}
      {noteFor && <div className="card" style={{ borderColor: "var(--warn)" }}>
        <form onSubmit={(e) => { e.preventDefault(); const note = new FormData(e.currentTarget).get("note"); if (String(note).trim()) { setActual(noteFor.code, noteFor.m, noteFor.cents, String(note).trim()); setNoteFor(null); } }} className="row" style={{ alignItems: "end" }}>
          <div style={{ flex: 1 }}><label>Why is the actual for {noteFor.code} in {monthLabels[noteFor.m]} being changed to {f0(noteFor.cents)}? (required, kept in the audit trail)</label><input name="note" autoFocus required maxLength={300} placeholder="e.g. Rent for March posted to repairs — reclass journal JV-0412 pending" /></div>
          <button className="btn primary sm">Apply</button><button type="button" className="btn sm ghost" onClick={() => setNoteFor(null)}>Cancel</button>
        </form>
      </div>}
      <div className="bgrid">
        <table>
          <thead><tr><th>Account</th>{monthLabels.map((l, m) => <th key={l} style={m < closedMonths ? { background: "var(--border)" } : undefined}>{m < closedMonths ? "Actual" : "Fcst"}<br /><span style={{ fontWeight: 400 }}>{l}</span></th>)}<th>Landing</th><th>FY budget</th><th>Variance</th></tr></thead>
          <tbody>
            {CLASS_ORDER.map(([c, label]) => {
              const rows = bva.rows.filter((r) => r.cls === c);
              if (!rows.length) return null;
              const cls = bva.classes[c];
              return [
                <tr key={c} className="cls"><td>{label}</td><td colSpan={15} /></tr>,
                ...rows.map((r) => (
                  <tr key={r.code}>
                    <td title={r.name}><span className="faint">{r.code}</span> {r.name}</td>
                    {r.forecast.map((v, m) => {
                      const closed = m < closedMonths;
                      const ov = closed ? r.overridden[m] : r.reforecastOverridden[m];
                      const ao = actualOverrides[`${r.code}|${m}`];
                      if (!editable) return <td key={m} className={`${closed ? "act" : ""} ${ov ? "ovr" : ""}`} title={ao ? `Corrected: ${ao.note}` : undefined}>{f0(v)}</td>;
                      return <td key={m} className={`cell ${closed ? "act" : ""} ${ov ? "ovr" : ""}`} title={ao ? `Corrected from ${f0(actuals[r.code]?.[m] || 0)} — ${ao.note} (${ao.by || ""})` : closed ? "Actual from the ledger — edit to correct (note required)" : "Forecast — type to override"}>
                        <Cell value={v} label={`${r.name} ${monthLabels[m]}`} onCommit={(cents) => {
                          if (closed) { if (cents === null || cents === (actuals[r.code]?.[m] || 0)) setActual(r.code, m, null); else setNoteFor({ code: r.code, m, cents }); }
                          else setForecast(r.code, m, cents === null || cents === r.budget[m] && basis === "BUDGET" ? null : cents);
                        }} />
                      </td>;
                    })}
                    <td><strong>{f0(r.fy.landing)}</strong></td><td>{f0(r.fy.budget)}</td>
                    <td className={r.fy.favourable ? "" : ""}><span className={r.fy.favourable ? "fav" : "adv"}>{f0(r.fy.variance)}</span></td>
                  </tr>)),
                <tr key={c + "t"} className="tot"><td>Total {label.toLowerCase()}</td>{cls.forecastByMonth.map((v, m) => <td key={m}>{f0(v)}</td>)}<td>{f0(cls.fy.landing)}</td><td>{f0(cls.fy.budget)}</td><td>{f0(cls.fy.landing - cls.fy.budget)}</td></tr>,
              ];
            })}
            <tr className="grand"><td>Net profit</td>{Array.from({ length: 12 }, (_, m) => { const g = (c) => bva.classes[c].forecastByMonth[m]; return <td key={m}>{f0(g("REVENUE") - g("COGS") - g("EXPENSE") + g("OTHER_INCOME"))}</td>; })}<td>{f0(np.fy.landing)}</td><td>{f0(np.fy.budget)}</td><td>{f0(np.fy.landing - np.fy.budget)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="faint small">Shaded columns are closed months (actuals). Highlighted cells were changed by hand: actual corrections carry a mandatory note and the original ledger amount in their tooltip; clearing a cell reverts it.</p>
    </div>
  );
}

function Cell({ value, onCommit, label }) {
  const [txt, setTxt] = useState(null);
  const cancel = useRef(false);
  const shown = txt !== null ? txt : value ? String(Math.round(value / 100)) : "";
  return <input aria-label={label} value={shown} placeholder="–" onFocus={(e) => { cancel.current = false; setTxt(shown); e.target.select(); }}
    onChange={(e) => setTxt(e.target.value)}
    onBlur={() => { const t = txt; setTxt(null); if (t === null || cancel.current) return; if (t.trim() === "") return onCommit(null); const c = parseAmount(t); if (c !== null && c !== value) onCommit(c); }}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); } }} />;
}
