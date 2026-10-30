"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [["/product", "Platform"], ["/pricing", "Pricing"], ["/security", "Security"], ["/about", "About"], ["/faq", "FAQ"], ["/contact", "Contact"]];

/** Primary marketing links with active state. Collapses on small screens (see .site-menu in globals.css). */
export default function SiteNav() {
  const path = usePathname() || "/";
  return (
    <>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={`hide-sm${path === href || path.startsWith(href + "/") ? " active" : ""}`}>{label}</Link>
      ))}
    </>
  );
}
