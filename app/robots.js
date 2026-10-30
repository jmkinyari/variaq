export default function robots() {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api", "/r/", "/legal/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
