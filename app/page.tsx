"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { buildCaseDelta, buildCaseHistoryEvidence, summarizeCase } from "@/lib/case-history";
import {
  EMPTY_METADATA,
  cloneMetadata,
  type AnalysisCase,
  type CaseRelationship,
  type CaseMetadata,
  type Dimensionality,
  type SensitivityVariable,
} from "@/lib/caevera-types";
import { buildCaseAssessment, type MetricAssessment } from "@/lib/diagnostics";
import { KNOWLEDGE_BASE_VERSION, sourcesFor } from "@/lib/diagnostic-knowledge";
import {
  ANALYSIS_VERSION,
  REVIEW_THRESHOLDS,
  analyzeRdeProbeSet,
  compareSignals,
  makeDemoProbeSignals,
  parseProbeCsv,
  type Comparison,
  type Signal,
} from "@/lib/rde-analysis";

const TEST_COLOR = "#2588a2";
const CFD_COLOR = "#6679bd";
const RESIDUAL_COLOR = "#c8873d";

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

function signed(value: number, digits: number) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

function metricDigits(metric: MetricAssessment) {
  if (["frequency", "amplitude", "peak-pressure", "mean-pressure", "impulse"].includes(metric.id)) return metric.id === "frequency" ? 2 : 3;
  if (metric.id === "speed") return 0;
  if (metric.id === "rise-time") return 1;
  if (metric.id === "harmonics") return 3;
  if (metric.id === "cycle-variability") return 1;
  return 0;
}

