# Variaq public website — commercial guide

The public (marketing) website lives in `app/(site)/` inside the same Next.js app as the product.
It shares the design system in `app/globals.css` (section "Public website") and needs no extra
dependencies or services.

## Sitemap

| URL | Purpose | File |
|---|---|---|
| `/` | Home: hero, trust strip, module tiles, AI specialists teaser, Kenya context, pricing teaser, dual CTA | `app/(site)/page.js` |
| `/product` | Platform overview, foundation features, how it fits next to the ERP | `app/(site)/product/page.js` |
| `/product/close` | Month-end close & bank/M-Pesa reconciliation | `app/(site)/product/close/page.js` |
| `/product/tax` | VAT reconciliation vs KRA auto-populated return, VAT3, eTIMS, tax centre | `app/(site)/product/tax/page.js` |
| `/product/audit` | Journal audit (21 tests), completeness, auditor queries | `app/(site)/product/audit/page.js` |
| `/product/reporting` | KPIs, budgets, forecasts, board packs | `app/(site)/product/reporting/page.js` |
| `/product/ai` | The five AI specialists, routing, background jobs, artifacts, controls | `app/(site)/product/ai/page.js` |
| `/pricing` | Single plan card ($40/mo incl. 5 users, +$5/extra user), worked examples, pricing Q&A | `app/(site)/pricing/page.js` |
| `/security` | Tenancy, encryption, audit trail, auth, AI controls, residency, hosting controls | `app/(site)/security/page.js` |
| `/hosting` | **Internal operator runbook** for running the SaaS — unlisted (not in nav/footer/sitemap), `noindex` | `app/(site)/hosting/page.js` |
| `/about` | Company/product story and principles | `app/(site)/about/page.js` |
| `/faq` | Grouped FAQ: product, AI agents, data & security, pricing & access | `app/(site)/faq/page.js` |
| `/contact` | Demo / contact form with topic + plan (accepts `?topic=demo|sales|security|partner|support|other&plan=variaq`) | `app/(site)/contact/` |
| `/legal/privacy`, `/legal/terms` | **Draft templates for counsel review** (noindex) | `app/(site)/legal/` |
| `/admin/leads` | (Platform admins only) contact/demo requests submitted on the site | `app/admin/leads/page.js` |

Shared pieces: `app/(site)/_components/content.js` (module list, agent list, the single `PLAN` and
`monthlyPrice(users)` — edit prices here once and they update on home + pricing), `ProductPage.js` (product page template),
`CtaBand.js`, `SiteNav.js` (active nav state). Mobile nav uses a `<details>` menu (no JS).

## Positioning

- **One line:** Accounting operations software for Kenyan finance teams — close, reconcile, audit,
  report and stay KRA-compliant in one reviewable workspace. *Turn numbers into decisions.*
- **Who:** Kenyan SMEs and mid-market finance teams (2–30 people), groups with several entities,
  and their external auditors / advisers.
- **Wedge:** bank + M-Pesa reconciliation and VAT reconciliation against KRA's auto-populated return
  (pain every Kenyan finance team feels monthly), then expand into audit, budgets and board packs.
- **Differentiators:** Kenya-native (KES, M-Pesa, KRA/eTIMS, Kenyan holidays); explainable matching
  and findings; human approval everywhere; per-company encryption + hash-chained audit log;
  five specialist AI agents that only propose; delivered online as SaaS — nothing to install.
- **Be honest about:** no direct KRA filing/API; no email delivery yet; ERP adapters tested against
  fixtures, not live sandboxes; no ISO 27001/SOC 2; tax rules must be verified by an adviser.

## Delivery model

Variaq is **SaaS only**. Customers sign up at `/signup` and use the app in the browser (desktop or
mobile). We don't sell self-hosted or on-prem installs, and the marketing copy has no "deploy on your
servers" CTAs. The source archive and `/hosting` runbook are for the Variaq operator, not a client
install kit.

## Pricing (single plan — edit in `_components/content.js` → `PLAN`)

