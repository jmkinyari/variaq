"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Logo from "./Logo";

const ITEMS = [
  ["", "Overview"],
  ["/ai", "Variaq AI ✦"],
  ["section", "CFO"],
  ["/dashboard", "KPI dashboard"],
  ["/board-packs", "Board packs"],
  ["/budgets", "Budgets & variance"],
  ["/statements/cash-flow", "Cash flow forecast"],
  ["section", "Financial statements"],
  ["/statements/balance-sheet", "Balance sheet"],
  ["/statements/income-statement", "Income statement"],
  ["/statements/cash", "Cash & equivalents"],
  ["section", "Accounting"],
  ["/data", "Data hub (CSV / Excel)"],
  ["/ledger", "Ledger & journals"],
  ["/bank", "Bank accounts"],
  ["/reconciliations", "Reconciliations"],
  ["/close", "Month-end close"],
  ["/tasks", "Tasks & workload"],
  ["/reports", "Variance reports"],
  ["section", "Audit & control"],
  ["/journal-audit", "Journal audit"],
  ["/completeness", "Completeness tests"],
  ["/queries", "Auditor queries"],
  ["/coa", "Chart of accounts mapping"],
  ["section", "Tax (KRA)"],
  ["/tax", "Tax centre"],
  ["/tax/vat", "VAT reconciliation"],
  ["/tax/mappings", "Tax codes & accounts"],
  ["section", "Settings"],
  ["/integrations", "ERP integrations & API"],
  ["/team", "Team & roles"],
  ["/audit", "Audit log"],
  ["/settings", "Workspace & security"],
];

export default function Nav({ slug, wsName, userName, role, unread = 0, platformAdmin = false }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const base = `/app/${slug}`;
  // Longest matching prefix wins, so /tax/vat doesn't also highlight /tax.
  const active = ITEMS.filter(([h]) => h && h !== "section" && (path === base + h || path.startsWith(base + h + "/"))).sort((a, b) => b[0].length - a[0].length)[0]?.[0] ?? (path === base ? "" : null);
  return (
    <>
      <div className="mobile-top">
        <Link href={base} aria-label="Variaq"><Logo size={20} /></Link>
        <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Menu"}</button>
      </div>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link href="/app" className="brand" aria-label="Variaq"><Logo size={22} /></Link>
        <div className="ws"><strong style={{ color: "var(--text)" }}>{wsName}</strong><br />{userName} · {role.toLowerCase()}</div>
        <Link href={`${base}/tasks?view=mine`} className="btn sm ghost" style={{ marginBottom: 8, justifyContent: "flex-start" }}>My tasks{unread > 0 && <span className="badge bad" style={{ marginLeft: 6 }}>{unread}</span>}</Link>
        <nav className="nav" onClick={() => setOpen(false)}>
          {ITEMS.map(([href, label], i) => href === "section"
            ? <div className="section" key={i}>{label}</div>
            : <Link key={href} href={base + href} className={active === href ? "active" : ""}>{label}</Link>)}
        </nav>
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 12 }}>
          <Link href="/app" className="btn ghost sm">Switch workspace</Link>
          <Link href="/app/account" className="btn ghost sm">Account security</Link>
          {platformAdmin && <Link href="/admin" className="btn ghost sm">Variaq admin</Link>}
          <form action="/logout" method="post"><button className="btn ghost sm">Sign out</button></form>
        </div>
      </aside>
    </>
  );
}
