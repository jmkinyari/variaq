"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [["/admin", "Overview"], ["/admin/ai", "AI service"], ["/admin/companies", "Companies"], ["/admin/leads", "Leads"], ["/admin/audit", "Admin log"]];

export default function AdminTabs() {
  const path = usePathname();
  return (
    <nav className="tabs" style={{ marginBottom: "1.4rem" }}>
      {TABS.map(([href, label]) => <Link key={href} href={href} className={(href === "/admin" ? path === href : path.startsWith(href)) ? "active" : ""}>{label}</Link>)}
    </nav>
  );
}
