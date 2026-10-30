import db from "@/lib/db";
import { requireWorkspace, canAdmin } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatDateTime } from "@/lib/dates";
import { saveMapping, addStarter, deleteMapping } from "./actions";
export const metadata = { title: "Tax codes & accounts" };

function MappingForm({ ws, m, accounts }) {
  return (
    <form action={saveMapping}>
      <input type="hidden" name="slug" value={ws.slug} />{m && <input type="hidden" name="id" value={m.id} />}
      <div className="form-row">
        <div className="field"><label>Tax code</label><input name="tax_code" defaultValue={m?.tax_code} required /></div>
        <div className="field"><label>Name</label><input name="name" defaultValue={m?.name} required /></div>
        <div className="field"><label>Rate %</label><input name="rate_percent" defaultValue={m?.rate_percent || ""} placeholder="Not set" /></div>
        <div className="field"><label>Ledger account</label><input name="account_code" list="acct-codes" defaultValue={m?.account_code || ""} placeholder="e.g. 2200" /></div>
        <div className="field"><label>Applies to</label><select name="applies_to" defaultValue={m?.applies_to || "BOTH"}><option value="BOTH">Sales & purchases</option><option value="SALES">Sales</option><option value="PURCHASES">Purchases</option><option value="PAYROLL">Payroll</option></select></div>
      </div>
      <div className="form-row">
        <div className="field"><label>Source (URL or reference)</label><input name="source_url" defaultValue={m?.source_url || ""} placeholder="Link to the KRA guidance, Finance Act, or notice" /></div>
        <div className="field"><label>Notes</label><input name="notes" defaultValue={m?.notes || ""} /></div>
      </div>
      <label className="row" style={{ fontWeight: 400, color: "var(--text)" }}><input type="checkbox" name="verified" defaultChecked={!!m?.verified} /> Verified against the source by our accountant</label>
      <div className="row" style={{ marginTop: ".6rem" }}><Submit className="btn sm primary">{m ? "Save changes" : "Add mapping"}</Submit></div>
    </form>
  );
}

export default async function TaxPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const [rows, accounts] = await Promise.all([
    db.all("SELECT * FROM tax_mappings WHERE workspace_id = ? ORDER BY applies_to, tax_code", [ws.id]),
    db.all("SELECT account_code, MAX(account_name) account_name FROM ledger_entries WHERE workspace_id = ? GROUP BY account_code ORDER BY account_code", [ws.id]),
  ]);
  const admin = canAdmin(ws.role);
  return (
    <>
      <PageHead title="Tax codes & accounts" crumbs={<a href={`/app/${ws.slug}/tax`}>Tax centre</a>} desc="Configurable tax codes, rates and ledger accounts. Variaq never assumes a rate — each mapping records its source and whether it has been verified.">
        {admin && <form action={addStarter}><input type="hidden" name="slug" value={ws.slug} /><Submit className="btn">Add Kenya starter codes</Submit></form>}
      </PageHead>
      <Flash searchParams={searchParams} />
      <datalist id="acct-codes">{accounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_name}</option>)}</datalist>
      <div className="alert warn small">Tax rules change. Confirm every rate and treatment with current KRA guidance (or the relevant authority) and your tax adviser before relying on it. Unverified mappings are clearly marked.</div>
      {rows.length === 0 ? <div className="card empty">No tax mappings yet.{admin && " Add the Kenya starter codes or create your own below."}</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th className="num">Rate</th><th>Account</th><th>Applies to</th><th>Status</th><th>Source</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id}>
              <td><strong>{m.tax_code}</strong></td><td className="wrap">{m.name}{m.notes && <div className="faint small">{m.notes}</div>}</td>
              <td className="num">{m.rate_percent ? `${m.rate_percent}%` : <span className="faint">Not set</span>}</td><td>{m.account_code || "—"}</td><td>{m.applies_to.toLowerCase()}</td>
              <td>{m.verified ? <span className="badge good">Verified</span> : <span className="badge warn">Unverified</span>}<div className="faint small">{formatDateTime(m.updated_at)}</div></td>
              <td className="small">{m.source_url ? (m.source_url.startsWith("http") ? <a href={m.source_url} target="_blank" rel="noreferrer">Source</a> : m.source_url) : "—"}</td>
            </tr>))}</tbody>
        </table></div>)}
      {admin && <>
        <h2 style={{ marginTop: "2rem" }}>Edit mappings</h2>
        <div className="stack">
          {rows.map((m) => (
            <details key={m.id} className="card flat"><summary style={{ cursor: "pointer" }}><strong>{m.tax_code}</strong> · {m.name}</summary>
              <div style={{ marginTop: "1rem" }}><MappingForm ws={ws} m={m} accounts={accounts} /></div>
              <form action={deleteMapping} style={{ marginTop: ".5rem" }}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={m.id} /><Submit className="btn sm danger" confirm={`Delete ${m.tax_code}?`}>Delete</Submit></form>
            </details>))}
          <div className="card"><h3>New mapping</h3><MappingForm ws={ws} accounts={accounts} /></div>
        </div>
      </>}
    </>
  );
}
