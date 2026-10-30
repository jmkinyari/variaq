import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import { StatusBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/dates";
export const metadata = { title: "Reconciliations" };

export default async function RecsPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const recs = await db.all(`SELECT r.*, b.name bank, s.period_start, s.period_end, s.row_count,
      (SELECT COUNT(*) FROM matches m WHERE m.reconciliation_id = r.id AND m.status = 'CONFIRMED') confirmed,
      (SELECT COUNT(*) FROM matches m WHERE m.reconciliation_id = r.id AND m.status = 'SUGGESTED') suggested,
      (SELECT COUNT(*) FROM recon_exceptions e WHERE e.reconciliation_id = r.id AND e.status = 'OPEN') open_ex
    FROM reconciliations r JOIN bank_accounts b ON b.id = r.bank_account_id JOIN bank_statements s ON s.id = r.statement_id
    WHERE r.workspace_id = ? ORDER BY s.period_start DESC, r.created_at DESC`, [ws.id]);
  return (
    <>
      <PageHead title="Reconciliations" desc="Bank statements matched against the ledger, with every decision saved and reopenable.">
        {canEdit(ws.role) && <Link href={`/app/${ws.slug}/reconciliations/new`} className="btn primary">New reconciliation</Link>}
      </PageHead>
      <Flash searchParams={searchParams} />
      {recs.length === 0 ? <div className="card empty"><h3>No reconciliations yet</h3><p>Import a bank statement, then start a reconciliation to match it to your ledger.</p><Link href={`/app/${ws.slug}/reconciliations/new`} className="btn primary">Start one</Link></div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Reconciliation</th><th>Period</th><th>Progress</th><th className="num">To review</th><th className="num">Open items</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>{recs.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/app/${ws.slug}/reconciliations/${r.id}`}><strong>{r.name}</strong></Link><div className="faint small">{r.bank}</div></td>
              <td>{r.period_start} → {r.period_end}</td>
              <td style={{ minWidth: 140 }}><div className="progress"><span style={{ width: `${r.row_count ? (r.confirmed / r.row_count) * 100 : 0}%` }} /></div><div className="faint small">{r.confirmed}/{r.row_count} bank lines matched</div></td>
              <td className="num">{r.suggested}</td><td className="num">{r.open_ex}</td>
              <td><StatusBadge status={r.status} /></td><td className="small">{formatDateTime(r.updated_at)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
