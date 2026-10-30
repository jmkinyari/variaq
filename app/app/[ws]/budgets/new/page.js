import Link from "next/link";
import "@/styles/planning.css";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { METHODS, defaultAssumptions } from "@/lib/budget/engine";
import { createBudget } from "../actions";
export const metadata = { title: "New budget" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HELP = {
  PRIOR_YEAR: "Last 12 months of actuals per account, grown by a % per statement class. Simple and easy to explain.",
  TREND: "Fits a straight line through up to 24 months per account and extends it. Good for steadily growing or shrinking lines.",
  SEASONAL: "Annual total from last 12 months × growth, then spread by each account's historical month-by-month pattern.",
  DRIVER: "Revenue grows by %, cost of sales follows a % of revenue, overheads rise with inflation, payroll steps up in the pay-review month.",
  ZERO_BASED: "Every account starts at zero for you to build up line by line.",
};

export default async function NewBudget({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws, "MEMBER");
  const base = `/app/${ws.slug}`;
  const range = await db.get("SELECT MIN(date) mn, MAX(date) mx FROM ledger_entries WHERE workspace_id = ?", [ws.id]);
  const next = range?.mx ? (() => { const [y, m] = range.mx.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); })() : new Date().toISOString().slice(0, 7);
  // Default: the month after the latest ledger data (change it to your financial-year start, e.g. January or July).
  const fyDefault = next;
  const d = defaultAssumptions();
  return (
    <>
      <PageHead title="New budget" crumbs={<Link href={`${base}/budgets`}>Budgets</Link>} desc="Generated from your own ledger history. Everything can be edited afterwards." />
      <Flash searchParams={searchParams} />
      {!range?.mx && <div className="alert warn">There&apos;s no ledger data yet, so only a zero-based budget will have content. Import your ledger first for data-driven budgets.</div>}
      <form action={createBudget} className="stack" style={{ maxWidth: 860 }}>
        <input type="hidden" name="slug" value={ws.slug} />
        <div className="card">
          <div className="form-row">
            <div className="field"><label>Budget name</label><input name="name" required defaultValue={`FY${fyDefault.slice(0, 4)} budget`} maxLength={100} /></div>
            <div className="field"><label>First month of the financial year</label><input type="month" name="fy_start" required defaultValue={fyDefault} /><div className="help">History used: the 24 months before this month{range?.mx ? ` (ledger has ${range.mn} → ${range.mx})` : ""}.</div></div>
          </div>
        </div>
        <div className="card">
          <h3>Method</h3>
          {Object.entries(METHODS).map(([k, label], i) => (
            <label key={k} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", fontWeight: 400, color: "var(--text)", padding: ".45rem 0", borderBottom: "1px solid var(--border)" }}>
              <input type="radio" name="method" value={k} defaultChecked={i === 0} style={{ width: "auto", marginTop: 4 }} />
              <span><strong>{label}</strong><br /><span className="muted small">{HELP[k]}</span></span>
            </label>))}
        </div>
        <div className="card">
          <h3>Assumptions</h3>
          <p className="muted small">Growth by class is used by the prior-year and seasonal methods; the driver fields by the driver-based method.</p>
          <div className="form-row">
            <div className="field"><label>Revenue growth %</label><input type="number" step="0.1" name="growth_REVENUE" defaultValue={d.growth.REVENUE} /></div>
            <div className="field"><label>Cost of sales growth %</label><input type="number" step="0.1" name="growth_COGS" defaultValue={d.growth.COGS} /></div>
            <div className="field"><label>Operating expense growth %</label><input type="number" step="0.1" name="growth_EXPENSE" defaultValue={d.growth.EXPENSE} /></div>
            <div className="field"><label>Other income growth %</label><input type="number" step="0.1" name="growth_OTHER_INCOME" defaultValue={d.growth.OTHER_INCOME} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Driver: revenue growth %</label><input type="number" step="0.1" name="revGrowth" defaultValue={d.revGrowth} /></div>
            <div className="field"><label>Driver: cost of sales % of revenue</label><input type="number" step="0.1" name="cogsPct" placeholder="Blank = historical %" /></div>
            <div className="field"><label>Driver: overhead inflation %</label><input type="number" step="0.1" name="inflation" defaultValue={d.inflation} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Driver: payroll increase %</label><input type="number" step="0.1" name="payrollPct" defaultValue={d.payrollPct} /></div>
            <div className="field"><label>Driver: pay review from</label><select name="payrollMonth" defaultValue="0">{MONTHS.map((_, i) => <option key={i} value={i}>Budget month {i + 1}</option>)}</select></div>
            <div className="field"><label>Round cells to</label><select name="rounding" defaultValue="100000"><option value="1">Exact</option><option value="10000">{ws.currency} 100</option><option value="100000">{ws.currency} 1,000</option><option value="1000000">{ws.currency} 10,000</option></select></div>
          </div>
        </div>
        <div className="row"><Submit pendingText="Generating…">Generate budget</Submit><Link className="btn ghost" href={`${base}/budgets`}>Cancel</Link></div>
      </form>
    </>
  );
}
