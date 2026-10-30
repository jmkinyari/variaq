import { redirect } from "next/navigation";
// Redirect back to a page with a one-off message in the URL (?ok= / ?err=).
export function back(path, { ok, err } = {}) {
  const q = new URLSearchParams();
  if (ok) q.set("ok", ok);
  if (err) q.set("err", err);
  const s = q.toString();
  redirect(s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path);
}
