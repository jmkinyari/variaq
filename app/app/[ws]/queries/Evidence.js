// Renders a query's evidence pack (server component, also used in the printable report).
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { SevBadge, StateBadge } from "../journal-audit/ui";

export default function Evidence({ ev, currency, slug, print = false }) {
  if (!ev) return <p className="muted">No evidence pack — the query isn't linked to an account or journal.</p>;
  const m = (c) => formatMoney(c, currency);
  const a = ev.account, j = ev.journal;
  const maxAbs = Math.max(1, ...(a?.trend || []).map((t) => Math.abs(t.netCents)));
  return (
    <div className="evidence">
      <p className="faint small">Generated from the ledger {formatDateTime(ev.generatedAt)} · period {formatDate(ev.from)} – {formatDate(ev.to)}</p>
      {a && <>
        <h3>Account {a.code} {a.name}</h3>
        <div className="table-wrap"><table><tbody>
          <tr><td>Opening balance ({formatDate(ev.from)})</td><td className="num">{m(a.openingCents)}</td></tr>
          <tr><td>Debits in period</td><td className="num">{m(a.debitsCents)}</td></tr>
          <tr><td>Credits in period</td><td className="num">{m(-a.creditsCents)}</td></tr>
          <tr><td><strong>Closing balance ({formatDate(ev.to)})</strong></td><td className="num"><strong>{m(a.closingCents)}</strong></td></tr>
          <tr><td className="faint small">Lines posted in period</td><td className="num faint small">{a.lines.toLocaleString()}</td></tr>
        </tbody></table></div>
        {a.trend.length > 0 && <>
          <h3>Monthly movement (last 12 months)</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Month</th><th className="num">Net movement</th><th className="num">Lines</th><th style={{ width: "40%" }}></th></tr></thead>
            <tbody>{a.trend.map((t) => <tr key={t.ym}><td>{t.ym}</td><td className="num">{m(t.netCents)}</td><td className="num">{t.n}</td>
              <td><div className="conf" style={{ width: "100%" }}><span style={{ width: `${(Math.abs(t.netCents) / maxAbs) * 100}%`, background: t.netCents < 0 ? "var(--bad)" : "var(--accent)" }} /></div></td></tr>)}</tbody>
          </table></div>
        </>}
        {a.counterparties.length > 0 && <>
          <h3>Top counterparties</h3>
          <div className="table-wrap"><table><thead><tr><th>Counterparty</th><th className="num">Net</th><th className="num">Lines</th><th className="num">Largest</th></tr></thead>
            <tbody>{a.counterparties.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{m(c.netCents)}</td><td className="num">{c.n}</td><td className="num">{m(c.largestCents)}</td></tr>)}</tbody></table></div>
        </>}
        {a.largestJournals.length > 0 && <>
          <h3>Largest journals in the period</h3>
          <div className="table-wrap"><table><thead><tr><th>Journal</th><th>Date</th><th>Description</th><th>Posted / approved</th><th className="num">Effect on account</th></tr></thead>
            <tbody>{a.largestJournals.map((x) => <tr key={x.ref}><td>{print ? x.ref : <Link href={`/app/${slug}/ledger?q=${encodeURIComponent(x.ref)}`}>{x.ref}</Link>}</td><td className="small">{x.date}</td><td className="wrap">{x.description}</td><td className="small">{x.postedBy || "—"} / {x.approvedBy || "—"}</td><td className="num">{m(x.netCents)}</td></tr>)}</tbody></table></div>
        </>}
      </>}
      {j && <>
        <h3>Journal {j.journalNo} {j.balanced ? <span className="badge good">balanced</span> : <span className="badge bad">does not balance</span>}</h3>
        <p className="small muted">Posted by {j.postedBy || "—"}{j.postedAt ? ` at ${formatDateTime(j.postedAt)}` : ""} · approved by {j.approvedBy || "—"} · type {j.entryType || "—"} · source {j.source || "—"}</p>
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Counterparty</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{j.lines.map((l, i) => <tr key={i}><td className="small">{l.date}</td><td>{l.accountCode} <span className="faint small">{l.accountName}</span></td><td className="wrap">{l.description}</td><td className="small">{l.counterparty || "—"}</td><td className="num">{l.amountCents > 0 ? m(l.amountCents) : ""}</td><td className="num">{l.amountCents < 0 ? m(-l.amountCents) : ""}</td></tr>)}</tbody></table></div>
      </>}
      <h3>Related audit findings</h3>
      {ev.findings.length ? <div className="table-wrap"><table><thead><tr><th>Severity</th><th>Finding</th><th>Date</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>{ev.findings.map((f) => <tr key={f.id}><td><SevBadge severity={f.severity} /></td><td className="wrap">{print ? f.title : <Link href={`/app/${slug}/journal-audit/${f.id}`}>{f.title}</Link>}{f.resolution ? <div className="faint small">{f.resolution}</div> : null}</td><td className="small">{f.date || "—"}</td><td className="num">{f.amountCents !== null ? m(f.amountCents) : "—"}</td><td><StateBadge status={f.status} /></td></tr>)}</tbody></table></div>
        : <p className="muted small">No journal-audit findings on this account or journal (run Journal audit for the period if it hasn't been run).</p>}
      {ev.reconciliations.length > 0 && <>
        <h3>Bank reconciliations</h3>
        <ul className="small">{ev.reconciliations.map((r, i) => <li key={i}>{r.name} — {r.status.toLowerCase().replace("_", " ")} (statement to {r.periodEnd}{r.completedAt ? `, completed ${formatDate(r.completedAt.slice(0, 10))}` : ""})</li>)}</ul>
      </>}
      <h3>Period locks</h3>
      <p className="small muted">{ev.locks.length ? ev.locks.map((l) => `${l.period} locked ${formatDateTime(l.lockedAt)}`).join(" · ") : "No periods in this range are locked."}</p>
    </div>
  );
}
