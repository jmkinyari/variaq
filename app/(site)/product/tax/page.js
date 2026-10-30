import ProductPage from "../../_components/ProductPage";
export const metadata = { title: "VAT & KRA compliance", description: "Reconcile ERP sales and purchase registers against KRA's auto-populated VAT return, prepare VAT3 sheet O, check eTIMS deductibility and track filing deadlines." };

export default function Page() {
  return (
    <ProductPage
      current="tax" eyebrow="KRA tax"
      title={<>Know your VAT position <em>before KRA does.</em></>}
      lede="Variaq reconciles your ERP registers against KRA's auto-populated VAT return, shows exactly which invoices disagree and why, and prepares the schedules you need for iTax."
      problems={[
        ["eTIMS vs ERP gaps", "Sales on eTIMS that never reached the ERP, or ERP invoices that were never transmitted, only surface during a KRA review."],
        ["Blocked input VAT", "Purchases missing from eTIMS or older than six months quietly reduce claimable input tax."],
        ["Deadline pressure", "Filing dates move with weekends and public holidays, and penalties and interest add up fast."],
      ]}
      steps={[
        ["Download from iTax", "Export the auto-populated return (Sections B and F CSVs) from iTax — there is no public KRA API for this data."],
        ["Upload with your registers", "Import your ERP sales and purchase registers through the Data hub."],
        ["Run the four-pass matcher", "Variaq matches invoices and flags every mismatch with its reason."],
        ["Fix, export, file", "Resolve findings, export iTax-format Sections B, F and L, and review VAT3 sheet O before you file in iTax yourself."],
      ]}
      capabilities={[
        ["VAT reconciliation", "Flags unrecorded revenue, untransmitted sales, purchases not on eTIMS, stale input VAT, amount/VAT/PIN mismatches, invalid PINs, wrong rates, duplicates, orphan credit notes and withholding VAT ≠ 2%."],
        ["VAT3 sheet O", "Computes rows 13–28 and cross-checks VAT control accounts and revenue in the ledger."],
        ["eTIMS deductibility", "Estimates expenses without eTIMS support that may be non-deductible under ITA s.16(1)(c) (Finance Act 2023)."],
        ["Tax centre", "KRA profile with the PIN stored encrypted, filing calendar with weekend and holiday roll-forward, and a penalty and interest estimator."],
        ["Configurable tax codes", "VAT, withholding tax, PAYE, NSSF, SHIF and Housing Levy mappings, each with its source and a verified flag."],
        ["KRA Tax agent", "Ask about the period's VAT status or queue a tax reconciliation summary that's saved as an artifact."],
      ]}
      note="Variaq doesn't file returns or connect to KRA systems directly. Rates and deadlines list their sources; items that couldn't be confirmed from a KRA source are marked unverified. Have a qualified Kenyan tax adviser confirm them for your business."
    />
  );
}
