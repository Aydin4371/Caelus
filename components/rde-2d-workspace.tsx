"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import type { EngineDesign, OperatingPoint } from "@/lib/design-workspace";
import { runFastRde2d, type FastRde2dProgress, type FastRde2dResult } from "@/lib/fast-rde-2d";
import {
  analyzeRde2dResult,
  buildRde2dPackage,
  midpointCondition,
  parseRde2dResult,
  RDE_2D_PRESETS,
  relativeRde2dWork,
  rde2dPackageFileName,
  settingsForPreset,
  type Rde2dPresetId,
  type Rde2dResultSummary,
  type Rde2dSettings,
} from "@/lib/rde-2d-workflow";

type Props = {
  designs: EngineDesign[];
  activeDesignId: string | null;
  operatingPoints: OperatingPoint[];
  onSelectDesign: (id: string) => void;
  onOpenDesign: () => void;
  onOpenEnvelope: () => void;
  onOpenValidation: () => void;
};

type FieldMetric = "pressure" | "temperature" | "reaction" | "velocity";

function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function formatMetric(value: number | null, unit = "") {
  return value === null || !Number.isFinite(value) ? "Not resolved" : `${value.toFixed(Math.abs(value) >= 100 ? 1 : 2)}${unit}`;
}

function isFastResult(result: Rde2dResultSummary): result is FastRde2dResult {
  return result.evidenceClass === "browser-screening" && "field" in result && "screeningDiagnostics" in result;
}

function color(value: number) {
  const x = Math.max(0, Math.min(1, value));
  const stops = [[18, 45, 66], [23, 118, 145], [62, 181, 156], [244, 207, 96], [218, 105, 53], [124, 35, 47]];
  const scaled = x * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  return stops[index].map((channel, channelIndex) => Math.round(channel + fraction * (stops[index + 1][channelIndex] - channel)));
}

