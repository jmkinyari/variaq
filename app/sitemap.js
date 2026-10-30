// Public marketing pages only (app, admin and API routes are private).
const PATHS = ["/", "/product", "/product/close", "/product/tax", "/product/audit", "/product/reporting", "/product/ai", "/pricing", "/security", "/about", "/faq", "/contact"];

export default function sitemap() {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return PATHS.map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly", priority: p === "/" ? 1 : 0.7 }));
}
