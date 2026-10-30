"use client";
export default function Error({ error, reset }) {
  return <div className="auth"><div className="card"><h2>Something went wrong</h2><p className="muted">{error?.message || "Unexpected error."}</p><button className="btn primary" onClick={() => reset()}>Try again</button></div></div>;
}
