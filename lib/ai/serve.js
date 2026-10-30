// Serving stored AI reports: strict headers so even a sanitiser miss can't run script or load anything.
import "server-only";
import { NextResponse } from "next/server";

// No scripts, no network, no forms. (No CSP `sandbox` directive: it would give the document an opaque
// origin and break framing by our own viewer, which already applies <iframe sandbox="">.)
const reportCsp = (ancestors) => `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'none'`;

export function htmlResponse(html, { download, fileName, frameable = true, origin } = {}) {
  const res = new NextResponse(html, { status: 200, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": reportCsp(frameable ? (origin || "'self'") : "'none'"),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  } });
  if (download) res.headers.set("Content-Disposition", `attachment; filename="${String(fileName || "report").replace(/[^\w.-]+/g, "_").slice(0, 80)}.html"`);
  // Override the app-wide X-Frame-Options DENY so the report can render inside our own page.
  res.headers.set("X-Frame-Options", frameable ? "SAMEORIGIN" : "DENY");
  return res;
}
