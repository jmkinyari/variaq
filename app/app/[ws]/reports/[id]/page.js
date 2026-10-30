import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, canEdit, canAdmin } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { StatusBadge } from "@/components/Badges";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { aiAvailable, aiUnavailableReason } from "@/lib/ai";
import * as A from "../actions";
export const metadata = { title: "Variance report" };

export default async function ReportPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const [aiOn, aiReason] = [await aiAvailable(ws), await aiUnavailableReason(ws)];
  const rep = await db.get("SELECT r.*, u.name creator FROM reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ? AND r.workspace_id = ?", [params.id, ws.id]);
  if (!rep) notFound();
  const data = JSON.parse(rep.data); const notes = JSON.parse(rep.notes || "{}");
  const cur = ws.currency; const edit = canEdit(ws.role);
  const showAll = searchParams.all === "1";
  const lines = showAll ? data.lines : data.lines.filter((l) => l.material);
  const H = () => <><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="report" value={rep.id} /></>;
  const missing = data.lines.filter((l) => l.material && !notes[l.accountCode]).length;
  return (
    <>
      <PageHead title={rep.name} crumbs={<Link href={`/app/${ws.slug}/reports`}>Variance reports</Link>}
        desc={`${rep.comp_start} → ${rep.comp_end} compared with ${rep.base_start} → ${rep.base_end} · material = ≥${rep.threshold_pct}% and ≥${formatMoney(rep.threshold_cents, cur)}${data.prefix ? ` · accounts ${data.prefix}*` : ""}`}>
        <StatusBadge status={rep.status} />
        {edit && <form action={A.recompute}><H /><Submit className="btn" confirm="Recalculate from the current ledger? Status will return to draft." pendingText="Recalculating…">Recalculate</Submit></form>}
        {edit && (rep.status === "DRAFT"
          ? <form action={A.setReportStatus}><H /><input type="hidden" name="status" value="REVIEWED" /><Submit className="btn primary">Mark reviewed</Submit></form>
          : <form action={A.setReportStatus}><H /><input type="hidden" name="status" value="DRAFT" /><Submit className="btn">Back to draft</Submit></form>)}
      </PageHead>
      <Flash searchParams={searchParams} />
      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <div className="card stat"><div className="label">Accounts analysed</div><div className="value">{data.totals.accounts}</div></div>
        <div className="card stat"><div className="label">Material movements</div><div className="value">{data.totals.material}</div></div>
        <div className="card stat"><div className="label">Still need an explanation</div><div className="value" style={{ color: missing ? "var(--warn)" : "var(--good)" }}>{missing}</div></div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row between"><h3 style={{ margin: 0 }}>Summary commentary</h3><span className="badge">AI draft · review before sharing</span></div>
        {rep.ai_summary ? <p style={{ whiteSpace: "pre-wrap", marginTop: ".8rem" }}>{rep.ai_summary}</p> : <p className="muted" style={{ marginTop: ".8rem" }}>{aiOn ? "No AI draft yet." : `AI commentary is unavailable: ${aiReason} The account-level explanations below are generated from your transactions without AI.`}</p>}
        {edit && aiOn && <form action={A.aiSummary}><H /><Submit className="btn sm" pendingText="Writing…">{rep.ai_summary ? "Regenerate draft" : "Draft commentary with AI"}</Submit></form>}
      </div>

      <div className="row between" style={{ marginBottom: ".5rem" }}>
        <h2 style={{ margin: 0 }}>{showAll ? "All accounts" : "Material movements"}</h2>
        <Link href={showAll ? "?" : "?all=1"} className="btn sm">{showAll ? "Show material only" : `Show all ${data.lines.length} accounts`}</Link>
      </div>
      {lines.length === 0 && <div className="card empty">No material movements at these thresholds.</div>}
      <div className="stack">
        {lines.map((l) => (
          <div key={l.accountCode} id={`acct-${l.accountCode}`} className="card">
            <div className="row between">
              <div><strong>{l.accountCode}</strong> {l.accountName} {l.material && <span className="badge warn">Material</span>}</div>
              <div className="mono">{formatMoney(l.base, cur)} → <strong>{formatMoney(l.comp, cur)}</strong> <span className={`badge ${l.change > 0 ? "info" : "bad"}`}>{formatMoney(l.change, cur, { sign: true })}{l.pct === null ? " · new" : ` · ${l.pct > 0 ? "+" : ""}${l.pct}%`}</span></div>
            </div>
            <p className="muted small" style={{ margin: ".6rem 0" }}><span className="faint">From linked transactions:</span> {l.explanation}</p>
            {l.topEntries.length > 0 && <details><summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>Largest entries this period ({l.compCount})</summary>
              <div className="table-wrap" style={{ marginTop: ".5rem" }}><table><tbody>{l.topEntries.map((e) => <tr key={e.id}><td>{e.date}</td><td className="wrap">{e.description}</td><td>{e.reference || ""}</td><td>{e.counterparty || ""}</td><td className="num">{formatMoney(e.amountCents, cur)}</td></tr>)}</tbody></table></div>
              <Link className="small" href={`/app/${ws.slug}/ledger?account=${encodeURIComponent(l.accountCode)}&from=${rep.comp_start}&to=${rep.comp_end}`}>Open all entries in the ledger →</Link>
            </details>}
            {notes[l.accountCode] && <div className="panel small" style={{ marginTop: ".6rem" }}><strong>Reviewer explanation</strong> — {notes[l.accountCode].by}, {formatDateTime(notes[l.accountCode].at)}<div style={{ marginTop: ".3rem", whiteSpace: "pre-wrap" }}>{notes[l.accountCode].text}</div></div>}
            {edit && <details key={notes[l.accountCode]?.at || "new"} style={{ marginTop: ".5rem" }} open={l.material && !notes[l.accountCode] && missing <= 5}>
              <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>{notes[l.accountCode] ? "Edit explanation" : "Add explanation"}</summary>
              <form action={A.saveNote} style={{ marginTop: ".5rem" }}><H /><input type="hidden" name="account" value={l.accountCode} />
                <textarea name="note" defaultValue={notes[l.accountCode]?.text || ""} placeholder="What caused this movement, and is it expected to continue?" rows={3} />
                <Submit className="btn sm primary" style={{ marginTop: ".4rem" }}>Save explanation</Submit></form>
            </details>}
          </div>))}
      </div>
      <p className="faint small" style={{ marginTop: "1.5rem" }}>Created by {rep.creator} · {formatDateTime(rep.created_at)} · snapshot calculated {formatDateTime(data.generatedAt)}. Positive amounts are debits, negative are credits.</p>
      {canAdmin(ws.role) && <form action={A.deleteReport}><H /><Submit className="btn sm danger" confirm="Delete this report?">Delete report</Submit></form>}
    </>
  );
}
