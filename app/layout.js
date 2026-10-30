import "./globals.css";
import "@/styles/mobile.css";
import PwaSupport from "@/components/PwaSupport";

export const metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "Variaq — Accounting operations for finance teams in Kenya", template: "%s · Variaq" },
  description: "Variaq brings ledger imports, bank reconciliation, month-end close, audit, budgeting, KRA tax and AI-assisted reporting into one reviewable workflow for finance teams in Kenya.",
  applicationName: "Variaq",
  appleWebApp: { capable: true, title: "Variaq", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  openGraph: {
    title: "Variaq — Accounting operations for finance teams in Kenya",
    description: "Import your ledger, reconcile bank statements, review exceptions with an audit trail, and explain month-on-month changes.",
    siteName: "Variaq", type: "website", locale: "en_KE",
  },
  twitter: { card: "summary_large_image", title: "Variaq", description: "Accounting operations software for finance teams in Kenya." },
};
export const viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f8f6f3" }, { media: "(prefers-color-scheme: dark)", color: "#211d24" }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}<PwaSupport /></body>
    </html>
  );
}
