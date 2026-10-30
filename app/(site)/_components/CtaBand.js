import Link from "next/link";

/** Closing call-to-action band used on every marketing page. */
export default function CtaBand({ title = <>Put your finance team <em>back in the picture.</em></>, text = "Create a workspace in minutes, or let us walk you through Variaq with demo data." }) {
  return (
    <section className="section">
      <div className="container cta-band">
        <h2>{title}</h2>
        <p className="lede" style={{ margin: "0 auto" }}>{text}</p>
        <div className="row" style={{ justifyContent: "center", marginTop: "1.5rem" }}>
          <Link href="/signup" className="btn primary">Create your workspace</Link>
          <Link href="/contact?topic=demo" className="btn">Book a demo</Link>
        </div>
      </div>
    </section>
  );
}
