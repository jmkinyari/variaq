import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace, canAdmin } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatMoney } from "@/lib/money";
import { deleteStatement } from "../../actions";
export const metadata = { title: "Bank statement" };

export default async function StatementPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const st = await db.get("SELECT s.*, b.name bank, b.currency FROM bank_statements s JOIN bank_accounts b ON b.id = s.bank_account_id WHERE s.id = ? AND s.workspace_id = ?", [params.id, ws.id]);
  if (!st) notFound();
  const [txns, tot, recs] = await Promise.all([
    db.all("SELECT * FROM bank_transactions WHERE statement_id = ? ORDER BY date, rowid", [st.id]),
    db.get("SELECT SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) inflow, SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END) outflow FROM bank_transactions WHERE statement_id = ?", [st.id]),
    db.all("SELECT id, name, status FROM reconciliations WHERE statement_id = ?", [st.id]),
  ]);
  return (
    <>
      <PageHead title={st.file_name} crumbs={<Link href={`/app/${ws.slug}/bank`}>Bank accounts · {st.bank}</Link>} desc={`${st.period_start} → ${st.period_end} · ${st.row_count} transactions`}>
        {recs.length ? recs.map((r) => <Link key={r.id} className="btn" href={`/app/${ws.slug}/reconciliations/${r.id}`}>Open {r.name}</Link>) : <Link className="btn primary" href={`/app/${ws.slug}/reconciliations/new?statement=${st.id}`}>Reconcile this statement</Link>}
        {canAdmin(ws.role) && !recs.length && <form action={deleteStatement}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={st.id} /><Submit className="btn danger" confirm="Delete this statement and its transactions?">Delete</Submit></form>}
      </PageHead>
      <Flash searchParams={searchParams} />
      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <div className="card stat"><div className="label">Money in</div><div className="value">{formatMoney(tot.inflow || 0, st.currency)}</div></div>
        <div className="card stat"><div className="label">Money out</div><div className="value">{formatMoney(tot.outflow || 0, st.currency)}</div></div>
        <div className="card stat"><div className="label">Net movement</div><div className="value">{formatMoney((tot.inflow || 0) + (tot.outflow || 0), st.currency)}</div></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
        <tbody>{txns.map((t) => <tr key={t.id}><td>{t.date}</td><td className="wrap">{t.description}</td><td>{t.reference || "—"}</td><td className="num">{formatMoney(t.amount_cents, st.currency)}</td><td className="num">{t.balance_cents === null ? "—" : formatMoney(t.balance_cents, st.currency)}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}
