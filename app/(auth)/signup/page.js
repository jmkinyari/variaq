import Link from "next/link";
import Logo from "@/components/Logo";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { signup } from "../actions";
import { getUser } from "@/lib/auth";
export const metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }) {
  if (await getUser()) redirect(searchParams.next || "/app");
  return (
    <div className="auth"><div className="card">
      <Link href="/" aria-label="Variaq home"><Logo size={24} /></Link>
      <h2 style={{ marginTop: "1.2rem" }}>Create your account</h2>
      <p className="muted">You'll set up your company workspace next.</p>
      <AuthForm mode="signup" action={signup} next={searchParams.next} email={searchParams.email} />
    </div></div>
  );
}
