# Variaq

A finance and accounting department tool for companies in Kenya. It runs alongside your existing ERP or accounting software (Sage, Dynamics, QuickBooks, Xero, Odoo, Zoho, or anything that can export CSV/Excel) and handles:

- CFO reporting
- Month-end close and reconciliations
- Journal auditing and auditor queries
- Budgeting and forecasting
- KRA tax reconciliation

Many companies (workspaces) and their users can use one installation at the same time. Each company's data is isolated, encrypted, and audited.

> Security, multi-tenancy and scaling are described in [docs/SECURITY-AND-SCALE.md](docs/SECURITY-AND-SCALE.md).

## What it does

### For the CFO
| Module | What you get |
|---|---|
| **KPI dashboard** | 21 KPIs with definitions and status, calculated live from the ledger: revenue, gross margin, EBITDA, net margin, cash, burn and runway, current and quick ratio, debt/equity, DSO/DPO/DIO and the cash conversion cycle, growth, opex and payroll ratios. Also trend charts, AR/AP ageing, top movers and alerts from every module. |
| **Board packs** | Choose a month and a budget to get a 10-section pack: summary, P&L against budget and last year, balance sheet, cash and 13-week outlook, KPIs, budget commentary, close status, control findings, KRA compliance, and risks/decisions. The numbers are snapshotted at creation. Commentary can be written per section, and an AI draft is optional and labelled. Approval goes Draft → In review → Approved, with the preparer and approver kept separate. Print to A4 PDF. |
| **Budgets & variance** | Build an annual budget from your own history in one of five ways: prior year, trend, seasonal, driver-based, or zero-based. Edit it in a grid with bulk changes and spreading. Approval workflow; simultaneous edits are detected so nobody overwrites someone else's changes. Budget vs actual for the month, year to date and full-year landing, plus a reforecast where you can correct actuals as well as forecast months. **Each variance comes with suggested causes and action points**: timing vs permanent, one-off, run-rate shift, price/volume, missing accrual, or possible misposting. The transactions behind each variance are listed. |
| **Cash flow forecast** | A 13-week forecast and a 12-month forecast, each with Base, Best and Worst scenarios. Forecast cells can be edited, and so can **actual weeks** (a note is required and the change can be reverted). The 12-month forecast is driven by the approved budget, or by trend if there isn't one. Shows minimum-cash alerts and the funding gap. |
| **Financial statements** | Balance sheet, income statement, and cash & cash equivalents, with drill-down to individual entries. |

### For accountants
| Module | What you get |
|---|---|
| **Data hub (CSV / Excel)** | Upload any export, CSV or .xlsx/.xls/.ods with multiple sheets. The hub detects what kind of data it is (12 types). It skips title rows, removes repeated page headers and total rows, fills journal numbers, dates and users down onto continuation lines, and converts Excel dates. It reads bracketed or DR/CR amounts and both decimal formats, flags invalid KRA PINs, and maps columns automatically. The server validates everything again before import, and re-imported lines are skipped. |
| **Ledger & journals** | Journal-level data: journal number, line, source, posted by/at, approved by, cost centre, project and tax code. A journal drill-down shows the balance check and any linked audit findings. |
| **Reconciliations** | Bank and M-Pesa matching with confidence and reasons for each match, an exception queue, and review and completion workflow. |
| **Month-end close & tasks** | Close checklist with owners, reviewers, priorities, dependencies, comments and approver sign-off, plus an optional period lock. The task board shows your own work, team workload and a kanban view. Notifications go out on assignment. |
| **Journal audit** | 21 automated tests in the style of ISA 240 journal-entry testing, covering:<br>• unbalanced journals<br>• weekend/holiday postings (Kenyan holidays)<br>• after-hours postings<br>• back-dating or posting into locked periods<br>• round amounts<br>• amounts just below the approval limit<br>• duplicates<br>• self-approval and missing approval<br>• uncleared suspense<br>• abnormal balances<br>• rare account pairs<br>• manual entries to revenue/cash<br>• vague descriptions<br>• statistical outliers<br>• Benford's law<br>• cut-off<br>• dormant accounts<br>• **machine-learned misposting detection**, trained on your own history<br>Each finding has a corrective action and, where it applies, a **balanced correcting journal you can download as CSV and import into your ERP**. Findings can be assigned; they carry over between runs and keep their status. |
| **Completeness tests** | Gaps and duplicates in journal and invoice number sequences, TB roll-forward against the GL, missing recurring postings (rent, payroll, depreciation), volume anomalies, out-of-range dates, chart coverage, and ledger vs bank. |
| **Auditor queries** | External auditors (a read-only role) raise queries on an account, journal or period. An **evidence pack** is built automatically: movement summary, monthly trend, the journals with their lines, counterparties, related findings and reconciliation status. The accountant replies with action points, owners and due dates, and there is a printable response report. Queries are encrypted at rest. |
| **Chart of accounts mapping** | Map a subsidiary's or legacy system's chart to your group chart. Matching uses codes, finance synonyms, reporting concepts, statement class, and mappings people have already confirmed. You can then translate trial balances into the group chart, and **reconcile two ledgers to find probable mispostings**, each with a reclass journal. |

