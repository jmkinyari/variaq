"use client";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";

function Submit({ label }) { const { pending } = useFormStatus(); return <button className="btn primary" style={{ width: "100%" }} disabled={pending}>{pending ? "Please wait…" : label}</button>; }

export default function AuthForm({ mode, action, next, email }) {
  const [state, formAction] = useFormState(action, {});
  const signup = mode === "signup";
  return (
    <form action={formAction}>
      {state?.error && <div className="alert error">{state.error}</div>}
      <input type="hidden" name="next" value={next || ""} />
      {signup && <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" autoComplete="name" required /></div>}
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" defaultValue={email || ""} required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 12 : undefined} maxLength={200} required />{signup && <div className="help">At least 12 characters. A short phrase works well.</div>}</div>
      <Submit label={signup ? "Create account" : "Sign in"} />
      <p className="muted small" style={{ marginTop: "1rem", textAlign: "center" }}>
        {signup ? <>Already have an account? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link></> : <>New to Variaq? <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link></>}
      </p>
    </form>
  );
}
