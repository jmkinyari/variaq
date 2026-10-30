import Link from "next/link";
export default function NotFound() {
  return <div className="auth"><div className="card" style={{ textAlign: "center" }}><h2>Page not found</h2><p className="muted">It may have moved, or you may not have access to it.</p><Link href="/app" className="btn primary">Go to your workspaces</Link></div></div>;
}
