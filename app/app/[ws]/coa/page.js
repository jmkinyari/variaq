import "@/styles/audit.css";
import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CLASSES } from "@/lib/statements";
import { reconcileCharts } from "@/lib/coa/consolidate";
import { LEDGER, listCharts, chartAccounts, loadMappings, loadTb, translated } from "@/lib/coa/data";
import { JournalLines } from "../journal-audit/ui";
import { autoMap, saveMappings, confirmAbove } from "./actions";
export const metadata = { title: "Chart of accounts mapping" };

const TABS = [["", "Charts"], ["map", "Map accounts"], ["consolidate", "Translated trial balance"], ["reconcile", "Reconcile two ledgers"]];
const clsLabel = (c) => CLASSES[c] || c || "—";

export default async function CoaPage({ params, searchParams: sp }) {
  const { ws } = await requireWorkspace(params.ws);
  const { charts, tbs } = await listCharts(ws.id);
  const tab = sp.tab || "";
  const base = `/app/${ws.slug}/coa`;
  const chartNames = charts.map((c) => c.chart);
  const defTarget = chartNames.find((c) => /group/i.test(c)) || chartNames.find((c) => c !== LEDGER) || LEDGER;
  const ledgerMax = (await db.get("SELECT MAX(date) mx FROM ledger_entries WHERE workspace_id = ?", [ws.id]))?.mx;
  const tbOptions = [...tbs.map((t) => ({ value: t.id, label: `${t.chart} · TB ${t.as_at}` })), ...(ledgerMax ? [{ value: `${LEDGER}:${sp.asAt || ledgerMax}`, label: `Variaq ledger at ${sp.asAt || ledgerMax}` }] : [])];
  const q = (o) => `?${new URLSearchParams(Object.fromEntries(Object.entries({ ...sp, ...o }).filter(([k, v]) => v && !["ok", "err"].includes(k))))}`;

  return (
    <>
      <PageHead title="Chart of accounts mapping" desc="Map a subsidiary's, an old system's or the ERP's chart to your group reporting chart, translate trial balances, and reconcile two ledgers to find mispostings.">
        <Link className="btn" href={`/app/${ws.slug}/data?kind=coa`}>Upload chart</Link>
        <Link className="btn" href={`/app/${ws.slug}/data?kind=trial_balance`}>Upload trial balance</Link>
      </PageHead>
      <Flash searchParams={sp} />
      <div className="tabs" style={{ marginBottom: "1rem" }}>{TABS.map(([k, l]) => <Link key={k} href={k ? q({ tab: k }) : base} className={tab === k ? "active" : ""}>{l}</Link>)}</div>
      {tab === "" && <ChartsTab ws={ws} charts={charts} tbs={tbs} defTarget={defTarget} base={base} />}
      {tab === "map" && <MapTab ws={ws} sp={sp} chartNames={chartNames} defTarget={defTarget} q={q} />}
      {tab === "consolidate" && <ConsolidateTab ws={ws} sp={sp} chartNames={chartNames} defTarget={defTarget} tbOptions={tbOptions} />}
      {tab === "reconcile" && <ReconcileTab ws={ws} sp={sp} chartNames={chartNames} defTarget={defTarget} tbOptions={tbOptions} />}
    </>
  );
}