| Plan | Price (USD) | Scope |
|---|---|---|
| Variaq | **$40 / month per company workspace, includes 5 users** | Every module + five AI specialists (fair-use allowance), email support |
| Additional users | **$5 per user per month** | Read-only viewers / board members free |

Examples: 5 users = $40 · 8 users = $55 · 12 users = $75 · 20 users = $115. Each extra company
workspace is another $40/month. Local taxes (e.g. 16% Kenyan VAT) may apply.

The product does **not** enforce user caps or billing today, and there is no payment checkout: CTAs
go to `/signup` (Get started) or `/contact?topic=sales&plan=variaq`. Invoice manually until a billing
integration and seat entitlements are built.

## Operator checklist for the SaaS (full runbook at `/hosting`, unlisted)

1. `VARIAQ_MASTER_KEY` generated (`npm run keygen`), in a secrets manager, backed up separately.
2. `APP_URL` = public HTTPS origin; TLS in front (Nginx/Caddy/LB); upload limit ≥25 MB at the proxy.
3. Database: hosted libSQL/Turso with PITR, or local file + `DATABASE_ENCRYPTION_KEY` + daily backups.
4. `npm run make-admin -- you@domain` → enable 2FA → keep `ADMIN_REQUIRE_MFA=1`.
5. Never run `npm run seed` in production (use a separate demo instance).
6. AI: add provider key in `/admin → AI service`, set renew-by date and allowances.
7. **Agent jobs:** at least one web instance with `RUN_WORKER=1`. The standalone `npm run worker`
   skips `agent.*` jobs. Note `docker-compose.yml` sets `RUN_WORKER=0` on all app replicas — change
   it for one replica if you sell the AI agents.
8. Uptime monitor on `GET /api/health`; test a restore.
9. Tax adviser sign-off on `lib/tax/kenya.js`; replace legal drafts with counsel-approved text.

## How to demo Variaq to a prospect

Set up a **separate demo instance** (never production):

```bash
npm install && npm run setup && npm run seed && npm run dev   # or build + start
```

Demo logins (password `variaq-demo-2026`): `demo@variaq.test` (Owner/CFO),
`accountant@variaq.test`, `auditor@variaq.test`, `admin@variaq.test` (platform admin).

Suggested 30-minute flow:
1. **Website** (2 min): `/` → `/product` → `/pricing` ($40/mo, 5 users, +$5/user).
2. **KPI dashboard** as the CFO — headline numbers and alerts.
3. **Bank reconciliation** — suggested matches with reasons, the exception queue.
4. **Journal audit** — range 1 May 2025 – 30 Apr 2026 → Run; show the planted self-approved
   Sunday-night round-sum adjustment, duplicate bill, mispostings, and a correcting journal CSV.
5. **VAT reconciliation** — period 2026-04 → Run; show unrecorded eTIMS sales and blocked input VAT.
6. **Close** — checklist, sign-off, period lock.
7. **Budgets → Board packs** — create a pack, walk the approval flow.
8. **AI specialists** (if AI is enabled for the demo): "Ask KRA Tax" from the Tax centre; queue a
   Month-End Close summary (works without AI) and open the artifact.
9. Sign in as the **auditor** and raise a query to show the evidence pack.
10. Close with `/security`, then `/signup` to start their workspace (or `/contact?topic=sales`).

To enable AI in the demo: sign in as `admin@variaq.test` → `/admin` → AI service → paste key →
Test and activate → AI enabled; then as `demo@variaq.test` → Workspace & security → Allow AI.

## Leads

Submissions from `/contact` are stored in `contact_messages` (topic/plan prefixed to the message)
and listed at `/admin/leads` for platform admins. There's no email notification yet — check the
page or add an email integration.

## Before going public

- Replace `/legal/privacy` and `/legal/terms` drafts with counsel-reviewed text (Kenya DPA 2019).
- Confirm the $40 / 5 users / +$5 pricing, support hours and response times on `/pricing` and `/contact`.
- Decide how you'll invoice and collect (manual invoices until billing is built).
- Set `APP_URL` so Open Graph metadata resolves to the public domain.
