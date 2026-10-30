import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { createReconciliation } from "../actions";
export const metadata = { title: "New reconciliation" };

export default async function NewRecPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws, "MEMBER");
  const stmts = await db.all(`SELECT s.*, b.name bank, b.ledger_account_code FROM bank_statements s JOIN bank_accounts b ON b.id = s.bank_account_id WHERE s.workspace_id = ? ORDER BY s.period_start DESC`, [ws.id]);
  return (
    <>
      <PageHead title="New reconciliation" crumbs={<Link href={`/app/${ws.slug}/reconciliations`}>Reconciliations</Link>}
        desc="Choose a bank statement. Variaq compares it with entries posted to the linked ledger account." />
      <Flash searchParams={searchParams} />
      {stmts.length === 0 ? <div className="card empty"><h3>No statements to reconcile</h3><p>Import a bank statement first.</p><Link href={`/app/${ws.slug}/bank`} className="btn primary">Go to bank accounts</Link></div> : (
        <form action={createReconciliation} className="card" style={{ maxWidth: 720 }}>
          <input type="hidden" name="slug" value={ws.slug} />
          <div className="field"><label>Bank statement</label>
            <select name="statement" defaultValue={searchParams.statement || stmts[0].id} required>
              {stmts.map((s) => <option key={s.id} value={s.id}>{s.bank} — {s.period_start} → {s.period_end} ({s.row_count} lines, {s.file_name})</option>)}
            </select></div>
          <div className="field"><label>Name (optional)</label><input name="name" placeholder="e.g. KCB Operating · April 2026" /></div>
          <div className="form-row">
            <div className="field"><label>Date window (days)</label><input name="date_window" type="number" min={0} max={30} defaultValue={3} /><div className="help">How far apart bank and ledger dates can be for an automatic suggestion.</div></div>
            <div className="field"><label>Flag amounts above ({ws.currency})</label><input name="large_amount" defaultValue="1,000,000" /><div className="help">Large transactions are added to the review queue.</div></div>
          </div>
          <div className="panel small muted" style={{ marginBottom: "1rem" }}>
            <strong>How matching works.</strong> Suggestions need the same amount, plus a close date or a matching reference; descriptions add confidence. This is rule-based matching, not AI. Every suggestion shows its reasons and must be confirmed by a person.
          </div>
          <Submit pendingText="Matching…">Run matching</Submit>
        </form>
      )}
    </>
  );
}
