import "@/styles/audit.css";
import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import { loadCompletenessData, runCompleteness } from "@/lib/audit/data";
export const metadata = { title: "Completeness tests" };

const BADGE = { PASS: ["Pass", "good"], WARN: ["Review", "warn"], FAIL: ["Fail", "bad"], SKIP: ["Not run", ""] };

export default async function CompletenessPage({ params, searchParams: sp }) {
  const { ws } = await requireWorkspace(params.ws);
  const [range, tbs, charts] = await Promise.all([
    db.get("SELECT MIN(date) mn, MAX(date) mx, COUNT(*) n FROM ledger_entries WHERE workspace_id = ?", [ws.id]),
    db.all("SELECT id, chart, as_at, file_name, row_count FROM tb_imports WHERE workspace_id = ? ORDER BY as_at DESC", [ws.id]),
    db.all("SELECT chart, COUNT(*) n FROM coa_accounts WHERE workspace_id = ? GROUP BY chart ORDER BY chart", [ws.id]),
  ]);
  if (!range?.n) return (<><PageHead title="Completeness tests" /><div className="card empty"><h3>No ledger data yet</h3><p>Import the general ledger first.</p><Link className="btn primary" href={`/app/${ws.slug}/data?kind=ledger`}>Upload ledger</Link></div></>);
  const month = /^\d{4}-\d{2}$/.test(sp.month || "") ? sp.month : range.mx.slice(0, 7);
  const sorted = [...tbs].sort((a, b) => a.as_at.localeCompare(b.as_at));
  const tbClose = sp.tbClose ?? sorted[sorted.length - 1]?.id ?? "";
  const tbOpen = sp.tbOpen ?? sorted.filter((t) => t.as_at < (tbs.find((x) => x.id === tbClose)?.as_at || "")).pop()?.id ?? "";
  const chart = sp.chart ?? (charts[0]?.chart || "");
  const data = await loadCompletenessData(ws, { targetYm: month, tbOpeningId: tbOpen, tbClosingId: tbClose, chartLabel: chart });
  const { tests, summary } = runCompleteness(data);

  return (
    <>
      <PageHead title="Completeness tests" desc="Is everything that should be in the books there — exactly once, in the right period? Sequence gaps, trial-balance roll-forward, missing recurring postings, volume anomalies and more." />
      <Flash searchParams={sp} />
      <form className="card filters" style={{ marginBottom: "1rem" }}>
        <div className="form-row" style={{ alignItems: "end" }}>
          <div><label>Month to test</label><input type="month" name="month" defaultValue={month} /></div>
          <div><label>Opening trial balance</label><select name="tbOpen" defaultValue={tbOpen}><option value="">None</option>{tbs.map((t) => <option key={t.id} value={t.id}>{t.chart} · {t.as_at}</option>)}</select></div>
          <div><label>Closing trial balance</label><select name="tbClose" defaultValue={tbClose}><option value="">None</option>{tbs.map((t) => <option key={t.id} value={t.id}>{t.chart} · {t.as_at}</option>)}</select></div>
          <div><label>Chart of accounts</label><select name="chart" defaultValue={chart}><option value="">None</option>{charts.map((c) => <option key={c.chart} value={c.chart}>{c.chart} ({c.n})</option>)}</select></div>
          <button className="btn primary">Run tests</button>
        </div>
        <p className="help" style={{ marginBottom: 0 }}>Trial balances and charts come from the <Link href={`/app/${ws.slug}/data?kind=trial_balance`}>Data hub</Link>. The roll-forward proves the ledger extract is complete: opening TB + every journal in between must equal the closing TB.</p>
      </form>

      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        <div className="stat card"><div className="label">Passed</div><div className="value" style={{ color: "var(--good)" }}>{summary.pass}</div></div>
        <div className="stat card"><div className="label">To review</div><div className="value" style={{ color: "var(--warn)" }}>{summary.warn}</div></div>
        <div className="stat card"><div className="label">Failed</div><div className="value" style={{ color: "var(--bad)" }}>{summary.fail}</div></div>
        <div className="stat card"><div className="label">Not run</div><div className="value">{summary.skipped}</div></div>
      </div>

      <div className="card">
        {tests.map((t) => (
          <div key={t.id} className="test-row">
            <div><span className={`badge ${BADGE[t.status][1]}`}>{BADGE[t.status][0]}</span></div>
            <div>
              <strong>{t.title}</strong>
              <div className="muted">{t.summary}</div>
              {t.details.length > 0 && <details open={t.status === "FAIL"}><summary className="small">Details ({t.details.length})</summary><ul>{t.details.map((d, i) => <li key={i}>{d}</li>)}</ul></details>}
              {t.actions.length > 0 && <div className="small" style={{ marginTop: ".3rem" }}><strong>Action:</strong> {t.actions.join(" ")}</div>}
            </div>
          </div>
        ))}
      </div>
      <p className="faint small" style={{ marginTop: "1rem" }}>Tests run live on the current ledger; nothing is stored. Use <Link href={`/app/${ws.slug}/journal-audit`}>Journal audit</Link> for entry-level findings that can be assigned and tracked.</p>
    </>
  );
}