function ChartsTab({ ws, charts, tbs, defTarget, base }) {
  if (!charts.length) return <div className="card empty"><h3>No charts yet</h3><p>Upload a chart of accounts (e.g. your GROUP reporting chart) or a trial balance from another system, or import your ledger.</p></div>;
  return <>
    <div className="table-wrap"><table>
      <thead><tr><th>Chart</th><th className="num">Accounts</th><th>Trial balances</th><th></th></tr></thead>
      <tbody>{charts.map((c) => (
        <tr key={c.chart}><td><strong>{c.chart}</strong>{c.virtual && <div className="faint small">Accounts in Variaq's general ledger</div>}</td><td className="num">{c.n}</td>
          <td className="small">{tbs.filter((t) => t.chart === c.chart).map((t) => t.as_at).join(", ") || "—"}</td>
          <td className="num">{c.chart !== defTarget && <Link className="btn sm" href={`${base}?tab=map&source=${encodeURIComponent(c.chart)}&target=${encodeURIComponent(defTarget)}`}>Map to {defTarget} →</Link>}</td></tr>))}</tbody>
    </table></div>
    <div className="card" style={{ marginTop: "1rem" }}>
      <h3>How it works</h3>
      <ol className="small muted" style={{ margin: 0 }}>
        <li>Upload the target chart (for example <strong>GROUP</strong>) and each source chart or trial balance (subsidiary, old ERP).</li>
        <li><strong>Map accounts</strong>: every source account gets the best target account by code structure, name (with finance synonyms such as debtors ↔ receivables), statement class and mappings you confirmed before. Review, override and confirm.</li>
        <li><strong>Translated trial balance</strong> shows any TB in the target chart and lists unmapped balances.</li>
        <li><strong>Reconcile two ledgers</strong> compares two TBs (e.g. ERP vs Variaq, old vs new system) account by account and spots equal-and-opposite differences — the signature of a misposting — with a proposed reclass journal.</li>
      </ol>
    </div>
  </>;
}

async function MapTab({ ws, sp, chartNames, defTarget, q }) {
  const source = sp.source || chartNames.find((c) => c !== defTarget) || "";
  const target = sp.target || defTarget;
  const picker = (
    <form className="card row" style={{ alignItems: "end", marginBottom: "1rem" }}>
      <input type="hidden" name="tab" value="map" />
      <div><label>Source chart</label><select name="source" defaultValue={source}>{chartNames.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div><label>Target chart</label><select name="target" defaultValue={target}>{chartNames.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div><label>Show</label><select name="show" defaultValue={sp.show || ""}><option value="">All</option><option value="review">Needs review</option><option value="unmapped">Unmapped</option></select></div>
      <button className="btn">Open</button>
    </form>
  );
  if (!source || source === target) return <>{picker}<div className="alert info">Choose two different charts.</div></>;
  const [src, tgt, maps] = await Promise.all([chartAccounts(ws.id, source), chartAccounts(ws.id, target), loadMappings(ws.id, source, target)]);
  const tByCode = new Map(tgt.map((a) => [a.code, a]));
  let rows = src.map((a) => ({ a, m: maps.get(a.code) }));
  const stats = { total: rows.length, confirmed: rows.filter((r) => r.m && r.m.status !== "SUGGESTED").length, suggested: rows.filter((r) => r.m?.status === "SUGGESTED" && r.m.target_code).length };
  if (sp.show === "review") rows = rows.filter((r) => !r.m || r.m.status === "SUGGESTED");
  if (sp.show === "unmapped") rows = rows.filter((r) => !r.m?.target_code);
  const edit = canEdit(ws.role);
  const H = () => <><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="source" value={source} /><input type="hidden" name="target" value={target} /></>;
  return <>
    {picker}
    <div className="row between" style={{ marginBottom: ".8rem" }}>
      <span className="muted small">{stats.total} accounts · {stats.confirmed} confirmed · {stats.suggested} suggested · {stats.total - stats.confirmed - stats.suggested} unmapped</span>
      <div className="row">
        <Link className="btn sm" href={`/app/${ws.slug}/coa/export?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`}>Export CSV</Link>
        {edit && <form action={autoMap}><H /><Submit className="btn sm primary" pendingText="Matching…">{maps.size ? "Re-run auto-mapping" : "Auto-map accounts"}</Submit></form>}
      </div>
    </div>
    {edit && maps.size > 0 && <form action={confirmAbove} className="row small" style={{ marginBottom: ".8rem" }}><H /><span>Confirm all suggestions with confidence ≥</span><input name="threshold" type="number" min={50} max={100} defaultValue={85} style={{ width: 80 }} /><span>%</span><Submit className="btn sm">Confirm</Submit></form>}
    <form action={saveMappings}>
      <H />
      <datalist id="targets">{tgt.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
      <div className="table-wrap"><table>
        <thead><tr><th>Source account</th><th>Class</th><th>Maps to ({target})</th><th>Confidence</th><th>Why</th><th>Status</th>{edit && <th>Confirm</th>}</tr></thead>
        <tbody>{rows.slice(0, 1500).map(({ a, m }) => {
          const r = m ? JSON.parse(m.reasons || "{}") : {};
          const t = m?.target_code ? tByCode.get(String(m.target_code)) : null;
          const clsClash = t && t.cls !== a.cls;
          return (
            <tr key={a.code}>
              <td>{a.code} <span className="small">{a.name}</span></td>
              <td className="small">{clsLabel(a.cls)}</td>
              <td style={{ minWidth: 200 }}>{edit ? <input name={`map_${a.code}`} list="targets" defaultValue={m?.target_code || ""} placeholder="target code" /> : (m?.target_code || "—")}
                {t && <div className="faint small">{t.name}{clsClash && <span className="badge warn" style={{ marginLeft: 4 }}>{clsLabel(t.cls)}</span>}</div>}</td>
              <td>{m ? <><span className="conf"><span style={{ width: `${m.confidence}%` }} /></span> <span className="small">{m.confidence}%</span></> : "—"}</td>
              <td className="small wrap faint">{(r.reasons || []).join("; ")}{r.alternatives?.length ? <div>Also: {r.alternatives.map((x) => `${x.code} ${x.name} (${x.confidence}%)`).join(", ")}</div> : null}</td>
              <td>{m ? <span className={`badge ${m.status === "SUGGESTED" ? "info" : "good"}`}>{m.status.toLowerCase()}</span> : <span className="badge">unmapped</span>}</td>
              {edit && <td>{m?.status === "SUGGESTED" && m.target_code && <input type="checkbox" name={`ok_${a.code}`} style={{ width: "auto" }} />}</td>}
            </tr>);
        })}</tbody>
      </table></div>
      {rows.length > 1500 && <p className="muted small">Showing the first 1,500 accounts. Filter to “Needs review” to work through the rest.</p>}
      {edit && <div className="row" style={{ marginTop: ".8rem" }}><Submit>Save changes</Submit><span className="faint small">Changing a target marks it “overridden”; ticking Confirm accepts a suggestion. Confirmed mappings teach future auto-mapping.</span></div>}
    </form>
  </>;
}

async function ConsolidateTab({ ws, sp, chartNames, defTarget, tbOptions }) {
  const target = sp.target || defTarget;
  const src = sp.tb || tbOptions[0]?.value;
  const tb = src ? await loadTb(ws.id, src) : null;
  const res = tb ? await translated(ws.id, tb, target) : null;
  const m = (c) => formatMoney(c, ws.currency);
  return <>
    <form className="card row" style={{ alignItems: "end", marginBottom: "1rem" }}>
      <input type="hidden" name="tab" value="consolidate" />
      <div><label>Trial balance</label><select name="tb" defaultValue={src}>{tbOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
      <div><label>Ledger date (for Variaq ledger)</label><input type="date" name="asAt" defaultValue={sp.asAt || ""} /></div>
      <div><label>Present in chart</label><select name="target" defaultValue={target}>{chartNames.map((c) => <option key={c}>{c}</option>)}</select></div>
      <button className="btn">Show</button>
    </form>
    {!res ? <div className="card empty"><p>Upload a trial balance or import the ledger first.</p></div> : <>
      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <div className="card stat"><div className="label">TB total (should be 0)</div><div className="value" style={{ color: res.totalCents ? "var(--bad)" : "var(--good)" }}>{m(res.totalCents)}</div></div>
        <div className="card stat"><div className="label">Accounts in {target}</div><div className="value">{res.rows.length}</div></div>
        <div className="card stat"><div className="label">Unmapped balances</div><div className="value" style={{ color: res.unmapped.length ? "var(--bad)" : undefined }}>{res.unmapped.length} · {m(res.unmappedCents)}</div></div>
      </div>
      {res.unmapped.length > 0 && <div className="alert warn">These accounts carry a balance but have no mapping to {target}, so they're missing from the translated TB: {res.unmapped.slice(0, 12).map((u) => `${u.code} ${u.name} (${m(u.balanceCents)})`).join("; ")}{res.unmapped.length > 12 ? "…" : ""}. <Link href={`/app/${ws.slug}/coa?tab=map&source=${encodeURIComponent(tb.chart)}&target=${encodeURIComponent(target)}&show=unmapped`}>Map them</Link>.</div>}
      <div className="table-wrap"><table>
        <thead><tr><th>{target} account</th><th>Class</th><th className="num">Balance</th><th>From</th></tr></thead>
        <tbody>{res.rows.map((r) => <tr key={r.code}><td>{r.code} {r.name}</td><td className="small">{clsLabel(r.cls)}</td><td className="num">{m(r.balanceCents)}</td><td className="small faint wrap">{r.sources.length === 1 && r.sources[0].code === r.code ? "" : r.sources.slice(0, 6).map((s) => `${s.code} ${s.name}`).join(", ")}{r.sources.length > 6 ? ` +${r.sources.length - 6}` : ""}</td></tr>)}</tbody>
      </table></div>
    </>}
  </>;
}

async function ReconcileTab({ ws, sp, chartNames, defTarget, tbOptions }) {
  const target = sp.target || defTarget;
  const a = sp.a || tbOptions[0]?.value, b = sp.b || tbOptions[1]?.value || tbOptions[0]?.value;
  const [ta, tb] = await Promise.all([a ? loadTb(ws.id, a) : null, b ? loadTb(ws.id, b) : null]);
  let res = null, xa = null, xb = null;
  if (ta && tb && a !== b) {
    [xa, xb] = await Promise.all([translated(ws.id, ta, target), translated(ws.id, tb, target)]);
    res = reconcileCharts(xa.rows, xb.rows);
  }
  const m = (c) => formatMoney(c, ws.currency);
  return <>
    <form className="card row" style={{ alignItems: "end", marginBottom: "1rem" }}>
      <input type="hidden" name="tab" value="reconcile" />
      <div><label>Ledger A</label><select name="a" defaultValue={a}>{tbOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
      <div><label>Ledger B</label><select name="b" defaultValue={b}>{tbOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
      <div><label>Variaq ledger date</label><input type="date" name="asAt" defaultValue={sp.asAt || ""} /></div>
      <div><label>Compare in chart</label><select name="target" defaultValue={target}>{chartNames.map((c) => <option key={c}>{c}</option>)}</select></div>
      <button className="btn">Reconcile</button>
    </form>
    {!res ? <div className="alert info">Choose two different trial balances (for example the ERP's TB and Variaq's ledger at the same date). Both are translated into the chosen chart through your mappings.</div> : <>
      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        <div className="card stat"><div className="label">Accounts compared</div><div className="value">{res.diffs.length}</div></div>
        <div className="card stat"><div className="label">Agree</div><div className="value" style={{ color: "var(--good)" }}>{res.diffs.filter((d) => d.matched).length}</div></div>
        <div className="card stat"><div className="label">Probable mispostings</div><div className="value" style={{ color: res.mispostings.length ? "var(--warn)" : undefined }}>{res.mispostings.length}</div></div>
        <div className="card stat"><div className="label">Unexplained differences</div><div className="value" style={{ color: res.unexplained.length ? "var(--bad)" : undefined }}>{res.unexplained.length}</div></div>
      </div>
      {(xa.unmapped.length > 0 || xb.unmapped.length > 0) && <div className="alert warn">Unmapped balances are excluded: {xa.unmapped.length} in A ({m(xa.unmappedCents)}), {xb.unmapped.length} in B ({m(xb.unmappedCents)}). Map them first for a complete comparison.</div>}
      {res.mispostings.length > 0 && <>
        <h2>Probable mispostings</h2>
        {res.mispostings.map((p, i) => (
          <div key={i} className="card" style={{ marginBottom: ".8rem" }}>
            <p style={{ marginTop: 0 }}><strong>{m(p.amountCents)}</strong> — {p.explanation}</p>
            <p className="small muted">Proposed correction in ledger A (if B is right):</p>
            <JournalLines lines={p.reclass} currency={ws.currency} />
            <p className="small"><Link href={`/app/${ws.slug}/ledger?account=${encodeURIComponent(p.accounts[0])}`}>Review entries in {p.accounts[0]}</Link> · <Link href={`/app/${ws.slug}/journal-audit?account=${encodeURIComponent(p.accounts[0])}`}>findings</Link></p>
          </div>))}
      </>}
      <h2>Account by account ({ta.label} vs {tb.label})</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>{target} account</th><th className="num">A</th><th className="num">B</th><th className="num">Difference</th><th></th></tr></thead>
        <tbody>{res.diffs.filter((d) => sp.all || !d.matched).map((d) => (
          <tr key={d.code}><td>{d.code} {d.name}</td><td className="num">{m(d.aCents)}</td><td className="num">{m(d.bCents)}</td><td className="num" style={{ color: d.matched ? undefined : "var(--bad)" }}>{m(d.diffCents)}</td>
            <td>{d.matched ? <span className="badge good">agrees</span> : res.mispostings.some((p) => p.accounts.includes(d.code)) ? <span className="badge warn">misposting?</span> : <span className="badge bad">unexplained</span>}</td></tr>))}
          {!sp.all && <tr><td colSpan={5} className="small"><Link href={`?${new URLSearchParams({ ...sp, all: "1" })}`}>Show agreeing accounts too</Link></td></tr>}
        </tbody>
      </table></div>
      <p className="faint small">TB A as at {formatDate(ta.asAt)}, TB B as at {formatDate(tb.asAt)}. Differences at different dates include genuine activity in between.</p>
    </>}
  </>;
}
