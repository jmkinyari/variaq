"use client";
import { useFormState, useFormStatus } from "react-dom";
import { verifyMfa } from "../actions";

function Btn() { const { pending } = useFormStatus(); return <button className="btn primary" style={{ width: "100%" }} disabled={pending}>{pending ? "Checking…" : "Verify"}</button>; }

export default function MfaForm({ next }) {
  const [state, action] = useFormState(verifyMfa, {});
  return (
    <form action={action}>
      {state?.error && <div className="alert error">{state.error}</div>}
      <input type="hidden" name="next" value={next || ""} />
      <div className="field"><label htmlFor="code">Code</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={20} /></div>
      <Btn />
    </form>
  );
}
