"use client";

import { useState } from "react";
import type { EngineDesign, OperatingPoint } from "@/lib/design-workspace";
import { buildRde2dPackage, DEFAULT_RDE_2D_SETTINGS, midpointCondition, rde2dPackageFileName, type Rde2dSettings } from "@/lib/rde-2d-workflow";

type Props = {
  designs: EngineDesign[];
  activeDesignId: string | null;
  operatingPoints: OperatingPoint[];
  onSelectDesign: (id: string) => void;
  onOpenDesign: () => void;
  onOpenEnvelope: () => void;
  onOpenValidation: () => void;
};

function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function value(value: number) {
  return Number.isFinite(value) ? value : "";
}

export function Rde2dWorkspace({ designs, activeDesignId, operatingPoints, onSelectDesign, onOpenDesign, onOpenEnvelope, onOpenValidation }: Props) {
  const activeDesign = designs.find((item) => item.id === activeDesignId) ?? designs.at(-1) ?? null;
  const points = activeDesign ? operatingPoints.filter((point) => point.designId === activeDesign.id) : [];
  const [selectedPointId, setSelectedPointId] = useState("midpoint");
  const [settings, setSettings] = useState<Rde2dSettings>(DEFAULT_RDE_2D_SETTINGS);
  const [exported, setExported] = useState(false);
  const condition = activeDesign ? points.find((point) => point.id === selectedPointId) ?? midpointCondition(activeDesign) : null;
  const packageData = activeDesign && condition ? buildRde2dPackage(activeDesign, condition, settings) : null;
  const setNumber = (key: keyof Rde2dSettings, next: string) => setSettings((current) => ({ ...current, [key]: next === "" ? Number.NaN : Number(next) }));
  const setText = (key: keyof Rde2dSettings, next: string) => setSettings((current) => ({ ...current, [key]: next }));

  if (!activeDesign) return <section className="empty-workspace simulation-empty">
    <span className="empty-kicker">2D RDE DEVELOPMENT</span><h1>Define an engine before preparing CFD</h1>
    <p>The 2D workflow inherits its annulus, chamber, injectors, propellants, and operating range from an immutable Kythros engine revision.</p>
    <div className="empty-actions"><button className="button primary" onClick={onOpenDesign}>Build an RDE →</button></div>
  </section>;

  const pkg = packageData!;
  const width = pkg.geometry.circumferenceMm;
  const height = pkg.geometry.chamberLengthMm;
  const ratio = Math.min(5, Math.max(1.6, width / Math.max(height, 1)));

  return <section className="simulation-workspace" aria-labelledby="simulation-title">
    <header className="simulation-heading">
      <div><span className="workspace-label">2D UNWRAPPED RDE</span><h1 id="simulation-title">Prepare the next simulation</h1><p>Turn the saved engine definition into a periodic 2D chamber, traceable operating condition, mesh template, and pressure-probe plan. Kythros prepares and reviews the case; the selected CFD solver performs the reacting-flow calculation.</p></div>
      <div className="simulation-stage"><span>1 · Design</span><strong>2 · Prepare</strong><span>3 · Run</span><span>4 · Analyze</span><span>5 · Improve</span></div>
    </header>

    <div className="simulation-context-bar">
      <label><span>Engine revision</span><select value={activeDesign.id} onChange={(event) => { onSelectDesign(event.target.value); setSelectedPointId("midpoint"); setExported(false); }}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}{design.revision ? ` · r${design.revision.number}` : ""}</option>)}</select></label>
      <label><span>Operating condition</span><select value={selectedPointId} onChange={(event) => { setSelectedPointId(event.target.value); setExported(false); }}><option value="midpoint">Design-range midpoint</option>{points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label>
      <div><span>Condition</span><strong>ϕ {condition!.equivalenceRatio.toFixed(3)} · {condition!.massFlowKgS.toFixed(3)} kg/s · {condition!.inletPressureBar.toFixed(2)} bar</strong></div>
    </div>

    <div className="simulation-primary-grid">
      <section className="simulation-domain-card">
        <div className="card-heading"><div><span>DOMAIN</span><h2>Annulus unwrapped into a periodic rectangle</h2></div><small>Geometry only · no computed flow field</small></div>
        <svg viewBox={`0 0 ${500 * ratio / 3} 240`} role="img" aria-label="Two-dimensional unwrapped annular RDE chamber domain">
          <defs><pattern id="sim-grid" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M 18 0 L 0 0 0 18" fill="none" stroke="#c9dddf" strokeWidth="0.8" /></pattern><linearGradient id="sim-domain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f8ead8"/><stop offset="1" stopColor="#e5f2f2"/></linearGradient></defs>
          <rect x="42" y="30" width={`${500 * ratio / 3 - 74}`} height="160" rx="3" fill="url(#sim-domain)" stroke="#214d5c" strokeWidth="2"/>
          <rect x="42" y="30" width={`${500 * ratio / 3 - 74}`} height="160" fill="url(#sim-grid)" opacity=".85"/>
          <line x1="42" y1="30" x2="42" y2="190" stroke="#6679bd" strokeWidth="4" strokeDasharray="8 5"/><line x1={`${500 * ratio / 3 - 32}`} y1="30" x2={`${500 * ratio / 3 - 32}`} y2="190" stroke="#6679bd" strokeWidth="4" strokeDasharray="8 5"/>
          <line x1="42" y1="190" x2={`${500 * ratio / 3 - 32}`} y2="190" stroke="#c8873d" strokeWidth="5"/><line x1="42" y1="30" x2={`${500 * ratio / 3 - 32}`} y2="30" stroke="#2588a2" strokeWidth="5"/>
          <text x="50%" y="17" textAnchor="middle">Chamber exit</text><text x="50%" y="218" textAnchor="middle">Injector boundary</text><text x="18" y="112" textAnchor="middle" transform="rotate(-90 18 112)">Periodic</text><text x={`${500 * ratio / 3 - 9}`} y="112" textAnchor="middle" transform={`rotate(90 ${500 * ratio / 3 - 9} 112)`}>Periodic</text>
        </svg>
        <div className="simulation-domain-stats"><span><b>{width.toFixed(2)} mm</b>Circumferential width</span><span><b>{height.toFixed(2)} mm</b>Axial length</span><span><b>{pkg.geometry.annulusGapMm.toFixed(2)} mm</b>Physical annulus gap</span><span><b>{pkg.discretization.totalCells.toLocaleString()}</b>2D cells</span></div>
      </section>

      <section className="simulation-setup-card">
        <div className="card-heading"><div><span>CASE SETUP</span><h2>Discretization and solver handoff</h2></div></div>
        <div className="simulation-form-grid">
          <label><span>Circumferential cells</span><input type="number" min="1" step="1" value={value(settings.circumferentialCells)} onChange={(event) => setNumber("circumferentialCells", event.target.value)}/><small>{pkg.discretization.circumferentialCellSizeMm.toFixed(4)} mm nominal spacing</small></label>
          <label><span>Axial cells</span><input type="number" min="1" step="1" value={value(settings.axialCells)} onChange={(event) => setNumber("axialCells", event.target.value)}/><small>{pkg.discretization.axialCellSizeMm.toFixed(4)} mm nominal spacing</small></label>
          <label><span>Time step</span><div className="input-with-unit"><input type="number" min="0" value={value(settings.timeStepNs)} onChange={(event) => setNumber("timeStepNs", event.target.value)}/><i>ns</i></div></label>
          <label><span>Simulated duration</span><div className="input-with-unit"><input type="number" min="0" value={value(settings.endTimeMs)} onChange={(event) => setNumber("endTimeMs", event.target.value)}/><i>ms</i></div></label>
          <label><span>Pressure probes</span><input type="number" min="1" step="1" value={value(settings.probeCount)} onChange={(event) => setNumber("probeCount", event.target.value)}/><small>Equally spaced at mid-chamber</small></label>
          <label className="wide"><span>Solver</span><input value={settings.solver} onChange={(event) => setText("solver", event.target.value)}/></label>
          <label className="wide"><span>Chemistry mechanism or reference</span><input value={settings.chemistryMechanism} onChange={(event) => setText("chemistryMechanism", event.target.value)}/></label>
        </div>
      </section>
    </div>

    <section className="simulation-readiness-card">
      <div className="simulation-readiness-summary"><div><span>EXPORT READINESS</span><strong className={pkg.readiness.exportReady ? "ready" : "blocked"}>{pkg.readiness.exportReady ? "Geometry package ready" : "Setup incomplete"}</strong><p>{pkg.readiness.exportReady ? "Kythros can export the traceable domain, mesh dictionary, probe template, and setup record." : pkg.readiness.blockingIssues[0]}</p></div><div><span>SOLVER READINESS</span><strong className="review">Engineer review required</strong><p>No solver, chemistry mechanism, boundary condition, or mesh value is represented as validated automatically.</p></div></div>
      <details><summary>Five items required before running this case</summary><ol>{pkg.readiness.engineerReview.map((item) => <li key={item}>{item}</li>)}</ol></details>
      <div className="simulation-actions"><button className="button primary" disabled={!pkg.readiness.exportReady} onClick={() => { download(JSON.stringify(pkg, null, 2), rde2dPackageFileName(activeDesign)); setExported(true); }}>Download 2D case package</button><button className="button secondary" onClick={onOpenDesign}>Edit engine</button><button className="button secondary" onClick={onOpenEnvelope}>Choose another condition</button></div>
      {exported && <div className="simulation-next-step"><span>PACKAGE EXPORTED</span><strong>Run it only after completing the engineering review.</strong><p>When the solver produces pressure histories, return them to Kythros for automatic wave analysis. Experimental data are optional unless you want physical validation.</p><button className="button secondary" onClick={onOpenValidation}>Open result analysis →</button></div>}
    </section>
  </section>;
}
