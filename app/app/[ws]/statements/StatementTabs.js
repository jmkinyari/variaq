"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["balance-sheet", "Balance sheet"],
  ["income-statement", "Income statement"],
  ["cash", "Cash & cash equivalents"],
  ["cash-flow", "Cash flow forecast"],
  ["accounts", "Account mapping"],
];

export default function StatementTabs({ base }) {
  const path = usePathname();
  return (
    <div className="tabs no-print" role="tablist" style={{ marginBottom: "1.25rem" }}>
      {TABS.map(([href, label]) => (
        <Link key={href} href={`${base}/${href}`} role="tab" aria-selected={path === `${base}/${href}`} className={path === `${base}/${href}` ? "active" : ""}>{label}</Link>
      ))}
    </div>
  );
}
