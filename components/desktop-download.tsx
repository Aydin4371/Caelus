"use client";

const windowsDownload = "https://github.com/Aydin4371/Caelus/releases/latest/download/Kythros-Setup.exe";
const releasesPage = "https://github.com/Aydin4371/Caelus/releases/latest";

export function DesktopDownload({ details = false }: { details?: boolean }) {
  const nativeDesktop = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

  if (nativeDesktop) return null;

  const button = <a className="button primary desktop-download-button" href={windowsDownload} target="_blank" rel="noopener noreferrer">Download for Windows</a>;
  if (!details) return button;

  return <section className="desktop-download-card" aria-labelledby="desktop-download-title">
    <div>
      <span className="empty-kicker">FULL 3D ON YOUR COMPUTER</span>
      <h2 id="desktop-download-title">Install Kythros for Windows</h2>
      <p>Includes the desktop app and Full 3D CPU solver. Run the installer, open Kythros, then choose Full 3D → Install Full 3D runtime. Windows may ask you to restart once.</p>
      <p className="desktop-download-note">Windows 10/11 (64-bit). This download currently requires signing in to GitHub with access to Caelus. Your saved web workspace can be opened in the desktop app.</p>
    </div>
    <div className="desktop-download-actions">{button}<a href={releasesPage} target="_blank" rel="noopener noreferrer">Release notes and downloads</a></div>
  </section>;
}