function FastRdeFieldCanvas({ result, metric }: { result: FastRde2dResult; metric: FieldMetric }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = result.field;
  const values = metric === "pressure" ? field.pressureBar : metric === "temperature" ? field.temperatureK : metric === "reaction" ? field.reactionProgress : field.velocityMps;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(field.nx, field.ny);
    const span = Math.max(1e-12, maximum - minimum);
    for (let y = 0; y < field.ny; y += 1) {
      for (let x = 0; x < field.nx; x += 1) {
        const source = y * field.nx + x;
        const target = ((field.ny - 1 - y) * field.nx + x) * 4;
        const [red, green, blue] = color((values[source] - minimum) / span);
        image.data[target] = red;
        image.data[target + 1] = green;
        image.data[target + 2] = blue;
        image.data[target + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [field, maximum, metric, minimum, values]);
  const unit = metric === "pressure" ? "bar" : metric === "temperature" ? "K" : metric === "reaction" ? "burned" : "m/s";
  return <div className="fast-field-visual">
    <div className="fast-field-boundary"><span>Chamber exit</span><small>Periodic circumferential direction →</small></div>
    <canvas ref={canvas} width={field.nx} height={field.ny} aria-label={`Computed ${metric} field from Kythros Fast 2D`} />
    <div className="fast-field-legend"><span>Injector boundary</span><div><small>{minimum.toFixed(metric === "reaction" ? 2 : 1)} {unit}</small><i /><small>{maximum.toFixed(metric === "reaction" ? 2 : 1)} {unit}</small></div></div>
  </div>;
}

export function Rde2dWorkspace({ designs, activeDesignId, operatingPoints, onSelectDesign, onOpenDesign, onOpenEnvelope, onOpenValidation }: Props) {
  const activeDesign = designs.find((item) => item.id === activeDesignId) ?? designs.at(-1) ?? null;
  const points = activeDesign ? operatingPoints.filter((point) => point.designId === activeDesign.id) : [];
  const [selectedPointId, setSelectedPointId] = useState("midpoint");
  const [presetId, setPresetId] = useState<Rde2dPresetId>("balanced");
  const [settings, setSettings] = useState<Rde2dSettings>(() => settingsForPreset("balanced"));
  const [exported, setExported] = useState(false);
  const [result, setResult] = useState<Rde2dResultSummary | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<FastRde2dProgress | null>(null);
  const [fieldMetric, setFieldMetric] = useState<FieldMetric>("pressure");
  const abortController = useRef<AbortController | null>(null);
  const condition = activeDesign ? points.find((point) => point.id === selectedPointId) ?? midpointCondition(activeDesign) : null;
  const packageData = activeDesign && condition ? buildRde2dPackage(activeDesign, condition, settings) : null;
  const recommendation = activeDesign && condition && result ? analyzeRde2dResult(activeDesign, condition, result) : null;

  const resetResult = () => { setResult(null); setResultError(null); setExported(false); setProgress(null); };
  const setDiscrete = (patch: Partial<Rde2dSettings>) => { setPresetId("custom"); setSettings((current) => ({ ...current, ...patch })); resetResult(); };
  const choosePreset = (id: Rde2dPresetId) => {
    setPresetId(id);
    if (id !== "custom") setSettings((current) => settingsForPreset(id, current));
    resetResult();
  };
  const importResult = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setResult(parseRde2dResult(await file.text()));
      setResultError(null);
    } catch (error) {
      setResult(null);
      setResultError(error instanceof Error ? error.message : "Kythros could not read this result summary.");
    } finally {
      event.target.value = "";
    }
  };

  if (!activeDesign) return <section className="empty-workspace simulation-empty">
    <span className="empty-kicker">2D RDE DEVELOPMENT</span><h1>Define an engine before running the model</h1>
    <p>The browser solver inherits its annulus, chamber, propellants, injectors, and operating range from an immutable Kythros engine revision.</p>
    <div className="empty-actions"><button className="button primary" onClick={onOpenDesign}>Build an RDE →</button></div>
  </section>;

  const pkg = packageData!;
  const width = pkg.geometry.circumferenceMm;
  const height = pkg.geometry.chamberLengthMm;
  const ratio = Math.min(5, Math.max(1.6, width / Math.max(height, 1)));
  const work = relativeRde2dWork(settings);
  const resultTemplate = pkg.files.find((file) => file.path === "kythros-result.template.json");
  const fastResult = result && isFastResult(result) ? result : null;
  const runBrowserSolver = async () => {
    setResultError(null);
    if (!pkg.readiness.exportReady) { setResultError(pkg.readiness.blockingIssues[0] ?? "Complete the 2D setup before running."); return; }
    if (settings.solver !== "Kythros Fast 2D browser solver") { setResultError("Choose Kythros Fast 2D in Solver to run inside the browser."); return; }
    if (settings.chemistryMechanism !== "Simplified one-step heat release") { setResultError("Choose Simplified one-step heat release to run inside the browser."); return; }
    const controller = new AbortController();
    abortController.current = controller;
    setRunning(true);
    setResult(null);
    setProgress({ fraction: 0, step: 0, simulatedTimeMs: 0, stage: "initializing" });
    try {
      const computed = await runFastRde2d(activeDesign, condition!, settings, { signal: controller.signal, onProgress: setProgress });
      setResult(computed);
    } catch (error) {
      setResultError(error instanceof DOMException && error.name === "AbortError" ? "The browser simulation was cancelled." : error instanceof Error ? error.message : "Kythros Fast 2D could not complete this run.");
    } finally {
      abortController.current = null;
      setRunning(false);
    }
  };

  return <section className="simulation-workspace" aria-labelledby="simulation-title">
    <header className="simulation-heading">
      <div><span className="workspace-label">KYTHROS FAST 2D</span><h1 id="simulation-title">Run an RDE screening model in your browser</h1><p>Choose a preset, calculate the reactive flow on this computer, then review the field and one engine change to test. No cloud account or solver installation is required.</p></div>
      <div className="simulation-stage"><span>1 · Design</span><strong>2 · Set up</strong><span>3 · Run</span><span>4 · Results</span><span>5 · Improve</span></div>
    </header>

    <div className="simulation-context-bar">
      <label><span>Engine revision</span><select disabled={running} value={activeDesign.id} onChange={(event) => { onSelectDesign(event.target.value); setSelectedPointId("midpoint"); resetResult(); }}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}{design.revision ? ` · r${design.revision.number}` : ""}</option>)}</select></label>
      <label><span>Operating condition</span><select disabled={running} value={selectedPointId} onChange={(event) => { setSelectedPointId(event.target.value); resetResult(); }}><option value="midpoint">Design-range midpoint</option>{points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label>
      <div><span>Condition</span><strong>ϕ {condition!.equivalenceRatio.toFixed(3)} · {condition!.massFlowKgS.toFixed(3)} kg/s · {condition!.inletPressureBar.toFixed(2)} bar</strong></div>
    </div>

    <section className="simulation-preset-card">
      <div><span>RUN PRESET</span><h2>Choose speed</h2><p>Each preset changes the grid, maximum time step, and simulated duration together.</p></div>
      <label><span>Simulation preset</span><select disabled={running} value={presetId} onChange={(event) => choosePreset(event.target.value as Rde2dPresetId)}>{RDE_2D_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.purpose}</option>)}<option value="custom">Custom settings</option></select></label>
      <div className="simulation-cost"><span>RELATIVE WORK</span><strong>{Number.isFinite(work) ? `${work.toFixed(work < 0.1 ? 2 : 1)}×` : "—"}</strong><small>Refined preset = 1.0×</small></div>
    </section>

    <div className="simulation-primary-grid">
      <section className="simulation-domain-card">
        <div className="card-heading"><div><span>DOMAIN</span><h2>Periodic unwrapped annulus</h2></div><small>Model geometry</small></div>
        <svg viewBox={`0 0 ${500 * ratio / 3} 240`} role="img" aria-label="Two-dimensional unwrapped annular RDE chamber domain">
          <defs><pattern id="sim-grid" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M 18 0 L 0 0 0 18" fill="none" stroke="#c9dddf" strokeWidth="0.8" /></pattern><linearGradient id="sim-domain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f8ead8"/><stop offset="1" stopColor="#e5f2f2"/></linearGradient></defs>
          <rect x="42" y="30" width={`${500 * ratio / 3 - 74}`} height="160" rx="3" fill="url(#sim-domain)" stroke="#214d5c" strokeWidth="2"/>
          <rect x="42" y="30" width={`${500 * ratio / 3 - 74}`} height="160" fill="url(#sim-grid)" opacity=".85"/>
          <line x1="42" y1="30" x2="42" y2="190" stroke="#6679bd" strokeWidth="4" strokeDasharray="8 5"/><line x1={`${500 * ratio / 3 - 32}`} y1="30" x2={`${500 * ratio / 3 - 32}`} y2="190" stroke="#6679bd" strokeWidth="4" strokeDasharray="8 5"/>
          <line x1="42" y1="190" x2={`${500 * ratio / 3 - 32}`} y2="190" stroke="#c8873d" strokeWidth="5"/><line x1="42" y1="30" x2={`${500 * ratio / 3 - 32}`} y2="30" stroke="#2588a2" strokeWidth="5"/>
          <text x="50%" y="17" textAnchor="middle">Chamber exit</text><text x="50%" y="218" textAnchor="middle">Injector boundary</text><text x="18" y="112" textAnchor="middle" transform="rotate(-90 18 112)">Periodic</text><text x={`${500 * ratio / 3 - 9}`} y="112" textAnchor="middle" transform={`rotate(90 ${500 * ratio / 3 - 9} 112)`}>Periodic</text>
        </svg>
        <div className="simulation-domain-stats"><span><b>{width.toFixed(2)} mm</b>Circumference</span><span><b>{height.toFixed(2)} mm</b>Axial length</span><span><b>{pkg.geometry.annulusGapMm.toFixed(2)} mm</b>Annulus gap</span><span><b>{pkg.discretization.totalCells.toLocaleString()}</b>Cells</span></div>
      </section>

      <section className="simulation-setup-card">
        <div className="card-heading"><div><span>MODEL SETUP</span><h2>Fast screening controls</h2></div></div>
        <div className="simulation-form-grid">
          <label className="wide"><span>Grid</span><select disabled={running} value={`${settings.circumferentialCells}x${settings.axialCells}`} onChange={(event) => { const [circumferentialCells, axialCells] = event.target.value.split("x").map(Number); setDiscrete({ circumferentialCells, axialCells }); }}><option value="96x32">Quick · 96 × 32</option><option value="144x48">Balanced · 144 × 48</option><option value="192x64">Refined · 192 × 64</option><option value="256x80">Extra refined · 256 × 80</option></select><small>{pkg.discretization.circumferentialCellSizeMm.toFixed(3)} × {pkg.discretization.axialCellSizeMm.toFixed(3)} mm</small></label>
          <label><span>Maximum time step</span><select disabled={running} value={settings.timeStepNs} onChange={(event) => setDiscrete({ timeStepNs: Number(event.target.value) })}><option value="1000">1,000 ns · quick</option><option value="500">500 ns · balanced</option><option value="250">250 ns · refined</option><option value="125">125 ns · extra refined</option></select></label>
          <label><span>Simulated duration</span><select disabled={running} value={settings.endTimeMs} onChange={(event) => setDiscrete({ endTimeMs: Number(event.target.value) })}><option value="0.15">0.15 ms · quick</option><option value="0.3">0.30 ms · balanced</option><option value="0.45">0.45 ms · refined</option><option value="0.6">0.60 ms · extended</option></select></label>
          <label><span>Pressure probes</span><select disabled={running} value={settings.probeCount} onChange={(event) => setDiscrete({ probeCount: Number(event.target.value) })}><option value="4">4 · quick</option><option value="8">8 · standard</option><option value="12">12 · dense</option></select></label>
          <label className="wide"><span>Solver</span><select disabled={running} value={settings.solver} onChange={(event) => setDiscrete({ solver: event.target.value })}><option>Kythros Fast 2D browser solver</option><option>OpenFOAM · export only</option><option>Ansys Fluent · export only</option><option>Simcenter STAR-CCM+ · export only</option></select></label>
          <label className="wide"><span>Reaction model</span><select disabled={running} value={settings.chemistryMechanism} onChange={(event) => setDiscrete({ chemistryMechanism: event.target.value })}><option>Simplified one-step heat release</option><option>External detailed chemistry · export only</option></select></label>
        </div>
      </section>
    </div>

    <section className="browser-solver-card" aria-labelledby="browser-solver-title">
      <div className="browser-solver-heading"><div><span>NO-CLOUD EXECUTION</span><h2 id="browser-solver-title">Calculate the 2D flow now</h2><p>Your browser solves the reduced reactive-flow equations on this computer. Kythros does not upload the engine or use paid cloud compute.</p></div><div className="runner-badge ready"><i />Free · device CPU</div></div>
      <div className="browser-solver-body">
        <div><span>THIS MODEL INCLUDES</span><strong>Compressible flow, shocks, periodic propagation, injection, ignition, and simplified heat release</strong><p>It does not include turbulence, detailed chemistry, resolved injector jets, viscous wall heat flux, cooling life, or 3D modes.</p></div>
        <div className="simulation-actions"><button className="button primary" disabled={running} onClick={() => void runBrowserSolver()}>{running ? "Calculating…" : "Run Kythros Fast 2D"}</button>{running && <button className="button danger" onClick={() => abortController.current?.abort()}>Cancel</button>}</div>
      </div>
      {progress && <div className="browser-solver-progress" aria-live="polite"><div><span>{progress.stage === "solving" ? `Solving step ${progress.step.toLocaleString()}` : progress.stage === "analyzing" ? "Analyzing the computed field" : "Initializing the flow field"}</span><strong>{Math.round(progress.fraction * 100)}%</strong></div><progress max="1" value={progress.fraction}/><small>{progress.simulatedTimeMs.toFixed(3)} ms simulated</small></div>}
      {resultError && <p className="runner-error" role="alert">{resultError}</p>}
    </section>

    <section className="simulation-results-card" aria-labelledby="simulation-results-title">
      <div className="simulation-results-heading"><div><span>COMPUTED RESULT</span><h2 id="simulation-results-title">Flow field and next engine change</h2><p>The browser result appears here automatically. Import remains available for an external solver.</p></div><label className="result-upload button secondary">Import external result<input type="file" accept="application/json,.json" onChange={importResult}/></label></div>
      {!result || !recommendation ? <div className="simulation-result-empty"><strong>No computed field yet</strong><p>Select a preset and run Kythros Fast 2D. The calculation stays on this computer.</p><div><span>1 · Solve flow</span><span>2 · Inspect field</span><span>3 · Review recommendation</span></div></div> : <>
        {fastResult && <section className="fast-field-panel">
          <div className="fast-field-heading"><div><span>FINAL FIELD · {fastResult.field.nx} × {fastResult.field.ny}</span><strong>Calculated—not an illustration</strong></div><label><span>Display</span><select value={fieldMetric} onChange={(event) => setFieldMetric(event.target.value as FieldMetric)}><option value="pressure">Pressure</option><option value="temperature">Temperature</option><option value="reaction">Reaction progress</option><option value="velocity">Velocity</option></select></label></div>
          <FastRdeFieldCanvas result={fastResult} metric={fieldMetric}/>
          <div className="fast-field-metrics"><span><small>Peak pressure</small><strong>{fastResult.screeningDiagnostics.peakPressureBar.toFixed(2)} bar</strong></span><span><small>Peak temperature</small><strong>{fastResult.screeningDiagnostics.peakTemperatureK.toFixed(0)} K</strong></span><span><small>Wave speed</small><strong>{formatMetric(fastResult.screeningDiagnostics.estimatedWaveSpeedMps, " m/s")}</strong></span><span><small>Estimated thrust</small><strong>{fastResult.screeningDiagnostics.estimatedThrustN.toFixed(1)} N</strong></span><span><small>Device runtime</small><strong>{(fastResult.screeningDiagnostics.elapsedMs / 1000).toFixed(1)} s</strong></span></div>
        </section>}
        <div className="simulation-result-kpis"><span><small>Solver</small><strong>{result.solverName}</strong></span><span><small>Mode</small><strong>{result.propagationMode.replace("-", " ")}</strong></span><span><small>Frequency</small><strong>{formatMetric(result.dominantFrequencyKHz, " kHz")}</strong></span><span><small>Backflow</small><strong>{formatMetric(result.injectorBackflowPct, "%")}</strong></span><span><small>Wall heat flux</small><strong>{formatMetric(result.peakWallHeatFluxMWm2, " MW/m²")}</strong></span></div>
        <div className={`simulation-result-status ${recommendation.resultUsable ? "usable" : "blocked"}`}><strong>{recommendation.resultUsable ? result.evidenceClass === "browser-screening" ? "Screening result ready" : "Numerical gates passed" : "Engine advice withheld"}</strong><p>{recommendation.resultUsable ? result.evidenceClass === "browser-screening" ? "Use this result to choose the next screening change. Confirm important decisions with higher-fidelity CFD and experiment." : "Kythros can use this solver summary for a provisional design decision." : recommendation.pairingIssues[0] ?? recommendation.numericalIssues[0]}</p></div>
        <div className="simulation-recommendation-grid">
          <article className="engine-recommendation"><span>ENGINE CHANGE TO TEST</span><h3>{recommendation.engine.title}</h3><p>{recommendation.engine.action}</p><small>Why: {recommendation.engine.reason}</small>{recommendation.engine.target !== "none" && <button className="button secondary" onClick={recommendation.engine.target === "operating-condition" ? onOpenEnvelope : onOpenDesign}>{recommendation.engine.target === "operating-condition" ? "Choose operating condition →" : "Open engine design →"}</button>}</article>
          <article className="solver-recommendation"><span>NEXT 2D SIMULATION</span><h3>{recommendation.simulation.title}</h3><p>{recommendation.simulation.action}</p><small>Why: {recommendation.simulation.reason}</small></article>
        </div>
        {fastResult && <div className="fast-result-actions"><button className="button secondary" onClick={() => download(JSON.stringify(fastResult, null, 2), `kythros-fast-2d-${activeDesign.id}.json`)}>Download calculated result</button><details><summary>Numerical integrity</summary><p>{fastResult.screeningDiagnostics.steps.toLocaleString()} CFL-controlled steps · mass conservation error {fastResult.screeningDiagnostics.massConservationErrorPct.toFixed(4)}% · positivity repairs {fastResult.screeningDiagnostics.positivityRepairPct.toFixed(4)}%.</p><p>{fastResult.limitation}</p></details></div>}
      </>}
      <div className="simulation-validation-link"><div><strong>Have matched hot-fire data?</strong><p>Use Experiment Validation only when testing whether a simulation represents the physical engine.</p></div><button className="button secondary" onClick={onOpenValidation}>Open Experiment Validation →</button></div>
    </section>

    <section className="simulation-readiness-card external-export-card">
      <details><summary>Export this design to another CFD solver</summary><div className="simulation-readiness-summary"><div><span>CASE PACKAGE</span><strong className={pkg.readiness.exportReady ? "ready" : "blocked"}>{pkg.readiness.exportReady ? "Ready" : "Incomplete"}</strong><p>{pkg.readiness.exportReady ? "Periodic geometry, run settings, probe template, and traceability record." : pkg.readiness.blockingIssues[0]}</p></div><div><span>EXTERNAL SOLVER</span><strong className="review">Engineer review required</strong><p>Detailed chemistry, turbulence, walls, ignition, and convergence remain external-solver responsibilities.</p></div></div><div className="simulation-actions"><button className="button secondary" disabled={!pkg.readiness.exportReady} onClick={() => { download(JSON.stringify(pkg, null, 2), rde2dPackageFileName(activeDesign)); setExported(true); }}>Download 2D case package</button>{resultTemplate && <button className="button secondary" onClick={() => download(resultTemplate.content, "kythros-result.template.json")}>Download result template</button>}<button className="button secondary" onClick={onOpenEnvelope}>Choose another condition</button></div>{exported && <p className="simulation-next-step">Package downloaded. Complete and review the selected external solver before execution.</p>}</details>
    </section>
  </section>;
}
