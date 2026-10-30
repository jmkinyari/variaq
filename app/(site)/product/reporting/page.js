import ProductPage from "../../_components/ProductPage";
export const metadata = { title: "CFO reporting, budgets & board packs", description: "Live KPIs, budget vs actual with suggested causes, 13-week and 12-month cash forecasts and approvable board packs." };

export default function Page() {
  return (
    <ProductPage
      current="reporting" eyebrow="CFO reporting"
      title={<>From trial balance to <em>board pack.</em></>}
      lede="KPIs calculated live from your ledger, budgets built from your own history, cash forecasts with scenarios, and a 10-section board pack that goes through review and approval."
      problems={[
        ["Reports built by hand", "Every month the same spreadsheets are rebuilt, re-linked and re-checked before the board meeting."],
        ["Variances without reasons", "You can see a number moved, but not whether it's timing, a one-off, a price change or a misposting."],
        ["Cash surprises", "Short-term cash needs show up too late to arrange funding calmly."],
      ]}
      steps={[
        ["Watch the KPIs", "21 KPIs with definitions and status — margins, EBITDA, runway, working-capital days and more — plus alerts from every module."],
        ["Budget from history", "Build the annual budget by prior year, trend, seasonal, driver-based or zero-based methods, then approve it."],
        ["Explain the variance", "Budget vs actual for the month, year to date and full-year landing, with suggested causes and the transactions behind each variance."],
        ["Approve the board pack", "A 10-section pack with snapshotted numbers, commentary per section and a Draft → In review → Approved flow with separate preparer and approver."],
      ]}
      capabilities={[
        ["KPI dashboard", "Revenue, gross and net margin, EBITDA, cash, burn and runway, liquidity ratios, DSO/DPO/DIO, cash conversion cycle, AR/AP ageing and top movers."],
        ["Budgets & reforecast", "Grid editing with bulk changes and spreading, approval workflow, and conflict detection when two people edit at once."],
        ["Cash flow forecasts", "13-week and 12-month forecasts with Base, Best and Worst scenarios, minimum-cash alerts and funding gap."],
        ["Board packs", "P&L vs budget and last year, balance sheet, cash outlook, KPIs, close status, control findings, KRA compliance, risks and decisions. Print to A4 PDF."],
        ["Financial statements", "Balance sheet, income statement and cash with drill-down to entries."],
        ["CFO Reporting & Budget Forecast agents", "Ask for the month in review or queue a management or board report; drafts are labelled and need approval."],
      ]}
    />
  );
}
