"use client";

import { ChangeEvent, useEffect, useState } from "react";
import type { EngineDesign, OperatingPoint } from "@/lib/design-workspace";
import {
  cancelLocalRunnerJob,
  createLocalRunnerJob,
  getLocalRunnerHealth,
  getLocalRunnerJob,
  LOCAL_RUNNER_URL,
  type LocalRunnerHealth,
  type LocalRunnerJob,
} from "@/lib/local-openfoam-runner";
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

function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function formatMetric(value: number | null, unit = "") {
  return value === null || !Number.isFinite(value) ? "Not reported" : `${value.toFixed(Math.abs(value) >= 100 ? 1 : 2)}${unit}`;
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
  const [runnerHealth, setRunnerHealth] = useState<LocalRunnerHealth | null>(null);
  const [runnerChecking, setRunnerChecking] = useState(false);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [runnerSetupOpen, setRunnerSetupOpen] = useState(false);
  const [localJob, setLocalJob] = useState<LocalRunnerJob | null>(null);
  const condition = activeDesign ? points.find((point) => point.id === selectedPointId) ?? midpointCondition(activeDesign) : null;
  const packageData = activeDesign && condition ? buildRde2dPackage(activeDesign, condition, settings) : null;
  const recommendation = activeDesign && condition && result ? analyzeRde2dResult(activeDesign, condition, result) : null;
  const jobActive = localJob?.status === "queued" || localJob?.status === "running";

  const resetResult = () => { setResult(null); setResultError(null); setExported(false); setLocalJob(null); };
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
  const refreshRunner = async () => {
    setRunnerChecking(true);
    try {
      const health = await getLocalRunnerHealth();
      setRunnerHealth(health);
      setRunnerError(null);
      return health;
    } catch (error) {
      setRunnerHealth(null);
      setRunnerError(error instanceof Error ? error.message : "Kythros could not connect to the local runner.");
      return null;
    } finally {
      setRunnerChecking(false);
    }
  };
  const localJobId = localJob?.id;
  const localJobStatus = localJob?.status;
  useEffect(() => {
    if (!localJobId || !localJobStatus || !["queued", "running"].includes(localJobStatus)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getLocalRunnerJob(localJobId);
        setLocalJob(next);
        setRunnerError(null);
        if (next.status === "completed" && next.result) {
          try {
            setResult(parseRde2dResult(JSON.stringify(next.result)));
            setResultError(null);
          } catch (error) {
            setResultError(error instanceof Error ? error.message : "The local result summary could not be analyzed.");
          }
        }
      } catch (error) {
        setRunnerError(error instanceof Error ? error.message : "Kythros lost contact with the local runner.");
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [localJobId, localJobStatus]);

  if (!activeDesign) return <section className="empty-workspace simulation-empty">
    <span className="empty-kicker">2D RDE DEVELOPMENT</span><h1>Define an engine before preparing CFD</h1>
    <p>The 2D workflow inherits its annulus, chamber, injectors, propellants, and operating range from an immutable Kythros engine revision.</p>
    <div className="empty-actions"><button className="button primary" onClick={onOpenDesign}>Build an RDE →</button></div>
  </section>;

  const pkg = packageData!;
  const width = pkg.geometry.circumferenceMm;
  const height = pkg.geometry.chamberLengthMm;
  const ratio = Math.min(5, Math.max(1.6, width / Math.max(height, 1)));
  const work = relativeRde2dWork(settings);
  const resultTemplate = pkg.files.find((file) => file.path === "kythros-result.template.json");
  const startLocalJob = async (mode: LocalRunnerJob["mode"]) => {
    setRunnerError(null);
    setResultError(null);
    try {
      setLocalJob(await createLocalRunnerJob(mode, pkg));
    } catch (error) {
      setRunnerError(error instanceof Error ? error.message : "The local OpenFOAM job could not be started.");
    }
  };
  const runReactingCfd = async () => {
    setRunnerError(null);
    setRunnerSetupOpen(false);
    if (!pkg.readiness.exportReady || !settings.solver.startsWith("OpenFOAM")) {
      setRunnerSetupOpen(true);
      return;
    }
    const health = await refreshRunner();
    if (!health?.capabilities.reactingCfd) {
      setRunnerSetupOpen(true);
      return;
    }
    await startLocalJob("reacting-cfd");
  };
  const cancelLocalJob = async () => {
    if (!localJob) return;
    try {
      setLocalJob(await cancelLocalRunnerJob(localJob.id));
    } catch (error) {
      setRunnerError(error instanceof Error ? error.message : "The local job could not be cancelled.");
    }
  };
  const runnerSetupItems = [
    { label: "2D case package is ready", ready: pkg.readiness.exportReady, detail: pkg.readiness.exportReady ? "Geometry and run settings are complete" : pkg.readiness.blockingIssues[0] },
    { label: "OpenFOAM is the selected solver", ready: settings.solver.startsWith("OpenFOAM"), detail: settings.solver.startsWith("OpenFOAM") ? settings.solver : "Choose OpenFOAM in Case setup" },
    { label: "Local runner is reachable", ready: runnerHealth !== null, detail: runnerHealth ? LOCAL_RUNNER_URL : "Start the local companion, then check again" },
    { label: "Mesh commands are available", ready: Boolean(runnerHealth?.openfoam.blockMesh && runnerHealth?.openfoam.checkMesh), detail: "blockMesh and checkMesh" },
    { label: "Reviewed RDE template is configured", ready: Boolean(runnerHealth?.openfoam.templateConfigured), detail: "Set KYTHROS_OPENFOAM_TEMPLATE" },
    { label: "Reacting solver is configured", ready: Boolean(runnerHealth?.openfoam.solverConfigured), detail: runnerHealth?.openfoam.solverName ?? "Set KYTHROS_OPENFOAM_SOLVER" },
    { label: "Result adapter is configured", ready: Boolean(runnerHealth?.openfoam.postprocessorConfigured), detail: "Set KYTHROS_OPENFOAM_POSTPROCESSOR" },
  ];

  return <section className="simulation-workspace" aria-labelledby="simulation-title">
    <header className="simulation-heading">
      <div><span className="workspace-label">2D RDE DEVELOPMENT</span><h1 id="simulation-title">Set up, run locally, and improve</h1><p>Use a fast preset, connect to OpenFOAM on this computer, and execute a traceable job. A completed result is analyzed into separate simulation and engine-design actions.</p></div>
      <div className="simulation-stage"><span>1 · Design</span><strong>2 · Set up</strong><span>3 · Run</span><span>4 · Results</span><span>5 · Improve</span></div>
    </header>

    <div className="simulation-context-bar">
      <label><span>Engine revision</span><select disabled={jobActive} value={activeDesign.id} onChange={(event) => { onSelectDesign(event.target.value); setSelectedPointId("midpoint"); resetResult(); }}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}{design.revision ? ` · r${design.revision.number}` : ""}</option>)}</select></label>
      <label><span>Operating condition</span><select disabled={jobActive} value={selectedPointId} onChange={(event) => { setSelectedPointId(event.target.value); resetResult(); }}><option value="midpoint">Design-range midpoint</option>{points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label>
      <div><span>Condition</span><strong>ϕ {condition!.equivalenceRatio.toFixed(3)} · {condition!.massFlowKgS.toFixed(3)} kg/s · {condition!.inletPressureBar.toFixed(2)} bar</strong></div>
    </div>

    <section className="simulation-preset-card">
      <div><span>RUN PRESET</span><h2>Choose speed before editing details</h2><p>Presets change mesh, time step, duration, and probes together. The cost indicator is relative numerical work—not a wall-clock promise.</p></div>
      <label><span>Simulation preset</span><select disabled={jobActive} value={presetId} onChange={(event) => choosePreset(event.target.value as Rde2dPresetId)}>{RDE_2D_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.purpose}</option>)}<option value="custom">Custom settings</option></select></label>
      <div className="simulation-cost"><span>RELATIVE WORK</span><strong>{Number.isFinite(work) ? `${work.toFixed(work < 0.1 ? 3 : 1)}×` : "—"}</strong><small>Refined preset = 1.0×</small></div>
    </section>

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
        <div className="card-heading"><div><span>CASE SETUP</span><h2>Dropdowns for fast, repeatable setup</h2></div></div>
        <div className="simulation-form-grid">
          <label className="wide"><span>Mesh level</span><select disabled={jobActive} value={`${settings.circumferentialCells}x${settings.axialCells}`} onChange={(event) => { const [circumferentialCells, axialCells] = event.target.value.split("x").map(Number); setDiscrete({ circumferentialCells, axialCells }); }}><option value="180x60">Quick · 180 × 60</option><option value="360x120">Balanced · 360 × 120</option><option value="720x240">Refined · 720 × 240</option><option value="1080x360">Extra refined · 1080 × 360</option></select><small>{pkg.discretization.circumferentialCellSizeMm.toFixed(4)} × {pkg.discretization.axialCellSizeMm.toFixed(4)} mm nominal spacing</small></label>
          <label><span>Time step</span><select disabled={jobActive} value={settings.timeStepNs} onChange={(event) => setDiscrete({ timeStepNs: Number(event.target.value) })}><option value="20">20 ns · quick</option><option value="10">10 ns · balanced</option><option value="5">5 ns · refined</option><option value="2.5">2.5 ns · extra refined</option></select></label>
          <label><span>Simulated duration</span><select disabled={jobActive} value={settings.endTimeMs} onChange={(event) => setDiscrete({ endTimeMs: Number(event.target.value) })}><option value="0.25">0.25 ms · setup check</option><option value="0.5">0.50 ms · short development</option><option value="1">1.00 ms · standard</option><option value="2">2.00 ms · extended</option></select></label>
          <label><span>Pressure probes</span><select disabled={jobActive} value={settings.probeCount} onChange={(event) => setDiscrete({ probeCount: Number(event.target.value) })}><option value="4">4 · quick</option><option value="8">8 · standard</option><option value="12">12 · refined</option><option value="16">16 · dense</option></select></label>
          <label><span>Solver</span><select disabled={jobActive} value={settings.solver} onChange={(event) => setDiscrete({ solver: event.target.value })}><option>OpenFOAM custom reacting-flow solver</option><option>Ansys Fluent · export only</option><option>Simcenter STAR-CCM+ · export only</option><option>Other compressible reacting-flow solver · export only</option></select></label>
          <label className="wide"><span>Chemistry reference</span><select disabled={jobActive} value={settings.chemistryMechanism} onChange={(event) => setDiscrete({ chemistryMechanism: event.target.value })}><option>Not supplied</option><option>Hydrogen-air mechanism · reference required</option><option>Hydrogen-oxygen mechanism · reference required</option><option>Methane-oxygen mechanism · reference required</option><option>Custom mechanism · document in solver</option></select></label>
        </div>
      </section>
    </div>

    <section className="simulation-readiness-card">
      <div className="simulation-readiness-summary"><div><span>EXPORT READINESS</span><strong className={pkg.readiness.exportReady ? "ready" : "blocked"}>{pkg.readiness.exportReady ? "Case package ready" : "Setup incomplete"}</strong><p>{pkg.readiness.exportReady ? "Includes the domain, mesh dictionary, probe template, traceability record, and result template." : pkg.readiness.blockingIssues[0]}</p></div><div><span>SOLVER READINESS</span><strong className="review">Engineer review required</strong><p>Kythros prepares the case. Your selected solver still owns chemistry, boundaries, ignition, numerics, convergence, and execution.</p></div></div>
      <details><summary>Five items required before running this case</summary><ol>{pkg.readiness.engineerReview.map((item) => <li key={item}>{item}</li>)}</ol></details>
      <div className="simulation-actions"><button className="button primary" disabled={!pkg.readiness.exportReady} onClick={() => { download(JSON.stringify(pkg, null, 2), rde2dPackageFileName(activeDesign)); setExported(true); }}>Download 2D case package</button>{resultTemplate && <button className="button secondary" onClick={() => download(resultTemplate.content, "kythros-result.template.json")}>Download result template</button>}<button className="button secondary" onClick={onOpenDesign}>Edit engine</button><button className="button secondary" onClick={onOpenEnvelope}>Choose another condition</button></div>
      {exported && <div className="simulation-next-step"><span>NEXT STEP</span><strong>Run the case in the selected CFD solver.</strong><p>Complete the result template with solver-derived values, then import it directly below. Experimental data are not required for this design-iteration screen.</p></div>}
    </section>

    <section className="local-runner-card" aria-labelledby="local-runner-title">
      <div className="local-runner-heading">
        <div><span>LOCAL EXECUTION</span><h2 id="local-runner-title">OpenFOAM on this computer</h2><p>Kythros sends this exact case to a runner bound to localhost. The runner launches real OpenFOAM commands; it never substitutes generated CFD values.</p></div>
        <div className={`runner-badge ${runnerHealth?.status ?? "offline"}`}><i />{runnerChecking ? "Checking…" : runnerHealth?.status === "ready" ? "Reacting CFD ready" : runnerHealth?.status === "partial" ? "Mesh check ready" : "Runner offline"}</div>
      </div>
      <div className="local-runner-grid">
        <div className="runner-connection">
          <span>RUNNER ADDRESS</span><strong>{LOCAL_RUNNER_URL}</strong>
          <p>{runnerHealth?.message ?? "Start the local companion inside an initialized OpenFOAM shell, then check again."}</p>
          <div className="runner-command"><code>npm run runner:check</code><code>npm run runner:start</code></div>
          <div className="simulation-actions"><button className="button secondary" onClick={() => void refreshRunner()} disabled={runnerChecking || jobActive}>{runnerChecking ? "Checking…" : "Check connection"}</button><button className="button secondary" disabled={!pkg.readiness.exportReady || !runnerHealth?.capabilities.meshVerification || jobActive} onClick={() => void startLocalJob("mesh-verification")}>Verify mesh locally</button><button className="button primary" disabled={runnerChecking || jobActive} aria-expanded={runnerSetupOpen} aria-controls="local-runner-setup" onClick={() => void runReactingCfd()}>{runnerChecking ? "Checking local setup…" : "Run reacting CFD locally"}</button>{jobActive && <button className="button danger" onClick={() => void cancelLocalJob()}>Cancel run</button>}</div>
          {runnerError && <p className="runner-error" role="alert">{runnerError}</p>}
        </div>
        <div className="runner-boundary">
          <span>READINESS BOUNDARY</span>
          <dl><div><dt>Generated mesh</dt><dd>{runnerHealth?.capabilities.meshVerification ? "OpenFOAM can generate and check it" : "OpenFOAM commands not detected"}</dd></div><div><dt>Reacting solver</dt><dd>{runnerHealth?.openfoam.solverConfigured ? runnerHealth.openfoam.solverName : "Not configured"}</dd></div><div><dt>Reviewed RDE template</dt><dd>{runnerHealth?.openfoam.templateConfigured ? "Configured" : "Not configured"}</dd></div><div><dt>Result adapter</dt><dd>{runnerHealth?.openfoam.postprocessorConfigured ? "Configured" : "Not configured"}</dd></div></dl>
          <p>The Run button checks these requirements every time. Execution begins as soon as they pass; otherwise Kythros shows the exact missing setup.</p>
        </div>
      </div>
      {runnerSetupOpen && <section id="local-runner-setup" className="runner-setup" aria-live="polite">
        <div className="runner-setup-heading"><div><span>LOCAL SETUP</span><h3>Finish these items, then run</h3><p>Kythros will start the real OpenFOAM job automatically after every required item passes.</p></div><button className="button secondary" disabled={runnerChecking || jobActive} onClick={() => void runReactingCfd()}>{runnerChecking ? "Checking…" : "Check again and run"}</button></div>
        <ul>{runnerSetupItems.map((item) => <li key={item.label} className={item.ready ? "ready" : "missing"}><i aria-hidden="true">{item.ready ? "✓" : "•"}</i><span><strong>{item.label}</strong><small>{item.detail}</small></span></li>)}</ul>
      </section>}
      {localJob && <div className={`runner-job ${localJob.status}`} aria-live="polite"><div><span>LOCAL JOB · {localJob.mode.replace("-", " ")}</span><strong>{localJob.stage.replaceAll("-", " ")}</strong><p>{localJob.message}</p></div><small>{localJob.id}</small>{localJob.logs.length > 0 && <details><summary>Open solver log ({localJob.logs.length} lines retained)</summary><pre>{localJob.logs.map((entry) => `[${entry.source}] ${entry.line}`).join("\n")}</pre></details>}</div>}
    </section>

    <section className="simulation-results-card" aria-labelledby="simulation-results-title">
      <div className="simulation-results-heading"><div><span>2D RESULT</span><h2 id="simulation-results-title">Review the computed result and decide what changes next</h2><p>A configured local run returns its result automatically. Manual JSON import remains available for another solver or computer.</p></div><label className="result-upload button secondary">Import result manually<input type="file" accept="application/json,.json" onChange={importResult}/></label></div>
      {resultError && <div className="simulation-result-error" role="alert">{resultError}</div>}
      {!result || !recommendation ? <div className="simulation-result-empty"><strong>No reacting-flow result yet</strong><p>A mesh verification does not contain engine physics. Run a configured reacting case locally or import a solver summary containing convergence, mesh/time-step checks, propagation mode, injector backflow, and thermal outputs.</p><div><span>1 · Connect runner</span><span>2 · Execute OpenFOAM</span><span>3 · Analyze result</span><span>4 · Review engine change</span></div></div> : <>
        <div className="simulation-result-kpis"><span><small>Solver</small><strong>{result.solverName}</strong></span><span><small>Mode</small><strong>{result.propagationMode.replace("-", " ")}</strong></span><span><small>Frequency</small><strong>{formatMetric(result.dominantFrequencyKHz, " kHz")}</strong></span><span><small>Backflow</small><strong>{formatMetric(result.injectorBackflowPct, "%")}</strong></span><span><small>Wall heat flux</small><strong>{formatMetric(result.peakWallHeatFluxMWm2, " MW/m²")}</strong></span></div>
        <div className={`simulation-result-status ${recommendation.resultUsable ? "usable" : "blocked"}`}><strong>{recommendation.resultUsable ? "Numerical gates passed" : "Engine recommendation blocked"}</strong><p>{recommendation.resultUsable ? "Kythros can use this solver summary for a provisional design decision. Physical validation still requires experiment." : recommendation.pairingIssues[0] ?? recommendation.numericalIssues[0]}</p></div>
        <div className="simulation-recommendation-grid">
          <article className="engine-recommendation"><span>ENGINE CHANGE TO TEST</span><h3>{recommendation.engine.title}</h3><p>{recommendation.engine.action}</p><small>Why: {recommendation.engine.reason}</small>{recommendation.engine.target !== "none" && <button className="button secondary" onClick={onOpenDesign}>Open engine design →</button>}</article>
          <article className="solver-recommendation"><span>NEXT 2D SIMULATION</span><h3>{recommendation.simulation.title}</h3><p>{recommendation.simulation.action}</p><small>Why: {recommendation.simulation.reason}</small></article>
        </div>
      </>}
      <div className="simulation-validation-link"><div><strong>Have matched hot-fire data?</strong><p>Use Experiment Validation only when you want to test whether the CFD represents the physical engine.</p></div><button className="button secondary" onClick={onOpenValidation}>Open Experiment Validation →</button></div>
    </section>
  </section>;
}
