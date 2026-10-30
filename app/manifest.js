// Web app manifest: lets Variaq be installed on Android, iOS, Windows and macOS like a native app.
export default function manifest() {
  return {
    name: "Variaq — finance operations",
    short_name: "Variaq",
    description: "CFO reporting, reconciliations, audit, budgeting, KRA tax and AI for finance teams.",
    id: "/app",
    start_url: "/app?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#f8f6f3",
    theme_color: "#70556f",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Workspaces", url: "/app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Account security", url: "/app/account", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
