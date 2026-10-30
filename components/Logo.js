// Variaq wordmark (placeholder until the final logo file is supplied).
// To swap in the real logo: put it in /public (e.g. /public/logo.svg) and render an <img> here.
export default function Logo({ size = 22, withText = true }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.4), color: "var(--text)", textDecoration: "none" }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <rect x="8" y="17" width="4" height="7" rx="1.2" fill="var(--accent-contrast)" />
        <rect x="14" y="12" width="4" height="12" rx="1.2" fill="var(--accent-contrast)" />
        <rect x="20" y="8" width="4" height="16" rx="1.2" fill="var(--accent-contrast)" />
      </svg>
      {withText && <span style={{ fontFamily: "var(--display)", fontSize: size * 0.95, letterSpacing: "-.01em", lineHeight: 1 }}>Variaq</span>}
    </span>
  );
}
