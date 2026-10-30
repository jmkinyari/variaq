import Link from "next/link";
import CtaBand from "./CtaBand";
import { MODULES } from "./content";

/**
 * Shared layout for /product/* pages: problem → how Variaq helps → capabilities → CTA.
 * props: eyebrow, title (node), lede, problems [[t,d]], steps [[t,d]], capabilities [[t,d]], note, current (slug)
 */
export default function ProductPage({ eyebrow, title, lede, problems = [], steps = [], capabilities = [], note, current, aside }) {
  return (
    <>
      <section className="container page-hero">
        <div className="crumbs"><Link href="/product">Platform</Link> / {eyebrow}</div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        <div className="row" style={{ marginTop: "1.5rem" }}>
          <Link href="/signup" className="btn primary">Try it with your data</Link>
          <Link href="/contact?topic=demo" className="btn">Book a demo</Link>
        </div>
      </section>

      {problems.length > 0 && (
        <section className="section alt">
          <div className="container">
            <div className="eyebrow">The problem</div>
            <h2>What slows finance teams down</h2>
            <div className="grid grid-3" style={{ marginTop: "1.5rem" }}>
              {problems.map(([t, d]) => <div className="card flat" key={t}><h3>{t}</h3><p className="muted" style={{ margin: 0 }}>{d}</p></div>)}
            </div>
          </div>
        </section>
      )}

      {steps.length > 0 && (
        <section className="section">
          <div className="container grid grid-2" style={{ gap: "48px", alignItems: "start" }}>
            <div>
              <div className="eyebrow">How Variaq helps</div>
              <h2>A workflow you can <em>review.</em></h2>
              <ol className="steps">
                {steps.map(([t, d]) => <li key={t}><strong>{t}</strong><span className="muted">{d}</span></li>)}
              </ol>
            </div>
            {aside || null}
          </div>
        </section>
      )}

      {capabilities.length > 0 && (
        <section className="section alt">
          <div className="container">
            <div className="eyebrow">Key capabilities</div>
            <h2>What's in the box</h2>
            <div className="grid grid-3" style={{ marginTop: "1.5rem" }}>
              {capabilities.map(([t, d], i) => (
                <div className="card flat" key={t}>
                  <div className="feature-num">{String(i + 1).padStart(2, "0")}</div>
                  <h3>{t}</h3><p className="muted" style={{ margin: 0 }}>{d}</p>
                </div>
              ))}
            </div>
            {note && <p className="faint small" style={{ marginTop: "1.5rem", maxWidth: 760 }}>{note}</p>}
          </div>
        </section>
      )}

      <section className="section">
        <div className="container">
          <div className="eyebrow">More of the platform</div>
          <div className="module-strip">
            {MODULES.filter((m) => m.slug !== current).map((m) => (
              <Link key={m.slug} href={m.href} className="module-tile">
                <span className="eyebrow" style={{ marginBottom: ".3rem" }}>{m.eyebrow}</span>
                <strong>{m.title}</strong>
                <span className="arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
