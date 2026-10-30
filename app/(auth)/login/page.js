import Link from "next/link";
import Logo from "@/components/Logo";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { login } from "../actions";
import { getUser } from "@/lib/auth";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }) {
  if (await getUser()) redirect(searchParams.next || "/app");
  return (
    <div className="auth"><div className="card">
      <Link href="/" aria-label="Variaq home"><Logo size={24} /></Link>
      <h2 style={{ marginTop: "1.2rem" }}>Welcome back</h2>
      <AuthForm mode="login" action={login} next={searchParams.next} />
    </div></div>
  );
}
