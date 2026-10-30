"use client";
import { useEffect, useState } from "react";

/** Registers the service worker and offers an "Install app" button where the browser supports it. */
export default function PwaSupport() {
  const [prompt, setPrompt] = useState(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
    let dismissed = false;
    try { dismissed = localStorage.getItem("nq-install-dismissed") === "1"; } catch {}
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); if (!dismissed) setHidden(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setHidden(true));
    // Clear the static cache on sign-out.
    const onSubmit = (e) => { if (e.target?.action?.endsWith?.("/logout")) navigator.serviceWorker?.controller?.postMessage("clear"); };
    document.addEventListener("submit", onSubmit, true);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); document.removeEventListener("submit", onSubmit, true); };
  }, []);

  if (hidden || !prompt) return null;
  return (
    <div className="pwa-install" role="region" aria-label="Install Variaq">
      <img src="/icons/icon-192.png" alt="" width="32" height="32" />
      <span>Install Variaq on this device for quick, full-screen access.</span>
      <button className="btn sm primary" onClick={async () => { prompt.prompt(); await prompt.userChoice.catch(() => {}); setHidden(true); setPrompt(null); }}>Install</button>
      <button className="btn sm ghost" aria-label="Dismiss" onClick={() => { setHidden(true); try { localStorage.setItem("nq-install-dismissed", "1"); } catch {} }}>✕</button>
    </div>
  );
}
