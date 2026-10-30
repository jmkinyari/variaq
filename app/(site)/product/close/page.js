import ProductPage from "../../_components/ProductPage";
export const metadata = { title: "Month-end close & reconciliations", description: "Bank and M-Pesa reconciliation with reasons, an exception queue and a month-end close checklist with sign-off and period locks." };

export default function Page() {
  return (
    <ProductPage
      current="close" eyebrow="Month-end close"
      title={<>Close the month <em>without the chase.</em></>}
      lede="Reconcile bank and M-Pesa statements against your ledger, clear exceptions with an audit trail, and run a shared close checklist that ends with a locked period."
      problems={[
        ["Spreadsheet matching", "Hundreds of bank and M-Pesa lines ticked off by hand, with no record of why two items were matched."],
        ["Invisible progress", "Nobody knows which close tasks are blocked, who owns them, or whether the reviewer has signed off."],
        ["Late changes", "Entries keep landing in a month that was meant to be closed, and the numbers move after reporting."],
      ]}
      steps={[
        ["Import statements", "Upload bank and M-Pesa exports (CSV or Excel) and your ledger; columns are mapped once and validated on the server."],
        ["Review suggested matches", "Rule-based matching on amount, date, reference and description, each with a confidence and the reasons behind it. A person confirms every match."],
        ["Clear the exceptions", "Unmatched items, likely duplicates and reference mismatches land in one queue with notes and history."],
        ["Sign off and lock", "Work the checklist with owners, reviewers, dependencies and comments, then lock the period so imports, syncs and API pushes into it are rejected."],
      ]}
      capabilities={[
        ["Bank & M-Pesa reconciliation", "KCB, Equity, NCBA, M-Pesa and other statement exports matched against the ledger, with explainable suggestions."],
        ["Exception queue", "One place for what still needs attention, with notes and a full audit trail you can reopen later."],
        ["Close checklist & task board", "Owners, reviewers, priorities, due dates, dependencies, comments and approver sign-off; personal, team-workload and kanban views."],
        ["Period locks", "Locked months reject imports, connector syncs and API journal pushes."],
        ["Completeness tests", "Gaps in journal and invoice sequences, TB roll-forward, missing recurring postings (rent, payroll, depreciation) and ledger vs bank."],
        ["Month-End Close agent", "Ask for checklist status and blockers, or queue a close summary in the background — this one works even without an AI key."],
      ]}
    />
  );
}