function formatMetricValue(metric: MetricAssessment, value: number | string) {
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "Not assessed";
  const digits = metricDigits(metric);
  if (metric.id === "cycle-variability") return `${value.toFixed(digits)} %`;
  return `${value.toFixed(digits)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function formatMetricDifference(metric: MetricAssessment) {
  if (typeof metric.difference === "string") return metric.difference;
  const absolute = metric.id === "cycle-variability"
    ? `${signed(metric.difference, metricDigits(metric))} pt`
    : `${signed(metric.difference, metricDigits(metric))}${metric.unit ? ` ${metric.unit}` : ""}`;
  return metric.percentDifference === null || !Number.isFinite(metric.percentDifference)
    ? absolute
    : `${absolute} (${signed(metric.percentDifference, 1)}%)`;
}

function polylinePoints(values: number[], width: number, height: number, min: number, max: number, left = 0, top = 0) {
  const range = Math.max(max - min, 1e-9);
  return values.map((value, index) => {
    const x = left + (index / Math.max(values.length - 1, 1)) * width;
    const y = top + height - ((value - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function PlotGrid({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return <>
    {Array.from({ length: 7 }, (_, index) => <line key={`v-${index}`} x1={left + index * width / 6} y1={top} x2={left + index * width / 6} y2={top + height} className="grid-line" />)}
    {Array.from({ length: 5 }, (_, index) => <line key={`h-${index}`} x1={left} y1={top + index * height / 4} x2={left + width} y2={top + index * height / 4} className="grid-line" />)}
  </>;
}

function SignalChart({ comparison }: { comparison: Comparison }) {
  const all = [...comparison.test, ...comparison.cfd];
  const minimum = Math.min(...all);
  const maximum = Math.max(...all);
  const middle = (minimum + maximum) / 2;
  const start = comparison.time[0] ?? 0;
  const end = comparison.time.at(-1) ?? 0;
  const left = 60; const top = 12; const width = 700; const height = 232;
  return <div className="chart" role="img" aria-label="Aligned experimental and CFD pressure histories">
    <svg viewBox="0 0 790 286">
      <PlotGrid left={left} top={top} width={width} height={height} />
      <polyline points={polylinePoints(comparison.cfd, width, height, minimum, maximum, left, top)} fill="none" stroke={CFD_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={polylinePoints(comparison.test, width, height, minimum, maximum, left, top)} fill="none" stroke={TEST_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text x="7" y={top + 4} className="axis-value">{maximum.toFixed(2)}</text>
      <text x="7" y={top + height / 2 + 4} className="axis-value">{middle.toFixed(2)}</text>
      <text x="7" y={top + height + 4} className="axis-value">{minimum.toFixed(2)}</text>
      <text x={left} y="276" className="axis-value">{start.toFixed(2)}</text>
      <text x={left + width} y="276" textAnchor="end" className="axis-value">{end.toFixed(2)} ms</text>
      <text x="17" y="132" transform="rotate(-90 17 132)" textAnchor="middle" className="axis-title">PRESSURE (MPa)</text>
    </svg>
  </div>;
}

function SpectrumChart({ comparison }: { comparison: Comparison }) {
  const maximumFrequency = Math.min(Math.max(comparison.testFrequency, comparison.cfdFrequency) * 2.2, comparison.testSpectrum.frequency.at(-1) ?? 20);
  const trim = (data: { frequency: number[]; amplitude: number[] }) => data.amplitude
    .map((value, index) => ({ frequency: data.frequency[index], value: Math.log10(Math.max(value, 1e-5)) }))
    .filter((point) => point.frequency <= maximumFrequency);
  const test = trim(comparison.testSpectrum).map((point) => point.value);
  const cfd = trim(comparison.cfdSpectrum).map((point) => point.value);
  const all = [...test, ...cfd];
  const minimum = Math.min(...all); const maximum = Math.max(...all);
  const left = 52; const top = 12; const width = 708; const height = 232;
  return <div className="chart" role="img" aria-label="Experimental and CFD pressure spectra">
    <svg viewBox="0 0 790 286">
      <PlotGrid left={left} top={top} width={width} height={height} />
      <polyline points={polylinePoints(cfd, width, height, minimum, maximum, left, top)} fill="none" stroke={CFD_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={polylinePoints(test, width, height, minimum, maximum, left, top)} fill="none" stroke={TEST_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text x={left} y="276" className="axis-value">0</text>
      <text x={left + width / 2} y="276" textAnchor="middle" className="axis-value">{(maximumFrequency / 2).toFixed(1)}</text>
      <text x={left + width} y="276" textAnchor="end" className="axis-value">{maximumFrequency.toFixed(1)} kHz</text>
      <text x="15" y="132" transform="rotate(-90 15 132)" textAnchor="middle" className="axis-title">LOG AMPLITUDE</text>
    </svg>
  </div>;
}

function ResidualChart({ comparison }: { comparison: Comparison }) {
  const residual = comparison.test.map((value, index) => value - comparison.cfd[index]);
  const bound = Math.max(...residual.map(Math.abs), 1e-4);
  const start = comparison.time[0] ?? 0; const end = comparison.time.at(-1) ?? 0;
  const left = 60; const top = 12; const width = 700; const height = 232;
  return <div className="chart" role="img" aria-label="Experimental pressure minus CFD pressure residual">
    <svg viewBox="0 0 790 286">
      <PlotGrid left={left} top={top} width={width} height={height} />
      <line x1={left} y1={top + height / 2} x2={left + width} y2={top + height / 2} className="zero-line" />
      <polyline points={polylinePoints(residual, width, height, -bound, bound, left, top)} fill="none" stroke={RESIDUAL_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text x="7" y={top + 4} className="axis-value">+{bound.toFixed(2)}</text>
      <text x="32" y={top + height / 2 + 4} className="axis-value">0</text>
      <text x="7" y={top + height + 4} className="axis-value">−{bound.toFixed(2)}</text>
      <text x={left} y="276" className="axis-value">{start.toFixed(2)}</text>
      <text x={left + width} y="276" textAnchor="end" className="axis-value">{end.toFixed(2)} ms</text>
      <text x="17" y="132" transform="rotate(-90 17 132)" textAnchor="middle" className="axis-title">TEST − CFD (MPa)</text>
    </svg>
  </div>;
}

function Legend({ residual = false }: { residual?: boolean }) {
  return <div className="legend" aria-label="Chart legend">{residual
    ? <span><i className="legend-residual" />Experiment − CFD</span>
    : <><span><i className="legend-test" />Experiment</span><span><i className="legend-cfd" />CFD</span></>
  }</div>;
}

export default function Home() {
  const demo = useMemo(() => makeDemoProbeSignals(), []);
  const [cases, setCases] = useState<AnalysisCase[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [caseBaselineId, setCaseBaselineId] = useState<string | null>(null);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaseMetadata>(() => cloneMetadata(EMPTY_METADATA));
  const [draftRelationship, setDraftRelationship] = useState<CaseRelationship | null>(null);
  const [testPending, setTestPending] = useState<Signal[] | null>(null);
  const [cfdPending, setCfdPending] = useState<Signal[] | null>(null);
  const [showLoader, setShowLoader] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState<"signals" | "spectrum" | "residual">("signals");
  const [activeProbe, setActiveProbe] = useState(0);
  const [workspaceView, setWorkspaceView] = useState<"case" | "compare">("case");

  const activeCase = cases.find((item) => item.id === activeCaseId) ?? null;
  const comparisons = useMemo(() => activeCase ? activeCase.testSignals.map((signal, index) => compareSignals(signal, activeCase.cfdSignals[index])) : [], [activeCase]);
  const testMode = useMemo(() => activeCase ? analyzeRdeProbeSet(activeCase.testSignals, activeCase.metadata.probePositionsDeg, activeCase.metadata.annulusMeanDiameterMm) : null, [activeCase]);
  const cfdMode = useMemo(() => activeCase ? analyzeRdeProbeSet(activeCase.cfdSignals, activeCase.metadata.probePositionsDeg, activeCase.metadata.annulusMeanDiameterMm) : null, [activeCase]);
  const caseHistoryEvidence = useMemo(() => activeCase ? buildCaseHistoryEvidence(cases, activeCase.id) : [], [cases, activeCase]);
  const assessment = useMemo(() => activeCase && testMode && cfdMode ? buildCaseAssessment(activeCase.metadata, comparisons, testMode, cfdMode, caseHistoryEvidence) : null, [activeCase, comparisons, testMode, cfdMode, caseHistoryEvidence]);
  const activeComparison = comparisons[activeProbe];
  const correlation = comparisons.length ? average(comparisons.map((item) => item.correlation)) : Number.NaN;
  const nrmse = comparisons.length ? average(comparisons.map((item) => item.nrmse)) : Number.NaN;
  const pressureBias = comparisons.length ? average(comparisons.map((item) => item.pressureBias)) : Number.NaN;
  const waveformWithinLimit = correlation >= REVIEW_THRESHOLDS.minimumCorrelation;
  const caseSummaries = useMemo(() => cases.map(summarizeCase), [cases]);
  const baselineSummary = caseSummaries.find((summary) => summary.item.id === caseBaselineId) ?? caseSummaries[0] ?? null;

  const inputRows = activeCase ? [
    ["Geometry + probes", `${activeCase.metadata.annulusMeanDiameterMm.toFixed(1)} mm mean diameter · ${activeCase.metadata.probePositionsDeg.map((angle, index) => `P${index + 1} ${angle}°`).join(" · ")}`],
    ["Pressure evidence", `${activeCase.testSignals.length} experiment + ${activeCase.cfdSignals.length} CFD traces · ${activeCase.testSignals[0].time.length.toLocaleString()} samples each`],
    ["Operating point", `${activeCase.metadata.inletPressureBar.toFixed(1)} bar · ${activeCase.metadata.inletTemperatureK.toFixed(0)} K · φ ${activeCase.metadata.equivalenceRatio.toFixed(2)} · ${activeCase.metadata.massFlowKgS.toFixed(2)} kg/s`],
    ["Solver + discretization", `${activeCase.metadata.solver} ${activeCase.metadata.solverVersion} · ${activeCase.metadata.dimensionality} · ${activeCase.metadata.spatialScheme} O${activeCase.metadata.spatialOrder} · ${activeCase.metadata.numericalFlux}`],
    ["Time integration", `${activeCase.metadata.temporalScheme} O${activeCase.metadata.temporalOrder} · ${activeCase.metadata.timeStepUs.toFixed(3)} µs · CFL ${activeCase.metadata.cfl.toFixed(2)}`],
    ["Resolution", `${activeCase.metadata.meshCells.toLocaleString()} cells · ${activeCase.metadata.minimumCellSizeMm.toFixed(3)} mm minimum · ${activeCase.metadata.cellsPerInductionLength.toFixed(1)} cells/induction length`],
    ["Physics + boundaries", `${activeCase.metadata.chemistryModel} · ${activeCase.metadata.turbulenceModel} · ${activeCase.metadata.wallBoundaryCondition}`],
    ["Uncertainty", `Experiment ±${activeCase.metadata.pressureUncertaintyPct.toFixed(1)}%, ±${activeCase.metadata.timingUncertaintyUs.toFixed(2)} µs · CFD ±${activeCase.metadata.cfdPressureUncertaintyPct.toFixed(1)}%, ±${activeCase.metadata.cfdTimingUncertaintyUs.toFixed(2)} µs`],
  ] : [];

  const reviewMetrics = assessment?.metrics.filter((metric) => metric.tone === "review").length ?? 0;
  const inconclusiveMetrics = assessment?.metrics.filter((metric) => metric.tone === "neutral").length ?? 0;
  const totalReview = reviewMetrics + (waveformWithinLimit ? 0 : 1) + (assessment?.validity.status === "Valid" ? 0 : 1);
  const likelyHypothesis = assessment?.hypotheses[0] ?? null;
  const likelyEvidence = likelyHypothesis?.evidence.filter((item) => item.state === "supports").map((item) => item.observation) ?? [];
  const likelySources = likelyHypothesis ? sourcesFor(likelyHypothesis.sourceIds) : [];
  const showDetailedEvidence = false;

  async function readProbeFile(event: ChangeEvent<HTMLInputElement>, kind: "test" | "cfd") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setError("");
      const signals = parseProbeCsv(await file.text(), file.name);
      if (kind === "test") setTestPending(signals); else setCfdPending(signals);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read the pressure file.");
    }
  }

  function openNewCase() {
    setEditingCaseId(null);
    setDraft(cloneMetadata(EMPTY_METADATA));
    setDraftRelationship(null);
    setTestPending(null); setCfdPending(null); setError(""); setShowLoader(true);
  }

  function openCaseEditor() {
    if (!activeCase) return;
    setEditingCaseId(activeCase.id);
    setDraft(cloneMetadata(activeCase.metadata));
    setDraftRelationship(activeCase.relationship ?? null);
    setTestPending(null); setCfdPending(null); setError(""); setShowLoader(true);
  }

  function applyCase() {
    if (!draft.name.trim()) return setError("Give this operating point a name.");
    if (!draft.comparisonMatchConfirmed) return setError("Confirm that experiment and CFD use the same geometry, operating point, probe locations, and comparison window.");
    if (!Number.isFinite(draft.annulusMeanDiameterMm) || draft.annulusMeanDiameterMm <= 0) return setError("Enter a positive annulus mean diameter.");
    if (draft.probePositionsDeg.length !== 3 || draft.probePositionsDeg.some((value) => !Number.isFinite(value))) return setError("Enter three valid probe angles.");
    const positive = [draft.inletPressureBar, draft.inletTemperatureK, draft.equivalenceRatio, draft.massFlowKgS, draft.spatialOrder, draft.temporalOrder, draft.cfl, draft.meshCells, draft.minimumCellSizeMm, draft.cellsPerInductionLength, draft.nearWallCellSizeMm, draft.timeStepUs, draft.chemistrySpecies, draft.chemistryReactions];
    if (positive.some((value) => !Number.isFinite(value) || value <= 0)) return setError("Complete every required operating-condition, resolution, chemistry, and numerical field with a positive value.");
    const uncertainties = [draft.pressureUncertaintyPct, draft.timingUncertaintyUs, draft.cfdPressureUncertaintyPct, draft.cfdTimingUncertaintyUs];
    if (uncertainties.some((value) => !Number.isFinite(value) || value < 0)) return setError("Enter non-negative experiment and CFD uncertainty values.");
    const textFields = [draft.solver, draft.solverVersion, draft.dimensionality, draft.spatialScheme, draft.numericalFlux, draft.limiterFilter, draft.temporalScheme, draft.turbulenceModel, draft.combustionModel, draft.chemistryModel, draft.chemistryIntegrator, draft.wallBoundaryCondition, draft.inletBoundaryCondition, draft.outletBoundaryCondition, draft.initializationMethod];
    if (textFields.some((value) => !value.trim())) return setError("Complete every required CFD model-card field. Enter “None” where a limiter, turbulence model, or combustion model is not used.");
    if ((testPending && !cfdPending) || (!testPending && cfdPending)) return setError("Choose both the experimental and CFD three-probe files.");
    try {
      const editingCase = cases.find((item) => item.id === editingCaseId) ?? null;
      const nextTest = testPending ?? editingCase?.testSignals;
      const nextCfd = cfdPending ?? editingCase?.cfdSignals;
      if (!nextTest || !nextCfd) return setError("Choose both the experimental and CFD three-probe files.");
      nextTest.forEach((signal, index) => compareSignals(signal, nextCfd[index]));
      analyzeRdeProbeSet(nextTest, draft.probePositionsDeg, draft.annulusMeanDiameterMm);
      analyzeRdeProbeSet(nextCfd, draft.probePositionsDeg, draft.annulusMeanDiameterMm);
      const id = editingCaseId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (draftRelationship?.baselineCaseId === id) return setError("A case cannot be its own baseline.");
      const nextCase: AnalysisCase = { id, source: editingCase?.source ?? "uploaded", relationship: draftRelationship, metadata: cloneMetadata(draft), testSignals: nextTest, cfdSignals: nextCfd };
      setCases((current) => editingCaseId ? current.map((item) => item.id === editingCaseId ? nextCase : item) : [...current, nextCase]);
      if (!caseBaselineId) setCaseBaselineId(id);
      setActiveCaseId(id); setWorkspaceView("case"); setActiveProbe(0); setShowLoader(false); setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The two datasets could not be compared.");
    }
  }

  function loadExampleCaseHistory() {
    const stamp = Date.now().toString(36);
    const baselineId = `demo-${stamp}-baseline`;
    const baseMetadata: CaseMetadata = {
        name: "Synthetic baseline",
        annulusMeanDiameterMm: 82,
        probePositionsDeg: [...demo.positionsDeg],
        inletPressureBar: 8,
        inletTemperatureK: 300,
        equivalenceRatio: 1,
        massFlowKgS: 0.62,
        comparisonMatchConfirmed: true,
        solver: "Research CFD solver",
        solverVersion: "2026.1",
        dimensionality: "3D",
        spatialScheme: "MUSCL",
        spatialOrder: 2,
        numericalFlux: "HLLC",
        limiterFilter: "Venkatakrishnan limiter",
        temporalScheme: "SSPRK3",
        temporalOrder: 3,
        cfl: 0.35,
        turbulenceModel: "SST k-ω",
        combustionModel: "Finite-rate",
        chemistryModel: "Hydrogen reduced mechanism",
        chemistrySpecies: 9,
        chemistryReactions: 19,
        chemistryIntegrator: "Implicit BDF",
        meshCells: 2_500_000,
        minimumCellSizeMm: 0.25,
        cellsPerInductionLength: 8,
        nearWallCellSizeMm: 0.1,
        timeStepUs: 0.25,
        wallBoundaryCondition: "Isothermal 450 K",
        inletBoundaryCondition: "Measured total state + mass flow",
        outletBoundaryCondition: "Non-reflecting pressure outlet",
        initializationMethod: "Single-point ignition kernel",
        meshConvergencePct: 4.8,
        timeStepConvergencePct: 1.2,
        pressureUncertaintyPct: 1.5,
        timingUncertaintyUs: 0.5,
        cfdPressureUncertaintyPct: 2,
        cfdTimingUncertaintyUs: 0.25,
    };
    const cloneSignals = (signals: Signal[]) => signals.map((signal) => ({ ...signal, time: [...signal.time], pressure: [...signal.pressure] }));
    const blendTowardExperiment = (factor: number) => demo.cfd.map((signal, probe) => ({ ...signal, pressure: signal.pressure.map((value, index) => value + factor * (demo.test[probe].pressure[index] - value)) }));
    const examples: AnalysisCase[] = [
      { id: baselineId, source: "demo", relationship: null, metadata: baseMetadata, testSignals: cloneSignals(demo.test), cfdSignals: cloneSignals(demo.cfd) },
      {
        id: `demo-${stamp}-mesh`, source: "demo",
        relationship: { baselineCaseId: baselineId, changedVariable: "mesh", description: "50% front-region cell-size refinement" },
        metadata: { ...cloneMetadata(baseMetadata), name: "Synthetic mesh refinement", meshCells: 5_000_000, minimumCellSizeMm: 0.125, cellsPerInductionLength: 16, nearWallCellSizeMm: 0.05, meshConvergencePct: 1.7 },
        testSignals: cloneSignals(demo.test), cfdSignals: blendTowardExperiment(0.95),
      },
      {
        id: `demo-${stamp}-wall`, source: "demo",
        relationship: { baselineCaseId: baselineId, changedVariable: "wall", description: "Adjacent wall thermal boundary" },
        metadata: { ...cloneMetadata(baseMetadata), name: "Synthetic wall sensitivity", wallBoundaryCondition: "Adiabatic" },
        testSignals: cloneSignals(demo.test), cfdSignals: blendTowardExperiment(0.03),
      },
    ];
    setCases((current) => [...current, ...examples]);
    setCaseBaselineId(examples[0].id);
    setActiveCaseId(examples[0].id); setWorkspaceView("case"); setActiveProbe(0);
  }

  function downloadExample() {
    const rows = ["time_ms,p1_MPa,p2_MPa,p3_MPa", ...demo.test[0].time.slice(0, 800).map((time, index) => [time, ...demo.test.map((signal) => signal.pressure[index])].map((value) => value.toFixed(6)).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = "caevera-three-probe-example.csv"; link.click(); URL.revokeObjectURL(url);
  }

  function downloadReport() {
    if (!activeCase || !testMode || !cfdMode || !assessment) return;
    const report = {
      schema: "caevera-rde-case-report",
      analysisVersion: ANALYSIS_VERSION,
      knowledgeBaseVersion: KNOWLEDGE_BASE_VERSION,
      generatedAt: new Date().toISOString(),
      inputs: { metadata: activeCase.metadata, relationship: activeCase.relationship ?? null, experimentalSources: activeCase.testSignals.map((signal) => signal.name), cfdSources: activeCase.cfdSignals.map((signal) => signal.name), units: { time: "ms", pressure: "MPa", frequency: "kHz", waveSpeed: "m/s" } },
      outputs: { experimentMode: testMode, cfdMode, validity: assessment.validity, dataQuality: assessment.dataQuality, coverage: assessment.coverage, metrics: assessment.metrics, hypotheses: assessment.hypotheses, controlledNextRun: assessment.nextRun, caseHistoryEvidence, waveform: { correlation, normalizedRmse: nrmse, pressureBiasMpa: pressureBias } },
      citedSources: sourcesFor([...new Set(assessment.hypotheses.flatMap((hypothesis) => hypothesis.sourceIds))]),
      perProbe: comparisons,
      methods: ["bounded cross-correlation", "windowed pressure spectrum", "cycle detection", "uncertainty resolution by RSS", "circumferential phase fit", "structured diagnostic rules"],
      limitations: ["Hypotheses prioritize controlled sensitivity runs; they do not prove causality.", "Pressure and timing uncertainty are propagated only into supported scalar outputs.", "Mode inference assumes synchronized probes and one dominant rotating mode.", "Thermal, performance, combustion, and flowfield agreement are not assessed without those measurements."],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "caevera-rde-case-report.json"; link.click(); URL.revokeObjectURL(url);
  }

  const updateNumber = (key: keyof CaseMetadata, value: string) => setDraft((current) => ({ ...current, [key]: value === "" ? Number.NaN : Number(value) }));
  const updateText = (key: keyof CaseMetadata, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const numberValue = (value: number) => Number.isFinite(value) ? value : "";

  return <main className="app-shell">
    <header className="product-header">
      <a className="brand" href="#top" aria-label="Caevera by Caelus home"><span className="brand-mark">C</span><span><strong>CAEVERA</strong><small>BY CAELUS</small></span></a>
      <p>RDE simulation-to-test intelligence</p>
      <div className="header-actions"><span className="prototype-tag">v{ANALYSIS_VERSION}</span><button className="button primary" onClick={openNewCase}>+ Add case</button></div>
    </header>

    <section className="content" id="top">
      {!activeCase || !testMode || !cfdMode || !activeComparison || !assessment ? <section className="empty-workspace">
        <span className="empty-kicker">CASE WORKSPACE</span><h1>No cases loaded</h1>
        <p>Add an RDE operating point to assess whether CFD reproduces experimental wave and pressure behavior—and identify the next controlled simulation.</p>
        <div className="empty-actions"><button className="button primary" onClick={openNewCase}>Add first case →</button><button className="button secondary" onClick={loadExampleCaseHistory}>Load synthetic case history</button></div>
        <div className="empty-requirements"><span><b>1</b> Matched experiment + CFD traces</span><span><b>2</b> Full numerical model card + uncertainty</span><span><b>3</b> Evidence-based next-run plan</span></div>
      </section> : <>
        <section className="case-switcher" aria-label="Loaded cases">
          <div className="case-switcher-label"><span>Cases</span><b>{cases.length}</b></div>
          <div className="case-tabs-list">{cases.map((item, index) => <button key={item.id} className={workspaceView === "case" && item.id === activeCase.id ? "active" : ""} onClick={() => { setActiveCaseId(item.id); setActiveProbe(0); setWorkspaceView("case"); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.metadata.name}</strong><small>φ {item.metadata.equivalenceRatio.toFixed(2)} · {item.metadata.inletPressureBar.toFixed(1)} bar</small></button>)}</div>
          <div className="case-actions">{cases.length > 1 && <button className={`compare-cases-button ${workspaceView === "compare" ? "active" : ""}`} onClick={() => setWorkspaceView("compare")}>Case history</button>}<button className="add-case-button" onClick={openNewCase}>+ Add case</button></div>
        </section>

        {workspaceView === "compare" && baselineSummary ? <section className="case-history-comparison" aria-label="Case history">
          <div className="case-history-heading"><div><span className="empty-kicker">CASE HISTORY</span><h1>Related reruns for one case</h1><p>A rerun becomes diagnostic evidence only when the experiment and operating point are unchanged and exactly one recorded CFD variable group changes.</p></div><label className="baseline-select"><span>Baseline case</span><select value={baselineSummary.item.id} onChange={(event) => setCaseBaselineId(event.target.value)}>{caseSummaries.map((summary) => <option key={summary.item.id} value={summary.item.id}>{summary.item.metadata.name}</option>)}</select></label></div>
          <div className="case-history-table-wrap"><table className="case-history-table direct-delta-table">
            <thead><tr><th>Case</th><th>Operating change vs baseline</th><th>Experimental change</th><th>CFD error change</th><th>Case status</th></tr></thead>
            <tbody>{caseSummaries.map((summary) => {
              const delta = buildCaseDelta(baselineSummary, summary);
              const isBaseline = summary.item.id === baselineSummary.item.id;
              const relationEvidence = buildCaseHistoryEvidence(cases, baselineSummary.item.id).find((item) => item.caseId === summary.item.id);
              const caseReviews = summary.assessment.metrics.filter((metric) => metric.tone === "review").length;
              return <tr key={summary.item.id} className={isBaseline ? "baseline-row" : ""}>
                <th scope="row"><button onClick={() => { setActiveCaseId(summary.item.id); setActiveProbe(0); setWorkspaceView("case"); }}>{summary.item.metadata.name}<span>{isBaseline ? "Selected baseline" : "Open analysis →"}</span></button></th>
                <td>{isBaseline ? <strong>Reference condition</strong> : <><strong>φ {signed(delta.condition.equivalenceRatio, 2)} · pressure {signed(delta.condition.inletPressureBar, 1)} bar</strong><span>Temperature {signed(delta.condition.inletTemperatureK, 0)} K</span><span>Mass flow {signed(delta.condition.massFlowKgS, 2)} kg/s</span></>}</td>
                <td>{isBaseline ? <strong>Reference behavior</strong> : <><strong>Frequency {signed(delta.experiment.frequencyKHz, 2)} kHz</strong><span>Peak pressure {signed(delta.experiment.peakPressureMpa, 3)} MPa</span><span>Amplitude {signed(delta.experiment.pressureAmplitudeMpa, 3)} MPa · variability {signed(delta.experiment.cycleVariabilityPoints, 1)} pt</span></>}</td>
                <td>{isBaseline ? <strong>Reference error</strong> : <><strong>Frequency error {signed(delta.cfdAgreement.frequencyErrorPointChange, 1)} pt</strong><span>Peak error {signed(delta.cfdAgreement.peakPressureErrorPointChange, 1)} pt</span><span>Amplitude error {signed(delta.cfdAgreement.amplitudeErrorPointChange, 1)} pt</span></>}</td>
                <td><span className={`comparison-status ${relationEvidence?.controlled ? "pass" : summary.assessment.validity.status === "Blocked" || caseReviews ? "review" : "neutral"}`}>{isBaseline ? "Baseline case" : relationEvidence?.controlled ? `Used as evidence · ${relationEvidence.state}` : "Comparison only"}</span></td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="case-history-note"><strong>How this works:</strong> this view keeps a baseline and its related controlled reruns together. Unrelated operating points remain comparisons and do not alter the diagnosis.</p>
        </section> : <>
          <div className="case-heading"><div><span className={`source-dot ${activeCase.source === "demo" ? "demo" : ""}`} /><span>{activeCase.source === "demo" ? "Synthetic demonstration" : "Uploaded case"}</span></div><h1>{activeCase.metadata.name}</h1><p>Operating point {cases.findIndex((item) => item.id === activeCase.id) + 1} of {cases.length} · deterministic local analysis</p></div>

          <section className="decision-card" aria-label="Diagnostic recommendation">
            <article><span>LIKELY ISSUE</span><h2>{likelyHypothesis?.title ?? "Cannot assess"}</h2></article>
            <article><span>RECOMMENDED NEXT RUN</span><h2>{assessment.nextRun.title}</h2><p>{assessment.nextRun.change}</p></article>
            <article><span>WHY</span><p>{likelyEvidence.length ? likelyEvidence.join(" ") : "The loaded evidence does not support a more specific diagnosis."}</p>{likelySources.length > 0 && <div className="source-links" aria-label="Diagnostic sources">{likelySources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.authors.split(";")[0]} ({source.year})</a>)}</div>}</article>
            <div className="decision-actions"><button className="button secondary" onClick={downloadReport}>Download evidence report</button>{cases.length > 1 && <button className="button secondary" onClick={() => setWorkspaceView("compare")}>View case history</button>}</div>
          </section>

          {showDetailedEvidence && <>
          <section className={`assessment-banner ${totalReview ? "review" : "pass"}`} aria-label="Comparison conclusion">
            <div><span>COMPARISON CONCLUSION</span><h2>{assessment.validity.status === "Blocked" ? "Assessment blocked until case matching is confirmed" : totalReview ? `${totalReview} evidence check${totalReview === 1 ? "" : "s"} require review` : "No selected mismatch is resolved beyond current uncertainty"}</h2><p>{assessment.validity.status === "Blocked" ? "Do not tune the CFD from this pairing yet." : totalReview ? "The highlighted evidence drives the ranked hypotheses and one-variable next-run plan below." : "This does not prove the CFD is universally valid; it means this pressure case does not expose a resolved discrepancy."}</p></div>
            <strong>{assessment.validity.status === "Blocked" ? "BLOCKED" : totalReview ? "REVIEW" : "UNRESOLVED"}</strong>
          </section>

          <section className="coverage-grid" aria-label="Validation coverage">
            {assessment.coverage.map((item) => <article key={item.module} className={item.status === "Assessed" ? "coverage-assessed" : item.status === "Inconclusive" ? "coverage-inconclusive" : "coverage-missing"}><span>{item.module}</span><strong>{item.status}</strong><small>{item.detail}</small></article>)}
          </section>

          <section className="quality-validity-grid">
            <article className="validity-panel"><div className="section-heading"><span>01</span><div><h2>Comparison validity</h2><p>Can this pairing support a CFD conclusion?</p></div></div><ul>{assessment.validity.checks.map((check) => <li key={check.label}><span className={`check-dot ${check.status.toLowerCase()}`} /> <div><strong>{check.label}<i>{check.status}</i></strong><small>{check.detail}</small></div></li>)}</ul></article>
            <article className="data-quality-panel"><div className="section-heading"><span>02</span><div><h2>Data quality</h2><p>Sampling, duration, continuity, and clipping</p></div></div><div className="quality-stats"><span><b>{average(assessment.dataQuality.experiment.map((result) => result.capturedCycles)).toFixed(1)}</b> experiment cycles</span><span><b>{average(assessment.dataQuality.cfd.map((result) => result.capturedCycles)).toFixed(1)}</b> CFD cycles</span><span><b>{average(assessment.dataQuality.experiment.map((result) => result.samplesPerCycle)).toFixed(0)}</b> samples/cycle</span></div><ul>{assessment.dataQuality.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></article>
          </section>

          <section className="workflow" aria-label="Caevera inputs and outputs">
            <article className="inputs-panel"><div className="panel-heading"><div><span className="step-number">03</span><div><h2>Inputs used</h2><p>Every required field affects validity, calculation, or diagnosis</p></div></div><button className="text-button" onClick={openCaseEditor}>Edit case</button></div><ol className="input-list">{inputRows.map(([label, value]) => <li key={label}><i aria-hidden="true">✓</i><div><strong>{label}</strong><span>{value}</span></div></li>)}</ol></article>
            <div className="flow-arrow" aria-hidden="true"><span>ANALYZE</span><i>→</i></div>
            <article className="outputs-panel"><div className="panel-heading"><div><span className="step-number">04</span><div><h2>Experiment vs CFD</h2><p>CFD minus experiment, resolved against uncertainty where supported</p></div></div></div>
              <div className="comparison-table-wrap"><table className="comparison-table uncertainty-table">
                <thead><tr><th>Quantity</th><th>Experiment</th><th>CFD</th><th>CFD − experiment</th><th>Combined uncertainty / method limit</th><th>Assessment</th></tr></thead>
                <tbody>{assessment.metrics.map((metric) => <tr key={metric.id} className={metric.tone === "review" ? "comparison-row-review" : metric.tone === "neutral" ? "comparison-row-neutral" : ""}>
                  <th scope="row"><strong>{metric.label}</strong><small>{metric.purpose}</small></th>
                  <td>{formatMetricValue(metric, metric.experiment)}</td><td>{formatMetricValue(metric, metric.cfd)}</td><td className="difference-cell">{formatMetricDifference(metric)}</td>
                  <td className="uncertainty-cell">{metric.uncertainty === null || metric.assessment.status === "match" || metric.assessment.status === "mismatch" ? metric.uncertaintyLabel : `±${metric.uncertainty.toFixed(metricDigits(metric))}${metric.unit ? ` ${metric.unit}` : ""}`}<small>{metric.assessment.explanation}</small></td>
                  <td><span className={`comparison-status ${metric.tone}`}>{metric.assessment.label}</span></td>
                </tr>)}</tbody>
              </table></div>

              <section className="result-block mismatch-block"><div><span className="result-index">05</span><h3>Waveform agreement</h3></div><div className="comparison-metrics">
                <div className={waveformWithinLimit ? "metric-pass" : "metric-review"}><span>Aligned correlation</span><strong>{correlation.toFixed(3)}</strong><small>{waveformWithinLimit ? "Within method limit · target ≥ 0.700" : "Review · target ≥ 0.700"}</small></div>
                <div><span>Normalized RMSE</span><strong>{(nrmse * 100).toFixed(1)}<i>%</i></strong><small>Residual relative to experimental oscillation RMS</small></div>
                <div><span>Mean pressure bias</span><strong>{signed(pressureBias, 3)} <i>MPa</i></strong><small>Its significance is assessed in the mean-pressure row above</small></div>
              </div><p className="metric-note">Correlation and harmonic/variability checks use explicit prototype method limits. Pressure, frequency, speed, impulse, and rise-time rows use the supplied experiment/CFD uncertainties. {inconclusiveMetrics ? `${inconclusiveMetrics} metric${inconclusiveMetrics === 1 ? " is" : "s are"} inconclusive.` : ""}</p></section>

              <section className="result-block causes-block"><div><span className="result-index">06</span><h3>Ranked diagnostic hypotheses</h3></div><ol>{assessment.hypotheses.map((hypothesis, index) => <li key={hypothesis.title}><b>{index + 1}. {hypothesis.title}</b><span>{hypothesis.evidence.map((item) => `${item.state}: ${item.observation}`).join(" ")}</span><small>Model inputs: {hypothesis.modelInputs.filter(Boolean).join(" · ")}</small></li>)}</ol><small>These are transparent sensitivity-test priorities, not causal proof.</small></section>

              <section className="result-block action-block"><div><span className="result-index">07</span><h3>Controlled next-run plan</h3></div><div className="next-run-header"><strong>{assessment.nextRun.title}</strong><span>{assessment.nextRun.evidenceStrength} evidence</span></div><p className="next-change"><b>Change one thing:</b> {assessment.nextRun.change}</p><div className="next-run-grid"><div><span>Why this run</span><p>{assessment.nextRun.reason}</p></div><div><span>Hold fixed</span><p>{assessment.nextRun.holdFixed.join(" · ")}</p></div><div><span>Expected result</span><p>{assessment.nextRun.expectedOutcome}</p></div><div><span>Confirm / reject</span><p><b>Confirm:</b> {assessment.nextRun.confirmationCriterion}<br /><b>Reject:</b> {assessment.nextRun.rejectionCriterion}</p></div></div><p className="alternative"><b>Alternative hypothesis:</b> {assessment.nextRun.alternativeHypothesis}</p></section>

              <button className="report-button" onClick={downloadReport}><span><b>08</b><strong>Download traceable report</strong><small>Inputs, validity, uncertainty, metrics, hypotheses, and controlled next run</small></span><i>↓</i></button>
            </article>
          </section>

          <section className="evidence-panel"><div className="evidence-heading"><div><h2>Signal evidence</h2><p>Inspect the pressure, spectrum, and residual behind the assessment.</p></div><div className="control-group"><div className="probe-tabs" aria-label="Probe selection">{[0, 1, 2].map((probe) => <button key={probe} className={activeProbe === probe ? "active" : ""} onClick={() => setActiveProbe(probe)}>P{probe + 1}</button>)}</div><div className="view-tabs" aria-label="Evidence view"><button className={activeView === "signals" ? "active" : ""} onClick={() => setActiveView("signals")}>Pressure</button><button className={activeView === "spectrum" ? "active" : ""} onClick={() => setActiveView("spectrum")}>Frequency</button><button className={activeView === "residual" ? "active" : ""} onClick={() => setActiveView("residual")}>Residual</button></div></div></div><div className="chart-heading"><span>Probe P{activeProbe + 1} · {activeCase.metadata.probePositionsDeg[activeProbe]}°</span><Legend residual={activeView === "residual"} /></div>{activeView === "signals" && <SignalChart comparison={activeComparison} />}{activeView === "spectrum" && <SpectrumChart comparison={activeComparison} />}{activeView === "residual" && <ResidualChart comparison={activeComparison} />}</section>
          </>}
          <footer><span>Caevera v{ANALYSIS_VERSION} · deterministic analysis</span><span>{cases.length} case{cases.length === 1 ? "" : "s"} in this browser session · not certification evidence</span></footer>
        </>}
      </>}
    </section>

    {showLoader && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowLoader(false)}><section className="loader-modal" role="dialog" aria-modal="true" aria-labelledby="loader-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={() => setShowLoader(false)} aria-label="Close case loader">×</button><span className="modal-kicker">RDE CASE INPUTS</span><h2 id="loader-title">{editingCaseId ? "Edit operating point" : "Add operating point"}</h2><p>Required fields feed a calculation, validity check, uncertainty assessment, or diagnostic rule. Optional convergence results strengthen the recommendation when available.</p>

      <div className="form-section"><h3>Case + geometry</h3><div className="form-grid three"><label><span>Case name</span><input value={draft.name} onChange={(event) => updateText("name", event.target.value)} /></label><label><span>Mean diameter (mm)</span><input type="number" value={numberValue(draft.annulusMeanDiameterMm)} onChange={(event) => updateNumber("annulusMeanDiameterMm", event.target.value)} /></label><label><span>Probe angles (deg)</span><div className="angle-inputs">{draft.probePositionsDeg.map((angle, index) => <input key={index} type="number" aria-label={`Probe ${index + 1} angle`} value={numberValue(angle)} onChange={(event) => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.map((value, position) => position === index ? (event.target.value === "" ? Number.NaN : Number(event.target.value)) : value) }))} />)}</div></label></div><label className="confirmation-check"><input type="checkbox" checked={draft.comparisonMatchConfirmed} onChange={(event) => setDraft((current) => ({ ...current, comparisonMatchConfirmed: event.target.checked }))} /><span>I confirm experiment and CFD use the same geometry, operating point, probe locations, and comparison window.</span></label></div>

      {cases.length > 0 && <div className="form-section"><h3>Related rerun · optional</h3><p className="form-help">Use this only when this is a controlled rerun of an existing case. Caevera verifies the relationship before using it as diagnostic evidence.</p><div className="form-grid three"><label><span>Baseline case</span><select value={draftRelationship?.baselineCaseId ?? ""} onChange={(event) => setDraftRelationship(event.target.value ? { baselineCaseId: event.target.value, changedVariable: draftRelationship?.changedVariable ?? "other", description: draftRelationship?.description ?? "" } : null)}><option value="">Not a related rerun</option>{cases.filter((item) => item.id !== editingCaseId).map((item) => <option key={item.id} value={item.id}>{item.metadata.name}</option>)}</select></label><label><span>Single CFD change</span><select disabled={!draftRelationship} value={draftRelationship?.changedVariable ?? "other"} onChange={(event) => setDraftRelationship((current) => current ? { ...current, changedVariable: event.target.value as SensitivityVariable } : null)}><option value="mesh">Mesh / spatial method</option><option value="time-step">Time step / temporal method</option><option value="chemistry">Chemistry model</option><option value="inlet">Inlet treatment</option><option value="wall">Wall treatment</option><option value="initialization">Initialization</option><option value="other">Other / comparison only</option></select></label><label><span>Change description</span><input disabled={!draftRelationship} value={draftRelationship?.description ?? ""} onChange={(event) => setDraftRelationship((current) => current ? { ...current, description: event.target.value } : null)} placeholder="e.g. 50% front-cell refinement" /></label></div></div>}

      <div className="form-section"><div className="form-section-heading"><h3>Three synchronized pressure traces</h3><button onClick={downloadExample}>Download example CSV</button></div><div className="upload-grid"><label className={`upload-box ${testPending ? "loaded" : ""}`}><span>EXPERIMENT</span><strong>{testPending?.[0].name.split(" · ")[0] ?? (editingCaseId ? "Keep current file or choose replacement" : "Choose three-probe CSV")}</strong><small>time_ms, p1_MPa, p2_MPa, p3_MPa</small><input type="file" accept=".csv,.txt" onChange={(event) => readProbeFile(event, "test")} hidden /></label><label className={`upload-box ${cfdPending ? "loaded" : ""}`}><span>CFD</span><strong>{cfdPending?.[0].name.split(" · ")[0] ?? (editingCaseId ? "Keep current file or choose replacement" : "Choose matching CFD CSV")}</strong><small>Same probes, positions, and operating point</small><input type="file" accept=".csv,.txt" onChange={(event) => readProbeFile(event, "cfd")} hidden /></label></div></div>

      <div className="form-section"><h3>Operating conditions</h3><div className="form-grid four"><label><span>Inlet pressure (bar)</span><input type="number" value={numberValue(draft.inletPressureBar)} onChange={(event) => updateNumber("inletPressureBar", event.target.value)} /></label><label><span>Inlet temperature (K)</span><input type="number" value={numberValue(draft.inletTemperatureK)} onChange={(event) => updateNumber("inletTemperatureK", event.target.value)} /></label><label><span>Equivalence ratio</span><input type="number" step="0.01" value={numberValue(draft.equivalenceRatio)} onChange={(event) => updateNumber("equivalenceRatio", event.target.value)} /></label><label><span>Mass flow (kg/s)</span><input type="number" step="0.01" value={numberValue(draft.massFlowKgS)} onChange={(event) => updateNumber("massFlowKgS", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Solver + numerical schemes</h3><div className="form-grid four"><label><span>Solver</span><input value={draft.solver} onChange={(event) => updateText("solver", event.target.value)} /></label><label><span>Version</span><input value={draft.solverVersion} onChange={(event) => updateText("solverVersion", event.target.value)} /></label><label><span>Dimensionality</span><select value={draft.dimensionality} onChange={(event) => setDraft((current) => ({ ...current, dimensionality: event.target.value as Dimensionality }))}><option value="">Select</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label><span>Spatial scheme</span><input value={draft.spatialScheme} onChange={(event) => updateText("spatialScheme", event.target.value)} /></label><label><span>Spatial order</span><input type="number" value={numberValue(draft.spatialOrder)} onChange={(event) => updateNumber("spatialOrder", event.target.value)} /></label><label><span>Numerical flux</span><input value={draft.numericalFlux} onChange={(event) => updateText("numericalFlux", event.target.value)} /></label><label><span>Limiter / filter / dissipation</span><input placeholder="Enter None if unused" value={draft.limiterFilter} onChange={(event) => updateText("limiterFilter", event.target.value)} /></label><label><span>Temporal scheme</span><input value={draft.temporalScheme} onChange={(event) => updateText("temporalScheme", event.target.value)} /></label><label><span>Temporal order</span><input type="number" value={numberValue(draft.temporalOrder)} onChange={(event) => updateNumber("temporalOrder", event.target.value)} /></label><label><span>Time step (µs)</span><input type="number" step="0.001" value={numberValue(draft.timeStepUs)} onChange={(event) => updateNumber("timeStepUs", event.target.value)} /></label><label><span>CFL</span><input type="number" step="0.01" value={numberValue(draft.cfl)} onChange={(event) => updateNumber("cfl", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Resolution + convergence</h3><div className="form-grid four"><label><span>Total mesh cells</span><input type="number" value={numberValue(draft.meshCells)} onChange={(event) => updateNumber("meshCells", event.target.value)} /></label><label><span>Minimum front cell (mm)</span><input type="number" step="0.001" value={numberValue(draft.minimumCellSizeMm)} onChange={(event) => updateNumber("minimumCellSizeMm", event.target.value)} /></label><label><span>Cells / induction length</span><input type="number" step="0.1" value={numberValue(draft.cellsPerInductionLength)} onChange={(event) => updateNumber("cellsPerInductionLength", event.target.value)} /></label><label><span>Near-wall cell (mm)</span><input type="number" step="0.001" value={numberValue(draft.nearWallCellSizeMm)} onChange={(event) => updateNumber("nearWallCellSizeMm", event.target.value)} /></label><label><span>Mesh-change result (%) · optional</span><input type="number" step="0.1" value={numberValue(draft.meshConvergencePct)} onChange={(event) => updateNumber("meshConvergencePct", event.target.value)} /></label><label><span>Time-step-change result (%) · optional</span><input type="number" step="0.1" value={numberValue(draft.timeStepConvergencePct)} onChange={(event) => updateNumber("timeStepConvergencePct", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Physics + boundaries</h3><div className="form-grid four"><label><span>Chemical mechanism</span><input value={draft.chemistryModel} onChange={(event) => updateText("chemistryModel", event.target.value)} /></label><label><span>Species</span><input type="number" value={numberValue(draft.chemistrySpecies)} onChange={(event) => updateNumber("chemistrySpecies", event.target.value)} /></label><label><span>Reactions</span><input type="number" value={numberValue(draft.chemistryReactions)} onChange={(event) => updateNumber("chemistryReactions", event.target.value)} /></label><label><span>Chemistry integration</span><input value={draft.chemistryIntegrator} onChange={(event) => updateText("chemistryIntegrator", event.target.value)} /></label><label><span>Turbulence model</span><input placeholder="Enter None if unused" value={draft.turbulenceModel} onChange={(event) => updateText("turbulenceModel", event.target.value)} /></label><label><span>Combustion model</span><input placeholder="Enter None if unused" value={draft.combustionModel} onChange={(event) => updateText("combustionModel", event.target.value)} /></label><label><span>Wall thermal condition</span><input value={draft.wallBoundaryCondition} onChange={(event) => updateText("wallBoundaryCondition", event.target.value)} /></label><label><span>Inlet treatment</span><input value={draft.inletBoundaryCondition} onChange={(event) => updateText("inletBoundaryCondition", event.target.value)} /></label><label><span>Outlet treatment</span><input value={draft.outletBoundaryCondition} onChange={(event) => updateText("outletBoundaryCondition", event.target.value)} /></label><label><span>Ignition / initialization</span><input value={draft.initializationMethod} onChange={(event) => updateText("initializationMethod", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Experiment + CFD uncertainty</h3><div className="form-grid four"><label><span>Experiment pressure uncertainty (%)</span><input type="number" step="0.1" value={numberValue(draft.pressureUncertaintyPct)} onChange={(event) => updateNumber("pressureUncertaintyPct", event.target.value)} /></label><label><span>Experiment timing uncertainty (µs)</span><input type="number" step="0.01" value={numberValue(draft.timingUncertaintyUs)} onChange={(event) => updateNumber("timingUncertaintyUs", event.target.value)} /></label><label><span>CFD pressure uncertainty (%)</span><input type="number" step="0.1" value={numberValue(draft.cfdPressureUncertaintyPct)} onChange={(event) => updateNumber("cfdPressureUncertaintyPct", event.target.value)} /></label><label><span>CFD timing uncertainty (µs)</span><input type="number" step="0.01" value={numberValue(draft.cfdTimingUncertaintyUs)} onChange={(event) => updateNumber("cfdTimingUncertaintyUs", event.target.value)} /></label></div></div>

      {error && <p className="error-message">{error}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setShowLoader(false)}>Cancel</button><button className="button primary" onClick={applyCase}>Analyze case →</button></div>
    </section></div>}
  </main>;
}
