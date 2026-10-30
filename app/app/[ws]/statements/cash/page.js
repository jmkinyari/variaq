import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import { StatementTable, Empty, fmt } from "@/components/Statement";
import { classifyCashFlows, cashFlowByActivity } from "@/lib/statements";
import { formatDate } from "@/lib/dates";
import { loadChart, balancesAt, entriesBetween, ledgerRange, monthBounds, ISO_RE, shiftDays, previousPeriod } from "@/lib/statements-data";
export const metadata = { title: "Cash and cash equivalents" };

export default async function CashPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const sp = searchParams;
  const base = `/app/${ws.slug}`;
  const range = await ledgerRange(ws.id);
  if (!range.n) return <Empty base={base} title="Cash and cash equivalents" />;

  const [ms, me] = monthBounds(range.mx.slice(0, 7));
  let from = ISO_RE.test(sp.from || "") ? sp.from : ms;
  let to = ISO_RE.test(sp.to || "") ? sp.to : me;
  if (from > to) [from, to] = [to, from];
  const compare = sp.compare === "none" ? "none" : "prev";
  const [pf, pt] = previousPeriod(from, to);

  const { chart } = await loadChart(ws.id);
  const cashAccts = [...chart.values()].filter((a) => a.isCash).sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
  const codes = cashAccts.map((a) => a.code);
  const ph = codes.map(() => "?").join(",");
  const [openBal, closeBal, flowsRaw, entries, prevEntries, banks] = await Promise.all([
    balancesAt(ws.id, shiftDays(from, -1)),
    balancesAt(ws.id, to),
    codes.length ? db.all(`SELECT account_code, SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) inflow, SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END) outflow, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? AND date BETWEEN ? AND ? AND account_code IN (${ph}) GROUP BY account_code`, [ws.id, from, to, ...codes]) : [],
    entriesBetween(ws.id, from, to),
    compare === "prev" ? entriesBetween(ws.id, pf, pt) : [],
    db.all("SELECT id, name, bank_name, ledger_account_code FROM bank_accounts WHERE workspace_id = ?", [ws.id]),
  ]);
  const flowBy = new Map(flowsRaw.map((r) => [String(r.account_code), r]));
  // Latest bank statement balance on or before the period end, for accounts linked to a bank account.
  const bankBal = new Map();
  for (const b of banks) {
    if (!b.ledger_account_code) continue;
    const row = await db.get("SELECT t.date, t.balance_cents FROM bank_transactions t JOIN bank_statements s ON s.id = t.statement_id WHERE s.bank_account_id = ? AND t.balance_cents IS NOT NULL AND t.date <= ? ORDER BY t.date DESC, t.rowid DESC LIMIT 1", [b.id, to]);
    if (row) bankBal.set(String(b.ledger_account_code), { ...row, bank: b.name });
  }

  const lines = cashAccts.map((a) => {
    const f = flowBy.get(a.code) || {};
    return { ...a, opening: openBal.get(a.code) || 0, inflow: f.inflow || 0, outflow: f.outflow || 0, n: f.n || 0, closing: closeBal.get(a.code) || 0, bank: bankBal.get(a.code) };
  }).filter((l) => l.opening || l.closing || l.n);
  const T = (k) => lines.reduce((s, l) => s + l[k], 0);
  const totals = { opening: T("opening"), inflow: T("inflow"), outflow: T("outflow"), closing: T("closing") };

  const cf = cashFlowByActivity(classifyCashFlows(entries, chart));
  const cfPrev = compare === "prev" ? cashFlowByActivity(classifyCashFlows(prevEntries, chart)) : null;
  const prevOpen = cfPrev ? [...(await balancesAt(ws.id, shiftDays(pf, -1))).entries()].filter(([c]) => chart.get(c)?.isCash).reduce((s, [, v]) => s + v, 0) : 0;
  const prevClose = cfPrev ? [...(await balancesAt(ws.id, pt)).entries()].filter(([c]) => chart.get(c)?.isCash).reduce((s, [, v]) => s + v, 0) : 0;
  const v = (x, y) => (cfPrev ? [x, y] : [x]);
  const unclassified = (totals.closing - totals.opening) - cf.net;
  const unclassifiedPrev = cfPrev ? (prevClose - prevOpen) - cfPrev.net : 0;
  const rows = [];
  for (const act of cf.activities) {
    const p = cfPrev?.activities.find((x) => x.key === act.key);
    const keys = new Set([...act.lines.map((l) => l.key), ...(p ? p.lines.map((l) => l.key) : [])]);
    if (!keys.size) continue;
    rows.push({ type: "head", label: `Cash flows from ${act.title.toLowerCase()}` });
    for (const k of keys) {
      const l = act.lines.find((x) => x.key === k) || p.lines.find((x) => x.key === k);
      rows.push({ type: "line", name: l.label, values: v(cf.byCategory[k] || 0, cfPrev?.byCategory[k] || 0) });
    }
    rows.push({ type: "total", label: `Net cash from ${act.title.toLowerCase()}`, values: v(act.total, p?.total || 0) });
  }
  if (unclassified || unclassifiedPrev) rows.push({ type: "line", name: "Transfers and unclassified movements", values: v(unclassified, unclassifiedPrev) });
  rows.push({ type: "gap" },
    { type: "total", label: "Net increase / (decrease) in cash", values: v(totals.closing - totals.opening, prevClose - prevOpen) },
    { type: "line", name: "Cash and cash equivalents at start of period", values: v(totals.opening, prevOpen) },
    { type: "total", grand: true, label: "Cash and cash equivalents at end of period", values: v(totals.closing, prevClose) });

  const pLabel = (f, t) => `${formatDate(f)} – ${formatDate(t)}`;
  return (
    <>
      <PageHead title="Cash and cash equivalents" desc={`${ws.name} · ${pLabel(from, to)} · cash, bank and mobile-money accounts from the ledger`} />
      <form className="card filters no-print" style={{ marginBottom: "1rem" }}>
        <div className="form-row">
          <div><label>From</label><input type="date" name="from" defaultValue={from} /></div>
          <div><label>To</label><input type="date" name="to" defaultValue={to} /></div>
          <div><label>Compare with</label><select name="compare" defaultValue={compare}><option value="prev">Previous period</option><option value="none">No comparison</option></select></div>
          <div className="row"><button className="btn primary">Update</button></div>
        </div>
      </form>
      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        <div className="card stat"><div className="label">Opening cash</div><div className="value">{fmt(totals.opening)}</div></div>
        <div className="card stat"><div className="label">Cash in</div><div className="value" style={{ color: "var(--good)" }}>{fmt(totals.inflow)}</div></div>
        <div className="card stat"><div className="label">Cash out</div><div className="value" style={{ color: "var(--bad)" }}>{fmt(totals.outflow)}</div></div>
        <div className="card stat"><div className="label">Closing cash</div><div className="value">{fmt(totals.closing)}</div></div>
      </div>

      <h2 style={{ fontSize: "1.4rem" }}>Balances by account</h2>
      {lines.length === 0 ? <div className="card empty">No cash accounts found. Mark your bank, M-Pesa and petty cash accounts as cash in the <Link href={`${base}/statements/accounts`}>account mapping</Link>.</div> : (
        <div className="table-wrap" style={{ marginBottom: "1.5rem" }}><table>
          <thead><tr><th>Account · {ws.currency}</th><th className="num">Opening</th><th className="num">Receipts</th><th className="num">Payments</th><th className="num">Closing (ledger)</th><th className="num">Per bank statement</th><th className="num">Difference</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.code}>
                <td><Link href={`${base}/ledger?account=${encodeURIComponent(l.code)}&from=${from}&to=${to}`}><strong>{l.code}</strong> {l.name}</Link><div className="faint small">{l.n} entr{l.n === 1 ? "y" : "ies"} this period</div></td>
                <td className="num">{fmt(l.opening)}</td><td className="num">{fmt(l.inflow)}</td><td className="num">{fmt(l.outflow)}</td><td className="num"><strong>{fmt(l.closing)}</strong></td>
                <td className="num">{l.bank ? <>{fmt(l.bank.balance_cents)}<div className="faint small">{formatDate(l.bank.date)}</div></> : <span className="faint">—</span>}</td>
                <td className="num">{l.bank ? (l.bank.balance_cents - l.closing === 0 ? <span className="badge good">Agrees</span> : <span className="badge warn">{fmt(l.bank.balance_cents - l.closing)}</span>) : ""}</td>
              </tr>))}
            <tr style={{ fontWeight: 600, background: "var(--muted)" }}><td>Total cash and cash equivalents</td><td className="num">{fmt(totals.opening)}</td><td className="num">{fmt(totals.inflow)}</td><td className="num">{fmt(totals.outflow)}</td><td className="num">{fmt(totals.closing)}</td><td /><td /></tr>
          </tbody>
        </table></div>)}

      <h2 style={{ fontSize: "1.4rem" }}>Cash flow statement (direct method)</h2>
      <StatementTable columns={[pLabel(from, to), ...(cfPrev ? [pLabel(pf, pt)] : [])]} rows={rows} currency={ws.currency} firstLabel="Line" />
      <p className="faint small" style={{ marginTop: "1rem" }}>Each movement on a cash account is classified by the other side of its journal (matched on date and reference). Transfers between cash accounts are excluded. A bank-statement difference usually means unreconciled items — open a <Link href={`${base}/reconciliations`}>reconciliation</Link>. Change which accounts count as cash, and how they&apos;re classified, in the <Link href={`${base}/statements/accounts`}>account mapping</Link>.</p>
    </>
  );
}
