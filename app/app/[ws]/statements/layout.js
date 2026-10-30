import StatementTabs from "./StatementTabs";
import { requireWorkspace } from "@/lib/auth";

export default async function StatementsLayout({ children, params }) {
  const { ws } = await requireWorkspace(params.ws);
  return (
    <>
      <StatementTabs base={`/app/${ws.slug}/statements`} />
      {children}
    </>
  );
}
