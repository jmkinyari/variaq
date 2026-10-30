import Link from "next/link";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { verifyChain } from "@/lib/audit-chain";
import PageHead from "@/components/PageHead";
import { formatDateTime } from "@/lib/dates";
import { auditWhere } from "./query";
import "@/styles/platform.css";
export const metadata = { title: "Audit log" };

const PAGE = 100;
const LINKS = {
  reconciliation: (b, id, a) => a !== "reconciliation.deleted" && `${b}/reconciliations/${id}`,
  report: (b, id, a) => a !== "report.deleted" && `${b}/reports/${id}`,
  close_task: (b, id, a) => a !== "close.task_deleted" && `${b}/tasks/${id}`,
  connector: (b) => `${b}/integrations`,
  auditor_query: (b, id) => `${b}/queries/${id}`,
};

export default async function AuditPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const sp = searchParams;
  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const { W, args } = auditWhere(ws.id, sp);
  // Verifies every event's hash link (and seals any pending events first).
  const chain = await verifyChain(ws.id);
  const [rows, types, count, users] = await Promise.all([
    db.all(`SELECT a.*, u.name, u.email FROM audit_events a LEFT JOIN users u ON u.id = a.user_id WHERE ${W} ORDER BY a.created_at DESC, a.seq DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, args),
    db.all("SELECT entity_type, COUNT(*) n FROM audit_events WHERE workspace_id = ? GROUP BY entity_type ORDER BY entity_type", [ws.id]),
    db.get(`SELECT COUNT(*) n FROM audit_events a WHERE ${W}`, args),
    db.all("SELECT DISTINCT u.id, u.name FROM audit_events a JOIN users u ON u.id = a.user_id WHERE a.workspace_id = ? ORDER BY u.name", [ws.id]),
  ]);
  const pages = Math.max(1, Math.ceil(count.n / PAGE));
  const base = `/app/${ws.slug}`;
  const filterQs = new URLSearchParams(Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && !["page", "ok", "err"].includes(k)))).toString();
  return (
    <>
      <PageHead title="Audit log" desc="Every import, sync, match decision, review note, approval and setting change — who did it, when and from where. Entries are hash-chained and can't be edited.">
        <a className="btn" href={`${base}/audit/export?${filterQs}`}>Export CSV</a>
      </PageHead>
      <div className={`card ${chain.ok ? "chain-ok" : "chain-bad"}`} style={{ marginBottom: "1rem" }}>
        {chain.ok ? <><span className="badge good">Integrity verified</span> <span className="small muted">All {chain.checked.toLocaleString()} events link correctly in an unbroken SHA-256 chain{chain.head ? <> · head <code>{chain.head.slice(0, 16)}…</code></> : null}.</span></>
          : <><span className="badge bad">Tampering detected</span> <span className="small">{chain.reason} The chain is intact up to event #{chain.checked}. Investigate database access around that time.</span></>}
      </div>
      <form className="card row" style={{ marginBottom: "1rem", alignItems: "end" }}>
        <div><label>Area</label><select name="type" defaultValue={sp.type || ""}><option value="">All</option>{types.map((t) => <option key={t.entity_type} value={t.entity_type}>{t.entity_type.replace(/_/g, " ")} ({t.n})</option>)}</select></div>
        <div><label>Person</label><select name="user" defaultValue={sp.user || ""}><option value="">Anyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label>Action contains</label><input name="action" defaultValue={sp.action || ""} placeholder="e.g. locked, deleted" /></div>
        <div><label>From</label><input type="date" name="from" defaultValue={sp.from || ""} /></div>
        <div><label>To</label><input type="date" name="to" defaultValue={sp.to || ""} /></div>
        <button className="btn primary">Filter</button><Link href={`${base}/audit`} className="btn ghost">Clear</Link>
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
        <tbody>{rows.map((r) => {
          let d = {}; try { d = JSON.parse(r.detail); } catch {}
          const link = LINKS[r.entity_type]?.(base, r.entity_id, r.action);
          return <tr key={r.id}><td className="faint small">{r.seq ?? "…"}</td><td className="small" style={{ whiteSpace: "nowrap" }}>{formatDateTime(r.created_at)}</td><td>{r.name || (r.user_id ? "—" : "System")}<div className="faint small">{r.email}</div></td><td><code className="small">{r.action}</code></td>
            <td className="small wrap">{Object.entries(d).map(([k, v]) => <span key={k} style={{ marginRight: 10 }}><span className="faint">{k}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}</span>)}
              {link && r.entity_id && <> <Link href={link}>open</Link></>}</td><td className="small faint">{r.ip || ""}</td></tr>;
        })}
        {rows.length === 0 && <tr><td colSpan={6} className="empty">No activity matches.</td></tr>}</tbody>
      </table></div>
      {pages > 1 && <div className="row" style={{ marginTop: ".8rem" }}>
        {page > 1 && <Link className="btn sm" href={`?${filterQs}&page=${page - 1}`}>← Newer</Link>}
        <span className="muted small">Page {page} of {pages}</span>
        {page < pages && <Link className="btn sm" href={`?${filterQs}&page=${page + 1}`}>Older →</Link>}
      </div>}
    </>
  );
}
