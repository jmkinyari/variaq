"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createWorkspace } from "@/lib/workspace";
import { back } from "@/lib/flash";

export async function createWorkspaceAction(formData) {
  const user = await requireUser();
  const name = String(formData.get("name") || "").trim();
  if (!name) back("/app", { err: "Give your workspace a name." });
  if (name.length > 80) back("/app", { err: "Keep the name under 80 characters." });
  const { slug } = await createWorkspace({
    name,
    country: "KE",
    currency: String(formData.get("currency") || "KES").toUpperCase().slice(0, 3),
    industry: String(formData.get("industry") || "") || null,
    ownerId: user.id,
  });
  redirect(`/app/${slug}`);
}
