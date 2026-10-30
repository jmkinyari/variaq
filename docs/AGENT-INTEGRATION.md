# Project Variaq — specialist agent integration

## Changelog (2026-10-30)

**New files**
- `lib/ai/agents.js` — specialist registry + coordinator router (`AGENTS`, `resolveAgent`, `listAgents`, `toolsFor`, `getAgent`, `JOB_TYPES`, `agentForJobType`). Pure CommonJS, no DB, so the worker and tests can load it.
- `lib/ai/deep-links.js` — client-safe `agentHref(slug, agentId, { period, entity, q })`, `periodBounds()`, `AGENT_IDS`, `AGENT_NAMES`.
- `lib/ai/agent-jobs.js` (server-only) — `buildAgentPayload`, `enqueueAgentJob`, `getAgentJob`, `listAgentJobs`, `listArtifacts`.
- `lib/ai/api-actor.js` (server-only) — resolves the REST API actor (key creator) + JSON body parsing.
- `app/api/v1/agents/route.js` — `GET` list specialists.
- `app/api/v1/agents/chat/route.js` — `POST` chat with a specialist.
- `app/api/v1/agents/jobs/route.js` — `POST` queue a job, `GET` recent agent jobs.
- `app/api/v1/agents/jobs/[id]/route.js` — `GET` job status/result + artifact.
- `app/api/v1/agents/artifacts/route.js` — `GET` artifacts.
- `app/app/[ws]/ai/artifacts/[id]/page.js` — artifact detail (redirects to the linked report when there is one).
- `tests/agents.test.js` — routing, tool subsets, deep links (node:test).
- `docs/AGENT-INTEGRATION.md` — this document.

**Modified files**
- `lib/ai/assistant.js` — `askAssistant` accepts `agentId`, `period`, `entityId`; specialist system prompt, filtered tools, context note, report-template bias, `agent_id` persisted; returns `agent`. New `runAgentJob`, `runAgentJobFromPayload`, `artifactPayload`; registers `globalThis.__variaqAgentRunner`.
- `lib/migrations/ai.js` — migration `ai_002_agents`: `ai_conversations.agent_id`, table `ai_artifacts` + indexes.
- `lib/jobs.js` — handlers `agent.cfo_report`, `agent.budget_forecast`, `agent.month_end_close`, `agent.journal_audit`, `agent.kra_tax`; `claim()` skips `agent.*` jobs in processes without the runner; `fail()` honours `err.permanent` (no retry).
- `lib/api.js` — new API key scopes `agents:read`, `agents:run` (appear automatically in Integrations → API keys).
- `instrumentation.js` — loads the agent runner into the in-process worker at startup.
- `app/app/[ws]/ai/actions.js` — `ask` passes `agentId/period/entityId`; new `listAgentsAction`, `enqueueAgentTask`, `enqueueAgentTaskForm`, `getJobStatus`, `listAgentTasks`, `listArtifacts`; `listConversations` returns `agent_id`.
- `app/app/[ws]/ai/page.js` — passes agents to the chat; "Run a specialist in the background" form; Artifacts list; honours `?agent=&period=&entity=`.
- `app/app/[ws]/layout.js` — floating assistant receives `agents`, wrapped in `<Suspense>` (uses `useSearchParams`).
- `components/AiAssistant.js` — agent picker (Auto + 5), deep-link context chips, per-agent quick prompts, specialist badge on answers and history, "Generate full report in background" with live job status.
- `styles/ai.css` — `.ai-agents`, `.ai-agent-tab`, `.ai-context`, `.ai-chip`, `.ai-agent-badge`, `.ai-jobs`, `.ai-artifact-payload`.
- Module entry points ("Ask [Specialist]" buttons): `app/app/[ws]/tax/page.js`, `app/app/[ws]/tax/vat/page.js`, `app/app/[ws]/close/page.js`, `app/app/[ws]/journal-audit/page.js`, `app/app/[ws]/budgets/page.js`, `app/app/[ws]/board-packs/page.js`, `app/app/[ws]/dashboard/page.js`.

No new npm dependencies. No TypeScript.

## Architecture