### Tax (KRA)
| Module | What you get |
|---|---|
| **VAT reconciliation** | Your ERP sales and purchase registers are reconciled against KRA's **auto-populated VAT return** (iTax/eTIMS `SEC_B…`, `SEC_F…` CSVs) using a four-pass matcher. It flags:<br>• sales on eTIMS but missing from the ERP (unrecorded revenue)<br>• ERP sales never transmitted<br>• purchases not on eTIMS (input VAT blocked)<br>• input VAT older than 6 months<br>• amount, VAT and PIN mismatches<br>• invalid PINs or self-supply<br>• wrong VAT rates and duplicates<br>• credit notes without the original invoice<br>• withholding VAT not equal to 2%<br>It also computes VAT3 sheet O (rows 13–28), exports iTax-format Sections B, F and L, and cross-checks the ledger's VAT control accounts and revenue. |
| **eTIMS deductibility** | Estimates expenses without eTIMS support, which are non-deductible under ITA s.16(1)(c) (Finance Act 2023). |
| **Tax centre** | KRA profile (PIN stored encrypted), filing calendar with weekend and holiday roll-forward, and a penalty and interest estimator. The rules reference cites its sources. Items that couldn't be confirmed from a KRA source are marked as unverified. |

### Variaq AI (embedded assistant)
| Feature | What you get |
|---|---|
| **Assistant on every page** | An "Ask AI" button on every page, or press Ctrl+J. On phones it opens full-screen. It answers questions about the company's own figures, explains the page you're on, and suggests what needs attention. Twelve read-only tools give it the data it needs: KPIs, financial statements, ledger search, account activity, journals, audit findings, tasks, budget vs actual, VAT status, auditor queries, and the team list. |
| **Actions with approval** | The assistant can **propose** tasks (with an assignee, due date and priority) and reports. Nothing happens until a person clicks *Create task* or *Generate report*. It cannot post, approve or delete anything itself. |
| **HTML reports** | Seven templates: management, board, audit & controls, KRA tax, cash outlook, budget variance, and custom. The AI gathers the figures with its tools, then writes the report. Reports are sanitised, shown in a sandboxed frame, and can be printed to PDF or downloaded as HTML. They can be shared with the whole workspace or through a **read-only external link that expires and can be revoked**. |
| **Data protection** | AI is used only after the **company owner consents**. Conversations and reports are encrypted with the company's own key. Every action is written to the audit log. |

### Variaq system administration (`/admin`)
For Variaq's own staff only; company owners and admins can't open it. Two-step verification is required.
- **AI service**: turn AI on or off for all companies; choose the model (Claude Opus 5.5 by default, or Sonnet 5.5 / Haiku 5.5) and the effort level. **Renew the API key whenever needed.** A new key is tested live before it replaces the old one and is stored encrypted. You set a renew-by date; reminders start 14 days before it, and AI pauses for every company once the date passes. The key history and usage/cost by feature are shown.
- **Companies**: turn AI on or off and set a monthly token allowance for each company (allowances reset monthly), see whether each owner has consented and how much they've used, and suspend or reactivate a company.
- **Overview and admin log**: platform totals, key status alerts, top AI users, and every admin action with the IP it came from.

