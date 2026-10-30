import Link from "next/link";
import { agentHref } from "@/lib/ai/deep-links";
import "@/styles/planning.css";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import { METHOD_LABELS, fyMonths } from "@/lib/budget/engine";
import { formatDateTime } from "@/lib/dates";
import BudgetStatus from "./BudgetStatus";
export const metadata = { title: "Budgets" };


export default async function BudgetsPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const base = `/app/${ws.slug}`;
  const budgets = await db.all(`SELECT b.*, u.name by_name,
      (SELECT COUNT(DISTINCT account_code) FROM budget_lines l WHERE l.budget_id = b.id) accounts
    FROM budgets b LEFT JOIN users u ON u.id = b.created_by WHERE b.workspace_id = ? ORDER BY b.fy_start DESC, b.updated_at DESC`, [ws.id]);
  return (
    <>
      <PageHead title="Budgets & variance" desc="Annual budgets generated from your own ledger history, edited as a grid, approved, then tracked against actuals with explanations and a full-year reforecast.">
        {canEdit(ws.role) && <><Link className="btn" href={`${base}/data?kind=budget`}>Upload a budget</Link><Link className="btn primary" href={`${base}/budgets/new`}>New budget</Link></>}
        <Link className="btn ghost ai-ask-link" href={agentHref(ws.slug, "budget-forecast")}>Ask Budget Forecast</Link>
      </PageHead>
      <Flash searchParams={searchParams} />
      {budgets.length === 0 ? (
        <div className="card empty"><h3>No budgets yet</h3><p>Generate next year&apos;s budget from your ledger history in a few seconds — prior year × growth, trend, seasonal or driver-based — then fine-tune it.</p>{canEdit(ws.role) && <Link className="btn primary" href={`${base}/budgets/new`}>Create a budget</Link>}</div>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th>Budget</th><th>Financial year</th><th>Method</th><th>Status</th><th className="num">Accounts</th><th>Updated</th><th></th></tr></thead>
          <tbody>{budgets.map((b) => { const m = fyMonths(b.fy_start); return (
            <tr key={b.id}><td><Link href={`${base}/budgets/${b.id}`}><strong>{b.name}</strong></Link><div className="faint small">by {b.by_name}</div></td>
              <td>{m[0]} → {m[11]}</td><td className="small">{METHOD_LABELS[b.method] || b.method}</td><td><BudgetStatus status={b.status} /></td>
              <td className="num">{b.accounts}</td><td className="small">{formatDateTime(b.updated_at)}</td>
              <td className="num"><Link className="btn sm" href={`${base}/budgets/${b.id}?tab=bva`}>Budget vs actual</Link></td></tr>); })}</tbody>
        </table></div>
      )}
      <p className="faint small" style={{ marginTop: "1rem" }}>Budgets are held in natural sign: income and costs are both positive. Only approved or locked budgets drive the 12-month cash forecast and board packs.</p>
    </>
  );
}
