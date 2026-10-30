import Link from "next/link";
import Logo from "@/components/Logo";
import AdminTabs from "./AdminTabs";
import { requirePlatformAdmin } from "@/lib/auth";
import "@/styles/ai.css";
export const metadata = { title: { default: "Variaq admin", template: "%s · Variaq admin" }, robots: { index: false } };

export default async function AdminLayout({ children }) {
  const user = await requirePlatformAdmin();
  return (
    <div className="container" style={{ maxWidth: 1180, padding: "28px 20px 60px" }}>
      <div className="row between" style={{ marginBottom: "1rem" }}>
        <div className="row"><Link href="/admin" aria-label="Variaq admin"><Logo size={22} /></Link><span className="badge accent">System administration</span></div>
        <div className="row small muted"><span>{user.email}</span><Link href="/app" className="btn sm">Workspaces</Link><form action="/logout" method="post"><button className="btn sm">Sign out</button></form></div>
      </div>
      <AdminTabs />
      {children}
    </div>
  );
}
