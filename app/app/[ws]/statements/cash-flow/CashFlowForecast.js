"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { computeForecast, normalizeSettings, defaultSettings, SCENARIOS } from "@/lib/cashflow";
import { CF_CATEGORIES } from "@/lib/statements";
import { parseAmount } from "@/lib/money";
import { saveForecastVersioned } from "./actions";

// Categorical slots 1–3 of the validated chart palette (light / dark handled via CSS vars below).
const SC_COLOR = { BASE: "var(--sc-base)", WORST: "var(--sc-worst)", BEST: "var(--sc-best)" };
const SC_ORDER = ["BASE", "BEST", "WORST"];
const SECTIONS = [
  ["Cash in", ["CUSTOMER_RECEIPTS", "OTHER_RECEIPTS"], "inflows", "Total cash in"],
  ["Cash out", ["SUPPLIER_PAYMENTS", "PAYROLL", "OPEX", "TAX", "OTHER_PAYMENTS", "CAPEX"], "outflows", "Total cash out"],
  ["Financing", ["FINANCING"], "financing", "Net financing"],
];
const fmt0 = (c) => { if (c === null || c === undefined) return ""; const r = Math.round(c / 100); if (r === 0) return "–"; const s = Math.abs(r).toLocaleString("en-KE"); return r < 0 ? `(${s})` : s; };
const fmtShort = (c) => { const v = c / 100, a = Math.abs(v); const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}k` : `${Math.round(a)}`; return v < 0 ? `−${s}` : s; };
const dlabel = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default function CashFlowForecast({ slug, model, initialSettings, currency, canEdit, savedInfo, latestLedger, version: v0 = 0 }) {
  const [version, setVersion] = useState(v0);
  const [noteFor, setNoteFor] = useState(null); // pending actual correction {cat, week, cents}
  const [settings, setSettings] = useState(() => normalizeSettings(initialSettings));
  const [sc, setSc] = useState("BASE");
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [saved, setSaved] = useState(savedInfo);
  const [pending, start] = useTransition();
  const res = useMemo(() => computeForecast(model, settings), [model, settings]);
  const r = res.scenarios[sc];
  const p = settings.scenarios[sc];
  const nAct = res.actualCount;

  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const update = (fn) => { setSettings((s) => { const n = structuredClone(s); fn(n); return n; }); setDirty(true); setMsg(null); };
  const setOverride = (cat, weekStart, cents) => update((s) => { const k = `${cat}|${weekStart}`; if (cents === null) delete s.scenarios[sc].overrides[k]; else s.scenarios[sc].overrides[k] = cents; });
  const overrideCount = Object.keys(p.overrides).length;
  const setActualOverride = (cat, weekStart, cents, note) => update((s) => { const k = `${cat}|${weekStart}`; if (cents === null) delete s.actualOverrides[k]; else s.actualOverrides[k] = { cents, note }; });
  const actualCount = Object.keys(settings.actualOverrides || {}).length;

  const save = () => start(async () => {
    const out = await saveForecastVersioned(slug, settings, version);
    if (out?.error) setMsg({ err: out.error }); else { setDirty(false); setVersion(out.version); setSettings(normalizeSettings(out.settings)); setSaved({ at: out.savedAt, by: out.by }); setMsg({ ok: "Forecast saved." }); }
  });

  const exportCsv = () => {
    const head = ["Line", "Run-rate per week", ...res.weeks.map((w) => `${w.actual ? "Actual" : "Forecast"} w/c ${w.start}`), "13-week forecast total"];
    const ftot = (arr) => arr.slice(nAct).reduce((a, x) => a + x, 0);
    const line = (label, base, arr, total = true) => [label, base === null ? "" : (base / 100).toFixed(2), ...arr.map((v) => (v / 100).toFixed(2)), total ? (ftot(arr) / 100).toFixed(2) : ""];
    const rows = [head, line("Opening cash", null, r.opening, false)];
    for (const [title, cats, key, totLabel] of SECTIONS) { for (const c of cats) rows.push(line(CF_CATEGORIES[c].label, res.baseline[c], r.rows[c])); rows.push(line(totLabel, null, r[key])); void title; }
    rows.push(line("Net cash flow", null, r.net), line("Closing cash", null, r.closing, false));
    const csv = rows.map((row) => row.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `cash-flow-13wk-${SCENARIOS[sc].toLowerCase()}-${model.forecastWeeks[0].start}.csv`;
    a.click();
  };

  const lowWeekLabel = (s) => (s.lowest.week ? `w/c ${dlabel(s.lowest.week)}` : "");
  return (
    <div className="cf-root">
      <style>{`.cf-root{--sc-base:#2a78d6;--sc-worst:#eb6834;--sc-best:#1baf7a}@media (prefers-color-scheme: dark){.cf-root{--sc-base:#3987e5;--sc-worst:#d95926;--sc-best:#199e70}}`}</style>

      {/* Scenario summary — click a card to show that scenario in the grid */}
      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        {SC_ORDER.map((k) => { const s = res.scenarios[k].summary; const on = k === sc; return (
          <button key={k} type="button" onClick={() => setSc(k)} className="card stat" aria-pressed={on}
            style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--text)", borderColor: on ? SC_COLOR[k] : undefined, boxShadow: on ? `0 0 0 2px ${SC_COLOR[k]} inset` : undefined }}>
            <div className="label"><span className="legend-dot" style={{ background: SC_COLOR[k] }} />{SCENARIOS[k]} case · cash at week 13</div>
            <div className="value" style={{ color: s.endCash < settings.minCash ? "var(--bad)" : undefined }}>{fmt0(s.endCash)}</div>
            <div className="small muted">13-week net {fmt0(s.forecastNet)} · lowest {fmt0(s.lowest.value)} {lowWeekLabel(s)}</div>
            <div className="small" style={{ marginTop: 4 }}>{s.weeksBelowMin ? <span className="badge bad">{s.weeksBelowMin} week{s.weeksBelowMin === 1 ? "" : "s"} below minimum</span> : <span className="badge good">Stays above minimum</span>}</div>
          </button>); })}
      </div>

      <Chart res={res} minCash={settings.minCash} currency={currency} />

      {/* Toolbar */}
      <div className="row between no-print" style={{ margin: "1.25rem 0 .75rem" }}>
        <div className="seg" role="tablist" aria-label="Scenario">
          {SC_ORDER.map((k) => <button key={k} type="button" role="tab" aria-selected={k === sc} className={k === sc ? "on" : ""} onClick={() => setSc(k)}>{SCENARIOS[k]}</button>)}
        </div>
        <div className="row">
          <label className="row small" style={{ margin: 0, gap: ".4rem" }}>Run-rate from last
            <select value={settings.lookback} onChange={(e) => update((s) => { s.lookback = +e.target.value; })} style={{ width: "auto", padding: ".3rem .5rem" }}>
              {[1, 2, 3, 4, 6, 8, 13].map((n) => <option key={n} value={n}>{n} week{n === 1 ? "" : "s"}</option>)}
            </select></label>
          <label className="row small" style={{ margin: 0, gap: ".4rem" }}>Minimum cash ({currency})
            <input defaultValue={Math.round(settings.minCash / 100).toLocaleString("en-KE")} onBlur={(e) => { const c = parseAmount(e.target.value); update((s) => { s.minCash = c ?? 0; }); }} style={{ width: 130, padding: ".3rem .5rem" }} /></label>
          <button type="button" className="btn sm" onClick={exportCsv}>Download CSV</button>
          {canEdit && <button type="button" className="btn sm primary" disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : dirty ? "Save assumptions" : "Saved"}</button>}
        </div>
      </div>
      {msg?.ok && <div className="alert success">{msg.ok}</div>}
      {msg?.err && <div className="alert error">{msg.err}</div>}

      {noteFor && (
        <form className="card row no-print" style={{ borderColor: "var(--warn)", alignItems: "end", marginBottom: ".75rem" }} onSubmit={(e) => { e.preventDefault(); const note = String(new FormData(e.currentTarget).get("note") || "").trim(); if (!note) return; setActualOverride(noteFor.cat, noteFor.week, noteFor.cents, note); setNoteFor(null); }}>
          <div style={{ flex: 1 }}><label>Why is the actual {CF_CATEGORIES[noteFor.cat].label.toLowerCase()} for the week of {dlabel(noteFor.week)} being changed to {fmt0(noteFor.cents)}? (required — recorded in the audit log)</label>
            <input name="note" autoFocus required maxLength={300} placeholder="e.g. Customer receipt banked on Monday belongs to the previous week" /></div>
          <button className="btn sm primary">Apply correction</button><button type="button" className="btn sm ghost" onClick={() => setNoteFor(null)}>Cancel</button>
        </form>)}
      {/* Grid */}
      <div className="cf-grid">
        <table>
          <thead>
            <tr>
              <th>{SCENARIOS[sc]} case · {currency}</th>
              <th title="Average per week over the run-rate window, before scenario adjustments">Run-rate<br />per week</th>
              {res.weeks.map((w, i) => <th key={w.start} className={w.actual ? "act" : ""}>{w.actual ? `Actual W−${nAct - i}` : `W${i - nAct + 1}`}<br /><span style={{ fontWeight: 400 }}>{dlabel(w.start)}</span></th>)}
              <th>13-week<br />total</th>
            </tr>
          </thead>
          <tbody>
            <BalRow label="Opening cash" arr={r.opening} weeks={res.weeks} />
            {SECTIONS.map(([title, cats, key, totLabel]) => (
              <Section key={title} title={title} cats={cats} totLabel={totLabel} tot={r[key]} r={r} res={res} nAct={nAct} canEdit={canEdit} setOverride={setOverride} actualOverrides={settings.actualOverrides} onActualEdit={(cat, week, cents) => { if (cents === null) setActualOverride(cat, week, null); else setNoteFor({ cat, week, cents }); }} />
            ))}
            <tr className="tot"><td>Net cash flow</td><td />{r.net.map((v, i) => <td key={i} className={res.weeks[i].actual ? "act" : ""} style={{ color: v < 0 ? "var(--bad)" : undefined }}>{fmt0(v)}</td>)}<td>{fmt0(r.net.slice(nAct).reduce((a, x) => a + x, 0))}</td></tr>
            <tr className="bal"><td>Closing cash</td><td />{r.closing.map((v, i) => <td key={i} className={`${res.weeks[i].actual ? "act" : ""} ${v < settings.minCash ? "low" : ""}`}>{fmt0(v)}</td>)}<td /></tr>
            <tr><td className="small muted">Headroom over minimum</td><td />{r.closing.map((v, i) => <td key={i} className={`small ${res.weeks[i].actual ? "act" : ""} ${v - settings.minCash < 0 ? "low" : ""}`}>{fmt0(v - settings.minCash)}</td>)}<td /></tr>
          </tbody>
        </table>
      </div>
      <p className="faint small" style={{ marginTop: ".5rem" }}>
        Shaded columns are actuals from the ledger (cash accounts, classified by the other side of each journal). Forecast weeks start from the run-rate and apply this scenario&apos;s assumptions.
        {canEdit ? " Click any forecast cell to type your own figure (payments can be typed as positive numbers); clear it to go back to the calculated value. Actual cells can also be corrected — a note is required, the correction feeds the run-rate, and clearing the cell restores the ledger figure. Edited cells are highlighted." : ""}
        {latestLedger ? ` Latest ledger entry: ${latestLedger}.` : ""}
      </p>

      {/* Assumptions */}
      <div className="grid grid-2" style={{ marginTop: "1.25rem", alignItems: "start" }}>
        <div className="card assume">
          <div className="row between"><h3 style={{ margin: 0 }}><span className="legend-dot" style={{ background: SC_COLOR[sc] }} />{SCENARIOS[sc]} case assumptions</h3>
            {canEdit && <button type="button" className="btn sm ghost" onClick={() => update((s) => { s.scenarios[sc] = { ...defaultSettings().scenarios[sc], overrides: s.scenarios[sc].overrides }; })}>Reset to defaults</button>}</div>
          <p className="small muted" style={{ margin: ".4rem 0 .8rem" }}>Adjustment to the run-rate for each line. For payments, +10% means paying 10% more.</p>
          <table>
            <thead><tr><th>Line</th><th className="num">Run-rate / wk</th><th className="num" style={{ width: 120 }}>Adjust %</th><th className="num">Forecast / wk</th></tr></thead>
            <tbody>{SECTIONS.flatMap(([, cats]) => cats).map((c) => (
              <tr key={c}><td>{CF_CATEGORIES[c].label}</td><td className="num">{fmt0(res.baseline[c])}</td>
                <td className="num"><input type="number" step="1" value={p.adj[c]} disabled={!canEdit} onChange={(e) => update((s) => { s.scenarios[sc].adj[c] = e.target.value === "" ? 0 : +e.target.value; })} style={{ textAlign: "right" }} /></td>
                <td className="num">{fmt0(Math.round(res.baseline[c] * (1 + p.adj[c] / 100)))}</td></tr>))}</tbody>
          </table>
        </div>
        <div className="card assume">
          <h3>Timing and trend</h3>
          <div className="field"><label>Weekly growth (% compounding, applies to every line)</label>
            <input type="number" step="0.1" value={p.growth} disabled={!canEdit} onChange={(e) => update((s) => { s.scenarios[sc].growth = e.target.value === "" ? 0 : +e.target.value; })} /></div>
          <div className="field"><label>Customer collections delayed by</label>
            <select value={p.receiptLag} disabled={!canEdit} onChange={(e) => update((s) => { s.scenarios[sc].receiptLag = +e.target.value; })}>
              {[0, 1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n === 0 ? "No delay" : `${n} week${n === 1 ? "" : "s"} (no customer receipts in W1${n > 1 ? `–W${n}` : ""})`}</option>)}
            </select></div>
          <div className="panel small">
            <strong>{overrideCount}</strong> manual cell value{overrideCount === 1 ? "" : "s"} in this scenario · <strong>{actualCount}</strong> corrected actual{actualCount === 1 ? "" : "s"} (all scenarios).
            {canEdit && actualCount > 0 && <> <button type="button" className="btn sm ghost" onClick={() => update((s) => { s.actualOverrides = {}; })}>Revert actual corrections</button></>}
            {canEdit && overrideCount > 0 && <> <button type="button" className="btn sm ghost" onClick={() => update((s) => { s.scenarios[sc].overrides = {}; })}>Clear them</button></>}
            {canEdit && sc !== "BASE" && <div style={{ marginTop: ".5rem" }}><button type="button" className="btn sm" onClick={() => update((s) => { s.scenarios[sc].overrides = { ...s.scenarios.BASE.overrides }; })}>Copy manual values from Base</button></div>}
          </div>
          <p className="faint small" style={{ marginTop: ".8rem", marginBottom: 0 }}>{saved?.at ? `Assumptions last saved ${new Date(saved.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}${saved.by ? ` by ${saved.by}` : ""}.` : "Using default assumptions — not saved yet."} Manual values are stored against their week date, so they stay put when you move the forecast start.</p>
        </div>
      </div>
    </div>
  );
}

