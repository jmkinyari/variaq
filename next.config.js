/** @type {import('next').NextConfig} */
const prod = process.env.NODE_ENV === "production";

// Content-Security-Policy: no third-party scripts, no framing, no plugins. Next.js needs
// 'unsafe-inline' for its bootstrap scripts without a nonce; 'unsafe-eval' only in development.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${prod ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Only when served over HTTPS: on a plain-HTTP host it would rewrite frames/workers to https and break them.
  ...(prod && /^https:/.test(process.env.APP_URL || "") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client", "libsql", "@libsql/core", "@libsql/hrana-client", "@libsql/isomorphic-ws", "@libsql/isomorphic-fetch", "bcryptjs"],
    serverActions: { bodySizeLimit: "25mb", allowedOrigins: process.env.APP_URL ? [new URL(process.env.APP_URL).host] : undefined },
    instrumentationHook: true,
  },
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/app/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // AI report HTML: no scripts or external loads at all; framable only by our own viewer page.
      ...["/app/:ws/ai/reports/:id/raw", "/r/:token"].map((source) => ({ source, headers: [
        // The route handler sets the exact frame-ancestors; this replaces the app-wide policy for these paths.
        { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; base-uri 'none'; form-action 'none'" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ] })),
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};
module.exports = nextConfig;
