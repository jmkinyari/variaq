import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import ImportWizard from "@/components/ImportWizard";
import { importStatement } from "../../actions";
export const metadata = { title: "Import bank statement" };

export default async function ImportStatementPage({ params }) {
  const { ws } = await requireWorkspace(params.ws, "MEMBER");
  const acct = await db.get("SELECT * FROM bank_accounts WHERE id = ? AND workspace_id = ?", [params.accountId, ws.id]);
  if (!acct) notFound();
  return (
    <>
      <PageHead title={`Import statement — ${acct.name}`} crumbs={<Link href={`/app/${ws.slug}/bank`}>Bank accounts</Link>}
        desc="Upload the bank or M-Pesa statement as CSV. The statement period is taken from the transaction dates." />
      <ImportWizard kind="bank" currency={acct.currency} onImport={importStatement.bind(null, ws.slug)} extra={{ bankAccountId: acct.id }} />
      <div className="panel small muted" style={{ marginTop: "1.5rem" }}>Need a sample? Download <a href="/samples/bank-statement-sample.csv">bank-statement-sample.csv</a>.</div>
    </>
  );
}
