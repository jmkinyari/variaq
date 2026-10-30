"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { parseAmount } from "@/lib/money";
import { saveBudgetLines } from "../actions";

const CLASS_ORDER = [["REVENUE", "Revenue"], ["COGS", "Cost of sales"], ["EXPENSE", "Operating expenses"], ["OTHER_INCOME", "Other income (net)"]];
const f0 = (c) => { const r = Math.round((c || 0) / 100); return r === 0 ? "–" : r < 0 ? `(${Math.abs(r).toLocaleString("en-KE")})` : r.toLocaleString("en-KE"); };
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);

/**
 * Accounts × 12 months editable grid with class totals, profit lines, % vs last 12 months,
 * bulk % changes per row or class and "spread an annual total". Saves only changed rows,
 * with an optimistic-lock version so two people editing at once can't overwrite each other.
 */
export default function BudgetGrid({ slug, budgetId, version: v0, monthLabels, accounts, lines: initial, prior, editable, otherAccounts }) {
  const [lines, setLines] = useState(initial);
  const [rows, setRows] = useState(accounts);
  const [dirty, setDirty] = useState(() => new Set());
  const [version, setVersion] = useState(v0);
  const [msg, setMsg] = useState(null);
  const [pending, start] = useTransition();
  const [bulk, setBulk] = useState({ target: "", pct: "" });
  const [spreadRow, setSpreadRow] = useState({ code: "", total: "", mode: "SHAPE" });
  const [addCode, setAddCode] = useState("");

  useEffect(() => {
    if (!dirty.size) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const setRow = (code, row) => { setLines((l) => ({ ...l, [code]: row })); setDirty((d) => new Set(d).add(code)); setMsg(null); };
  const setCell = (code, m, cents) => setRow(code, (lines[code] || new Array(12).fill(0)).map((v, i) => (i === m ? cents : v)));

  const byClass = useMemo(() => Object.fromEntries(CLASS_ORDER.map(([c]) => [c, rows.filter((r) => r.cls === c)])), [rows]);
  const classTot = (c) => Array.from({ length: 12 }, (_, m) => sum(byClass[c].map((r) => lines[r.code]?.[m] || 0)));
  const tots = Object.fromEntries(CLASS_ORDER.map(([c]) => [c, classTot(c)]));
  const gp = tots.REVENUE.map((v, m) => v - tots.COGS[m]);
  const np = gp.map((v, m) => v - tots.EXPENSE[m] + tots.OTHER_INCOME[m]);
  const priorTot = (codes) => sum(codes.map((c) => prior[c] || 0));

  function applyBulk() {
    const p = parseFloat(bulk.pct);
    if (!Number.isFinite(p) || !bulk.target) return;
    const targets = bulk.target.startsWith("class:") ? byClass[bulk.target.slice(6)].map((r) => r.code) : [bulk.target];
    setLines((l) => { const n = { ...l }; for (const c of targets) n[c] = (n[c] || new Array(12).fill(0)).map((v) => Math.round(v * (1 + p / 100))); return n; });
    setDirty((d) => { const n = new Set(d); targets.forEach((c) => n.add(c)); return n; });
  }
  function applySpread() {
    const total = parseAmount(spreadRow.total);
    if (total === null || !spreadRow.code) return;
    const cur = lines[spreadRow.code] || new Array(12).fill(0);
    const curTot = sum(cur);
    const weights = spreadRow.mode === "SHAPE" && curTot ? cur.map((v) => v / curTot) : new Array(12).fill(1 / 12);
    const row = weights.map((w) => Math.round(total * w));
    row[11] += total - sum(row);
    setRow(spreadRow.code, row);
  }
  function addAccount() {
    const a = otherAccounts.find((x) => x.code === addCode);
    if (!a) return;
    setRows((r) => [...r, a]);
    setRow(a.code, new Array(12).fill(0));
    setAddCode("");
  }

  const save = () => start(async () => {
    const changes = Object.fromEntries([...dirty].map((c) => [c, lines[c] || new Array(12).fill(0)]));
    const res = await saveBudgetLines(slug, budgetId, version, changes);
    if (res?.error) setMsg({ err: res.error + (res.conflict ? " Your unsaved edits are still on screen — copy them before reloading." : "") });
    else { setVersion(res.version); setDirty(new Set()); setMsg({ ok: "Budget saved." }); }
  });

  const exportCsv = () => {
    const head = ["Account", "Name", "Class", ...monthLabels, "Total"];
    const out = [head, ...rows.map((r) => [r.code, r.name, r.cls, ...(lines[r.code] || new Array(12).fill(0)).map((v) => (v / 100).toFixed(2)), (sum(lines[r.code] || []) / 100).toFixed(2)])];
    const csv = out.map((row) => row.map((x) => { const s = String(x ?? ""); const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; }).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "budget.csv"; a.click();
  };

  const totalRow = (label, arr, cls, priorVal) => (
    <tr className={cls}><td>{label}</td>{arr.map((v, m) => <td key={m}>{f0(v)}</td>)}<td>{f0(sum(arr))}</td><td>{priorVal ? `${(((sum(arr) - priorVal) / Math.abs(priorVal)) * 100).toFixed(1)}%` : ""}</td></tr>
  );

  return (
    <div className="stack">
      {editable && <div className="card row" style={{ alignItems: "end", gap: "1rem" }}>
        <div><label>Apply % change to</label><select value={bulk.target} onChange={(e) => setBulk({ ...bulk, target: e.target.value })} style={{ minWidth: 220 }}>
          <option value="">Choose a row or class…</option>
          {CLASS_ORDER.map(([c, l]) => <option key={c} value={`class:${c}`}>All {l.toLowerCase()}</option>)}
          {rows.map((r) => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}</select></div>
        <div><label>%</label><input type="number" step="0.1" value={bulk.pct} onChange={(e) => setBulk({ ...bulk, pct: e.target.value })} style={{ width: 90 }} /></div>
        <button type="button" className="btn sm" onClick={applyBulk}>Apply</button>
        <span className="faint">|</span>
        <div><label>Spread an annual total over</label><select value={spreadRow.code} onChange={(e) => setSpreadRow({ ...spreadRow, code: e.target.value })} style={{ minWidth: 200 }}><option value="">Choose a row…</option>{rows.map((r) => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}</select></div>
        <div><label>Annual total</label><input value={spreadRow.total} onChange={(e) => setSpreadRow({ ...spreadRow, total: e.target.value })} style={{ width: 130 }} /></div>
        <div><label>Pattern</label><select value={spreadRow.mode} onChange={(e) => setSpreadRow({ ...spreadRow, mode: e.target.value })}><option value="SHAPE">Keep row&apos;s monthly shape</option><option value="FLAT">Evenly</option></select></div>
        <button type="button" className="btn sm" onClick={applySpread}>Spread</button>
      </div>}

      <div className="row between">
        <div className="small muted">{dirty.size ? <strong style={{ color: "var(--warn)" }}>{dirty.size} row(s) changed — not saved</strong> : "All changes saved."} Amounts in whole currency units; income and costs both positive.</div>
        <div className="row"><button type="button" className="btn sm" onClick={exportCsv}>Download CSV</button>{editable && <button type="button" className="btn sm primary" disabled={!dirty.size || pending} onClick={save}>{pending ? "Saving…" : "Save budget"}</button>}</div>
      </div>
      {msg?.ok && <div className="alert success">{msg.ok}</div>}
      {msg?.err && <div className="alert error">{msg.err}</div>}

      <div className="bgrid">
        <table>
          <thead><tr><th>Account</th>{monthLabels.map((l) => <th key={l}>{l}</th>)}<th>Total</th><th title="Change vs the last 12 months of actuals">vs LY</th></tr></thead>
          <tbody>
            {CLASS_ORDER.map(([c, label]) => byClass[c].length > 0 && (
              <ClassBlock key={c} label={label} rows={byClass[c]} lines={lines} dirty={dirty} prior={prior} editable={editable} setCell={setCell} tot={tots[c]} priorTot={priorTot(byClass[c].map((r) => r.code))} totalRow={totalRow} />
            ))}
            {totalRow("Gross profit", gp, "grand", priorTot(byClass.REVENUE.map((r) => r.code)) - priorTot(byClass.COGS.map((r) => r.code)))}
            {totalRow("Net profit", np, "grand", priorTot(byClass.REVENUE.map((r) => r.code)) - priorTot(byClass.COGS.map((r) => r.code)) - priorTot(byClass.EXPENSE.map((r) => r.code)) + priorTot(byClass.OTHER_INCOME.map((r) => r.code)))}
          </tbody>
        </table>
      </div>
      {editable && otherAccounts.length > 0 && <div className="row"><select value={addCode} onChange={(e) => setAddCode(e.target.value)} style={{ width: "auto" }}><option value="">Add an account to the budget…</option>{otherAccounts.filter((a) => !rows.some((r) => r.code === a.code)).map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select><button type="button" className="btn sm" onClick={addAccount} disabled={!addCode}>Add row</button></div>}
    </div>
  );
}

function ClassBlock({ label, rows, lines, dirty, prior, editable, setCell, tot, priorTot, totalRow }) {
  return (
    <>
      <tr className="cls"><td>{label}</td><td colSpan={14} /></tr>
      {rows.map((r) => {
        const row = lines[r.code] || new Array(12).fill(0);
        const t = sum(row), p = prior[r.code] || 0;
        return (
          <tr key={r.code}>
            <td title={`${r.code} ${r.name}`}><span className="faint">{r.code}</span> {r.name}</td>
            {row.map((v, m) => editable
              ? <td key={m} className={`cell ${dirty.has(r.code) ? "changed" : ""}`}><Cell value={v} onCommit={(c) => setCell(r.code, m, c)} label={`${r.name} month ${m + 1}`} /></td>
              : <td key={m}>{f0(v)}</td>)}
            <td><strong>{f0(t)}</strong></td>
            <td className="faint">{p ? `${(((t - p) / Math.abs(p)) * 100).toFixed(1)}%` : t ? "new" : ""}</td>
          </tr>);
      })}
      {totalRow(`Total ${label.toLowerCase()}`, tot, "tot", priorTot)}
    </>
  );
}

function Cell({ value, onCommit, label }) {
  const [txt, setTxt] = useState(null);
  const cancel = useRef(false);
  const shown = txt !== null ? txt : value ? String(Math.round(value / 100)) : "";
  return <input aria-label={label} value={shown} placeholder="–" onFocus={(e) => { cancel.current = false; setTxt(shown); e.target.select(); }}
    onChange={(e) => setTxt(e.target.value)}
    onBlur={() => { const t = txt; setTxt(null); if (t === null || cancel.current) return; const c = t.trim() === "" ? 0 : parseAmount(t); if (c !== null && c !== value) onCommit(c); }}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); } }} />;
}
