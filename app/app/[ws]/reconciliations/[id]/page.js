import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, canEdit, canAdmin } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { StatusBadge, ExceptionBadge } from "@/components/Badges";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { aiAvailable } from "@/lib/ai";
import * as A from "../actions";
export const metadata = { title: "Reconciliation" };

function Hidden({ ws, rec, tab, id }) {
  return <><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="rec" value={rec.id} />{tab && <input type="hidden" name="tab" value={tab} />}{id && <input type="hidden" name="id" value={id} />}</>;
}

export default async function RecPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const rec = await db.get(`SELECT r.*, b.name bank, b.ledger_account_code, b.currency, s.file_name, s.period_start, s.period_end, s.row_count, u.name creator, cu.name completer
    FROM reconciliations r JOIN bank_accounts b ON b.id = r.bank_account_id JOIN bank_statements s ON s.id = r.statement_id
    LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users cu ON cu.id = r.completed_by WHERE r.id = ? AND r.workspace_id = ?`, [params.id, ws.id]);
  if (!rec) notFound();
  const cur = rec.currency;
  const [matches, exceptions, bankTot, ledgerTot, history, members] = await Promise.all([
    db.all(`SELECT m.*, bt.date b_date, bt.description b_desc, bt.reference b_ref, bt.amount_cents b_amt, le.date l_date, le.description l_desc, le.reference l_ref, le.amount_cents l_amt, le.counterparty l_cp, u.name reviewer
      FROM matches m JOIN bank_transactions bt ON bt.id = m.bank_transaction_id JOIN ledger_entries le ON le.id = m.ledger_entry_id LEFT JOIN users u ON u.id = m.reviewed_by
      WHERE m.reconciliation_id = ? AND m.status != 'REJECTED' ORDER BY m.confidence DESC, bt.date`, [rec.id]),
    db.all(`SELECT e.*, bt.date b_date, bt.description b_desc, bt.reference b_ref, bt.amount_cents b_amt, le.date l_date, le.description l_desc, le.reference l_ref, le.amount_cents l_amt, u.name resolver
      FROM recon_exceptions e LEFT JOIN bank_transactions bt ON bt.id = e.bank_transaction_id LEFT JOIN ledger_entries le ON le.id = e.ledger_entry_id LEFT JOIN users u ON u.id = e.resolved_by
      WHERE e.reconciliation_id = ? ORDER BY e.status = 'OPEN' DESC, COALESCE(bt.date, le.date)`, [rec.id]),
    db.get("SELECT SUM(amount_cents) net FROM bank_transactions WHERE statement_id = ?", [rec.statement_id]),
    db.get("SELECT SUM(amount_cents) net FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN ? AND ?", [ws.id, rec.ledger_account_code, rec.period_start, rec.period_end]),
    db.all("SELECT a.*, u.name FROM audit_events a LEFT JOIN users u ON u.id = a.user_id WHERE a.workspace_id = ? AND (a.entity_id = ? OR a.detail LIKE ?) ORDER BY a.created_at DESC LIMIT 200", [ws.id, rec.id, `%"reconciliation":"${rec.id}"%`]),
    db.all("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?", [ws.id]),
  ]);
  const suggested = matches.filter((m) => m.status === "SUGGESTED");
  const confirmed = matches.filter((m) => m.status === "CONFIRMED");
  const open = exceptions.filter((e) => e.status === "OPEN");
  const locked = rec.status === "COMPLETED";
  const editable = canEdit(ws.role) && !locked;
  const tab = searchParams.tab || (suggested.length ? "review" : open.length ? "exceptions" : "matched");
  const base = `/app/${ws.slug}/reconciliations/${rec.id}`;

  // Candidates for manual matching: unmatched ledger entries on the linked account near the period.
  let candidates = [];
  if (editable && tab === "exceptions") {
    candidates = await db.all(`SELECT id, date, description, reference, amount_cents FROM ledger_entries WHERE workspace_id = ? AND account_code = ? AND date BETWEEN date(?, '-60 day') AND date(?, '+60 day')
      AND id NOT IN (SELECT ledger_entry_id FROM matches WHERE status IN ('CONFIRMED','SUGGESTED')) ORDER BY date`, [ws.id, rec.ledger_account_code, rec.period_start, rec.period_end]);
  }
  const unmatchedBankTotal = open.filter((e) => ["UNMATCHED_BANK", "AMOUNT_MISMATCH"].includes(e.type)).reduce((s, e) => s + (e.b_amt || 0), 0);
  const unmatchedLedgerTotal = open.filter((e) => e.type === "UNMATCHED_LEDGER").reduce((s, e) => s + (e.l_amt || 0), 0);
  const diff = (bankTot.net || 0) - (ledgerTot.net || 0);
  const ai = await aiAvailable(ws);

  return (
    <>
      <PageHead title={rec.name} crumbs={<Link href={`/app/${ws.slug}/reconciliations`}>Reconciliations</Link>}
        desc={`${rec.bank} · ledger account ${rec.ledger_account_code} · ${rec.period_start} → ${rec.period_end} · ${rec.file_name}`}>
        <StatusBadge status={rec.status} />
        {editable && <form action={A.rerunMatching}><Hidden ws={ws} rec={rec} tab={tab} /><Submit className="btn" pendingText="Matching…">Re-run matching</Submit></form>}
        {editable && rec.status === "IN_PROGRESS" && <form action={A.setStatus}><Hidden ws={ws} rec={rec} tab={tab} /><input type="hidden" name="status" value="IN_REVIEW" /><Submit className="btn">Send for review</Submit></form>}
        {editable && <form action={A.setStatus}><Hidden ws={ws} rec={rec} tab={tab} /><input type="hidden" name="status" value="COMPLETED" /><Submit className="btn primary" disabled={suggested.length > 0 || open.length > 0} title={suggested.length || open.length ? "Review all suggestions and open items first" : ""}>Complete</Submit></form>}
        {locked && canAdmin(ws.role) && <form action={A.setStatus}><Hidden ws={ws} rec={rec} tab={tab} /><input type="hidden" name="status" value="IN_PROGRESS" /><Submit className="btn" confirm="Reopen this completed reconciliation? This is recorded in the audit log.">Reopen</Submit></form>}
      </PageHead>
      <Flash searchParams={searchParams} />
      {locked && <div className="alert success">Completed by {rec.completer} on {formatDateTime(rec.completed_at)}. This reconciliation is locked{canAdmin(ws.role) ? " — reopen it to make changes" : ""}.</div>}

      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        <div className="card stat"><div className="label">Bank lines matched</div><div className="value">{confirmed.length}/{rec.row_count}</div><div className="progress" style={{ marginTop: 6 }}><span style={{ width: `${(confirmed.length / Math.max(1, rec.row_count)) * 100}%` }} /></div></div>
        <div className="card stat"><div className="label">To review</div><div className="value">{suggested.length}</div><div className="faint small">suggested matches</div></div>
        <div className="card stat"><div className="label">Open items</div><div className="value" style={{ color: open.length ? "var(--bad)" : undefined }}>{open.length}</div><div className="faint small">exceptions to resolve</div></div>
        <div className="card stat"><div className="label">Difference</div><div className="value" style={{ fontSize: "1.3rem" }}>{formatMoney(diff, cur)}</div><div className="faint small">bank {formatMoney(bankTot.net || 0, cur)} vs ledger {formatMoney(ledgerTot.net || 0, cur)}</div></div>
      </div>
      {diff !== 0 && <div className="panel small muted" style={{ marginBottom: "1rem" }}>Movement in the period: bank minus ledger = {formatMoney(diff, cur)}. Open unmatched bank lines total {formatMoney(unmatchedBankTotal, cur)} and open unmatched ledger entries total {formatMoney(unmatchedLedgerTotal, cur)}; together with timing differences across the period edges they explain the gap.</div>}

      <div className="tabs">
        {[["review", `Review suggestions (${suggested.length})`], ["exceptions", `Exceptions (${open.length} open)`], ["matched", `Matched (${confirmed.length})`], ["history", "History"]].map(([k, l]) => (
          <Link key={k} href={`${base}?tab=${k}`} className={tab === k ? "active" : ""}>{l}</Link>))}
      </div>

      {tab === "review" && (<>
        {editable && suggested.some((m) => m.confidence >= 90) && (
          <form action={A.confirmHighConfidence} className="row" style={{ marginBottom: "1rem" }}><Hidden ws={ws} rec={rec} tab="review" /><input type="hidden" name="min" value="90" />
            <Submit className="btn">Confirm all {suggested.filter((m) => m.confidence >= 90).length} at 90%+ confidence</Submit><span className="muted small">You can still undo any match afterwards.</span></form>)}
        {suggested.length === 0 ? <div className="card empty">No suggestions waiting for review.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Bank line</th><th>Ledger entry</th><th className="num">Amount</th><th>Why</th><th className="num">Confidence</th>{editable && <th></th>}</tr></thead>
            <tbody>{suggested.map((m) => (
              <tr key={m.id}>
                <td className="wrap">{m.b_date}<div>{m.b_desc}</div><div className="faint small">{m.b_ref}</div></td>
                <td className="wrap">{m.l_date}<div>{m.l_desc}</div><div className="faint small">{[m.l_ref, m.l_cp].filter(Boolean).join(" · ")}</div></td>
                <td className="num">{formatMoney(m.b_amt, cur)}</td>
                <td className="small">{JSON.parse(m.reasons).join(" · ")}<div className="faint">{m.method.toLowerCase()} rule</div></td>
                <td className="num"><span className={`badge ${m.confidence >= 90 ? "good" : m.confidence >= 75 ? "info" : "warn"}`}>{m.confidence}%</span></td>
                {editable && <td className="num"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                  <form action={A.confirmMatch}><Hidden ws={ws} rec={rec} tab="review" id={m.id} /><Submit className="btn sm primary" pendingText="…">Confirm</Submit></form>
                  <form action={A.rejectMatch}><Hidden ws={ws} rec={rec} tab="review" id={m.id} /><Submit className="btn sm" pendingText="…">Reject</Submit></form>
                </div></td>}
              </tr>))}</tbody>
          </table></div>)}
      </>)}

      {tab === "exceptions" && (exceptions.length === 0 ? <div className="card empty">Nothing needs attention.</div> : (
        <div className="stack">
          {exceptions.map((e) => {
            const amt = e.b_amt ?? e.l_amt;
            const near = e.bank_transaction_id ? candidates.filter((c) => Math.sign(c.amount_cents) === Math.sign(amt)).sort((a, b) => Math.abs(a.amount_cents - amt) - Math.abs(b.amount_cents - amt)).slice(0, 25) : [];
            return (
              <div key={e.id} className="card" style={{ opacity: e.status === "OPEN" ? 1 : 0.75 }}>
                <div className="row between">
                  <div className="row"><ExceptionBadge type={e.type} /><StatusBadge status={e.status} /></div>
                  <strong className="mono">{formatMoney(amt, cur)}</strong>
                </div>
                <div className="grid grid-2" style={{ marginTop: ".6rem" }}>
                  {e.bank_transaction_id && <div><div className="faint small">Bank · {e.b_date}</div>{e.b_desc}<div className="faint small">{e.b_ref}</div></div>}
                  {e.ledger_entry_id && <div><div className="faint small">Ledger · {e.l_date}</div>{e.l_desc} <span className="mono small">({formatMoney(e.l_amt, cur)})</span><div className="faint small">{e.l_ref}</div></div>}
                </div>
                <p className="muted small" style={{ margin: ".5rem 0 0" }}>{e.detail}</p>
                {e.ai_hint && <div className="alert info small" style={{ marginTop: ".6rem", marginBottom: 0 }}><strong>AI review hint (check before acting):</strong> {e.ai_hint}</div>}
                {e.status !== "OPEN" && <p className="small" style={{ margin: ".6rem 0 0" }}><strong>{e.status === "RESOLVED" ? "Resolved" : "Dismissed"}</strong> by {e.resolver || "—"} · {formatDateTime(e.resolved_at)} — {e.note}</p>}
                {editable && e.status === "OPEN" && (
                  <details style={{ marginTop: ".6rem" }} open={open.length <= 3}>
                    <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>Resolve</summary>
                    <div className="grid grid-2" style={{ marginTop: ".6rem" }}>
                      {e.bank_transaction_id && ["UNMATCHED_BANK", "AMOUNT_MISMATCH"].includes(e.type) && (
                        <form action={A.manualMatch} className="panel">
                          <Hidden ws={ws} rec={rec} tab="exceptions" /><input type="hidden" name="exception" value={e.id} />
                          <label>Match to a ledger entry</label>
                          <select name="ledger_entry" defaultValue={e.type === "AMOUNT_MISMATCH" ? e.ledger_entry_id : ""}>
                            <option value="">— choose —</option>
                            {e.type === "AMOUNT_MISMATCH" && !near.some((c) => c.id === e.ledger_entry_id) && <option value={e.ledger_entry_id}>{e.l_date} · {e.l_desc} · {formatMoney(e.l_amt, cur)}</option>}
                            {near.map((c) => <option key={c.id} value={c.id}>{c.date} · {c.description.slice(0, 50)} · {formatMoney(c.amount_cents, cur)}</option>)}
                          </select>
                          <input name="note" placeholder="Note (required if amounts differ)" style={{ marginTop: ".5rem" }} />
                          <Submit className="btn sm primary" style={{ marginTop: ".5rem" }}>Match</Submit>
                        </form>)}
                      <form action={A.resolveException} className="panel">
                        <Hidden ws={ws} rec={rec} tab="exceptions" id={e.id} />
                        <label>Explain and close</label>
                        <input name="note" required placeholder={e.type === "UNMATCHED_LEDGER" ? "e.g. Outstanding cheque, clears in May" : e.type === "UNMATCHED_BANK" ? "e.g. Bank charge — journal posted" : "e.g. Reviewed, supporting documents on file"} />
                        <div className="row" style={{ marginTop: ".5rem" }}>
                          <button name="status" value="RESOLVED" className="btn sm primary">Mark resolved</button>
                          <button name="status" value="DISMISSED" className="btn sm">Dismiss</button>
                        </div>
                      </form>
                    </div>
                    {ai ? <form action={A.aiHint} style={{ marginTop: ".5rem" }}><Hidden ws={ws} rec={rec} tab="exceptions" id={e.id} /><Submit className="btn sm ghost" pendingText="Asking AI…">{e.ai_hint ? "Refresh AI hint" : "Get an AI review hint"}</Submit></form>
                      : <p className="faint small" style={{ marginTop: ".5rem", marginBottom: 0 }}>AI review hints: unavailable (not configured).</p>}
                  </details>)}
                {editable && e.status !== "OPEN" && !String(e.note || "").startsWith("Resolved by manual match") && <form action={A.reopenException} style={{ marginTop: ".4rem" }}><Hidden ws={ws} rec={rec} tab="exceptions" id={e.id} /><Submit className="btn sm ghost">Reopen</Submit></form>}
              </div>);
          })}
        </div>))}

      {tab === "matched" && (confirmed.length === 0 ? <div className="card empty">No confirmed matches yet.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Bank line</th><th>Ledger entry</th><th className="num">Amount</th><th>Method</th><th>Confirmed by</th>{editable && <th></th>}</tr></thead>
          <tbody>{confirmed.map((m) => (
            <tr key={m.id}>
              <td className="wrap">{m.b_date} · {m.b_desc}<div className="faint small">{m.b_ref}</div></td>
              <td className="wrap">{m.l_date} · {m.l_desc}<div className="faint small">{m.l_ref}</div></td>
              <td className="num">{formatMoney(m.b_amt, cur)}{m.b_amt !== m.l_amt && <div className="small" style={{ color: "var(--warn)" }}>ledger {formatMoney(m.l_amt, cur)}</div>}</td>
              <td className="small">{m.method === "MANUAL" ? "Manual" : `${m.method.toLowerCase()} rule · ${m.confidence}%`}<div className="faint">{JSON.parse(m.reasons).filter((r) => r.startsWith("Note") || r.startsWith("Difference")).join(" · ")}</div></td>
              <td className="small">{m.reviewer}<div className="faint">{formatDateTime(m.reviewed_at)}</div></td>
              {editable && <td className="num"><form action={A.undoMatch}><Hidden ws={ws} rec={rec} tab="matched" id={m.id} /><Submit className="btn sm ghost">Undo</Submit></form></td>}
            </tr>))}</tbody>
        </table></div>))}

      {tab === "history" && (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{history.map((h) => <tr key={h.id}><td className="small">{formatDateTime(h.created_at)}</td><td>{h.name || "—"}</td><td>{h.action}</td><td className="small faint wrap">{summarize(h.detail)}</td></tr>)}</tbody>
        </table></div>)}

      {canAdmin(ws.role) && !locked && (
        <form action={A.deleteReconciliation} style={{ marginTop: "2rem" }}><Hidden ws={ws} rec={rec} /><Submit className="btn sm danger" confirm="Delete this reconciliation and all its matches and review notes?">Delete reconciliation</Submit></form>)}
      <p className="faint small" style={{ marginTop: "1rem" }}>Created by {rec.creator} on {formatDateTime(rec.created_at)} · date window {rec.date_window} days · large-amount flag {formatMoney(rec.large_amount_cents, cur)} · team: {members.map((m) => m.name).join(", ")}</p>
    </>
  );
}

function summarize(detail) {
  try { const d = JSON.parse(detail); return Object.entries(d).filter(([k]) => k !== "reconciliation").map(([k, v]) => `${k}: ${v}`).join(" · "); } catch { return ""; }
}
