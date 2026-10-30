import "server-only";
// Single-prompt AI helpers used by older features (variance commentary, reconciliation hints,
// board-pack drafts). They go through the platform AI service, so they respect the Variaq-managed
// key, the company's entitlement and consent, monthly allowances and usage metering.
// Output is always labelled as AI-generated and needs human review.
import { aiStatus } from "./ai/config";
import { askOnce } from "./ai/assistant";

export async function aiAvailable(ws) { return (await aiStatus(ws.id)).ok; }
export async function aiUnavailableReason(ws) { return (await aiStatus(ws.id)).reason || null; }

export async function askClaude(system, prompt, { ws, user, feature = "ASSIST", maxTokens = 2000 } = {}) {
  if (!ws) throw new Error("askClaude needs the workspace.");
  return askOnce({ ws, user, feature, system, prompt, maxTokens });
}
