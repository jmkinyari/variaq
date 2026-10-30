import Link from "next/link";
import { notFound } from "next/navigation";
import "@/styles/planning.css";
import { requireWorkspace, can, canEdit } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { loadPackView } from "@/lib/boardpack/load";
import { aiAvailable } from "@/lib/ai";
import { formatDateTime } from "@/lib/dates";
import PackView from "../PackView";
import { changePackStatus, refreshSnapshot, deletePack } from "../actions";
export const metadata = { title: "Board pack" };
export const dynamic = "force-dynamic";

const STATUS = { DRAFT: ["Draft", ""], IN_REVIEW: ["In review", "warn"], APPROVED: ["Approved", "good"] };

export default async function PackPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const pack = await loadPackView(ws.id, params.id);
  if (!pack) notFound();
  const base = `/app/${ws.slug}`;
  const editable = canEdit(ws.role) && pack.status !== "APPROVED";
  const [l, t] = STATUS[pack.status] || [pack.status, ""];
  const F = ({ action, cls = "btn sm", children, confirm }) => <form action={changePackStatus}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={pack.id} /><input type="hidden" name="action" value={action} /><Submit className={cls} confirm={confirm}>{children}</Submit></form>;
  return (
    <>
      <PageHead title={pack.title} crumbs={<Link href={`${base}/board-packs`}>Board packs</Link>}
        desc={`${pack.period} · numbers as at ${formatDateTime(pack.snapshot?.generatedAt)} · prepared by ${pack.created_by_name}${pack.budget_name ? ` · budget: ${pack.budget_name}` : ""}${pack.approved_by_name ? ` · approved by ${pack.approved_by_name} ${formatDateTime(pack.approved_at)}` : ""}`}>
        <span className={`badge ${t}`}>{l}</span>
      </PageHead>
      <Flash searchParams={searchParams} />
      <div className="row between bp-toolbar no-print" style={{ marginBottom: "1rem" }}>
        <div className="row">
          <Link className="btn sm primary" href={`${base}/board-packs/${pack.id}/print`}>Print / save as PDF</Link>
          {pack.status === "DRAFT" && canEdit(ws.role) && <form action={refreshSnapshot}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={pack.id} /><Submit className="btn sm">Refresh numbers</Submit></form>}
        </div>
        <div className="row">
          {pack.status === "DRAFT" && canEdit(ws.role) && <F action="submit" cls="btn sm primary" confirm="Send for review? Numbers will be frozen.">Send for review</F>}
          {pack.status === "IN_REVIEW" && can(ws.role, "approve") && <><F action="approve" cls="btn sm primary" confirm="Approve this board pack?">Approve</F><F action="reject">Return to draft</F></>}
          {pack.status === "APPROVED" && can(ws.role, "approve") && <F action="reject" confirm="Re-open this approved pack?">Re-open</F>}
          {can(ws.role, "admin") && <form action={deletePack}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={pack.id} /><Submit className="btn sm danger" confirm="Delete this board pack?">Delete</Submit></form>}
        </div>
      </div>
      {pack.status === "IN_REVIEW" && <div className="alert info">Numbers are frozen while the pack is in review. Commentary can still be edited until it&apos;s approved.</div>}
      <PackView pack={pack} editable={editable} slug={ws.slug} aiOn={await aiAvailable(ws)} />
    </>
  );
}