```
            ┌───────────── Variaq Next.js app (workspace /app/[ws]) ─────────────┐
 module page ──"Ask KRA Tax"──▶ /app/[ws]/ai?agent=kra-tax&period=2026-04
 floating / inline AiAssistant ──ask(slug,{agentId,period,entityId,page})──▶ server action
                                                    │
                     resolveAgent (lib/ai/agents.js) ── coordinator "Project Variaq"
                                                    │
     askAssistant: CHAT_SYSTEM + specialist addendum, toolsFor(agent, TOOLS), context note
                                                    │
 "Generate in background" / API POST ─▶ enqueueAgentJob ─▶ jobs table (agent.*)
                                                    │
     worker (in web process) ─▶ runAgentJobFromPayload ─▶ generateReport / DB summary
                                                    │
                    ai_reports (sealed HTML) + ai_artifacts (sealed payload) ─▶ AI page / API
```

### 1. Registry (`lib/ai/agents.js`)
| id | name | page prefixes | default templates | job type | artifact kind |
|---|---|---|---|---|---|
| `cfo-reporting` | CFO Reporting | `/board-packs` `/dashboard` `/statements` `/reports` | MANAGEMENT, BOARD, CASH | `agent.cfo_report` | REPORT |
| `budget-forecast` | Budget Forecast | `/budgets` | BUDGET, CASH | `agent.budget_forecast` | FORECAST |
| `month-end-close` | Month-End Close | `/close` `/tasks` `/reconciliations` `/completeness` `/bank` | MANAGEMENT | `agent.month_end_close` | CLOSE_SUMMARY |
| `journal-audit` | Journal Audit | `/journal-audit` `/audit` `/queries` `/ledger` | AUDIT | `agent.journal_audit` | AUDIT_PACK |
| `kra-tax` | KRA Tax | `/tax` | TAX | `agent.kra_tax` | TAX_RECON |

Each agent has `system` (specialist addendum), `toolNames` (subset of the existing `TOOLS`; every agent keeps `get_company_overview`, `list_team`, `propose_task`, `propose_report`), `keywords`, and `quick` prompts for the UI. `listAgents()` returns the public fields only (no prompts or tool lists).

### 2. Routing — `resolveAgent({ agentId, path, message })`
1. Explicit `agentId` (not `"auto"`, must exist) → `routedBy: "explicit"`.
2. Page: `/app/<slug>` is stripped and the longest whole-segment prefix wins → `"page"`.
3. Keyword score over the message (longer keywords weigh more) → `"keywords"`.
4. Default `cfo-reporting` → `"default"`.
In chat, an "Auto" follow-up with no page context keeps the conversation's stored `agent_id`.

### 3. Assistant (`lib/ai/assistant.js`)
- The system prompt is the existing `CHAT_SYSTEM` plus the specialist role, a report-template bias (`defaultTemplates[0]`) and a "hand off to the right specialist" rule.
- Context note on the user turn: page title/path, period (YYYY-MM → first/last day), entity/reference.
- Tools are filtered with `toolsFor(agent, TOOLS)`. The tool loop, model calls, usage accounting and sealing are unchanged.
- `ai_conversations.agent_id` is set on insert and update; each display message stores `agent`.

### 4. Panel (`components/AiAssistant.js`)
- Tabs: **Auto** (coordinator) + CFO / Budget / Close / Audit / Tax.
- Reads `agent`, `period`, `entity`, `q` (prefill, inline only) and `askai=1` (opens the floating panel) via `useSearchParams`. Context shows as removable chips.
- Answers carry a specialist badge (with a "routed by" tooltip); history items show the agent.
- Heavy questions (report/pack/recon/forecast…) offer **Generate full report in background**; a specialist's empty state offers **Generate full … pack in background**. Job status polls every 4 s and links to the artifact or report.
- Floating and inline modes are both kept.

### 5. Server actions (`app/app/[ws]/ai/actions.js`)
`ask(slug, { conversationId, message, page, agentId, period, entityId })`, `listAgentsAction(slug)`, `enqueueAgentTask(slug, { agentId, kind, period | periodFrom/periodTo, entityId, title, instructions, template, withReport })` (rate limit `heavy` per workspace, dedupe key, audit event `ai.agent_job_queued`), `enqueueAgentTaskForm(formData)`, `getJobStatus(slug, jobId)`, `listAgentTasks(slug)`, `listArtifacts(slug, { agentId })`.

### 6. REST API (`/api/v1/agents/*`)
These use the same `handler(scope, fn)` auth, rate limiting, optional HMAC signing and `{ error: { code, message } }` shape as `/api/v1/journals`. Chat and jobs run **as the API key's creator**, who must still be a workspace member.

