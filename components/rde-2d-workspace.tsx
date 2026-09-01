"use client";

import { ChangeEvent, useEffect, useState } from "react";
import type { EngineDesign, OperatingPoint } from "@/lib/design-workspace";
import {
  cancelCloudRunnerJob,
  createCloudRunnerJob,
  getCloudRunnerHealth,
  getCloudRunnerJob,
  type CloudComputeTier,
  type CloudRunnerHealth,
  type CloudRunnerJob,
} from "@/lib/cloud-openfoam-runner";
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

const CLOUD_TIER_OPTIONS: Array<Pick<CloudComputeTier, "id" | "label" | "vcpu" | "memoryGiB">> = [
  { id: "quick", label: "Quick", vcpu: 2, memoryGiB: 8 },
  { id: "balanced", label: "Balanced", vcpu: 4, memoryGiB: 16 },
  { id: "refined", label: "Refined", vcpu: 8, memoryGiB: 32 },
];

export function Rde2dWorkspace({ designs, activeDesignId, operatingPoints, onSelectDesign, onOpenDesign, onOpenEnvelope, onOpenValidation }: Props) {
  const activeDesign = designs.find((item) => item.id === activeDesignId) ?? designs.at(-1) ?? null;
  const points = activeDesign ? operatingPoints.filter((point) => point.designId === activeDesign.id) : [];
  const [selectedPointId, setSelectedPointId] = useState("midpoint");
  const [presetId, setPresetId] = useState<Rde2dPresetId>("balanced");
  const [settings, setSettings] = useState<Rde2dSettings>(() => settingsForPreset("balanced"));
  const [exported, setExported] = useState(false);
  const [result, setResult] = useState<Rde2dResultSummary | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [cloudTier, setCloudTier] = useState<CloudComputeTier["id"]>("balanced");
  const [cloudHealth, setCloudHealth] = useState<CloudRunnerHealth | null>(null);
  const [cloudChecking, setCloudChecking] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudJob, setCloudJob] = useState<CloudRunnerJob | null>(null);
  const condition = activeDesign ? points.find((point) => point.id === selectedPointId) ?? midpointCondition(activeDesign) : null;
  const packageData = activeDesign && condition ? buildRde2dPackage(activeDesign, condition, settings) : null;
  const recommendation = activeDesign && condition && result ? analyzeRde2dResult(activeDesign, condition, result) : null;
  const jobActive = cloudJob?.status === "queued" || cloudJob?.status === "running" || cloudJob?.status === "cancelling";

  const resetResult = () => { setResult(null); setResultError(null); setExported(false); setCloudJob(null); };
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
  const refreshCloud = async () => {
    setCloudChecking(true);
    try {
      const health = await getCloudRunnerHealth();
      setCloudHealth(health);
      setCloudError(null);
      return health;
    } catch (error) {
      setCloudHealth(null);
      setCloudError(error instanceof Error ? error.message : "Kythros could not connect to cloud execution.");
      return null;
    } finally {
      setCloudChecking(false);
    }
  };
  const cloudJobId = cloudJob?.id;
  const cloudJobStatus = cloudJob?.status;
  useEffect(() => {
    if (!cloudJobId || !cloudJobStatus || !["queued", "running", "cancelling"].includes(cloudJobStatus)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getCloudRunnerJob(cloudJobId);
        setCloudJob(next);
        setCloudError(null);
        if (next.status === "completed" && next.result) {
          try {
            setResult(parseRde2dResult(JSON.stringify(next.result)));
            setResultError(null);
          } catch (error) {
            setResultError(error instanceof Error ? error.message : "The cloud result summary could not be analyzed.");
          }
        }
      } catch (error) {
        setCloudError(error instanceof Error ? error.message : "Kythros lost contact with the cloud job.");
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [cloudJobId, cloudJobStatus]);

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
  const runCloudCfd = async () => {
    setCloudError(null);
    setResultError(null);
    try {
      if (!pkg.readiness.exportReady) throw new Error(pkg.readiness.blockingIssues[0] ?? "Complete the 2D case setup before running.");
      if (!settings.solver.startsWith("OpenFOAM")) throw new Error("Choose OpenFOAM in Case setup before starting a managed cloud job.");
      const health = await refreshCloud();
      const selected = health?.tiers.find((tier) => tier.id === cloudTier);
      if (!health || health.status !== "ready") throw new Error(health?.message ?? "Cloud execution is not available.");
      if (!selected?.available) throw new Error(`${selected?.label ?? cloudTier} cloud compute is not available.`);
      setCloudJob(await createCloudRunnerJob(cloudTier, pkg));
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "The Google Cloud OpenFOAM job could not be started.");
    }
  };
  const cancelCloudJob = async () => {
    if (!cloudJob) return;
    try {
      setCloudJob(await cancelCloudRunnerJob(cloudJob.id));
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "The cloud job could not be cancelled.");
    }
  };
  const selectedCloudTier = cloudHealth?.tiers.find((tier) => tier.id === cloudTier) ?? null;

  return <section className="simulation-workspace" aria-labelledby="simulation-title">
    <header className="simulation-heading">
      <div><span className="workspace-label">2D RDE DEVELOPMENT</span><h1 id="simulation-title">Set up, run in cloud, and improve</h1><p>Choose a fast preset and submit a traceable OpenFOAM job. Kythros returns the result as separate simulation and engine-design actions.</p></div>
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

    <section className="cloud-runner-card" aria-labelledby="cloud-runner-title">
      <div className="cloud-runner-heading">
        <div><span>CLOUD EXECUTION</span><h2 id="cloud-runner-title">Run OpenFOAM without local setup</h2><p>Kythros sends this exact case to an isolated Google Cloud job, follows its progress, and returns the computed result automatically.</p></div>
        <div className={`runner-badge ${cloudHealth?.status ?? "unchecked"}`}><i />{cloudChecking ? "Checking…" : cloudHealth?.status === "ready" ? "Cloud compute ready" : cloudHealth?.status === "unavailable" ? "Cloud unavailable" : "Checked when you run"}</div>
      </div>
      <div className="cloud-runner-grid">
        <div className="runner-connection">
          <span>COMPUTE SIZE</span>
          <label className="cloud-tier-select"><select disabled={jobActive} value={cloudTier} onChange={(event) => setCloudTier(event.target.value as CloudComputeTier["id"])}>{CLOUD_TIER_OPTIONS.map((tier) => <option key={tier.id} value={tier.id}>{tier.label} · {tier.vcpu} vCPU · {tier.memoryGiB} GiB</option>)}</select></label>
          <p>{cloudHealth?.message ?? "Kythros checks cloud availability when you press Run. Nothing needs to be installed on this computer."}</p>
          <div className="simulation-actions"><button className="button primary" disabled={cloudChecking || jobActive} onClick={() => void runCloudCfd()}>{cloudChecking ? "Checking cloud…" : "Run 2D CFD in cloud"}</button><button className="button secondary" onClick={() => void refreshCloud()} disabled={cloudChecking || jobActive}>Check cloud status</button>{jobActive && <button className="button danger" onClick={() => void cancelCloudJob()}>Cancel run</button>}</div>
          {cloudError && <p className="runner-error" role="alert">{cloudError}</p>}
        </div>
        <div className="runner-boundary">
          <span>WHAT HAPPENS</span>
          <dl><div><dt>Case transfer</dt><dd>Encrypted server-to-server</dd></div><div><dt>Solver</dt><dd>Managed OpenFOAM image</dd></div><div><dt>Selected compute</dt><dd>{selectedCloudTier ? `${selectedCloudTier.vcpu} vCPU · ${selectedCloudTier.memoryGiB} GiB` : `${CLOUD_TIER_OPTIONS.find((tier) => tier.id === cloudTier)?.vcpu} vCPU · ${CLOUD_TIER_OPTIONS.find((tier) => tier.id === cloudTier)?.memoryGiB} GiB`}</dd></div><div><dt>Estimated charge</dt><dd>{selectedCloudTier?.estimatedUsdPerHour !== null && selectedCloudTier?.estimatedUsdPerHour !== undefined ? `$${selectedCloudTier.estimatedUsdPerHour.toFixed(2)} / active hour` : "Shown when configured"}</dd></div></dl>
          <p>Charges accrue only while the cloud job runs. Kythros still blocks engine recommendations unless the returned numerical checks pass.</p>
        </div>
      </div>
      {cloudJob && <div className={`runner-job ${cloudJob.status}`} aria-live="polite"><div><span>GOOGLE CLOUD JOB · {cloudJob.tier}</span><strong>{cloudJob.stage.replaceAll("-", " ")}</strong><p>{cloudJob.message}</p></div><small>{cloudJob.id}</small>{cloudJob.usage && <small>{Math.ceil(cloudJob.usage.elapsedSeconds / 60)} min{cloudJob.usage.estimatedUsd !== null ? ` · $${cloudJob.usage.estimatedUsd.toFixed(2)}` : ""}</small>}{cloudJob.logs.length > 0 && <details><summary>Solver log ({cloudJob.logs.length} lines retained)</summary><pre>{cloudJob.logs.map((entry) => `[${entry.source}] ${entry.line}`).join("\n")}</pre></details>}</div>}
    </section>

    <section className="simulation-results-card" aria-labelledby="simulation-results-title">
      <div className="simulation-results-heading"><div><span>2D RESULT</span><h2 id="simulation-results-title">Review the computed result and decide what changes next</h2><p>A cloud run returns its result automatically. Manual JSON import remains available for another solver or prior run.</p></div><label className="result-upload button secondary">Import result manually<input type="file" accept="application/json,.json" onChange={importResult}/></label></div>
      {resultError && <div className="simulation-result-error" role="alert">{resultError}</div>}
      {!result || !recommendation ? <div className="simulation-result-empty"><strong>No reacting-flow result yet</strong><p>Run the prepared case in Google Cloud or import a solver summary containing convergence, mesh/time-step checks, propagation mode, injector backflow, and thermal outputs.</p><div><span>1 · Submit cloud job</span><span>2 · Execute OpenFOAM</span><span>3 · Analyze result</span><span>4 · Review engine change</span></div></div> : <>
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
