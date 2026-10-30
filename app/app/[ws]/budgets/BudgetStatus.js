const STATUS = { DRAFT: ["Draft", ""], SUBMITTED: ["Awaiting approval", "warn"], APPROVED: ["Approved", "good"], LOCKED: ["Locked", "info"] };
export default function BudgetStatus({ status }) { const [l, t] = STATUS[status] || [status, ""]; return <span className={`badge ${t}`}>{l}</span>; }