| Method | Path | Scope | Body / query |
|---|---|---|---|
| GET | `/api/v1/agents` | `agents:read` | — |
| POST | `/api/v1/agents/chat` | `agents:run` | `{ message, conversationId?, agentId?, period?, entityId?, page? }` |
| POST | `/api/v1/agents/jobs` | `agents:run` | `{ agentId, kind?, period? \| periodFrom/periodTo, entityId?, title?, instructions?, template? }` → `202` |
| GET | `/api/v1/agents/jobs?limit=` | `agents:read` | — |
| GET | `/api/v1/agents/jobs/:id` | `agents:read` | — |
| GET | `/api/v1/agents/artifacts?agent=&limit=` | `agents:read` | — |

### 7. Background jobs
- Payload: `{ workspaceId, userId, agentId, kind, periodFrom, periodTo, entityId, title, instructions, template, withReport }`.
- Dedupe key: `agent:<ws>:<agent>:<kind>:<from>:<to>:<entity>` while the job is QUEUED or RUNNING. `maxAttempts` is 2.
- `runAgentJobFromPayload` loads the workspace (with the user's membership role) and the user from the DB, because jobs have no session. Then `runAgentJob`:
  - writes a PENDING artifact (keyed by `job_id`, so retries update the same row);
  - captures structured data with the existing read-only tools: KPIs (CFO), budget vs actual (Budget), open findings + auditor queries (Audit), VAT status (Tax), or a checklist summary from SQL (Close);
  - **Month-End Close** without instructions saves the checklist summary only, with no AI call;
  - everything else calls `generateReport` with the agent's template, then marks the artifact READY and links `report_id`;
  - if AI is unavailable, the artifact is set to FAILED and the error is thrown with `permanent: true`, so it is not retried.
- **Worker split:** `lib/jobs.js` is CommonJS and is also loaded by the standalone `npm run worker`, which can't load server-only modules. The assistant module registers `globalThis.__variaqAgentRunner`. `instrumentation.js` loads it at startup, and any AI action or API call loads it too. `claim()` skips `agent.*` jobs in a process without the runner, so a standalone worker leaves them for a web-process worker.

### 8. Deep links
`agentHref(slug, agentId, { period, entity, q })` → `/app/<slug>/ai?agent=kra-tax&period=2026-04&entity=…&q=…`. The AI page preselects the specialist in both the chat and the background form. Add `askai=1` to any workspace URL to open the floating panel there.

### 9. Artifacts (`ai_artifacts`)
`id, workspace_id, agent_id, kind (REPORT|AUDIT_PACK|TAX_RECON|CLOSE_SUMMARY|FORECAST|OTHER), title, period_from, period_to, entity_id, job_id, report_id → ai_reports, summary, payload (sealed with vault "ai.artifact"), status (PENDING|READY|FAILED), created_by, created_at, updated_at`, with indexes on `(workspace_id, created_at)`, `(workspace_id, agent_id, created_at)` and `(job_id)`.
Visibility: a user sees their own artifacts, plus any whose linked report is shared with the TEAM. The report HTML stays in `ai_reports` (sealed); the artifact page redirects there.

## Try it
```bash
npm install
npm run setup        # if not done: env + DB
npm run seed         # demo workspace (demo@variaq.test / variaq-demo-2026)
npm run dev          # http://localhost:3000 (in-process worker runs agent jobs)
node --test tests/agents.test.js   # or: npm test
```
- Open `/app/<ws>/ai?agent=kra-tax&period=2026-03`, or use **Ask KRA Tax** on the Tax centre.
- Queue a Month-End Close summary from the AI page. It works without an AI key; the other specialists need AI enabled (admin console → AI key, owner consent in Settings).
- API: create a key with `agents:read` + `agents:run` under Integrations, then:
  `curl -H "Authorization: Bearer nq_…" -X POST localhost:3000/api/v1/agents/jobs -d '{"agentId":"month-end-close","period":"2026-04"}'`

## Known gaps / next steps
- There is no streaming in chat (same as before). Job status is polled, not pushed.
- Artifacts have no delete or share UI of their own (they follow the linked report's visibility).
- "Entity" is free-text context passed to the model. There is no entity master table yet.
- When `RUN_WORKER=0` on every web instance, agent jobs wait, because only web-process workers have the runner.