Grant admin access to an existing account with `npm run make-admin -- someone@company.com`.

### Web and mobile
- **Responsive**: phones and tablets get a stacked layout, a sticky menu bar, 16px form fields (so iOS doesn't zoom in) and support for notched screens.
- **Installable**: Variaq can be added to the home screen on Android, iOS, Windows and macOS. It runs full-screen with its own icon and shortcuts.
- **Offline**: the service worker caches only icons and build files, never company data. Without a connection, users see an offline page.

### Integrations
- **ERP connectors** with incremental, idempotent sync, control totals, scheduling and locked-period protection. Connectors: Odoo, Xero, QuickBooks Online, Microsoft Dynamics 365 Business Central, Zoho Books, any REST/JSON API (configurable mapping), and CSV/Excel files at an HTTPS URL.
- **REST API** (`/api/v1/journals`, `/trial-balance`, `/accounts`, `/api/health`). Any system can push or pull journals. API keys are scoped and stored hashed, with optional HMAC request signing and a per-key rate limit.

## Public website

Variaq is sold as SaaS: customers sign up on the website and use the app online. The
customer-facing site (home, platform and module pages, pricing, security, about, FAQ, contact/demo
and draft legal pages) lives in `app/(site)/` and is served by the same app at `/`, `/product`,
`/pricing`, `/security`, `/about`, `/faq` and `/contact`. Pricing is a single plan: **$40/month per
company workspace including 5 users, +$5 per additional user per month (USD)**. `/hosting` is an
unlisted, noindex operator runbook for the Variaq team. Demo requests are listed for platform admins
at `/admin/leads`. Sitemap, positioning, pricing, the ops checklist and a demo script are in
[docs/COMMERCIAL-SITE.md](docs/COMMERCIAL-SITE.md).

## Run it

You need **Node.js 18.18+** (the LTS version from nodejs.org is recommended). In PowerShell, from this folder:

```bash
npm install
```
```bash
npm run setup
```
```bash
npm run seed
```
```bash
npm run dev
```

Then open http://localhost:3000. On Windows you can also double-click **Start Variaq.cmd**.

- `npm run setup` creates `.env.local` with a **freshly generated encryption master key**, and creates the database.
- `npm run seed` is optional and loads a demo company: *Demo Supplies Ltd*, with 24 months of journals (May 2024 – Apr 2026). The data includes **planted control issues for the audit engines to find**: a self-approved round-sum Sunday-night adjustment, an unbalanced accrual, a duplicate bill, three mispostings, a back-dated write-down, a cut-off reversal, a missing rent month and a journal-number gap. It also includes a bank reconciliation, a legacy-ERP trial balance with a different chart, a group chart, AR/AP ageing, and April 2026 KRA VAT documents.

Demo users (local testing only; the password for all three is `variaq-demo-2026`):

| Email | Role |
|---|---|
| demo@variaq.test | Owner / CFO |
| accountant@variaq.test | Accountant |
| auditor@variaq.test | External auditor |
| admin@variaq.test | Variaq system administrator (`/admin`) |

**To turn on AI in the demo:**
1. Sign in as `admin@variaq.test` and open `/admin` → **AI service**.
2. Paste your Anthropic API key, then click *Test and activate*.
3. Tick **AI enabled** and save.
4. Sign in as `demo@variaq.test` and go to **Workspace & security** → **Allow AI for this company**.

For local testing only, `.env.local` sets `ADMIN_REQUIRE_MFA="0"`; in production, admins must use 2FA.

A good tour, signed in as the CFO:
1. **KPI dashboard**
2. **Journal audit**: set the range to 1 May 2025 – 30 Apr 2026 and run it
3. **Budgets → New** (Seasonal, financial year starting 2026-01), then the *Budget vs actual* tab
4. **Board packs → Create**
5. **VAT reconciliation**: period 2026-04, then Run
6. **Chart mapping**: *Map accounts* (Legacy ERP → GROUP), then Auto-map

Then sign in as the auditor and raise a query.

Other commands:

| Command | What it does |
|---|---|
| `npm run make-admin -- <email>` | Grants Variaq system-administrator access (`--revoke` to remove) |
| `npm run icons` | Regenerates the app / home-screen icons |
| `npm test` | 85 unit tests, including the AI report HTML sanitiser: encryption, TOTP, SSRF guard, audit hash chain, ingest/cleaning, KRA engines, journal rules, mispostings, chart matching, KPIs, budgets, forecasts, connectors, job queue, API keys |
| `npm run build` then `npm start` | Production build |
| `npm run worker` | Stand-alone background worker (ERP syncs, sealing, cleanup) for scaled-out deployments |
| `npm run keygen` | Prints a new 32-byte key |

To start over, stop the server, delete the `data` folder, and run `npm run setup` (plus `npm run seed` if you want the demo).

## Deploy

- **Docker**: `docker compose up --build` starts a libSQL server, two app replicas, a worker, and nginx with rate limiting. Set `VARIAQ_MASTER_KEY` and `APP_URL` first.
- **Managed**: Vercel/Render/Fly plus Turso. Set `DATABASE_URL=libsql://…`, `DATABASE_AUTH_TOKEN`, `VARIAQ_MASTER_KEY` and `APP_URL`, and run the worker separately with `RUN_WORKER=0` on the web instances.

Before go-live, work through the checklist in [docs/SECURITY-AND-SCALE.md](docs/SECURITY-AND-SCALE.md). In particular:
- **Back up the master key.** Without it, encrypted data can't be read.
- **Require two-step verification** for owners and admins.
- **Have a Kenyan tax adviser verify** `lib/tax/kenya.js`.

## Project structure

```
app/(auth)/                 Sign-in (lockout, rate limits), sign-up, MFA challenge, invitations
app/app/account/            Account security: TOTP 2FA, recovery codes, password, sessions
app/app/[ws]/               The app — dashboard, board-packs, budgets, statements, data, ledger, bank,
                            reconciliations, close, tasks, reports, journal-audit, completeness,
                            queries, coa, tax, integrations, team, audit, settings
app/api/                    REST API v1 + health
lib/security/               crypto (envelope encryption, blind index), totp, rate-limit, net (SSRF), password
lib/vault.js                Per-workspace keyring (seal/open/rotate)
lib/audit-chain.js          Tamper-evident hash chain for the audit log
lib/db.js, lib/schema.js    libSQL access (WAL, retries, transactions, optimistic locking) and migrations
lib/migrations/             Module-owned migrations
lib/ingest/                 Dataset registry, file readers (CSV/Excel), cleaning & validation pipeline
lib/importers/              Data hub importers per dataset type
lib/tax/                    Kenya rules, VAT recon, VAT3, calendar & penalties, ledger checks, eTIMS
lib/audit/                  Journal rules, misposting model, Benford, completeness, evidence packs
lib/coa/                    Chart matching, TB translation, ledger-to-ledger reconciliation
lib/kpi.js, lib/budget/     KPIs, budget generation, budget vs actual & variance explanations
lib/forecast/, cashflow.js  12-month and 13-week forecasts
lib/boardpack/              Board-pack snapshot and alerts
lib/connectors/             ERP adapters + sync engine;  lib/jobs.js  lease-based job queue
components/                 UI (Data hub, charts, navigation, …)
scripts/                    setup, seed (+ demo history), worker
docs/                       Security, multi-tenancy and scaling
tests/                      node:test suites
```

## Known limits

- **ERP adapters**: built from each vendor's public API documentation and tested against fixture payloads, but **not yet against live sandboxes**. Test each connection before relying on it. OAuth connectors (Xero, QuickBooks, Zoho) take a refresh token you paste in; there's no in-app "Connect" consent screen yet.
- **KRA**: there is no public KRA API for pulling iTax data. Download the auto-populated return files from iTax and upload them in the Data hub. Some layouts and deadlines are marked *unverified* in the app.
- **Email**: no email delivery yet. Invitations and notifications are shown in the app.
- **Rate limits**: counted separately on each app instance. Use Redis to share the count across instances.
