import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import MfaForm from "./MfaForm";
import { getPendingMfaUser } from "@/lib/auth";
export const metadata = { title: "Two-step verification" };

export default async function MfaPage({ searchParams }) {
  const pending = await getPendingMfaUser();
  if (!pending) redirect("/login");
  return (
    <div className="auth"><div className="card">
      <Link href="/" aria-label="Variaq home"><Logo size={24} /></Link>
      <h2 style={{ marginTop: "1.2rem" }}>Two-step verification</h2>
      <p className="muted">Enter the 6-digit code from your authenticator app for <strong>{pending.email}</strong>, or one of your recovery codes.</p>
      <MfaForm next={searchParams.next} />
      <form action="/logout" method="post" style={{ marginTop: "1rem", textAlign: "center" }}><button className="btn ghost sm">Cancel and sign out</button></form>
    </div></div>
  );
}
