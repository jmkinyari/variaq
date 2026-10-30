// Number formatting shared by server pages and the client chart components (no "use client" here,
// so server components can call these directly).
export function fmtCompact(v, unit = "money") {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (unit === "pct") return `${Math.round(v * 10) / 10}%`;
  if (unit === "x") return `${v.toFixed(2)}×`;
  if (unit === "days") return `${Math.round(v)} d`;
  if (unit === "months") return `${v} mo`;
  const n = v / 100, a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : `${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
}
export function fmtFull(v, unit = "money") {
  if (v === null || v === undefined) return "—";
  if (unit !== "money") return fmtCompact(v, unit);
  const r = Math.round(v / 100);
  return r < 0 ? `(${Math.abs(r).toLocaleString("en-KE")})` : r.toLocaleString("en-KE");
}
