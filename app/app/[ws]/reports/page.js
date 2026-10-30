import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import { StatusBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/dates";
export const metadata = { title: "Variance reports" };

export default async function ReportsPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const reps = await db.all("SELECT r.id, r.name, r.base_start, r.base_end, r.comp_start, r.comp_end, r.status, r.updated_at, r.data, u.name creator FROM reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.workspace_id = ? ORDER BY r.created_at DESC", [ws.id]);
  return (
    <>
      <PageHead title="Variance reports" desc="Compare two periods by account, flag material movements and record the explanation.">
        {canEdit(ws.role) && <Link href={`/app/${ws.slug}/reports/new`} className="btn primary">New report</Link>}
      </PageHead>
      <Flash searchParams={searchParams} />
      {reps.length === 0 ? <div className="card empty"><h3>No reports yet</h3><p>Create a report to see which accounts moved the most and why.</p><Link className="btn primary" href={`/app/${ws.slug}/reports/new`}>Create a report</Link></div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Report</th><th>Current period</th><th>Compared with</th><th className="num">Material</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>{reps.map((r) => { const d = JSON.parse(r.data); return (
            <tr key={r.id}><td><Link href={`/app/${ws.slug}/reports/${r.id}`}><strong>{r.name}</strong></Link><div className="faint small">by {r.creator}</div></td>
              <td>{r.comp_start} → {r.comp_end}</td><td>{r.base_start} → {r.base_end}</td><td className="num">{d.totals.material}/{d.totals.accounts}</td><td><StatusBadge status={r.status} /></td><td className="small">{formatDateTime(r.updated_at)}</td></tr>); })}</tbody>
        </table></div>)}
    </>
  );
}
