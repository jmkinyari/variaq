"use client";
// Dependency-free SVG charts for the CFO dashboard, budgets and board packs.
// Design rules (dataviz method): categorical slots in fixed order (series 1–4), 2px lines,
// <=24px bars with 4px rounded data-ends, hairline gridlines, area washes at ~10%, one y-axis only,
// legend for >=2 series, hover crosshair/tooltip, and a data-table view for every chart.
import { useState } from "react";

const SLOTS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

import { fmtCompact, fmtFull } from "./format";
export { fmtCompact, fmtFull };

function niceTicks(lo, hi, count = 4) {
  if (lo === hi) { hi = lo + 1; }
  const span = hi - lo, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw)))), norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}

function Legend({ items }) {
  if (items.length < 2) return null;
  return <div className="viz-legend">{items.map((it) => <span key={it.label}><span className={`key ${it.kind || ""}`} style={{ background: it.color }} />{it.label}</span>)}</div>;
}

function TableView({ labels, series, unit }) {
  return (
    <details className="viz-table">
      <summary>Show data table</summary>
      <div className="table-wrap" style={{ marginTop: 6 }}><table>
        <thead><tr><th></th>{series.map((s) => <th key={s.label} className="num">{s.label}</th>)}</tr></thead>
        <tbody>{labels.map((l, i) => <tr key={l + i}><td>{l}</td>{series.map((s) => <td key={s.label} className="num">{fmtFull(s.values[i], unit)}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  );
}

function Frame({ title, subtitle, legend, children, table, right }) {
  return (
    <div className="card viz-root viz-card">
      <div className="row between" style={{ marginBottom: 6, alignItems: "flex-start" }}>
        <div>{title && <h3 className="viz-title">{title}</h3>}{subtitle && <div className="viz-sub">{subtitle}</div>}</div>
        <div className="row" style={{ gap: ".8rem" }}>{legend}{right}</div>
      </div>
      {children}
      {table}
    </div>
  );
}

/**
 * Multi-series line chart. series: [{label, values (null = gap), slot?, area?}]
 * forecastFrom: index where values become a forecast (drawn dashed, shaded band label).
 * refLine: {value, label} drawn as a dashed hairline.
 */
export function LineChart({ title, subtitle, labels, series, unit = "money", height = 240, forecastFrom = null, refLine = null, zeroLine = true }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = height, pad = { l: 52, r: 16, t: 12, b: 28 };
  const n = labels.length;
  const vals = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  if (refLine) vals.push(refLine.value);
  if (zeroLine) vals.push(0);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const x = (i) => pad.l + (n <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo || 1);
  const seg = (vs, from, to) => { let d = "", pen = false; for (let i = from; i <= to; i++) { const v = vs[i]; if (v === null || v === undefined) { pen = false; continue; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; } return d; };
  const step = Math.max(1, Math.ceil(n / 8));
  const colors = series.map((s, i) => s.color || SLOTS[s.slot ?? i]);
  return (
    <Frame title={title} subtitle={subtitle}
      legend={<Legend items={[...series.map((s, i) => ({ label: s.label, color: colors[i], kind: "line" })), ...(refLine ? [{ label: refLine.label, kind: "dash" }] : []), ...(forecastFrom !== null && series.length === 1 ? [] : [])]} />}
      table={<TableView labels={labels} series={series} unit={unit} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={`${title || "Line chart"}: ${series.map((s) => s.label).join(", ")}`} onMouseLeave={() => setHover(null)}>
        {forecastFrom !== null && forecastFrom < n && <>
          <rect x={x(Math.max(0, forecastFrom - 0.5))} y={pad.t} width={W - pad.r - x(Math.max(0, forecastFrom - 0.5))} height={H - pad.t - pad.b} fill="var(--muted)" opacity=".6" />
          <text x={x(Math.max(0, forecastFrom - 0.5)) + 6} y={pad.t + 12} fontSize="11" fill="var(--ink-muted)">Forecast</text>
        </>}
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" /><text x={pad.l - 8} y={y(t) + 4} fontSize="11" textAnchor="end" fill="var(--ink-muted)">{fmtCompact(t, unit)}</text></g>)}
        {zeroLine && lo < 0 && hi > 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth="1" />}
        {refLine && <line x1={pad.l} x2={W - pad.r} y1={y(refLine.value)} y2={y(refLine.value)} stroke="var(--ink-muted)" strokeWidth="1.5" strokeDasharray="4 3" />}
        {labels.map((l, i) => i % step === 0 && <text key={l + i} x={x(i)} y={H - 8} fontSize="11" textAnchor="middle" fill="var(--ink-muted)">{l}</text>)}
        {series.map((s, si) => {
          const end = forecastFrom !== null ? Math.min(n - 1, forecastFrom - 1) : n - 1;
          const area = s.area && n > 1 ? `${seg(s.values, 0, n - 1)}L${x(n - 1)},${y(Math.max(lo, 0))}L${x(0)},${y(Math.max(lo, 0))}Z` : null;
          return <g key={s.label}>
            {area && <path d={area} fill={colors[si]} opacity=".1" />}
            <path d={seg(s.values, 0, end)} fill="none" stroke={colors[si]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {forecastFrom !== null && <path d={seg(s.values, Math.max(0, forecastFrom - 1), n - 1)} fill="none" stroke={colors[si]} strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />}
          </g>;
        })}
        {series.length <= 3 && series.map((s, si) => { const li = [...s.values.keys()].reverse().find((i) => s.values[i] !== null && s.values[i] !== undefined); return li !== undefined && <circle key={s.label} cx={x(li)} cy={y(s.values[li])} r="4" fill={colors[si]} stroke="var(--card)" strokeWidth="2" />; })}
        {hover !== null && <>
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-muted)" strokeWidth="1" />
          {series.map((s, si) => s.values[hover] !== null && s.values[hover] !== undefined && <circle key={s.label} cx={x(hover)} cy={y(s.values[hover])} r="4.5" fill={colors[si]} stroke="var(--card)" strokeWidth="2" />)}
        </>}
        {labels.map((l, i) => <rect key={"h" + i} x={x(i) - (W - pad.l - pad.r) / Math.max(1, n - 1) / 2} y={pad.t} width={(W - pad.l - pad.r) / Math.max(1, n - 1)} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)}><title>{`${l}: ${series.map((s) => `${s.label} ${fmtFull(s.values[i], unit)}`).join(" · ")}`}</title></rect>)}
      </svg>
      <div className="viz-tip" aria-live="polite">{hover !== null ? <><strong>{labels[hover]}{forecastFrom !== null && hover >= forecastFrom ? " (forecast)" : ""}</strong>{series.map((s, si) => <span key={s.label}><span className="legend-dot" style={{ background: colors[si] }} />{s.label} <span className="v">{fmtFull(s.values[hover], unit)}</span></span>)}</> : <span className="faint">Hover for values</span>}</div>
    </Frame>
  );
}

/** Rounded-top bar path (4px data-end, square at baseline); handles negative bars. */
function barPath(x, y0, y1, w, r = 4) {
  const top = Math.min(y0, y1), bot = Math.max(y0, y1), h = bot - top;
  const rr = Math.min(r, h, w / 2);
  if (h <= 0) return "";
  if (y1 <= y0) return `M${x},${bot}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${bot}Z`;
  return `M${x},${top}V${bot - rr}Q${x},${bot} ${x + rr},${bot}H${x + w - rr}Q${x + w},${bot} ${x + w},${bot - rr}V${top}Z`;
}

/** Grouped column chart. series: [{label, values}] (max 3 recommended). */
export function BarChart({ title, subtitle, labels, series, unit = "money", height = 220 }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = height, pad = { l: 52, r: 12, t: 12, b: 28 };
  const n = labels.length, k = series.length;
  const ticks = niceTicks(Math.min(0, ...series.flatMap((s) => s.values.map((v) => v || 0))), Math.max(0, ...series.flatMap((s) => s.values.map((v) => v || 0))));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const band = (W - pad.l - pad.r) / Math.max(1, n);
  const bw = Math.min(24, (band * 0.7) / k);
  const y = (v) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo || 1);
  const step = Math.max(1, Math.ceil(n / 12));
  return (
    <Frame title={title} subtitle={subtitle} legend={<Legend items={series.map((s, i) => ({ label: s.label, color: SLOTS[s.slot ?? i] }))} />} table={<TableView labels={labels} series={series} unit={unit} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={title || "Bar chart"} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" /><text x={pad.l - 8} y={y(t) + 4} fontSize="11" textAnchor="end" fill="var(--ink-muted)">{fmtCompact(t, unit)}</text></g>)}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth="1" />
        {labels.map((l, i) => {
          const gx = pad.l + band * i + (band - (bw * k + 2 * (k - 1))) / 2;
          return <g key={l + i} onMouseEnter={() => setHover(i)}>
            <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill={hover === i ? "var(--muted)" : "transparent"} />
            {series.map((s, si) => <path key={s.label} d={barPath(gx + si * (bw + 2), y(0), y(s.values[i] || 0), bw)} fill={SLOTS[s.slot ?? si]}><title>{`${l} · ${s.label}: ${fmtFull(s.values[i], unit)}`}</title></path>)}
            {i % step === 0 && <text x={pad.l + band * i + band / 2} y={H - 8} fontSize="11" textAnchor="middle" fill="var(--ink-muted)">{l}</text>}
          </g>;
        })}
      </svg>
      <div className="viz-tip">{hover !== null ? <><strong>{labels[hover]}</strong>{series.map((s, si) => <span key={s.label}><span className="legend-dot" style={{ background: SLOTS[s.slot ?? si] }} />{s.label} <span className="v">{fmtFull(s.values[hover], unit)}</span></span>)}</> : <span className="faint">Hover for values</span>}</div>
    </Frame>
  );
}

/**
 * Waterfall / bridge. steps: [{label, value, total?: true}] — totals are drawn from zero,
 * others float from the running sum. Increases use status-good, decreases status-critical.
 */
export function Waterfall({ title, subtitle, steps, unit = "money", height = 240 }) {
  const W = 720, H = height, pad = { l: 52, r: 12, t: 16, b: 40 };
  let run = 0;
  const bars = steps.map((s) => { if (s.total) { run = s.value; return { ...s, from: 0, to: s.value }; } const from = run; run += s.value; return { ...s, from, to: run }; });
  const ticks = niceTicks(Math.min(0, ...bars.flatMap((b) => [b.from, b.to])), Math.max(0, ...bars.flatMap((b) => [b.from, b.to])));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const band = (W - pad.l - pad.r) / Math.max(1, bars.length);
  const bw = Math.min(40, band * 0.6);
  const y = (v) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo || 1);
  const color = (b) => (b.total ? "var(--series-1)" : b.value >= 0 ? "var(--st-good)" : "var(--st-critical)");
  return (
    <Frame title={title} subtitle={subtitle} legend={<Legend items={[{ label: "Total", color: "var(--series-1)" }, { label: "Increase", color: "var(--st-good)" }, { label: "Decrease", color: "var(--st-critical)" }]} />}
      table={<TableView labels={steps.map((s) => s.label)} series={[{ label: "Amount", values: steps.map((s) => s.value) }]} unit={unit} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={title || "Waterfall chart"}>
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" /><text x={pad.l - 8} y={y(t) + 4} fontSize="11" textAnchor="end" fill="var(--ink-muted)">{fmtCompact(t, unit)}</text></g>)}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth="1" />
        {bars.map((b, i) => {
          const bx = pad.l + band * i + (band - bw) / 2;
          const top = Math.min(y(b.from), y(b.to)), h = Math.max(1, Math.abs(y(b.from) - y(b.to)));
          return <g key={b.label + i}>
            <rect x={bx} y={top} width={bw} height={h} rx="3" fill={color(b)}><title>{`${b.label}: ${fmtFull(b.value, unit)}`}</title></rect>
            {i < bars.length - 1 && <line x1={bx + bw} x2={bx + band} y1={y(b.to)} y2={y(b.to)} stroke="var(--axis)" strokeWidth="1" strokeDasharray="2 2" />}
            <text x={bx + bw / 2} y={top - 4} fontSize="10.5" textAnchor="middle" fill="var(--text-2)">{fmtCompact(b.value, unit)}</text>
            <text x={bx + bw / 2} y={H - 22} fontSize="10.5" textAnchor="middle" fill="var(--ink-muted)">{String(b.label).slice(0, 14)}</text>
            {String(b.label).length > 14 && <text x={bx + bw / 2} y={H - 10} fontSize="10.5" textAnchor="middle" fill="var(--ink-muted)">{String(b.label).slice(14, 28)}</text>}
          </g>;
        })}
      </svg>
    </Frame>
  );
}

/** Horizontal 100%-width stacked bars (e.g. AR/AP ageing). rows: [{label, parts: [cents...]}], partLabels. */
export function StackedBars({ title, subtitle, rows, partLabels, unit = "money" }) {
  const W = 720, rowH = 30, pad = { l: 120, r: 90, t: 6 };
  const H = pad.t * 2 + rows.length * (rowH + 12);
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, x) => a + Math.max(0, x), 0)));
  const sx = (v) => (v * (W - pad.l - pad.r)) / max;
  // Ageing is ordinal: map oldest buckets to warmer slots in fixed order.
  const colors = partLabels.map((_, i) => SLOTS[i]);
  return (
    <Frame title={title} subtitle={subtitle} legend={<Legend items={partLabels.map((l, i) => ({ label: l, color: colors[i] }))} />}
      table={<TableView labels={rows.map((r) => r.label)} series={partLabels.map((l, i) => ({ label: l, values: rows.map((r) => r.parts[i]) }))} unit={unit} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={title || "Stacked bars"}>
        {rows.map((r, ri) => {
          let acc = 0;
          const yy = pad.t + ri * (rowH + 12);
          const total = r.parts.reduce((a, x) => a + Math.max(0, x), 0);
          return <g key={r.label}>
            <text x={pad.l - 10} y={yy + rowH / 2 + 4} fontSize="12" textAnchor="end" fill="var(--text-2)">{r.label}</text>
            {r.parts.map((p, pi) => { const w = sx(Math.max(0, p)); const xx = pad.l + sx(acc); acc += Math.max(0, p); return w > 0 && <rect key={pi} x={xx} y={yy} width={Math.max(0, w - 2)} height={rowH} rx="3" fill={colors[pi]}><title>{`${r.label} · ${partLabels[pi]}: ${fmtFull(p, unit)}`}</title></rect>; })}
            <text x={pad.l + sx(total) + 8} y={yy + rowH / 2 + 4} fontSize="12" fill="var(--text)">{fmtCompact(total, unit)}</text>
          </g>;
        })}
      </svg>
    </Frame>
  );
}

export function Sparkline({ values, width = 120, height = 28, slot = 0 }) {
  const vs = (values || []).filter((v) => v !== null && v !== undefined);
  if (vs.length < 2) return null;
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (i) => (i * (width - 4)) / (values.length - 1) + 2;
  const y = (v) => height - 3 - ((v - lo) * (height - 6)) / (hi - lo || 1);
  const d = values.map((v, i) => (v === null || v === undefined ? "" : `${i && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join("");
  const li = values.length - 1;
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="viz-root" style={{ display: "block" }}><path d={d} fill="none" stroke={SLOTS[slot]} strokeWidth="1.5" strokeLinejoin="round" /><circle cx={x(li)} cy={y(values[li] ?? lo)} r="2.5" fill={SLOTS[slot]} /></svg>;
}

const STATUS_TEXT = { good: "On track", warn: "Watch", bad: "Action" };
/** KPI tile: label, status pill (icon + label, never colour alone), hero value, delta, sparkline. */
export function KpiTile({ kpi, currency = "KES", href }) {
  const { label, value, prior, unit, status, definition, series } = kpi;
  let delta = null;
  if (value !== null && prior !== null && prior !== undefined) {
    const d = value - prior;
    delta = unit === "money" ? `${d >= 0 ? "+" : "−"}${fmtCompact(Math.abs(d))} vs prior` : `${d >= 0 ? "+" : "−"}${fmtCompact(Math.abs(d), unit)} vs prior`;
  }
  const inner = (
    <div className="kpi-tile viz-root" title={definition}>
      <div className="k-label"><span>{label}</span>{status && <span className={`status-pill ${status}`}><i />{STATUS_TEXT[status]}</span>}</div>
      <div className="k-value">{unit === "money" ? <><span className="faint" style={{ fontSize: ".75rem", fontWeight: 400 }}>{currency} </span>{fmtCompact(value)}</> : fmtCompact(value, unit)}</div>
      <div className="row between" style={{ gap: ".4rem", alignItems: "flex-end" }}>
        <span className="k-delta">{delta || " "}</span>
        {series && <Sparkline values={series.slice(-12)} width={80} height={22} />}
      </div>
    </div>
  );
  return href ? <a href={href} style={{ textDecoration: "none", color: "inherit" }}>{inner}</a> : inner;
}
