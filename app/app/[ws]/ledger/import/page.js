import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import ImportWizard from "@/components/ImportWizard";
import { importLedger } from "../actions";
export const metadata = { title: "Import ledger" };

export default async function ImportLedgerPage({ params }) {
  const { ws } = await requireWorkspace(params.ws, "MEMBER");
  return (
    <>
      <PageHead title="Import ledger" crumbs={<Link href={`/app/${ws.slug}/ledger`}>Ledger</Link>}
        desc="Upload a general-ledger CSV export from your accounting system. Nothing is saved until you've reviewed the validation." />
      <ImportWizard kind="ledger" currency={ws.currency} onImport={importLedger.bind(null, ws.slug)} />
      <div className="panel small muted" style={{ marginTop: "1.5rem" }}>
        <strong>Tips.</strong> Export the journal or general ledger detail report with one row per line. Each row needs a date, description, account code and either a signed amount or debit/credit. Rows already in this workspace (same date, account, amount, reference and description) are skipped automatically. Need a sample? Download <a href="/samples/ledger-sample.csv">ledger-sample.csv</a>.
      </div>
    </>
  );
}
