// Shared presentational pieces for the audit & control pages (server components).
import { formatMoney } from "@/lib/money";

export const FINDING_STATUSES = [["OPEN", "Open", "bad"], ["IN_PROGRESS", "In progress", "info"], ["CORRECTED", "Corrected", "good"], ["ACCEPTED_RISK", "Accepted risk", "warn"], ["FALSE_POSITIVE", "False positive", ""], ["CLEARED", "Cleared on re-run", "good"]];
export const QUERY_STATUSES = [["OPEN", "Open", "bad"], ["IN_PROGRESS", "In progress", "info"], ["RESPONDED", "Responded", "warn"], ["CLOSED", "Closed", "good"]];

export function SevBadge({ severity }) {
  const t = { HIGH: "bad", MEDIUM: "warn", LOW: "info" }[severity] || "";
  return <span className={`badge sev ${t}`}>{String(severity || "").toLowerCase()}</span>;
}
export function StateBadge({ status, list = FINDING_STATUSES }) {
  const s = list.find(([v]) => v === status) || [status, status, ""];
  return <span className={`badge ${s[2]}`}>{s[1]}</span>;
}

/** Proposed journal (balanced lines) as a table. */
export function JournalLines({ lines, currency }) {
  if (!lines?.length) return null;
  const dr = lines.reduce((a, l) => a + (l.debitCents || 0), 0), cr = lines.reduce((a, l) => a + (l.creditCents || 0), 0);
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
      <tbody>
        {lines.map((l, i) => <tr key={i}><td>{l.accountCode} <span className="faint small">{l.accountName}</span></td><td className="wrap">{l.description}</td><td className="num">{l.debitCents ? formatMoney(l.debitCents, currency) : ""}</td><td className="num">{l.creditCents ? formatMoney(l.creditCents, currency) : ""}</td></tr>)}
        <tr><td colSpan={2}><strong>Total</strong>{dr !== cr && <span className="badge warn" style={{ marginLeft: 6 }}>one-sided: contra to be confirmed</span>}</td><td className="num"><strong>{formatMoney(dr, currency)}</strong></td><td className="num"><strong>{formatMoney(cr, currency)}</strong></td></tr>
      </tbody>
    </table></div>
  );
}

/** Observed first-digit frequencies (bars) vs Benford's expected curve (line). */
export function BenfordChart({ result }) {
  if (!result?.n) return <p className="muted small">No amounts to test.</p>;
  const W = 480, H = 200, pad = 28, bw = (W - pad * 2) / 9;
  const max = Math.max(0.32, ...result.digits.map((d) => d.observed));
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const pts = result.digits.map((d, i) => `${pad + bw * i + bw / 2},${y(d.expected)}`).join(" ");
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="benford" role="img" aria-label={`Benford first-digit test: ${result.conformity}`}>
        {result.digits.map((d, i) => <rect key={d.digit} className="bar" x={pad + bw * i + 4} y={y(d.observed)} width={bw - 8} height={H - pad - y(d.observed)}><title>{`Digit ${d.digit}: ${(d.observed * 100).toFixed(1)}% observed vs ${(d.expected * 100).toFixed(1)}% expected (z ${d.z})`}</title></rect>)}
        <polyline className="exp" points={pts} />
        {result.digits.map((d, i) => <text key={d.digit} x={pad + bw * i + bw / 2} y={H - 10} textAnchor="middle">{d.digit}</text>)}
        <text x={pad} y={14}>{(max * 100).toFixed(0)}%</text>
      </svg>
      <figcaption className="small muted">Bars: observed first digits · red line: Benford expected · {result.n.toLocaleString()} amounts · MAD {result.mad} — <strong>{result.conformity}</strong>{!result.reliable && " (fewer than 300 amounts: indicative only)"}</figcaption>
    </figure>
  );
}
