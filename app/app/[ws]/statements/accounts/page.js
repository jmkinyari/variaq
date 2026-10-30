import Link from "next/link";
import { requireWorkspace, canEdit, canAdmin } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { Empty } from "@/components/Statement";
import { CLASSES, CF_CHOICES } from "@/lib/statements";
import { loadChart } from "@/lib/statements-data";
import { saveMapping, resetMapping } from "../actions";
export const metadata = { title: "Account mapping" };

export default async function AccountMappingPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const base = `/app/${ws.slug}`;
  const { chart, accounts } = await loadChart(ws.id);
  if (!accounts.length) return <Empty base={base} title="Account mapping" />;
  const edit = canEdit(ws.role);
  const count = new Map(accounts.map((a) => [String(a.account_code), a.n]));
  const rows = [...chart.values()].sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
  const overridden = rows.filter((r) => r.overridden).length;
  return (
    <>
      <PageHead title="Account mapping" desc="How each ledger account is grouped in the statements and classified in the cash flow. Defaults come from the account code (1 assets, 2 liabilities, 3 equity, 4 revenue, 5 cost of sales, 6–7 and 9 expenses, 8 other income) and the account name." />
      <Flash searchParams={searchParams} />
      <form action={saveMapping}>
        <input type="hidden" name="slug" value={ws.slug} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Account</th><th className="num">Entries</th><th>Statement group</th><th>Cash &amp; equivalent</th><th>Cash flow line (when it&apos;s the other side of a cash movement)</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.code}>
                  <td><strong>{a.code}</strong> {a.name}{a.overridden && <span className="badge info" style={{ marginLeft: 6 }}>Edited</span>}</td>
                  <td className="num">{count.get(a.code) || 0}</td>
                  <td><select name={`class:${a.code}`} defaultValue={a.cls} disabled={!edit} style={{ minWidth: 190 }}>{Object.entries(CLASSES).map(([k, l]) => <option key={k} value={k}>{l}{k === a.auto.cls ? " (auto)" : ""}</option>)}</select></td>
                  <td><label className="row" style={{ margin: 0, gap: ".4rem", fontWeight: 400 }}><input type="checkbox" name={`cash:${a.code}`} value="1" defaultChecked={a.isCash} disabled={!edit} /> Cash</label></td>
                  <td><select name={`cf:${a.code}`} defaultValue={a.cf} disabled={!edit} style={{ minWidth: 220 }}>{Object.entries(CF_CHOICES).map(([k, l]) => <option key={k} value={k}>{l}{k === a.auto.cf ? " (auto)" : ""}</option>)}</select></td>
                </tr>))}
            </tbody>
          </table>
        </div>
        {edit && <div className="row" style={{ marginTop: "1rem" }}><Submit pendingText="Saving…">Save mapping</Submit><span className="faint small">{overridden} account{overridden === 1 ? "" : "s"} changed from the automatic mapping.</span></div>}
      </form>
      {canAdmin(ws.role) && overridden > 0 && <form action={resetMapping} style={{ marginTop: ".75rem" }}><input type="hidden" name="slug" value={ws.slug} /><Submit className="btn sm danger" confirm="Reset every account to its automatic mapping?">Reset to automatic</Submit></form>}
      <div className="panel small" style={{ marginTop: "1.5rem" }}>
        <strong>How the cash flow uses this.</strong> Every entry posted to a cash account is matched to the other side of its journal (same date and reference). The other account&apos;s cash flow line decides where the movement appears — for example, a receipt against Accounts Receivable is a customer receipt, and a payment against Accounts Payable is a supplier payment. These lines feed the <Link href={`${base}/statements/cash`}>cash statement</Link> and the actual weeks of the <Link href={`${base}/statements/cash-flow`}>13-week forecast</Link>.
      </div>
    </>
  );
}
