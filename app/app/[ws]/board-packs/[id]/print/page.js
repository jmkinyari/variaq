import Link from "next/link";
import { notFound } from "next/navigation";
import "@/styles/planning.css";
import { requireWorkspace, audit } from "@/lib/auth";
import { loadPackView } from "@/lib/boardpack/load";
import PackView from "../../PackView";
import PrintButton from "./PrintButton";
export const metadata = { title: "Board pack — print" };
export const dynamic = "force-dynamic";

export default async function PrintPack({ params }) {
  const { ws, user } = await requireWorkspace(params.ws);
  const pack = await loadPackView(ws.id, params.id);
  if (!pack) notFound();
  await audit(ws.id, user.id, "boardpack.printed", "board_pack", pack.id, { status: pack.status });
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="row between no-print" style={{ marginBottom: "1rem" }}>
        <Link className="btn sm" href={`/app/${ws.slug}/board-packs/${pack.id}`}>← Back to editor</Link>
        <div className="row"><span className="small muted">Use your browser&apos;s print dialog and choose “Save as PDF”. A4, portrait.</span><PrintButton /></div>
      </div>
      {pack.status !== "APPROVED" && <div className="alert warn">Draft — not yet approved.</div>}
      <PackView pack={pack} />
    </div>
  );
}
