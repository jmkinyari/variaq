import Link from "next/link";
import { cookies } from "next/headers";
import db from "@/lib/db";
import { requireWorkspace, can } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import Flash from "@/components/Flash";
import Submit from "@/components/Submit";
import { ADAPTERS, loadConfig, publicConfig, sourceName } from "@/lib/connectors";
import { SCOPES, parseScopes } from "@/lib/api";
import { openGlobal } from "@/lib/security/crypto";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { saveConnector, testConnector, syncNow, toggleConnector, deleteConnector, createApiKey, revokeApiKey } from "./actions";
import "@/styles/platform.css";
export const metadata = { title: "ERP integrations & API" };

const STATUS_BADGE = { SUCCESS: "good", PARTIAL: "warn", FAILED: "bad", RUNNING: "info" };

export default async function IntegrationsPage({ params, searchParams }) {
  const { ws } = await requireWorkspace(params.ws);
  const manage = can(ws.role, "connectors.manage");
  const [connectors, keys, jobs] = await Promise.all([
    db.all("SELECT * FROM connectors WHERE workspace_id = ? ORDER BY created_at", [ws.id]),
    db.all("SELECT k.*, u.name by_name FROM api_keys k LEFT JOIN users u ON u.id = k.created_by WHERE k.workspace_id = ? ORDER BY k.created_at DESC", [ws.id]),
    db.all("SELECT type, status, payload, attempts, error, run_after FROM jobs WHERE workspace_id = ? AND status IN ('QUEUED','RUNNING') ORDER BY created_at", [ws.id]),
  ]);
  const runId = searchParams.run;
  const run = runId ? await db.get("SELECT r.*, c.name conn_name FROM sync_runs r JOIN connectors c ON c.id = r.connector_id WHERE r.id = ? AND r.workspace_id = ?", [runId, ws.id]) : null;
  const runs = await db.all("SELECT r.*, c.name conn_name FROM sync_runs r JOIN connectors c ON c.id = r.connector_id WHERE r.workspace_id = ? ORDER BY r.started_at DESC LIMIT 25", [ws.id]);
  const newType = manage && ADAPTERS[searchParams.new] ? searchParams.new : null;
  const editConn = manage && searchParams.edit ? connectors.find((c) => c.id === searchParams.edit) : null;
  const formAdapter = newType ? ADAPTERS[newType] : editConn ? ADAPTERS[editConn.type] : null;
  const formValues = editConn ? publicConfig(formAdapter, await loadConfig(editConn)) : {};
  let reveal = null;
  try { reveal = JSON.parse(openGlobal("api-key-reveal", cookies().get("nq_new_api_key")?.value) || "null"); } catch {}
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const queued = (id) => jobs.find((j) => j.type === "connector.sync" && JSON.parse(j.payload || "{}").connectorId === id);

  return (
    <>
      <PageHead title="ERP integrations & API" desc="Connect your accounting system so journals flow in automatically, or push them through the REST API. Credentials are encrypted with this company's own key." />
      <Flash searchParams={searchParams} />
      {reveal && <div className="alert warn"><strong>Copy your API key now — it won't be shown again.</strong>
        <div className="field" style={{ marginTop: ".5rem" }}><label>{reveal.name}</label><input readOnly value={reveal.key} className="mono" /></div>
        {reveal.signing && <div className="field"><label>Signing secret (HMAC-SHA256)</label><input readOnly value={reveal.signing} className="mono" /></div>}</div>}

      {formAdapter && (
        <form action={saveConnector} className="card stack" style={{ marginBottom: "1.5rem" }}>
          <input type="hidden" name="slug" value={ws.slug} />
          {editConn ? <input type="hidden" name="id" value={editConn.id} /> : <input type="hidden" name="type" value={newType} />}
          <div className="row between"><h3 style={{ margin: 0 }}>{editConn ? `Edit ${editConn.name}` : `Connect ${formAdapter.label}`}</h3><Link href="?" className="btn sm ghost">Cancel</Link></div>
          <p className="muted small" style={{ margin: 0 }}>{formAdapter.description}</p>
          <div className="form-row">
            <div className="field"><label>Name</label><input name="name" defaultValue={editConn?.name || formAdapter.label} maxLength={60} /></div>
            <div className="field"><label>Automatic sync</label><select name="schedule_minutes" defaultValue={String(editConn?.schedule_minutes || 0)}>
              <option value="0">Manual only</option><option value="15">Every 15 minutes</option><option value="60">Hourly</option><option value="360">Every 6 hours</option><option value="1440">Daily</option></select></div>
          </div>
          <div className="mapping-grid">
            {formAdapter.fields.map((f) => (
              <div key={f.key} style={f.type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
                <label>{f.label}{f.required && !(editConn && f.secret) ? " *" : ""}</label>
                {f.type === "select" ? <select name={f.key} defaultValue={formValues[f.key] || f.options[0][0]}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : f.type === "textarea" ? <textarea name={f.key} rows={4} defaultValue={formValues[f.key] || ""} placeholder={f.placeholder} className="mono small" />
                  : <input name={f.key} type={f.secret ? "password" : f.type === "date" ? "date" : "text"} autoComplete="off" defaultValue={f.secret ? "" : formValues[f.key] || ""}
                      placeholder={f.secret && editConn ? "•••••• stored — leave blank to keep" : f.placeholder || ""} />}
                {f.help && <div className="help">{f.help}</div>}
              </div>))}
          </div>
          <p className="faint small" style={{ margin: 0 }}>Secrets are write-only: they're encrypted on save and never shown again. All outbound requests are restricted to public HTTPS addresses.</p>
          <div><Submit>{editConn ? "Save changes" : "Save connector"}</Submit></div>
        </form>
      )}

      <h2>Connected systems</h2>
      {connectors.length === 0 ? <div className="card empty"><h3>No ERP connected yet</h3><p>Pick your accounting system below. Until then you can upload exports in the Data hub.</p></div> : (
        <div className="stack">{connectors.map((c) => {
          const q = queued(c.id);
          return (
            <div key={c.id} className="card">
              <div className="row between">
                <div><strong>{c.name}</strong> <span className="badge">{ADAPTERS[c.type]?.label || c.type}</span> {c.status !== "ACTIVE" && <span className="badge warn">Disabled</span>}
                  <div className="muted small">Source code in ledger: <code>{sourceName(c)}</code> · {c.schedule_minutes ? `syncs every ${c.schedule_minutes >= 60 ? `${c.schedule_minutes / 60} h` : `${c.schedule_minutes} min`}` : "manual sync"} · last sync {c.last_sync_at ? formatDateTime(c.last_sync_at) : "never"}
                    {c.last_status && <> · <span className={`badge ${STATUS_BADGE[c.last_status] || ""}`}>{c.last_status.toLowerCase()}</span></>}
                    {q && <> · <span className="badge info">{q.status === "RUNNING" ? "syncing now" : `queued${q.attempts ? ` (retry ${q.attempts})` : ""}`}</span></>}</div>
                  {c.last_error && <div className="small" style={{ color: "var(--bad)" }}>{c.last_error}</div>}
                </div>
                {manage && <div className="row">
                  <form action={testConnector}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={c.id} /><Submit className="btn sm" pendingText="Testing…">Test</Submit></form>
                  <form action={syncNow}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={c.id} /><Submit className="btn sm primary">Sync now</Submit></form>
                  <form action={syncNow}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="full" value="1" /><Submit className="btn sm ghost" confirm="Re-read everything from the start date? Unchanged lines are skipped, changed ones updated.">Full resync</Submit></form>
                  <Link href={`?edit=${c.id}`} className="btn sm ghost">Edit</Link>
                  <form action={toggleConnector}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={c.id} /><Submit className="btn sm ghost">{c.status === "ACTIVE" ? "Disable" : "Enable"}</Submit></form>
                  <form action={deleteConnector}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={c.id} /><Submit className="btn sm danger" confirm={`Delete ${c.name} and its stored credentials?`}>Delete</Submit></form>
                </div>}
              </div>
            </div>);
        })}</div>
      )}

      {manage && <>
        <h2 style={{ marginTop: "2rem" }}>Add a connection</h2>
        <div className="grid grid-3">{Object.values(ADAPTERS).map((a) => (
          <Link key={a.type} href={`?new=${a.type}`} className="card connector-card" style={{ textDecoration: "none", color: "var(--text)" }}>
            <strong>{a.label}</strong><div className="faint small">{a.vendor}</div><div className="muted small" style={{ marginTop: ".3rem" }}>{a.description}</div>
          </Link>))}
        </div>
      </>}

      {run && <div className="card" style={{ marginTop: "2rem" }} id="run">
        <div className="row between"><h3 style={{ margin: 0 }}>Sync run · {run.conn_name} · {formatDateTime(run.started_at)}</h3><Link href="?" className="btn sm ghost">Close</Link></div>
        <RunDetail run={run} currency={ws.currency} />
      </div>}

      <h2 style={{ marginTop: "2rem" }}>Sync history</h2>
      {runs.length === 0 ? <p className="muted">No syncs yet.</p> : <div className="table-wrap"><table>
        <thead><tr><th>Started</th><th>Connector</th><th>Status</th><th className="num">Fetched</th><th className="num">New</th><th className="num">Updated</th><th className="num">Skipped</th><th>Controls</th><th></th></tr></thead>
        <tbody>{runs.map((r) => { const c = JSON.parse(r.controls || "{}"); return (
          <tr key={r.id}><td className="small">{formatDateTime(r.started_at)}</td><td>{r.conn_name}</td><td><span className={`badge ${STATUS_BADGE[r.status] || ""}`}>{r.status.toLowerCase()}</span></td>
            <td className="num">{r.fetched.toLocaleString()}</td><td className="num">{r.inserted.toLocaleString()}</td><td className="num">{r.updated.toLocaleString()}</td><td className="num">{r.skipped.toLocaleString()}</td>
            <td className="small">{c.lines !== undefined ? (c.unbalancedCount ? <span className="badge warn">{c.unbalancedCount} unbalanced journals</span> : c.debitCents === c.creditCents ? <span className="badge good">balanced</span> : <span className="badge warn">Dr ≠ Cr</span>) : "—"}</td>
            <td><Link href={`?run=${r.id}#run`} className="btn sm ghost">Details</Link></td></tr>); })}</tbody>
      </table></div>}

      <h2 style={{ marginTop: "2.5rem" }}>REST API keys</h2>
      <p className="muted small">For ERPs we don't connect to directly: your system (or an integration platform) pushes journal lines to Variaq. Keys belong to this company only, are stored hashed, and can be limited by scope and expiry.</p>
      {keys.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Signed</th><th>Last used</th><th>Expires</th><th>Status</th>{manage && <th></th>}</tr></thead>
        <tbody>{keys.map((k) => { const dead = k.revoked_at || (k.expires_at && k.expires_at < db.now()); return (
          <tr key={k.id}><td>{k.name}<div className="faint small">by {k.by_name}</div></td><td className="mono small">nq_{k.prefix}_…</td><td className="small">{parseScopes(k.scopes).join(", ")}</td><td>{k.signing_secret ? "HMAC" : "—"}</td>
            <td className="small">{k.last_used_at ? formatDateTime(k.last_used_at) : "never"}</td><td className="small">{k.expires_at ? formatDateTime(k.expires_at) : "never"}</td>
            <td>{k.revoked_at ? <span className="badge bad">revoked</span> : dead ? <span className="badge warn">expired</span> : <span className="badge good">active</span>}</td>
            {manage && <td>{!dead && <form action={revokeApiKey}><input type="hidden" name="slug" value={ws.slug} /><input type="hidden" name="id" value={k.id} /><Submit className="btn sm danger" confirm={`Revoke ${k.name}? Systems using it stop working immediately.`}>Revoke</Submit></form>}</td>}</tr>); })}</tbody>
      </table></div>}
      {manage && <form action={createApiKey} className="card" style={{ marginTop: "1rem" }}>
        <input type="hidden" name="slug" value={ws.slug} />
        <div className="form-row">
          <div className="field"><label>Key name</label><input name="name" placeholder="e.g. SAP B1 nightly push" required maxLength={60} /></div>
          <div className="field"><label>Expires after</label><select name="expires_days" defaultValue="365"><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option><option value="730">2 years</option><option value="0">Never (not recommended)</option></select></div>
        </div>
        <div className="row" style={{ gap: "1rem", margin: ".5rem 0" }}>{Object.entries(SCOPES).map(([s, l]) => <label key={s} className="row small" style={{ fontWeight: 400, gap: 6 }}><input type="checkbox" name={`scope_${s}`} defaultChecked={s === "journals:write"} style={{ width: "auto" }} /> <code>{s}</code> — {l}</label>)}</div>
        <label className="row small" style={{ fontWeight: 400, gap: 6, marginBottom: ".8rem" }}><input type="checkbox" name="signing" style={{ width: "auto" }} /> Require HMAC-signed requests (recommended for production pushes)</label>
        <Submit>Create API key</Submit>
      </form>}

      <details className="card" style={{ marginTop: "1.5rem" }}>
        <summary><strong>API reference</strong></summary>
        <div className="small stack" style={{ marginTop: ".8rem" }}>
          <p>Base URL <code>{appUrl}/api/v1</code>. Authenticate with <code>Authorization: Bearer nq_…</code>. Limit: 600 requests/minute per key; 5,000 lines and 5 MB per request.</p>
          <pre className="code-block">{`# Push journal lines (idempotent by externalId; journals must balance)
curl -X POST ${appUrl}/api/v1/journals \\
  -H "Authorization: Bearer $VARIAQ_KEY" -H "Content-Type: application/json" \\
  -d '{"source":"SAP-PROD","lines":[
    {"externalId":"JE1001-1","journalNo":"JE1001","date":"2026-04-30","accountCode":"6100","accountName":"Rent","description":"April rent","debit":150000,"postedBy":"jkamau"},
    {"externalId":"JE1001-2","journalNo":"JE1001","date":"2026-04-30","accountCode":"2010","description":"April rent","credit":150000,"postedBy":"jkamau"}]}'

# Read journal lines (keyset pagination)
curl "${appUrl}/api/v1/journals?from=2026-04-01&to=2026-04-30&limit=500" -H "Authorization: Bearer $VARIAQ_KEY"

# Trial balance and chart
curl "${appUrl}/api/v1/trial-balance?asAt=2026-04-30" -H "Authorization: Bearer $VARIAQ_KEY"
curl "${appUrl}/api/v1/accounts" -H "Authorization: Bearer $VARIAQ_KEY"`}</pre>
          <p><strong>Signed requests.</strong> When a key requires signing, send <code>X-Variaq-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256(secret, t + "." + raw body)&gt;</code>. Requests older than 5 minutes are rejected.</p>
          <p><strong>Line fields:</strong> externalId*, date* (YYYY-MM-DD), accountCode*, amount (signed, debit +) or debit/credit or amountCents, journalNo, lineNo, accountName, description, reference, currency, fxRate, counterparty, entryType, postedBy, approvedBy, postedAt, taxCode, costCenter, department, project. Lines in locked periods are rejected (HTTP 207 with details).</p>
        </div>
      </details>
    </>
  );
}

function RunDetail({ run, currency }) {
  const c = JSON.parse(run.controls || "{}");
  const log = JSON.parse(run.log || "[]");
  const periods = Object.keys(c.byPeriod || {}).sort();
  return (
    <div className="stack" style={{ marginTop: ".8rem" }}>
      <div className="grid grid-4">
        <div className="stat"><div className="label">Lines fetched</div><div className="value">{run.fetched.toLocaleString()}</div></div>
        <div className="stat"><div className="label">Journals</div><div className="value">{(c.journals || 0).toLocaleString()}</div></div>
        <div className="stat"><div className="label">Unbalanced journals</div><div className="value" style={{ color: c.unbalancedCount ? "var(--bad)" : undefined }}>{c.unbalancedCount || 0}</div></div>
        <div className="stat"><div className="label">Rejected (invalid / locked)</div><div className="value">{(c.invalid || 0) + (c.locked || 0)}</div></div>
      </div>
      {run.error && <div className="alert error">{run.error}</div>}
      {periods.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>Period</th><th className="num">Lines from ERP</th><th className="num">Debits from ERP</th><th className="num">Credits from ERP</th><th className="num">Lines stored</th><th className="num">Debits stored</th><th>Check</th></tr></thead>
        <tbody>{periods.map((p) => { const a = c.byPeriod[p], s = c.stored?.[p] || {}; return (
          <tr key={p}><td>{p}</td><td className="num">{a.lines}</td><td className="num">{formatMoney(a.debitCents, currency)}</td><td className="num">{formatMoney(a.creditCents, currency)}</td><td className="num">{s.lines ?? "—"}</td><td className="num">{s.debitCents !== undefined ? formatMoney(s.debitCents, currency) : "—"}</td>
            <td>{a.debitCents === a.creditCents ? <span className="badge good">Dr = Cr</span> : <span className="badge warn">Dr ≠ Cr</span>}</td></tr>); })}</tbody>
      </table></div>}
      {c.unbalanced?.length > 0 && <div className="small">Unbalanced: {c.unbalanced.slice(0, 10).map((u) => `${u.journalNo} (${formatMoney(u.diffCents, currency)})`).join(", ")}</div>}
      <details><summary className="small">Run log ({log.length} lines)</summary><pre className="code-block">{log.join("\n")}</pre></details>
    </div>
  );
}
