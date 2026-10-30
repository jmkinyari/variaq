import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace, canAdmin, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatDateTime } from "@/lib/dates";
import { createBankAccount, updateBankAccount } from "./actions";
export const metadata = { title: "Bank accounts" };

export default async function BankPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const [accts, stmts, ledgerAccts] = await Promise.all([
    db.all("SELECT * FROM bank_accounts WHERE workspace_id = ? ORDER BY created_at", [ws.id]),
    db.all("SELECT s.*, (SELECT COUNT(*) FROM reconciliations r WHERE r.statement_id = s.id) recs FROM bank_statements s WHERE s.workspace_id = ? ORDER BY s.period_start DESC", [ws.id]),
    db.all("SELECT account_code, MAX(account_name) account_name FROM ledger_entries WHERE workspace_id = ? GROUP BY account_code ORDER BY account_code", [ws.id]),
  ]);
  const acctOptions = (def) => (<>
    <option value="">— choose —</option>
    {ledgerAccts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code}{a.account_name ? ` · ${a.account_name}` : ""}</option>)}
    {def && !ledgerAccts.some((a) => a.account_code === def) && <option value={def}>{def}</option>}
  </>);
  return (
    <>
      <PageHead title="Bank accounts" desc="Each bank or mobile-money account is linked to the ledger account that records its transactions." />
      <Flash searchParams={searchParams} />
      {accts.length === 0 && <div className="alert info">Add a bank account below, then import a statement for it.{ledgerAccts.length === 0 && <> Import your <Link href={`/app/${ws.slug}/ledger/import`}>ledger</Link> first so you can choose its cash account.</>}</div>}
      <div className="stack">
        {accts.map((a) => {
          const own = stmts.filter((s) => s.bank_account_id === a.id);
          return (
            <div className="card" key={a.id}>
              <div className="row between">
                <div><h3 style={{ margin: 0 }}>{a.name}</h3><div className="muted small">{[a.bank_name, a.account_mask && `•••• ${a.account_mask}`, a.currency].filter(Boolean).join(" · ")} · ledger account <strong>{a.ledger_account_code || "not set"}</strong></div></div>
                <div className="row">
                  {canEdit(ws.role) && <Link href={`/app/${ws.slug}/bank/${a.id}/import`} className="btn primary sm">Import statement</Link>}
                </div>
              </div>
              {canAdmin(ws.role) && <details style={{ marginTop: ".6rem" }}><summary className="small muted" style={{ cursor: "pointer" }}>Change linked ledger account</summary>
                <form action={updateBankAccount} className="row" style={{ marginTop: ".5rem" }}>
                  <input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={a.id} />
                  <select name="ledger_account_code" defaultValue={a.ledger_account_code || ""} style={{ maxWidth: 320 }}>{acctOptions(a.ledger_account_code)}</select>
                  <Submit className="btn sm">Save</Submit>
                </form></details>}
              {own.length > 0 ? (
                <div className="table-wrap" style={{ marginTop: "1rem" }}><table>
                  <thead><tr><th>Statement</th><th>Period</th><th className="num">Transactions</th><th>Imported</th><th>Reconciliations</th></tr></thead>
                  <tbody>{own.map((s) => <tr key={s.id}><td><Link href={`/app/${ws.slug}/bank/statements/${s.id}`}>{s.file_name}</Link></td><td>{s.period_start} → {s.period_end}</td><td className="num">{s.row_count}</td><td>{formatDateTime(s.created_at)}</td><td>{s.recs ? `${s.recs}` : <Link href={`/app/${ws.slug}/reconciliations/new?statement=${s.id}`}>Reconcile →</Link>}</td></tr>)}</tbody>
                </table></div>
              ) : <p className="muted small" style={{ marginTop: ".8rem", marginBottom: 0 }}>No statements imported yet.</p>}
            </div>
          );
        })}
      </div>
      {canAdmin(ws.role) && (
        <form action={createBankAccount} className="card" style={{ marginTop: "1.5rem" }}>
          <h3>Add a bank account</h3>
          <input type="hidden" name="slug" value={ws.slug} />
          <div className="form-row">
            <div className="field"><label>Name</label><input name="name" required placeholder="e.g. KCB Operating Account" /></div>
            <div className="field"><label>Bank / provider</label><input name="bank_name" placeholder="KCB, Equity, M-Pesa…" /></div>
            <div className="field"><label>Last 4 digits</label><input name="account_mask" maxLength={4} placeholder="1234" /></div>
            <div className="field"><label>Currency</label><input name="currency" defaultValue={ws.currency} maxLength={3} /></div>
          </div>
          <div className="field"><label>Linked ledger account</label>
            {ledgerAccts.length ? <select name="ledger_account_code" required>{acctOptions()}</select> : <input name="ledger_account_code" required placeholder="Ledger account code, e.g. 1010" />}
            <div className="help">The cash/bank account in your general ledger. Reconciliation compares the statement with entries posted to this account.</div></div>
          <Submit>Add bank account</Submit>
        </form>
      )}
    </>
  );
}
