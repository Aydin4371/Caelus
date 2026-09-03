"use client";

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);
  const nativeDesktop = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The app remains fully usable in the browser if registration is blocked.
      });
    }

    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setPromptEvent(null);
      setShowInstructions(false);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  async function install() {
    if (!promptEvent) {
      setShowInstructions(true);
      return;
    }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "dismissed") setShowInstructions(true);
  }

  if (installed || nativeDesktop) return null;

  return <>
    <button className="button secondary install-button" onClick={install}>Install web app</button>
    {showInstructions && <div className="modal-backdrop install-backdrop" role="presentation" onMouseDown={() => setShowInstructions(false)}>
      <section className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" onMouseDown={(event) => event.stopPropagation()}>
        <span className="eyebrow">WEB APP</span>
        <h2 id="install-title">Install the Kythros web app</h2>
        <p>This installs the web interface for design, Rapid 2D, and saved results. Full 3D uses the separate Windows desktop installer.</p>
        <ol>
          <li>Look for the install icon at the right side of the address bar.</li>
          <li>If it is not there, open the Chrome or Edge menu.</li>
          <li>Choose <strong>Cast, save, and share</strong>, then <strong>Install Kythros</strong> or <strong>Install page as app</strong>.</li>
        </ol>
        <p className="install-note">The web app opens in its own window. It does not install the local Full 3D solver.</p>
        <div className="install-actions"><button className="button primary" onClick={() => setShowInstructions(false)}>Got it</button></div>
      </section>
    </div>}
  </>;
}
