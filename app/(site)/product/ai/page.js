import Link from "next/link";
import ProductPage from "../../_components/ProductPage";
import { AGENTS } from "../../_components/content";
export const metadata = { title: "AI specialists", description: "Five specialist finance AI agents — CFO Reporting, Budget Forecast, Month-End Close, Journal Audit and KRA Tax — embedded in the Variaq workspace with consent, read-only tools and human approval." };

export default function Page() {
  return (
    <ProductPage
      current="ai" eyebrow="Variaq AI"
      title={<>Specialist help, <em>inside your workspace.</em></>}
      lede="Variaq AI isn't a separate chatbot. It's five finance specialists embedded in the app: ask from any page, get answers grounded in your own figures, and run heavy work in the background."
      problems={[
        ["Generic chatbots", "General-purpose AI doesn't know your ledger, your close status or your VAT position — and copying data into it is a risk."],
        ["Reports take days", "Drafting management commentary, audit packs and tax summaries eats the time you need for review."],
        ["Uncontrolled AI", "Tools that act on their own create entries nobody approved."],
      ]}
      steps={[
        ["Ask in context", "Open the assistant on any page (or Ctrl+J). Auto routing picks the specialist from the page you're on — Tax centre → KRA Tax, Close → Month-End Close — or from your question."],
        ["Grounded answers", "The specialist reads your company data only through read-only tools scoped to your workspace, and answers with the figures it used."],
        ["Background jobs", "Board packs, audit packs, tax recon summaries and forecasts queue as background jobs; you see live status and get a link when they finish."],
        ["Saved artifacts", "Results are saved back into the workspace as artifacts and reports — encrypted with your company's key and shareable by revocable link."],
      ]}
      aside={
        <div className="agent-list">
          {AGENTS.map(([n, d]) => <div className="agent-row" key={n}><strong>{n}</strong><span className="muted small">{d}</span></div>)}
          <p className="faint small" style={{ margin: ".4rem 0 0" }}>Plus "Auto" — the coordinator that routes each question to the right specialist.</p>
        </div>
      }
      capabilities={[
        ["Two consent gates", "AI runs only when Variaq has enabled it for your company (with a monthly allowance) and your company owner has consented. Otherwise nothing is sent to the model."],
        ["Propose, never approve", "Agents can propose tasks and reports; a person clicks Create or Generate. They can't post, approve or delete anything."],
        ["Prompt-injection defences", "Tool results are labelled as data, and the model is told never to follow instructions found in narrations or other records."],
        ["Safe report output", "AI-generated HTML passes an allow-list sanitiser and is displayed in a sandboxed frame with a strict CSP."],
        ["Deep links", "Module pages carry \"Ask [Specialist]\" buttons that open the right agent with the period already set."],
        ["API access", "Scoped API keys (agents:read, agents:run) let other systems chat with a specialist or queue jobs and fetch artifacts."],
      ]}
      note={<>AI features use a third-party large-language-model provider (Anthropic) configured by Variaq administrators. Conversations and reports are stored encrypted with your company's key; usage is metered and rate-limited. See <Link href="/security">Security</Link> for details.</>}
    />
  );
}
