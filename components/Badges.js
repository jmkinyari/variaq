export function StatusBadge({ status }) {
  const map = { IN_PROGRESS: ["In progress", "info"], IN_REVIEW: ["In review", "warn"], COMPLETED: ["Completed", "good"], DRAFT: ["Draft", ""], REVIEWED: ["Reviewed", "good"], TODO: ["To do", ""], DONE: ["Done", "good"], OPEN: ["Open", "bad"], RESOLVED: ["Resolved", "good"], DISMISSED: ["Dismissed", ""], SUGGESTED: ["Suggested", "info"], CONFIRMED: ["Confirmed", "good"], REJECTED: ["Rejected", "bad"] };
  const [l, t] = map[status] || [status, ""];
  return <span className={`badge ${t}`}>{l}</span>;
}
export const EXCEPTION_LABELS = {
  UNMATCHED_BANK: ["Unmatched bank line", "bad"],
  UNMATCHED_LEDGER: ["Unmatched ledger entry", "warn"],
  DUPLICATE: ["Possible duplicate", "warn"],
  LARGE_AMOUNT: ["Large amount", "info"],
  AMOUNT_MISMATCH: ["Amount mismatch", "bad"],
};
export function ExceptionBadge({ type }) {
  const [l, t] = EXCEPTION_LABELS[type] || [type, ""];
  return <span className={`badge ${t}`}>{l}</span>;
}
