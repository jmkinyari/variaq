"use client";
import { useFormState, useFormStatus } from "react-dom";
import { sendContact } from "./actions";

const TOPICS = [["demo", "Request a demo"], ["sales", "Pricing & billing"], ["security", "Security review"], ["partner", "Partnership"], ["support", "Support"], ["other", "Something else"]];
const PLANS = [["", "Not sure yet"], ["variaq", "Variaq — $40/month, 5 users included (+$5 per extra user)"]];

function Submit() { const { pending } = useFormStatus(); return <button className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send request"}</button>; }

export default function ContactForm({ topic = "demo", plan = "" }) {
  const [state, action] = useFormState(sendContact, {});
  if (state?.ok) return <div className="alert success">Thanks — your request has been received. We typically reply by email within one business day.</div>;
  return (
    <form action={action} className="card">
      {state?.error && <div className="alert error">{state.error}</div>}
      <div className="form-row">
        <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" required autoComplete="name" /></div>
        <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
      </div>
      <div className="field"><label htmlFor="company">Company (optional)</label><input id="company" name="company" autoComplete="organization" /></div>
      <div className="form-row">
        <div className="field"><label htmlFor="topic">I'm interested in</label>
          <select id="topic" name="topic" defaultValue={topic}>{TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="plan">Plan</label>
          <select id="plan" name="plan" defaultValue={plan}>{PLANS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      <div className="field"><label htmlFor="message">How can we help?</label><textarea id="message" name="message" required rows={6} placeholder="e.g. 8 users, 2 companies on Sage, 2 banks + M-Pesa, monthly board pack, VAT recon takes a week…" /></div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ display: "none" }} aria-hidden="true" />
      <Submit />
      <p className="faint small" style={{ margin: ".8rem 0 0" }}>We use these details only to reply to you.</p>
    </form>
  );
}