function BalRow({ label, arr, weeks }) {
  return <tr className="bal"><td>{label}</td><td />{arr.map((v, i) => <td key={i} className={weeks[i].actual ? "act" : ""}>{fmt0(v)}</td>)}<td /></tr>;
}

function Section({ title, cats, totLabel, tot, r, res, nAct, canEdit, setOverride, actualOverrides = {}, onActualEdit }) {
  return (
    <>
      <tr className="sec"><td>{title}</td><td colSpan={res.weeks.length + 2} /></tr>
      {cats.map((c) => (
        <tr key={c}>
          <td>{CF_CATEGORIES[c].label}</td>
          <td className="muted">{fmt0(res.baseline[c])}</td>
          {r.rows[c].map((v, i) => {
            const w = res.weeks[i];
            if (w.actual) {
              const ao = actualOverrides[`${c}|${w.start}`];
              const orig = r.actualOriginal?.[c]?.[i];
              const tip = ao ? `Corrected from ${fmt0(orig)}: ${ao.note}${ao.by ? ` — ${ao.by}` : ""}` : "Actual from the ledger";
              return <td key={i} className={`act ${canEdit ? "edit" : ""}`} title={tip}>{canEdit
                ? <Cell value={v} overridden={!!ao} computed={orig} outflow={CF_CATEGORIES[c].group === "OUT"} onCommit={(cents) => onActualEdit(c, w.start, cents === null || cents === orig ? null : cents)} />
                : <span style={ao ? { color: "var(--warn)", fontWeight: 600 } : undefined}>{fmt0(v)}</span>}</td>;
            }
            const j = i - nAct;
            return <td key={i} className={canEdit ? "edit" : ""}>{canEdit
              ? <Cell value={v} overridden={r.overridden[c][j]} computed={r.computed[c][j]} outflow={CF_CATEGORIES[c].group === "OUT"} onCommit={(cents) => setOverride(c, w.start, cents)} />
              : <span style={r.overridden[c][j] ? { color: "var(--warn)", fontWeight: 600 } : undefined}>{fmt0(v)}</span>}</td>;
          })}
          <td>{fmt0(r.rows[c].slice(nAct).reduce((a, x) => a + x, 0))}</td>
        </tr>))}
      <tr className="tot"><td>{totLabel}</td><td />{tot.map((v, i) => <td key={i} className={res.weeks[i].actual ? "act" : ""}>{fmt0(v)}</td>)}<td>{fmt0(tot.slice(nAct).reduce((a, x) => a + x, 0))}</td></tr>
    </>
  );
}

