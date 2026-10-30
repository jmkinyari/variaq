import Link from "next/link";
import { getUser } from "@/lib/auth";
import Logo from "@/components/Logo";
import SiteNav from "./_components/SiteNav";

const MOBILE = [["/product", "Platform"], ["/pricing", "Pricing"], ["/security", "Security"], ["/about", "About"], ["/faq", "FAQ"], ["/contact", "Contact"]];

const FOOTER = [
  ["Platform", [["/product", "Overview"], ["/product/close", "Close & reconciliations"], ["/product/tax", "VAT & KRA"], ["/product/audit", "Journal audit"], ["/product/reporting", "CFO reporting"], ["/product/ai", "AI specialists"]]],
  ["Get started", [["/pricing", "Pricing"], ["/signup", "Create your workspace"], ["/security", "Security"], ["/contact?topic=demo", "Book a demo"]]],
  ["Company", [["/about", "About"], ["/faq", "FAQ"], ["/contact", "Contact"], ["/legal/privacy", "Privacy (draft)"], ["/legal/terms", "Terms (draft)"], ["/hosting", "Operations (internal)"]]],
];

export default async function SiteLayout({ children }) {
  const user = await getUser();
  return (
    <div className="site">
      <div className="site-header"><header className="container site-nav">
        <Link href="/" aria-label="Variaq home"><Logo size={24} /></Link>
        <nav>
          <SiteNav />
          {user ? <Link href="/app" className="btn primary sm">Open app</Link> : <>
            <Link href="/login">Sign in</Link>
            <Link href="/signup" className="btn primary sm">Get started</Link>
          </>}
          <details className="site-menu">
            <summary aria-label="Menu">Menu</summary>
            <div className="site-menu-panel">
              {MOBILE.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
            </div>
          </details>
        </nav>
      </header></div>
      <main>{children}</main>
      <footer className="footer">
        <div className="container footer-grid">
          <div>
            <Logo size={20} />
            <div style={{ marginTop: ".5rem", maxWidth: 280 }}>Accounting operations for finance teams in Kenya. Turn numbers into decisions.</div>
            <div className="row" style={{ marginTop: "1rem" }}>
              <Link href="/signup" className="btn primary sm">Get started</Link>
              <Link href="/login" className="btn sm">Sign in</Link>
            </div>
          </div>
          {FOOTER.map(([h, links]) => (
            <div key={h}>
              <div className="footer-h">{h}</div>
              {links.map(([href, label]) => <div key={href}><Link href={href}>{label}</Link></div>)}
            </div>
          ))}
        </div>
        <div className="container faint small" style={{ marginTop: "1.5rem" }}>© {new Date().getFullYear()} Variaq · Nairobi, Kenya — Turn numbers into decisions. Prices are in USD; local taxes may apply.</div>
      </footer>
    </div>
  );
}
