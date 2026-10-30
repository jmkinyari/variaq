import ProductPage from "../../_components/ProductPage";
export const metadata = { title: "Journal audit & auditor queries", description: "21 automated journal-entry tests, completeness checks, correcting journals and auditor query evidence packs." };

export default function Page() {
  return (
    <ProductPage
      current="audit" eyebrow="Journal audit"
      title={<>Find the risky journals <em>before your auditor does.</em></>}
      lede="Run 21 automated journal-entry tests across the year, get a corrective action for each finding, and answer auditor queries with evidence packs built for you."
      problems={[
        ["Sampling misses things", "Manual journal reviews look at a sample and rarely catch self-approved, back-dated or misposted entries."],
        ["Audit season scramble", "Every auditor request turns into a hunt for journals, lines, counterparties and reconciliations."],
        ["Fixes get lost", "Findings sit in email threads with no owner, no status and no correcting entry."],
      ]}
      steps={[
        ["Choose a range", "Pick the period — for example a full financial year."],
        ["Run the tests", "21 tests in the style of ISA 240 journal-entry testing run over every line, including a misposting model trained on your own history."],
        ["Assign and correct", "Each finding has a corrective action and, where it applies, a balanced correcting journal you can download as CSV for your ERP."],
        ["Respond to auditors", "External auditors raise queries in a read-only role; Variaq builds the evidence pack and you reply with action points."],
      ]}
      capabilities={[
        ["21 journal tests", "Unbalanced, weekend/holiday (Kenyan calendar), after-hours, back-dated, round sums, just-below-limit, duplicates, self-approval, suspense, abnormal balances, rare pairs, Benford's law, cut-off, dormant accounts and more."],
        ["Misposting detection", "A machine-learned model trained on your own posting history flags likely mispostings."],
        ["Correcting journals", "Balanced correcting entries exported as CSV to import into your ERP."],
        ["Findings that persist", "Findings carry over between runs and keep their status and owner."],
        ["Auditor queries", "Evidence packs with movement summary, trend, journals, counterparties, related findings and reconciliation status. Queries are encrypted at rest."],
        ["Journal Audit agent", "Summarise open findings and queries, or queue an audit-pack draft in the background."],
      ]}
    />
  );
}
