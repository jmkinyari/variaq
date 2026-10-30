import Link from "next/link";
import { agentHref } from "@/lib/ai/deep-links";
import "@/styles/planning.css";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { SECTIONS } from "@/lib/boardpack/build";
import { formatDateTime } from "@/lib/dates";
import { createPack } from "./actions";
export const metadata = { title: "Board packs" };

const STATUS = { DRAFT: ["Draft", ""], IN_REVIEW: ["In review", "warn"], APPROVED: ["Approved", "good"] };

export default async function BoardPacks({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const base = `/app/${ws.slug}`;
  const [packs, budgets, range] = await Promise.all([
    db.all("SELECT p.id, p.title, p.period, p.status, p.updated_at, u.name by_name, b.name budget_name FROM board_packs p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN budgets b ON b.id = p.budget_id WHERE p.workspace_id = ? ORDER BY p.period DESC, p.updated_at DESC", [ws.id]),
    db.all("SELECT id, name, fy_start, status FROM budgets WHERE workspace_id = ? ORDER BY CASE status WHEN 'LOCKED' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, fy_start DESC", [ws.id]),
    db.get("SELECT MAX(date) mx FROM ledger_entries WHERE workspace_id = ?", [ws.id]),
  ]);
  const defaultPeriod = range?.mx ? range.mx.slice(0, 7) : new Date().toISOString().slice(0, 7);
  return (
    <>
      <PageHead title="Board packs" desc="Monthly management packs for the board: KPIs, P&L vs budget and last year, balance sheet, cash outlook, variance commentary, close, controls and tax status — frozen once sent for review, printable to PDF.">
        <Link className="btn ghost ai-ask-link" href={agentHref(ws.slug, "cfo-reporting", { period: defaultPeriod, q: `Draft board-pack commentary for ${defaultPeriod}: headline performance, KPIs, cash and decisions required.` })}>Ask CFO Reporting</Link>
      </PageHead>
      <Flash searchParams={searchParams} />
      {canEdit(ws.role) && <form action={createPack} className="card" style={{ marginBottom: "1.5rem" }}>
        <input type="hidden" name="slug" value={ws.slug} />
        <h3>New board pack</h3>
        <div className="form-row">
          <div className="field"><label>Reporting month</label><input type="month" name="period" required defaultValue={defaultPeriod} /></div>
          <div className="field"><label>Compare with budget</label><select name="budget_id" defaultValue={budgets[0]?.id || ""}><option value="">No budget</option>{budgets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.status.toLowerCase()}, from {b.fy_start})</option>)}</select></div>
          <div className="field"><label>Title (optional)</label><input name="title" maxLength={120} placeholder="Board pack — month year" /></div>
        </div>
        <div className="row small" style={{ gap: "1rem", margin: ".3rem 0 .8rem" }}>{SECTIONS.filter(([k]) => k !== "cover").map(([k, l]) => <label key={k} className="row" style={{ fontWeight: 400, color: "var(--text)", gap: 4 }}><input type="checkbox" name={`s_${k}`} value="1" defaultChecked style={{ width: "auto" }} />{l}</label>)}</div>
        <Submit pendingText="Building pack…">Create board pack</Submit>
      </form>}
      {packs.length === 0 ? <div className="card empty"><h3>No board packs yet</h3><p>Create one for the latest month — numbers are pulled from the ledger, budget, close checklist, audit findings and tax reconciliations.</p></div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Pack</th><th>Month</th><th>Budget</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>{packs.map((p) => { const [l, t] = STATUS[p.status] || [p.status, ""]; return (
            <tr key={p.id}><td><Link href={`${base}/board-packs/${p.id}`}><strong>{p.title}</strong></Link><div className="faint small">by {p.by_name}</div></td><td>{p.period}</td><td className="small">{p.budget_name || "—"}</td><td><span className={`badge ${t}`}>{l}</span></td><td className="small">{formatDateTime(p.updated_at)}</td>
              <td className="num"><Link className="btn sm" href={`${base}/board-packs/${p.id}/print`}>Print / PDF</Link></td></tr>); })}</tbody>
        </table></div>
      )}
    </>
  );
}
