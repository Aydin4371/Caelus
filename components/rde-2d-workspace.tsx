"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import type { EngineDesign, OperatingPoint } from "@/lib/design-workspace";
import { runFastRde2d, type FastRde2dProgress, type FastRde2dResult } from "@/lib/fast-rde-2d";
import { RdeComputedFlow3d, type ComputedFlowMetric } from "@/components/rde-computed-flow-3d";
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

type FieldMetric = ComputedFlowMetric;
type CfdFidelity = "rapid-2d" | "detailed-2d" | "full-3d";

const CFD_LEVELS: Array<{ id: CfdFidelity; label: string; status: string; purpose: string }> = [
  { id: "rapid-2d", label: "Rapid 2D", status: "Runs now", purpose: "Screen geometry, wave development, pressure, velocity, and engine changes." },
  { id: "detailed-2d", label: "Detailed 2D", status: "Solver workflow", purpose: "Prepare finite-rate chemistry, turbulence, wall, and convergence work." },
  { id: "full-3d", label: "Full 3D", status: "Solver workflow", purpose: "Prepare resolved injectors, radial structure, cooling, and nozzle flow." },
];

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
  const [fidelity, setFidelity] = useState<CfdFidelity>("rapid-2d");
  const [externalSolver, setExternalSolver] = useState("OpenFOAM");
  const [turbulenceModel, setTurbulenceModel] = useState("Inviscid screening");
  const [wallModel, setWallModel] = useState("Adiabatic wall");
  const [injectorTreatment, setInjectorTreatment] = useState("Distributed inlet boundary");
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
  const selectedLevel = CFD_LEVELS.find((level) => level.id === fidelity)!;

  const resetResult = () => { setResult(null); setResultError(null); setExported(false); setProgress(null); };
  const setDiscrete = (patch: Partial<Rde2dSettings>) => { setPresetId("custom"); setSettings((current) => ({ ...current, ...patch })); resetResult(); };
  const choosePreset = (id: Rde2dPresetId) => {
    setPresetId(id);
    if (id !== "custom") setSettings((current) => settingsForPreset(id, current));
    resetResult();
  };
  const chooseFidelity = (next: CfdFidelity) => {
    setFidelity(next);
    setTurbulenceModel(next === "rapid-2d" ? "Inviscid screening" : next === "detailed-2d" ? "RANS" : "LES");
    setWallModel(next === "rapid-2d" ? "Adiabatic wall" : "Conjugate heat transfer");
    setInjectorTreatment(next === "full-3d" ? "Resolved discrete injectors" : "Distributed inlet boundary");
    if (next === "rapid-2d") setSettings((current) => ({ ...current, solver: "Kythros Fast 2D browser solver", chemistryMechanism: "Simplified one-step heat release" }));
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
    <span className="empty-kicker">RDE CFD SUITE</span><h1>Define an engine before running CFD</h1>
    <p>Every simulation inherits its annulus, chamber, propellants, injectors, cooling, and operating range from an immutable Kythros engine revision.</p>
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
    if (settings.solver !== "Kythros Fast 2D browser solver") { setResultError("Choose Rapid 2D to run the built-in calculation."); return; }
    if (settings.chemistryMechanism !== "Simplified one-step heat release") { setResultError("Rapid 2D requires the simplified one-step heat-release model."); return; }
    const controller = new AbortController();
    abortController.current = controller;
    setRunning(true);
    setResult(null);
    setProgress({ fraction: 0, step: 0, simulatedTimeMs: 0, stage: "initializing" });
    try {
      const computed = await runFastRde2d(activeDesign, condition!, settings, { signal: controller.signal, onProgress: setProgress });
      setResult(computed);
    } catch (error) {
      setResultError(error instanceof DOMException && error.name === "AbortError" ? "The simulation was cancelled." : error instanceof Error ? error.message : "Kythros Rapid 2D could not complete this run.");
    } finally {
      abortController.current = null;
      setRunning(false);
    }
  };
  const downloadSuitePlan = () => {
    const plan = {
      schema: "kythros-cfd-suite-plan",
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      designId: activeDesign.id,
      designFingerprint: activeDesign.revision?.fingerprint ?? null,
      operatingCondition: condition,
      fidelity,
      solver: fidelity === "rapid-2d" ? "Kythros Rapid 2D" : externalSolver,
      models: {
        flow: fidelity === "rapid-2d" ? "Compressible reactive Euler" : fidelity === "detailed-2d" ? "Compressible reacting RANS or LES" : "Compressible reacting 3D RANS or LES",
        chemistry: settings.chemistryMechanism,
        turbulence: turbulenceModel,
        wall: wallModel,
        injector: injectorTreatment,
      },
      mesh: pkg.discretization,
      requiredOutputs: ["pressure", "temperature", "velocity", "reaction progress", "pressure probes", "mass balance", "thrust"],
      traceability: "Every result must retain this design ID, fingerprint, operating-condition ID, solver version, mesh, time step, and model selection.",
      limitation: fidelity === "full-3d" ? "This is a solver-neutral full-3D work specification, not a computed 3D result or validated solver case." : "This is a solver-neutral detailed-2D work specification, not a completed external-solver result.",
    };
    download(JSON.stringify(plan, null, 2), `kythros-${fidelity}-${activeDesign.id}.json`);
    setExported(true);
  };

  return <section className="simulation-workspace" aria-labelledby="simulation-title">
    <header className="simulation-heading">
      <div><span className="workspace-label">RDE FLOW SIMULATION</span><h1 id="simulation-title">Input. Run. See the flow.</h1><p>Select the engine, operating condition, and simulation quality. Kythros calculates the flow, shows it in the 3D engine, and tells you what to change.</p></div>
      <div className="simulation-stage"><span>1 · Design</span><strong>2 · Simulate</strong><span>3 · Inspect 3D</span><span>4 · Improve</span><span>5 · Validate</span></div>
    </header>

    <div className="simulation-context-bar">
      <label><span>Engine revision</span><select disabled={running} value={activeDesign.id} onChange={(event) => { onSelectDesign(event.target.value); setSelectedPointId("midpoint"); resetResult(); }}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}{design.revision ? ` · r${design.revision.number}` : ""}</option>)}</select></label>
      <label><span>Operating condition</span><select disabled={running} value={selectedPointId} onChange={(event) => { setSelectedPointId(event.target.value); resetResult(); }}><option value="midpoint">Design-range midpoint</option>{points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label>
      <div><span>Condition</span><strong>ϕ {condition!.equivalenceRatio.toFixed(3)} · {condition!.massFlowKgS.toFixed(3)} kg/s · {condition!.inletPressureBar.toFixed(2)} bar</strong></div>
    </div>

    <section className="simulation-preset-card cfd-level-card">
      <div><span>SOLVER FIDELITY</span><h2>Choose what this run must resolve</h2><p>Start fast, then increase fidelity only when the decision requires it.</p></div>
      <label><span>CFD level</span><select disabled={running} value={fidelity} onChange={(event) => chooseFidelity(event.target.value as CfdFidelity)}><option value="rapid-2d">Rapid 2D · runs now</option><option value="detailed-2d">Detailed 2D · solver workflow</option><option value="full-3d">Full 3D · solver workflow</option></select></label>
      <div className="simulation-cost"><span>{selectedLevel.status}</span><strong>{fidelity === "rapid-2d" && Number.isFinite(work) ? `${work.toFixed(work < 0.1 ? 2 : 1)}×` : fidelity === "detailed-2d" ? "2D+" : "3D"}</strong><small>{selectedLevel.purpose}</small></div>
    </section>

    <div className="cfd-fidelity-strip" aria-label="CFD fidelity levels">{CFD_LEVELS.map((level, index) => <button key={level.id} className={fidelity === level.id ? "active" : ""} onClick={() => chooseFidelity(level.id)} disabled={running}><b>{index + 1}</b><span><strong>{level.label}</strong><small>{level.status}</small></span></button>)}</div>

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
        <div className="card-heading"><div><span>INPUT</span><h2>Simulation quality</h2></div></div>
        <div className="simulation-form-grid">
          <label className="wide"><span>Run preset</span><select disabled={running} value={presetId} onChange={(event) => choosePreset(event.target.value as Rde2dPresetId)}>{RDE_2D_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.purpose}</option>)}<option value="custom">Custom settings</option></select></label>
          <label className="wide"><span>Grid</span><select disabled={running} value={`${settings.circumferentialCells}x${settings.axialCells}`} onChange={(event) => { const [circumferentialCells, axialCells] = event.target.value.split("x").map(Number); setDiscrete({ circumferentialCells, axialCells }); }}><option value="96x32">Quick · 96 × 32</option><option value="144x48">Balanced · 144 × 48</option><option value="192x64">Refined · 192 × 64</option><option value="256x80">Extra refined · 256 × 80</option></select><small>{pkg.discretization.circumferentialCellSizeMm.toFixed(3)} × {pkg.discretization.axialCellSizeMm.toFixed(3)} mm</small></label>
          <label><span>Maximum time step</span><select disabled={running} value={settings.timeStepNs} onChange={(event) => setDiscrete({ timeStepNs: Number(event.target.value) })}><option value="1000">1,000 ns · quick</option><option value="500">500 ns · balanced</option><option value="250">250 ns · refined</option><option value="125">125 ns · extra refined</option></select></label>
          <label><span>Simulated duration</span><select disabled={running} value={settings.endTimeMs} onChange={(event) => setDiscrete({ endTimeMs: Number(event.target.value) })}><option value="0.15">0.15 ms · quick</option><option value="0.3">0.30 ms · balanced</option><option value="0.45">0.45 ms · refined</option><option value="0.6">0.60 ms · extended</option></select></label>
          <label><span>Pressure probes</span><select disabled={running} value={settings.probeCount} onChange={(event) => setDiscrete({ probeCount: Number(event.target.value) })}><option value="4">4 · quick</option><option value="8">8 · standard</option><option value="12">12 · dense</option></select></label>
          {fidelity !== "rapid-2d" && <label className="wide"><span>Solver</span><select disabled={running} value={externalSolver} onChange={(event) => { setExternalSolver(event.target.value); resetResult(); }}><option>OpenFOAM</option><option>Ansys Fluent</option><option>Simcenter STAR-CCM+</option><option>Solver-neutral</option></select></label>}
          <label className="wide"><span>Chemistry</span><select disabled={running} value={settings.chemistryMechanism} onChange={(event) => setDiscrete({ chemistryMechanism: event.target.value })}><option>Simplified one-step heat release</option>{fidelity !== "rapid-2d" && <><option>Reduced finite-rate chemistry</option><option>Detailed finite-rate chemistry</option><option>Flamelet chemistry</option></>}</select></label>
          <label><span>Turbulence</span><select disabled={running || fidelity === "rapid-2d"} value={turbulenceModel} onChange={(event) => { setTurbulenceModel(event.target.value); resetResult(); }}><option>Inviscid screening</option><option>RANS</option><option>URANS</option><option>LES</option></select></label>
          <label><span>Wall and cooling</span><select disabled={running || fidelity === "rapid-2d"} value={wallModel} onChange={(event) => { setWallModel(event.target.value); resetResult(); }}><option>Adiabatic wall</option><option>Isothermal wall</option><option>Conjugate heat transfer</option><option>Resolved cooling channels</option></select></label>
          <label className="wide"><span>Injector treatment</span><select disabled={running || fidelity === "rapid-2d"} value={injectorTreatment} onChange={(event) => { setInjectorTreatment(event.target.value); resetResult(); }}><option>Distributed inlet boundary</option><option>Porous injector face</option><option>Resolved discrete injectors</option></select></label>
        </div>
      </section>
    </div>

    <section className="browser-solver-card" aria-labelledby="browser-solver-title">
      <div className="browser-solver-heading"><div><span>RUN</span><h2 id="browser-solver-title">{fidelity === "rapid-2d" ? "Run the flow simulation" : `Prepare the ${selectedLevel.label} simulation`}</h2><p>{fidelity === "rapid-2d" ? "Kythros calculates the flow, draws the streamlines through the engine, and returns one recommended change." : `Kythros packages the same engine revision, operating condition, ${externalSolver} selection, model choices, and required outputs for the higher-fidelity run.`}</p></div><div className={`runner-badge ${fidelity === "rapid-2d" ? "ready" : "review"}`}><i />{selectedLevel.status}</div></div>
      <div className="browser-solver-body">
        <div><span>{fidelity === "rapid-2d" ? "THIS RUN INCLUDES" : "CASE SPECIFICATION INCLUDES"}</span><strong>{fidelity === "rapid-2d" ? "Compressible flow, shocks, periodic propagation, injection, ignition, and simplified heat release" : `${turbulenceModel}, ${settings.chemistryMechanism}, ${wallModel}, and ${injectorTreatment}`}</strong><p>{fidelity === "rapid-2d" ? "Use Detailed 2D or Full 3D when the design decision requires turbulence, detailed chemistry, wall heating, discrete injectors, radial structure, or cooling flow." : "Review the generated mesh and numerical setup in the selected solver before execution, then return the result to this workspace."}</p></div>
        <div className="simulation-actions"><button className="button primary" disabled={running} onClick={() => fidelity === "rapid-2d" ? void runBrowserSolver() : downloadSuitePlan()}>{running ? "Calculating…" : fidelity === "rapid-2d" ? "Run simulation" : `Download ${selectedLevel.label} specification`}</button>{running && <button className="button danger" onClick={() => abortController.current?.abort()}>Cancel</button>}</div>
      </div>
      {progress && <div className="browser-solver-progress" aria-live="polite"><div><span>{progress.stage === "solving" ? `Solving step ${progress.step.toLocaleString()}` : progress.stage === "analyzing" ? "Analyzing the computed field" : "Initializing the flow field"}</span><strong>{Math.round(progress.fraction * 100)}%</strong></div><progress max="1" value={progress.fraction}/><small>{progress.simulatedTimeMs.toFixed(3)} ms simulated</small></div>}
      {resultError && <p className="runner-error" role="alert">{resultError}</p>}
    </section>

    <section className="simulation-results-card" aria-labelledby="simulation-results-title">
      <div className="simulation-results-heading"><div><span>OUTPUT</span><h2 id="simulation-results-title">Simulation result</h2><p>Follow the flow through the engine, review the key outputs, then apply the recommended change.</p></div><label className="result-upload button secondary">Import CFD result<input type="file" accept="application/json,.json" onChange={importResult}/></label></div>
      {!result || !recommendation ? <div className="simulation-result-empty"><strong>Your 3D flow result will appear here</strong><p>Choose the simulation quality above and press Run simulation.</p><div><span>Input</span><span>Run</span><span>Output</span></div></div> : <>
        {fastResult && <section className="fast-field-panel">
          <RdeComputedFlow3d design={activeDesign} result={fastResult} metric={fieldMetric} onMetricChange={setFieldMetric}/>
          <details className="flat-field-details"><summary>Inspect the unwrapped 2D calculation</summary><div className="fast-field-heading"><div><span>FINAL FIELD · {fastResult.field.nx} × {fastResult.field.ny}</span><strong>Periodic circumferential–axial solution</strong></div></div><FastRdeFieldCanvas result={fastResult} metric={fieldMetric}/></details>
          <div className="fast-field-metrics"><span><small>Peak pressure</small><strong>{fastResult.screeningDiagnostics.peakPressureBar.toFixed(2)} bar</strong></span><span><small>Peak temperature</small><strong>{fastResult.screeningDiagnostics.peakTemperatureK.toFixed(0)} K</strong></span><span><small>Wave speed</small><strong>{formatMetric(fastResult.screeningDiagnostics.estimatedWaveSpeedMps, " m/s")}</strong></span><span><small>Estimated thrust</small><strong>{fastResult.screeningDiagnostics.estimatedThrustN.toFixed(1)} N</strong></span><span><small>Device runtime</small><strong>{(fastResult.screeningDiagnostics.elapsedMs / 1000).toFixed(1)} s</strong></span></div>
        </section>}
        <div className="simulation-result-kpis"><span><small>Solver</small><strong>{result.solverName}</strong></span><span><small>Mode</small><strong>{result.propagationMode.replace("-", " ")}</strong></span><span><small>Frequency</small><strong>{formatMetric(result.dominantFrequencyKHz, " kHz")}</strong></span><span><small>Backflow</small><strong>{formatMetric(result.injectorBackflowPct, "%")}</strong></span><span><small>Wall heat flux</small><strong>{formatMetric(result.peakWallHeatFluxMWm2, " MW/m²")}</strong></span></div>
        <div className={`simulation-result-status ${recommendation.resultUsable ? "usable" : "blocked"}`}><strong>{recommendation.resultUsable ? result.evidenceClass === "browser-screening" ? "Screening result ready" : "Numerical gates passed" : "Engine advice withheld"}</strong><p>{recommendation.resultUsable ? result.evidenceClass === "browser-screening" ? "Use this result to choose the next screening change. Confirm important decisions with higher-fidelity CFD and experiment." : "Kythros can use this solver summary for a provisional design decision." : recommendation.pairingIssues[0] ?? recommendation.numericalIssues[0]}</p></div>
        <div className="simulation-recommendation-grid">
          <article className="engine-recommendation"><span>ENGINE CHANGE TO TEST</span><h3>{recommendation.engine.title}</h3><p>{recommendation.engine.action}</p><small>Why: {recommendation.engine.reason}</small>{recommendation.engine.target !== "none" && <button className="button secondary" onClick={recommendation.engine.target === "operating-condition" ? onOpenEnvelope : onOpenDesign}>{recommendation.engine.target === "operating-condition" ? "Choose operating condition →" : "Open engine design →"}</button>}</article>
          <article className="solver-recommendation"><span>NEXT SIMULATION</span><h3>{recommendation.simulation.title}</h3><p>{recommendation.simulation.action}</p><small>Why: {recommendation.simulation.reason}</small></article>
        </div>
        {fastResult && <div className="fast-result-actions"><button className="button secondary" onClick={() => download(JSON.stringify(fastResult, null, 2), `kythros-fast-2d-${activeDesign.id}.json`)}>Download calculated result</button><details><summary>Numerical integrity</summary><p>{fastResult.screeningDiagnostics.steps.toLocaleString()} CFL-controlled steps · mass conservation error {fastResult.screeningDiagnostics.massConservationErrorPct.toFixed(4)}% · positivity repairs {fastResult.screeningDiagnostics.positivityRepairPct.toFixed(4)}%.</p><p>{fastResult.limitation}</p></details></div>}
      </>}
      <div className="simulation-validation-link"><div><strong>Have matched hot-fire data?</strong><p>Use Experiment Validation only when testing whether a simulation represents the physical engine.</p></div><button className="button secondary" onClick={onOpenValidation}>Open Experiment Validation →</button></div>
    </section>

    <section className="simulation-readiness-card external-export-card">
      <details><summary>Solver handoff and traceability files</summary><div className="simulation-readiness-summary"><div><span>CASE PACKAGE</span><strong className={pkg.readiness.exportReady ? "ready" : "blocked"}>{pkg.readiness.exportReady ? "Ready" : "Incomplete"}</strong><p>{pkg.readiness.exportReady ? "Periodic geometry, run settings, probe template, and traceability record." : pkg.readiness.blockingIssues[0]}</p></div><div><span>HIGHER FIDELITY</span><strong className="review">Model review required</strong><p>Detailed chemistry, turbulence, walls, injectors, ignition, and convergence must be reviewed for the selected solver.</p></div></div><div className="simulation-actions"><button className="button secondary" disabled={!pkg.readiness.exportReady} onClick={() => { download(JSON.stringify(pkg, null, 2), rde2dPackageFileName(activeDesign)); setExported(true); }}>Download periodic 2D case</button><button className="button secondary" onClick={downloadSuitePlan}>Download current CFD specification</button>{resultTemplate && <button className="button secondary" onClick={() => download(resultTemplate.content, "kythros-result.template.json")}>Download result template</button>}<button className="button secondary" onClick={onOpenEnvelope}>Choose another condition</button></div>{exported && <p className="simulation-next-step">Files downloaded. The design ID and operating condition are preserved for result import and validation.</p>}</details>
    </section>
  </section>;
}
