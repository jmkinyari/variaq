# Security, multi-tenancy and scale

Variaq holds company ledgers, tax data and ERP credentials for many companies at once. This
document describes how that data is isolated, encrypted and audited, and how the app scales.

## Tenancy model

- A **workspace** is one company (legal entity). Users join workspaces through invitations, and
  the role they're given applies only to that workspace.
- Every tenant table has a `workspace_id` column. Every query is scoped by the workspace that
  `requireWorkspace()` / `requirePerm()` resolves from the signed-in user's membership.
  - A user who isn't a member gets a 404, not a 403, so other tenants' slugs can't be enumerated.
- Records loaded by id are always re-checked with `AND workspace_id = ?`.
- API keys belong to exactly one workspace. Their scopes (`journals:write`, `journals:read`,
  `tb:read`, `reports:read`) limit what each key can do.

## Roles and permissions

| Role | Typical user | Can |
|---|---|---|
| Owner | Finance director | Everything, including rotating encryption keys, deleting the workspace, assigning admins |
| Admin / CFO | CFO, finance manager | Approve budgets and board packs, lock periods, manage team, connectors and API keys |
| Accountant (Member) | Accountants | Import, reconcile, run audit tests and tax reconciliations, work tasks, respond to auditor queries |
| External auditor | Audit firm | Read-only, plus raise and follow up auditor queries |
| Viewer | Board, management | Read-only |

The server checks permissions in every action (`can(role, perm)`). The UI only hides buttons.

## Authentication

- **Passwords**
  - Stored as bcrypt hashes (cost 12).
  - Policy: at least 12 characters, a list of common passwords is blocked, and the user's name or email can't appear in the password.
  - Changing your password signs out every other session.
- **Brute-force protection**
  - Sign-in is rate-limited per IP and per IP+email.
  - An account locks for 15 minutes after 5 failed attempts.
  - A password check runs even when the email doesn't exist, so response timing doesn't reveal whether an account exists.
- **Two-step verification (TOTP, RFC 6238)**
  - Works with any authenticator app.
  - Codes can't be replayed: each time-step is accepted only once.
  - 8 one-time recovery codes, stored as SHA-256 hashes and shown once.
  - The TOTP seed is encrypted with the master key.
- **Sessions**
  - 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie. In production it is also `Secure` and uses the `__Host-` prefix.
  - The database stores only SHA-256(token).
  - Sessions have an idle timeout (default 8 h) and an absolute lifetime (default 7 days).
  - A session that hasn't completed two-step verification can't reach the app.
  - Users can see their active sessions and sign the others out.
- **Invitations**
  - Tokens are stored hashed and shown once.
  - Each token only works for the invited email address and expires after 7 days.

## Encryption

| Layer | Mechanism |
|---|---|
| In transit | HTTPS (HSTS preload header in production) |
| Database file at rest | libSQL page encryption when `DATABASE_ENCRYPTION_KEY` is set (local file). Hosted Turso/sqld: use the provider's at-rest encryption. |
| Sensitive fields | **Envelope encryption** (`lib/security/crypto.js`, `lib/vault.js`), described below |
| Exact-match lookup on encrypted values | Blind index: HMAC-SHA256 with a per-workspace derived key (e.g. KRA PIN) |

How the field encryption works:

- **Master key.** `VARIAQ_MASTER_KEY` is kept outside the database, in the environment or a secrets manager.
- **Workspace keys.** Each workspace gets its own random 256-bit data-encryption key (DEK). The DEK is stored *wrapped* by the master key, using AES-256-GCM, in `workspace_keys`.
- **Sealing a field.** Fields are sealed with AES-256-GCM using the workspace DEK. The workspace id and the field's purpose are bound in as additional authenticated data, so a ciphertext copied to another tenant or another column fails to decrypt.
- **What gets encrypted.** ERP connector credentials and tokens, KRA PINs, auditor query questions and responses, and TOTP seeds.
- **Key rotation.** Owners can rotate a workspace key under Settings → Security. Old key versions stay available for decryption.
- **Crypto-shredding.** Deleting a workspace deletes its keys, which makes any leftover ciphertext (for example in backups) unreadable.

## Audit trail

- **What is recorded.** Every change (imports, matches, approvals, role changes, period locks, key rotation, connector syncs, API writes) is written to `audit_events` with user, time and IP.
- **Tamper evidence.** Events are sealed into a per-workspace **hash chain**: `hash = SHA-256(prev_hash | event)`.
  - Editing or deleting any past event breaks every later hash.
  - The Audit log page verifies the whole chain and shows where it breaks.
  - Sealing is serialised per workspace, and a unique `(workspace_id, seq)` index guarantees two app instances can't fork the chain.

## AI service

- **Who controls it.** Variaq system administrators own the AI configuration, in the `/admin` console. Access requires the `is_platform_admin` flag and two-step verification. Every admin action is logged in `platform_audit`.
- **The API key.** There is one Anthropic API key for the whole platform.
  - It is sealed with the master key and never shown again.
  - A new key is tested live before it replaces the old one.
  - Each key has a renew-by date. After that date, AI pauses for every company until the key is renewed.
