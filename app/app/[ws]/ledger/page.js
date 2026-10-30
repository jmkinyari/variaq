import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace, canAdmin, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { deleteImport } from "./actions";
export const metadata = { title: "Ledger & journals" };

const PAGE = 100;

export default async function LedgerPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const sp = searchParams;
  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const where = ["workspace_id = ?"], args = [ws.id];
  if (sp.account) { where.push("account_code = ?"); args.push(sp.account); }
  if (sp.from) { where.push("date >= ?"); args.push(sp.from); }
  if (sp.to) { where.push("date <= ?"); args.push(sp.to); }
  if (sp.journal) { where.push("journal_no = ?"); args.push(sp.journal); }
  if (sp.source) { where.push("source = ?"); args.push(sp.source); }
  if (sp.posted_by) { where.push("posted_by = ?"); args.push(sp.posted_by); }
  if (sp.q) { where.push("(description LIKE ? OR reference LIKE ? OR counterparty LIKE ? OR journal_no LIKE ?)"); const q = `%${sp.q}%`; args.push(q, q, q, q); }
  const W = where.join(" AND ");
  const [imports, accounts, count, entries, sum, sources, posters] = await Promise.all([
    db.all("SELECT i.*, u.name by_name FROM ledger_imports i LEFT JOIN users u ON u.id = i.created_by WHERE i.workspace_id = ? ORDER BY i.created_at DESC", [ws.id]),
    db.all("SELECT account_code, MAX(account_name) account_name, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? GROUP BY account_code ORDER BY account_code", [ws.id]),
    db.get(`SELECT COUNT(*) n FROM ledger_entries WHERE ${W}`, args),
    db.all(`SELECT * FROM ledger_entries WHERE ${W} ORDER BY date DESC, created_at DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, args),
    db.get(`SELECT SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) dr, SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) cr FROM ledger_entries WHERE ${W}`, args),
    db.all("SELECT source, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? GROUP BY source ORDER BY n DESC", [ws.id]),
    db.all("SELECT posted_by, COUNT(*) n FROM ledger_entries WHERE workspace_id = ? AND posted_by IS NOT NULL GROUP BY posted_by ORDER BY n DESC LIMIT 200", [ws.id]),
  ]);
  const base = `/app/${ws.slug}`;
  const pages = Math.max(1, Math.ceil(count.n / PAGE));
  const qs = (p) => { const u = new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k]) => !["ok", "err"].includes(k))), page: String(p) }); return `?${u}`; };
  return (
    <>
      <PageHead title="Ledger & journals" desc="Journal lines from your ERP (synced, pushed by API, or uploaded). Positive amounts are debits, negative are credits.">
        <Link href={`${base}/integrations`} className="btn">ERP integrations</Link>
        {canEdit(ws.role) && <Link href={`${base}/data?kind=ledger`} className="btn primary">Import CSV / Excel</Link>}
      </PageHead>
      <Flash searchParams={sp} />

      {imports.length === 0 ? (
        <div className="card empty"><h3>No ledger data yet</h3><p>Import a CSV export of your general ledger to get started.</p>{canEdit(ws.role) && <Link href={`${base}/data?kind=ledger`} className="btn primary">Import your first ledger</Link>} <Link href={`${base}/integrations`} className="btn">Connect your ERP</Link></div>
      ) : <>
        <form className="card" style={{ marginBottom: "1rem" }}>
          <div className="form-row" style={{ alignItems: "end" }}>
            <div><label>Account</label><select name="account" defaultValue={sp.account || ""}><option value="">All accounts</option>{accounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code}{a.account_name ? ` · ${a.account_name}` : ""} ({a.n})</option>)}</select></div>
            <div><label>From</label><input type="date" name="from" defaultValue={sp.from || ""} /></div>
            <div><label>To</label><input type="date" name="to" defaultValue={sp.to || ""} /></div>
            <div><label>Journal no.</label><input name="journal" defaultValue={sp.journal || ""} /></div>
            <div><label>Source</label><select name="source" defaultValue={sp.source || ""}><option value="">All sources</option>{sources.map((s) => <option key={s.source} value={s.source}>{s.source} ({s.n})</option>)}</select></div>
            <div><label>Posted by</label><select name="posted_by" defaultValue={sp.posted_by || ""}><option value="">Anyone</option>{posters.map((p) => <option key={p.posted_by} value={p.posted_by}>{p.posted_by} ({p.n})</option>)}</select></div>
            <div><label>Search</label><input name="q" defaultValue={sp.q || ""} placeholder="Description, reference, counterparty, journal" /></div>
            <div className="row"><button className="btn primary">Filter</button><Link href={`/app/${ws.slug}/ledger`} className="btn ghost">Clear</Link></div>
          </div>
        </form>
        <div className="row between small muted" style={{ marginBottom: ".5rem" }}>
          <span>{count.n.toLocaleString()} entries · debits {formatMoney(sum.dr || 0, ws.currency)} · credits {formatMoney(sum.cr || 0, ws.currency)}</span>
          <span>Page {page} of {pages}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Journal</th><th>Account</th><th>Description</th><th>Reference</th><th>Counterparty</th><th>Posted by</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}><td>{e.date}</td><td>{e.journal_no ? <Link href={`${base}/ledger/journal/${encodeURIComponent(e.journal_no)}`}>{e.journal_no}</Link> : "—"}<div className="faint small">{e.source}</div></td><td>{e.account_code}<div className="faint small">{e.account_name}</div></td><td className="wrap">{e.description}</td><td>{e.reference || "—"}</td><td>{e.counterparty || "—"}</td><td className="small">{e.posted_by || "—"}{e.approved_by ? <div className="faint">appr. {e.approved_by}</div> : null}</td><td className="num">{formatMoney(e.amount_cents, ws.currency)}</td></tr>
              ))}
              {entries.length === 0 && <tr><td colSpan={8} className="empty">No entries match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        {pages > 1 && <div className="row" style={{ marginTop: ".8rem" }}>
          {page > 1 && <Link className="btn sm" href={qs(page - 1)}>← Previous</Link>}
          {page < pages && <Link className="btn sm" href={qs(page + 1)}>Next →</Link>}
        </div>}

        <h2 style={{ marginTop: "2.5rem" }}>Import history</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>File / sync</th><th>Source</th><th>Imported</th><th className="num">Rows</th><th className="num">Skipped</th><th>By</th><th></th></tr></thead>
            <tbody>{imports.map((i) => (
              <tr key={i.id}><td>{i.file_name}</td><td className="small">{i.source}</td><td>{formatDateTime(i.created_at)}</td><td className="num">{i.row_count.toLocaleString()}</td><td className="num">{i.skipped}</td><td>{i.by_name}</td>
                <td className="num">{canAdmin(ws.role) && <form action={deleteImport} className="inline-form"><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={i.id} /><Submit className="btn sm danger" confirm={`Delete ${i.file_name} and all ${i.row_count} entries from it?`}>Delete</Submit></form>}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </>}
    </>
  );
}