function Cell({ value, overridden, computed, outflow, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState("");
  if (!editing) return (
    <button type="button" className={`cf-cell ${overridden ? "ovr" : ""}`} title={overridden ? `Manual value · calculated ${fmt0(computed)}` : "Click to enter your own figure"}
      onClick={() => { setTxt(String(Math.round((outflow ? Math.abs(value) : value) / 100))); setEditing(true); }}>{fmt0(value)}</button>
  );
  const commit = () => {
    setEditing(false);
    const t = txt.trim();
    if (!t) return onCommit(null);
    let c = parseAmount(t);
    if (c === null) return;
    if (outflow && c > 0) c = -c; // payments typed as positive numbers
    if (c === computed) return onCommit(null);
    onCommit(c);
  };
  return <input autoFocus className="cf-cell" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onFocus={(e) => e.target.select()}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(false); }} aria-label="Forecast amount" />;
}

function Chart({ res, minCash, currency }) {
  const [hover, setHover] = useState(null);
  const W = 960, H = 260, pad = { l: 64, r: 74, t: 16, b: 34 };
  const n = res.weeks.length;
  const all = SC_ORDER.flatMap((k) => res.scenarios[k].closing).concat([minCash, 0]);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) hi = lo + 100;
  const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, n - 1);
  const y = (v) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const nAct = res.actualCount;
  const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  // Direct labels at line ends, nudged apart so they don't collide.
  const ends = SC_ORDER.map((k) => ({ k, v: res.scenarios[k].closing[n - 1], yy: y(res.scenarios[k].closing[n - 1]) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
  return (
    <div className="card" style={{ padding: "14px 14px 8px" }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: ".95rem" }}>Closing cash by week · {currency}</strong>
        <div className="row small muted" style={{ gap: "1rem" }}>
          {SC_ORDER.map((k) => <span key={k}><span className="legend-dot" style={{ background: SC_COLOR[k] }} />{SCENARIOS[k]}</span>)}
          <span><svg width="18" height="8" style={{ marginRight: 6, verticalAlign: "middle" }}><line x1="0" y1="4" x2="18" y2="4" stroke="var(--text-3)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>Minimum cash</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Closing cash by week for base, best and worst scenarios" style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
        <rect x={pad.l} y={pad.t} width={Math.max(0, x(nAct - 0.5) - pad.l)} height={H - pad.t - pad.b} fill="var(--muted)" />
        {nAct > 0 && <text x={pad.l + 6} y={pad.t + 14} fontSize="11" fill="var(--text-3)">Actual</text>}
        <text x={x(nAct - 0.5) + 6} y={pad.t + 14} fontSize="11" fill="var(--text-3)">Forecast</text>
        {ticks.map((t, i) => <g key={i}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" /><text x={pad.l - 8} y={y(t) + 4} fontSize="11" textAnchor="end" fill="var(--text-3)">{fmtShort(t)}</text></g>)}
        {lo < 0 && hi > 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--text-3)" strokeWidth="1" />}
        <line x1={pad.l} x2={W - pad.r} y1={y(minCash)} y2={y(minCash)} stroke="var(--text-3)" strokeWidth="1.5" strokeDasharray="4 3" />
        {res.weeks.map((w, i) => (i % 2 === 0 || n <= 10) && <text key={w.start} x={x(i)} y={H - pad.b + 18} fontSize="11" textAnchor="middle" fill="var(--text-3)">{dlabel(w.start)}</text>)}
        {SC_ORDER.map((k) => <path key={k} d={path(res.scenarios[k].closing)} fill="none" stroke={SC_COLOR[k]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {ends.map((e) => <text key={e.k} x={W - pad.r + 8} y={e.yy + 4} fontSize="11" fill="var(--text-2)">{SCENARIOS[e.k]} {fmtShort(e.v)}</text>)}
        {hover !== null && <>
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--text-3)" strokeWidth="1" />
          {SC_ORDER.map((k) => <circle key={k} cx={x(hover)} cy={y(res.scenarios[k].closing[hover])} r="4.5" fill={SC_COLOR[k]} stroke="var(--card)" strokeWidth="2" />)}
        </>}
        {res.weeks.map((w, i) => <rect key={w.start} x={x(i) - (W - pad.l - pad.r) / Math.max(1, n - 1) / 2} y={pad.t} width={(W - pad.l - pad.r) / Math.max(1, n - 1)} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />)}
      </svg>
      {hover !== null && (
        <div className="small" style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", padding: "4px 6px 2px", color: "var(--text-2)" }}>
          <strong style={{ color: "var(--text)" }}>{res.weeks[hover].actual ? "Actual" : "Forecast"} · week of {dlabel(res.weeks[hover].start)}</strong>
          {SC_ORDER.map((k) => <span key={k}><span className="legend-dot" style={{ background: SC_COLOR[k] }} />{SCENARIOS[k]} <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt0(res.scenarios[k].closing[hover])}</span></span>)}
        </div>)}
    </div>
  );
}