- **Two gates per company.** Variaq must grant the company AI access (with a monthly token allowance), and the company owner must consent to its data being processed. Without both, nothing is sent to the model.
- **Read-only tools.**
  - The model reads company data only through tools scoped to the signed-in user's workspace. The workspace id comes from the session, never from the model.
  - It can only *propose* tasks or reports; a person must approve each one.
  - Tool results are labelled as data, and the system prompt tells the model never to follow instructions found in data. This defends against prompt injection through journal narrations or other records.
- **AI-generated HTML.**
  - Reports pass through an allow-list sanitiser: no scripts, event handlers, links, external resources, or `url()`/`expression` in CSS.
  - In the app they are shown in an `<iframe sandbox="">` with no permissions. Print, download and share-link versions are served with a `script-src 'none'` / `default-src 'none'` CSP.
  - Share links are random tokens, stored hashed, time-limited and revocable.
- **Storage and metering.**
  - Conversations and reports are encrypted with the company's own key.
  - Every call records tokens and cost per company, user and feature. Quotas are enforced before each call.
  - The assistant is rate-limited per user, and report generation per company.

## Mobile / installed app

- **Nothing sensitive offline.** The service worker caches only static assets (icons, build files, the offline page). It never caches company data, API responses, reports or admin pages, and it clears its cache on sign-out.
- **HTTPS only for `upgrade-insecure-requests`.** That CSP directive is applied only when `APP_URL` is HTTPS, so a plain-HTTP local server still works.

## Data integrity controls

- **Period locks.** Imports, connector syncs and API pushes into a locked month are rejected.
- **Optimistic locking.** Budgets, forecasts, close tasks and board packs carry a `version` column. Concurrent edits get a clear "someone else saved first" error instead of silently overwriting each other.
- **Server-side validation.** Imports are re-validated on the server; the browser preview is never trusted.
- **Idempotent ingestion.** Connector and API journal lines are keyed by `(workspace, source, external_id)`, so re-syncs never double count.
- **Control totals.** Every sync checks debits = credits per journal and compares counts and sums against the source.

## Web security

- **Security headers** (`next.config.js`):
  - Content-Security-Policy: no third-party scripts, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`.
  - X-Frame-Options DENY, nosniff, strict Referrer-Policy, a restrictive Permissions-Policy, COOP/CORP.
  - HSTS in production.
- **CSRF.** Server Actions are POST-only and origin-checked (`allowedOrigins` follows `APP_URL`). The session cookie is `SameSite=Lax`.
- **SSRF.**
  - Every outbound connector request goes through `safeFetch`, which requires https, re-checks DNS on every redirect hop, and blocks loopback, private, link-local and cloud-metadata ranges.
  - It also enforces a timeout and caps the response size.
  - For on-premise ERPs, set `CONNECTOR_ALLOW_PRIVATE=1` explicitly.
- **Rate limits.** Sign-in, sign-up, MFA, uploads, heavy engine runs and the REST API are all rate-limited.
- **Injection.** All SQL uses bound parameters. Uploaded values are normalised and length-capped, and Excel error values are stripped.
- **Caching.** App and API responses are `Cache-Control: no-store`.

## Scaling for many concurrent companies

- **Stateless web tier.** Run any number of Next.js instances behind a load balancer. Sessions live in the database, not in memory.
- **Database.** Locally, the app uses SQLite in WAL mode with a busy timeout and retry-with-jitter on contention. In production, point every instance at one libSQL server (sqld, see `docker-compose.yml`) or Turso.
- **Bulk writes.** Bulk inserts use multi-row statements inside one write transaction, chunked at 2,000 statements. Indexes cover every workspace-scoped lookup path.
- **Background work.** Connector syncs, scheduled engine runs, audit sealing and cleanup run on a database-backed job queue.
  - Workers claim jobs with **leases**, so several worker processes are safe.
  - Failed jobs retry with exponential backoff.
  - Run workers inside the web process (`RUN_WORKER=1`), or as separate `npm run worker` containers when you scale out.
- **Per-node caches.** Unwrapped DEKs are held in a bounded in-memory LRU cache per node. Rate-limit windows are per instance; swap the store for Redis to share them across instances.

## Operational checklist before go-live

1. Generate and store `VARIAQ_MASTER_KEY` in a secrets manager, and back it up separately from the database.
2. Set `APP_URL` to the public HTTPS URL, and put TLS in front of the app.
3. Use a hosted libSQL/Turso database with backups and point-in-time recovery, or a persistent volume with `DATABASE_ENCRYPTION_KEY` set.
4. Require two-step verification for owners and admins (Account security).
5. Don't run `npm run seed` in production.
6. Have a qualified Kenyan tax adviser verify the tax rates and deadlines in `lib/tax/kenya.js`. Each one lists its source.
