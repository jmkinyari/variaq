"use client";
import { useState, useTransition } from "react";
import { saveCommentary, draftCommentary } from "./actions";

// Per-section commentary editor. Versions are shared through a window-level counter so several
// editors on one page don't trip the pack's optimistic lock on each other.
export default function CommentaryEditor({ slug, packId, sectionKey, initial, version, aiOn }) {
  const [text, setText] = useState(initial?.text || "");
  const [meta, setMeta] = useState(initial);
  const [ai, setAi] = useState(!!initial?.ai);
  const [msg, setMsg] = useState(null);
  const [pending, start] = useTransition();
  const getV = () => (typeof window !== "undefined" && window.__bpVersion?.[packId]) || version;
  const setV = (v) => { window.__bpVersion = { ...(window.__bpVersion || {}), [packId]: v }; };
  const dirty = text !== (meta?.text || "");
  const save = () => start(async () => {
    const res = await saveCommentary(slug, packId, getV(), sectionKey, text, { ai });
    if (res?.error) setMsg({ err: res.error }); else { setV(res.version); setMeta(res.entry); setMsg({ ok: "Saved" }); }
  });
  const draft = () => start(async () => {
    const res = await draftCommentary(slug, packId, sectionKey);
    if (res?.error) setMsg({ err: res.error }); else { setText(res.text); setAi(true); setMsg({ ok: "AI draft inserted — review and edit before saving." }); }
  });
  return (
    <div className="no-print" style={{ marginTop: "1rem" }}>
      <label className="row between" style={{ marginBottom: 4 }}><span>Commentary {ai && <span className="bp-ai">AI-assisted</span>}</span>{meta?.by && <span className="faint small" style={{ fontWeight: 400 }}>last saved by {meta.by}</span>}</label>
      <textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }} placeholder="What happened, why it matters, and what management will do." style={{ width: "100%" }} maxLength={8000} />
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm primary" disabled={!dirty || pending} onClick={save}>{pending ? "…" : "Save commentary"}</button>
        {aiOn && <button type="button" className="btn sm" disabled={pending} onClick={draft}>Draft with AI</button>}
        {msg?.ok && <span className="small" style={{ color: "var(--good)" }}>{msg.ok}</span>}
        {msg?.err && <span className="small" style={{ color: "var(--bad)" }}>{msg.err}</span>}
      </div>
    </div>
  );
}
