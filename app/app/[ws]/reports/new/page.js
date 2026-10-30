import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { createReport } from "../actions";
export const metadata = { title: "New variance report" };

const monthBounds = (ym) => { const [y, m] = ym.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`]; };
const prevMonth = (ym) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };

export default async function NewReportPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws, "MEMBER");
  const latest = await db.get("SELECT MAX(date) d FROM ledger_entries WHERE workspace_id = ?", [ws.id]);
  const cur = (latest.d || new Date().toISOString()).slice(0, 7);
  const [cs, ce] = monthBounds(cur), [bs, be] = monthBounds(prevMonth(cur));
  return (
    <>
      <PageHead title="New variance report" crumbs={<Link href={`/app/${ws.slug}/reports`}>Variance reports</Link>} desc="Defaults compare your latest month of ledger data with the month before." />
      <Flash searchParams={searchParams} />
      <form action={createReport} className="card" style={{ maxWidth: 760 }}>
        <input type="hidden" name="slug" value={ws.slug} />
        <div className="field"><label>Name (optional)</label><input name="name" placeholder={`Variance ${cur} vs ${prevMonth(cur)}`} /></div>
        <h3>Current period</h3>
        <div className="form-row"><div className="field"><label>From</label><input type="date" name="comp_start" defaultValue={cs} required /></div><div className="field"><label>To</label><input type="date" name="comp_end" defaultValue={ce} required /></div></div>
        <h3>Compare with</h3>
        <div className="form-row"><div className="field"><label>From</label><input type="date" name="base_start" defaultValue={bs} required /></div><div className="field"><label>To</label><input type="date" name="base_end" defaultValue={be} required /></div></div>
        <h3>Materiality</h3>
        <div className="form-row">
          <div className="field"><label>Change of at least (%)</label><input type="number" name="threshold_pct" defaultValue={10} min={0} /></div>
          <div className="field"><label>And at least ({ws.currency})</label><input name="threshold_amount" defaultValue="50,000" /></div>
          <div className="field"><label>Only accounts starting with</label><input name="prefix" placeholder="e.g. 5 or 6 (optional)" /></div>
        </div>
        <p className="help">An account is material when its change meets both thresholds (or it had no activity in the comparison period).</p>
        <Submit pendingText="Analysing…">Create report</Submit>
      </form>
    </>
  );
}
