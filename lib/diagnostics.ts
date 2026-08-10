import type { CaseMetadata } from "./caevera-types.ts";
import { SOURCE_IDS_BY_CAUSE, type DiagnosticCauseId } from "./diagnostic-knowledge.ts";
import {
  REVIEW_THRESHOLDS,
  type Comparison,
  type DataQualityResult,
} from "./rde-analysis.ts";
import { phasePatternErrorDeg, type RdeModeResult } from "./wave-dynamics.ts";
import {
  assessResolvedDifference,
  exactAssessment,
  frequencyUncertaintyKHz,
  rss,
  statusTone,
  type UncertaintyAssessment,
} from "./uncertainty.ts";

export type MetricAssessment = {
  id: string;
  label: string;
  purpose: string;
  experiment: number | string;
  cfd: number | string;
  difference: number | string;
  percentDifference: number | null;
  unit: string;
  uncertainty: number | null;
  uncertaintyLabel: string;
  assessment: UncertaintyAssessment;
  tone: "pass" | "review" | "neutral";
};

export type ValidityCheck = {
  label: string;
  status: "Pass" | "Review" | "Blocked";
  detail: string;
};

export type EvidenceState = "supports" | "weakens" | "unknown" | "cannot-assess";
export type EvidenceStrength = "strong" | "moderate" | "context";

export type DiagnosticEvidence = {
  state: EvidenceState;
  strength: EvidenceStrength;
  observation: string;
  basis: "case" | "case-history" | "literature";
  sourceIds: string[];
};

export type CaseHistoryEvidence = {
  causeId: DiagnosticCauseId;
  state: "supports" | "weakens" | "unknown";
  strength: "strong" | "moderate";
  caseId: string;
  caseName: string;
  detail: string;
  controlled: boolean;
};

export type DiagnosticHypothesis = {
  id: DiagnosticCauseId;
  title: string;
  evidence: DiagnosticEvidence[];
  modelInputs: string[];
  sourceIds: string[];
};

export type ControlledNextRun = {
  title: string;
  change: string;
  reason: string;
  evidence: string[];
  holdFixed: string[];
  expectedOutcome: string;
  confirmationCriterion: string;
  rejectionCriterion: string;
  alternativeHypothesis: string;
  evidenceStrength: "High" | "Moderate" | "Exploratory";
};

export type CoverageItem = {
  module: string;
  status: "Assessed" | "Inconclusive" | "Not assessed";
  detail: string;
};

export type CaseAssessment = {
  validity: {
    status: "Valid" | "Review" | "Blocked";
    checks: ValidityCheck[];
  };
  dataQuality: {
    status: "Ready" | "Review";
    experiment: DataQualityResult[];
    cfd: DataQualityResult[];
    findings: string[];
  };
  metrics: MetricAssessment[];
  coverage: CoverageItem[];
  hypotheses: DiagnosticHypothesis[];
  nextRun: ControlledNextRun;
};

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

function pressureMetric(comparisons: Comparison[], key: keyof Comparison["testMetrics"], source: "test" | "cfd") {
  return average(comparisons.map((comparison) => comparison[source === "test" ? "testMetrics" : "cfdMetrics"][key] as number));
}

function resolvedPressureMetric({
  id,
  label,
  purpose,
  unit,
  test,
  cfd,
  metadata,
  includeTiming = false,
  testFrequencyKHz = 8,
  cfdFrequencyKHz = 8,
}: {
  id: string;
  label: string;
  purpose: string;
  unit: string;
  test: number;
  cfd: number;
  metadata: CaseMetadata;
  includeTiming?: boolean;
  testFrequencyKHz?: number;
  cfdFrequencyKHz?: number;
}): MetricAssessment {
  const difference = cfd - test;
  const experimentRelative = metadata.pressureUncertaintyPct / 100;
  const cfdRelative = metadata.cfdPressureUncertaintyPct / 100;
  const experimentTiming = includeTiming ? metadata.timingUncertaintyUs / (1000 / Math.max(testFrequencyKHz, 1e-12)) : 0;
  const cfdTiming = includeTiming ? metadata.cfdTimingUncertaintyUs / (1000 / Math.max(cfdFrequencyKHz, 1e-12)) : 0;
  const experimentUncertainty = Math.abs(test) * rss(experimentRelative, experimentTiming);
  const cfdUncertainty = Math.abs(cfd) * rss(cfdRelative, cfdTiming);
  const assessment = assessResolvedDifference(difference, experimentUncertainty, cfdUncertainty);
  return {
    id,
    label,
    purpose,
    experiment: test,
    cfd,
    difference,
    percentDifference: Number.isFinite(test) ? 100 * difference / Math.max(Math.abs(test), 1e-12) : null,
    unit,
    uncertainty: assessment.combined,
    uncertaintyLabel: "Combined measurement + numerical uncertainty (RSS, k=1)",
    assessment,
    tone: statusTone(assessment.status),
  };
}

function prototypeAssessment(matches: boolean, label: string, explanation: string): UncertaintyAssessment {
  return {
    combined: null,
    status: matches ? "within-limit" : "review",
    label: matches ? "Within method limit" : "Review",
    explanation,
  };
}

function categoricalMetric(id: string, label: string, purpose: string, experiment: string | number, cfd: string | number): MetricAssessment {
  const assessment = exactAssessment(experiment === cfd);
  return {
    id,
    label,
    purpose,
    experiment,
    cfd,
    difference: experiment === cfd ? "No difference" : "Different",
    percentDifference: null,
    unit: "",
    uncertainty: 0,
    uncertaintyLabel: "Exact categorical comparison",
    assessment,
    tone: statusTone(assessment.status),
  };
}

function caseDataQuality(comparisons: Comparison[]) {
  const experiment = comparisons.map((comparison) => comparison.testQuality);
  const cfd = comparisons.map((comparison) => comparison.cfdQuality);
  const findings = [...new Set([...experiment, ...cfd].flatMap((result) => result.findings).filter((finding) => !finding.startsWith("Sampling")))];
  return {
    experiment,
    cfd,
    findings: findings.length ? findings : [`All ${experiment.length + cfd.length} traces passed the current sampling, duration, continuity, and clipping checks.`],
    status: [...experiment, ...cfd].some((result) => result.status === "Review") ? "Review" as const : "Ready" as const,
  };
}

function probeLayoutReview(positionsDeg: number[]) {
  const normalized = positionsDeg.map((value) => ((value % 360) + 360) % 360).sort((a, b) => a - b);
  const gaps = normalized.map((value, index) => {
    const next = normalized[(index + 1) % normalized.length] + (index === normalized.length - 1 ? 360 : 0);
    return next - value;
  });
  return Math.max(...gaps) - Math.min(...gaps) < 2;
}

function metricById(metrics: MetricAssessment[], id: string) {
  return metrics.find((metric) => metric.id === id);
}

function isMismatch(metric: MetricAssessment | undefined) {
  return metric?.assessment.status === "resolved-mismatch" || metric?.assessment.status === "mismatch" || metric?.assessment.status === "review";
}

function numeric(value: number | string) {
  return typeof value === "number" ? value : Number.NaN;
}

function buildHypotheses(metadata: CaseMetadata, metrics: MetricAssessment[], validity: CaseAssessment["validity"], dataQuality: CaseAssessment["dataQuality"], caseHistory: CaseHistoryEvidence[]) {
  const candidates: DiagnosticHypothesis[] = [];
  const frequency = metricById(metrics, "frequency");
  const meanPressure = metricById(metrics, "mean-pressure");
  const peakPressure = metricById(metrics, "peak-pressure");
  const amplitude = metricById(metrics, "amplitude");
  const impulse = metricById(metrics, "impulse");
  const riseTime = metricById(metrics, "rise-time");
  const harmonics = metricById(metrics, "harmonics");
  const variability = metricById(metrics, "cycle-variability");
  const mode = metricById(metrics, "wave-count");
  const phasePattern = metricById(metrics, "phase-pattern");
  const frequencyDrift = metricById(metrics, "frequency-drift");
  const phaseJitter = metricById(metrics, "phase-jitter");
  const modeTransitions = metricById(metrics, "mode-transitions");

  const evidence = (observation: string, state: EvidenceState, strength: EvidenceStrength = "moderate", basis: DiagnosticEvidence["basis"] = "case", sourceIds: string[] = []): DiagnosticEvidence => ({ observation, state, strength, basis, sourceIds });
  const add = (id: DiagnosticCauseId, title: string, observations: DiagnosticEvidence[], modelInputs: string[]) => {
    const history = caseHistory.filter((item) => item.causeId === id).map((item) => evidence(item.detail, item.state, item.strength, "case-history"));
    const existing = candidates.find((candidate) => candidate.id === id);
    if (existing) {
      existing.evidence.push(...observations);
      existing.modelInputs = [...new Set([...existing.modelInputs, ...modelInputs])];
      return;
    }
    candidates.push({ id, title, evidence: [...observations, ...history], modelInputs, sourceIds: SOURCE_IDS_BY_CAUSE[id] });
  };

  if (validity.status === "Blocked") add("case-validity", "Case matching or data mapping", validity.checks.filter((check) => check.status === "Blocked").map((check) => evidence(check.detail, "supports", "strong")), ["Geometry", "operating point", "probe coordinates", "comparison window"]);
  if (dataQuality.status === "Review") add("data-quality", "Acquisition or export quality", dataQuality.findings.map((finding) => evidence(finding, "supports", "strong")), ["Sample rate", "record duration", "timestamps", "sensor range"]);
  if (isMismatch(peakPressure) && numeric(peakPressure!.cfd) < numeric(peakPressure!.experiment) && numeric(riseTime?.cfd ?? Number.NaN) > numeric(riseTime?.experiment ?? Number.NaN)) {
    add("spatial-resolution", "Spatial resolution or numerical dissipation", [
      evidence(`CFD peak pressure is ${Math.abs(peakPressure!.percentDifference ?? 0).toFixed(1)}% low.`, "supports", "moderate"),
      evidence(`CFD pressure rise is ${Math.abs(riseTime?.percentDifference ?? 0).toFixed(1)}% longer.`, "supports", "moderate"),
      evidence(Number.isFinite(metadata.meshConvergencePct) ? `Latest mesh-change effect is ${metadata.meshConvergencePct.toFixed(1)}%.` : "No mesh-convergence result was supplied.", Number.isFinite(metadata.meshConvergencePct) ? (metadata.meshConvergencePct > 2 ? "supports" : "weakens") : "unknown", "strong"),
    ], [`${metadata.minimumCellSizeMm} mm minimum cell`, `${metadata.cellsPerInductionLength} cells/induction length`, metadata.numericalFlux, metadata.limiterFilter]);
  }
  if (isMismatch(frequency)) {
    add("chemistry-timescale", "Chemistry timescale or temporal resolution", [evidence(`Wave-frequency difference is ${Math.abs(frequency!.percentDifference ?? 0).toFixed(1)}% and is ${frequency!.assessment.label.toLowerCase()}.`, "supports")], [metadata.chemistryModel, metadata.chemistryIntegrator, `${metadata.timeStepUs} µs time step`]);
    add("inlet-boundary", "Inlet state or backflow representation", [evidence("A resolved wave-frequency mismatch is consistent with, but not unique to, inlet-state, injection, or backflow error.", "supports", "context")], [metadata.inletBoundaryCondition, `${metadata.inletPressureBar} bar`, `${metadata.inletTemperatureK} K`, `φ ${metadata.equivalenceRatio}`]);
  }
  if (isMismatch(meanPressure)) {
    add("inlet-boundary", "Inlet state or backflow representation", [evidence(`Mean-pressure bias is ${numeric(meanPressure!.difference).toFixed(3)} MPa.`, "supports")], [metadata.inletBoundaryCondition, `${metadata.massFlowKgS} kg/s`, `${metadata.inletPressureBar} bar`]);
  }
  if (isMismatch(amplitude) || isMismatch(impulse)) {
    add("wall-loss", "Wall heat-loss treatment", [
      evidence(isMismatch(amplitude) ? `Pressure-amplitude difference is ${Math.abs(amplitude!.percentDifference ?? 0).toFixed(1)}% and exceeds combined uncertainty.` : "Pressure amplitude is not independently resolved.", isMismatch(amplitude) ? "supports" : "unknown"),
      evidence(isMismatch(impulse) ? `Wave-passage impulse difference is ${Math.abs(impulse!.percentDifference ?? 0).toFixed(1)}% and exceeds combined uncertainty.` : "Pressure impulse is not independently resolved.", isMismatch(impulse) ? "supports" : "unknown"),
    ], [metadata.wallBoundaryCondition, `${metadata.nearWallCellSizeMm} mm near-wall cell`, metadata.chemistryModel, metadata.chemistryIntegrator]);
  }
  if (isMismatch(mode) || isMismatch(phasePattern) || isMismatch(modeTransitions)) {
    add("initialization-mode", "Initialization or domain-mode sensitivity", [
      evidence(isMismatch(mode) ? "Experiment and CFD identify different rotating-wave counts." : "Wave count matches across the full record.", isMismatch(mode) ? "supports" : "unknown", "strong"),
      evidence(isMismatch(phasePattern) ? `CFD circumferential phase pattern differs by ${numeric(phasePattern!.difference).toFixed(1)}° RMS.` : "Circumferential phase pattern is within the current method limit.", isMismatch(phasePattern) ? "supports" : "weakens"),
      evidence(isMismatch(modeTransitions) ? "Experiment and CFD contain different numbers of window-to-window mode transitions." : "Mode-transition counts match.", isMismatch(modeTransitions) ? "supports" : "weakens"),
    ], [metadata.initializationMethod, metadata.dimensionality, `${metadata.meshCells.toLocaleString()} cells`, `${metadata.probePositionsDeg.length} pressure probes`]);
  }
  if (isMismatch(harmonics)) {
    add("spatial-resolution", "Spatial resolution or numerical dissipation", [evidence(`Second-harmonic ratio differs by ${Math.abs(harmonics!.percentDifference ?? 0).toFixed(1)}%.`, "supports", "context")], [metadata.spatialScheme, metadata.numericalFlux, metadata.limiterFilter, metadata.chemistryIntegrator]);
  }
  if ((isMismatch(variability) && numeric(variability!.cfd) < numeric(variability!.experiment)) || isMismatch(frequencyDrift) || (isMismatch(phaseJitter) && numeric(phaseJitter!.cfd) < numeric(phaseJitter!.experiment))) {
    add("missing-unsteadiness", "Missing unsteadiness in the CFD setup", [
      evidence(isMismatch(variability) ? `CFD cycle variability differs by ${Math.abs(numeric(variability!.difference)).toFixed(1)} percentage points.` : "Cycle-range variability is within the current method limit.", isMismatch(variability) ? "supports" : "weakens"),
      evidence(isMismatch(frequencyDrift) ? `Frequency-drift difference is ${Math.abs(numeric(frequencyDrift!.difference)).toFixed(1)} percentage points.` : "Frequency drift is similar.", isMismatch(frequencyDrift) ? "supports" : "weakens"),
      evidence(isMismatch(phaseJitter) ? `Phase-jitter difference is ${Math.abs(numeric(phaseJitter!.difference)).toFixed(1)}°.` : "Phase jitter is similar.", isMismatch(phaseJitter) ? "supports" : "weakens"),
    ], [metadata.turbulenceModel, metadata.combustionModel, metadata.inletBoundaryCondition, metadata.dimensionality]);
  }

  const historyTitles: Partial<Record<DiagnosticCauseId, string>> = {
    "spatial-resolution": "Spatial resolution or numerical dissipation",
    "chemistry-timescale": "Chemistry timescale or temporal resolution",
    "inlet-boundary": "Inlet state or backflow representation",
    "wall-loss": "Wall heat-loss treatment",
    "initialization-mode": "Initialization or domain-mode sensitivity",
    "missing-unsteadiness": "Missing unsteadiness in the CFD setup",
  };
  for (const item of caseHistory) {
    if (!candidates.some((candidate) => candidate.id === item.causeId)) {
      add(item.causeId, historyTitles[item.causeId] ?? "Related-case sensitivity", [], [item.detail]);
    }
  }

  if (!candidates.length) {
    add("validation-coverage", "Validation-envelope coverage", [evidence("No current comparison is resolved beyond uncertainty or fails an exact mode check.", "supports", "context")], [`${metadata.inletPressureBar} bar`, `${metadata.inletTemperatureK} K`, `φ ${metadata.equivalenceRatio}`]);
  }
  const rank = (candidate: DiagnosticHypothesis) => {
    const states = candidate.evidence;
    return [
      candidate.id === "case-validity" ? 1 : 0,
      states.filter((item) => item.basis === "case-history" && item.state === "supports").length,
      states.filter((item) => item.state === "supports").length - states.filter((item) => item.state === "weakens").length,
      states.filter((item) => item.strength === "strong" && item.state === "supports").length,
      -states.filter((item) => item.state === "unknown" || item.state === "cannot-assess").length,
    ];
  };
  return candidates.sort((left, right) => {
    const a = rank(left); const b = rank(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
    return left.title.localeCompare(right.title);
  }).slice(0, 3);
}

function nextRunFor(hypothesis: DiagnosticHypothesis, metadata: CaseMetadata): ControlledNextRun {
  const common = {
    evidence: hypothesis.evidence.map((item) => `${item.state}: ${item.observation}`),
    evidenceStrength: hypothesis.evidence.some((item) => item.state === "supports" && item.strength === "strong") ? "High" as const : hypothesis.evidence.some((item) => item.state === "supports") ? "Moderate" as const : "Exploratory" as const,
  };
  if (hypothesis.id === "case-validity") return {
    ...common,
    title: "Verify the comparison before changing CFD",
    change: "Re-export one synchronized window after confirming geometry, operating point, probe coordinates, and trigger time.",
    reason: "A model change cannot be interpreted while the experiment/CFD pairing is unconfirmed.",
    holdFixed: ["CFD solution", "signal processing settings"],
    expectedOutcome: "The validity checks pass and the remaining mismatches can be attributed to the paired case.",
    confirmationCriterion: "All case-matching checks pass and every probe has at least five common cycles.",
    rejectionCriterion: "The mismatch persists after the corrected export with the same sign and magnitude.",
    alternativeHypothesis: "If the corrected pairing still disagrees, evaluate spatial resolution next.",
  };
  if (hypothesis.id === "data-quality") return {
    ...common,
    title: "Repair the evidence window first",
    change: "Re-export or reacquire the affected traces at a continuous sample rate with at least five complete cycles and no clipping.",
    reason: "The current record can bias peaks, rise time, frequency, or cycle statistics.",
    holdFixed: ["Operating point", "CFD model", "probe coordinates"],
    expectedOutcome: "Data-quality findings clear without altering the physical case.",
    confirmationCriterion: "No gaps or clipping; at least 20 samples per cycle and five captured cycles.",
    rejectionCriterion: "The new record passes quality checks but produces the same resolved mismatch.",
    alternativeHypothesis: "If the mismatch remains, proceed to the highest-ranked CFD hypothesis.",
  };
  if (hypothesis.id === "spatial-resolution") {
    const supportedByRerun = hypothesis.evidence.some((item) => item.basis === "case-history" && item.state === "supports" && item.strength === "strong");
    if (supportedByRerun) return {
      ...common,
      title: "Complete the mesh-convergence check",
      change: "Run the next finer mesh level with the same refinement region and numerical method.",
      reason: "A linked one-variable mesh rerun already reduced the targeted mismatch; the next level tests whether that improvement is converging.",
      holdFixed: ["Chemistry mechanism", "time step and CFL", "boundary conditions", "wall model", "initialization"],
      expectedOutcome: "Peak pressure and rise time change less than in the previous refinement while remaining closer to experiment.",
      confirmationCriterion: "The targeted errors remain lower and the fine-to-finer change is below 2%.",
      rejectionCriterion: "The improvement reverses or the fine-to-finer change remains above 2%.",
      alternativeHypothesis: "If the trend does not converge, test chemistry integration or wall-loss treatment next.",
    };
    return {
    ...common,
    title: "Run one spatial-refinement case",
    change: `Reduce the ${metadata.minimumCellSizeMm.toFixed(3)} mm minimum cell size by 50% in the detonation-front region without changing the flux or limiter.`,
    reason: "Low peaks plus a slower rise are consistent with front smearing, especially without a converged mesh result.",
    holdFixed: ["Chemistry mechanism", "time step and CFL", "boundary conditions", "wall model", "initialization"],
    expectedOutcome: "Peak pressure increases and rise time shortens while frequency and wave count remain approximately unchanged.",
    confirmationCriterion: "Peak and rise-time mismatch both shrink by at least 25%, with frequency changing by less than 2%.",
    rejectionCriterion: "Peak and rise time change by less than 5% after refinement.",
    alternativeHypothesis: "If refinement has little effect, test chemistry integration or wall-loss treatment next.",
    };
  }
  if (hypothesis.id === "initialization-mode") return {
    ...common,
    title: "Run an initialization-sensitivity case",
    change: `Repeat the case with a second physically defensible ignition pattern while keeping ${metadata.dimensionality || "the current dimensionality"}.`,
    reason: "Wave-count disagreement can reflect the selected attractor rather than steady operating conditions alone.",
    holdFixed: ["Mesh", "time step", "chemistry", "boundary conditions", "wall model"],
    expectedOutcome: "The CFD either reaches the experimental mode or demonstrates persistent mode-selection disagreement.",
    confirmationCriterion: "The alternate initialization reaches the experimental wave count and direction for the final five cycles.",
    rejectionCriterion: "Both initializations converge to the same nonexperimental mode.",
    alternativeHypothesis: "If mode selection is persistent, investigate domain dimensionality and inlet-plenum treatment.",
  };
  if (hypothesis.id === "chemistry-timescale") return {
    ...common,
    title: "Run one chemistry time-resolution case",
    change: "Halve only the chemistry integration substep or tolerance while keeping the flow time step fixed.",
    reason: "The wave-frequency mismatch is consistent with an incorrectly resolved reaction timescale, and the paper record identifies temporal chemistry resolution as a relevant sensitivity.",
    holdFixed: ["Mesh", "flow time step", "chemical mechanism", "boundaries", "wall model", "initialization"],
    expectedOutcome: "Frequency moves toward the experiment without materially changing the inferred wave mode.",
    confirmationCriterion: "Frequency mismatch shrinks by at least 25% and wave count is unchanged.",
    rejectionCriterion: "Frequency changes by less than 1% or moves farther from the experiment.",
    alternativeHypothesis: "If chemistry time resolution is weak, test inlet representation next.",
  };
  if (hypothesis.id === "inlet-boundary") return {
    ...common,
    title: "Run one inlet-representation sensitivity case",
    change: "Change only the inlet formulation to the closest hardware-matched treatment of injection and detonation-driven backflow.",
    reason: "Published RDE studies show that injection conditions, slot-generated inhomogeneity, and inlet backflow can alter wave behavior and pressure gain; the current pressure mismatch does not identify which inlet mechanism is responsible.",
    holdFixed: ["Mesh", "time step", "chemistry", "outlet condition", "wall model", "initialization"],
    expectedOutcome: "Mean pressure or wave frequency moves toward experiment without changing unrelated model settings.",
    confirmationCriterion: "The targeted mismatch shrinks by at least 25% while the other resolved pressure metrics do not worsen beyond uncertainty.",
    rejectionCriterion: "The targeted metric changes by less than its combined uncertainty.",
    alternativeHypothesis: "If boundary sensitivity is weak, examine wall heat-loss treatment.",
  };
  if (hypothesis.id === "wall-loss") return {
    ...common,
    title: "Run one wall-loss sensitivity case",
    change: `Bracket the current wall treatment (${metadata.wallBoundaryCondition}) with one physically defensible adjacent thermal condition.`,
    reason: "Resolved amplitude or impulse disagreement indicates a pressure-energy difference while the dominant wave mode may still agree.",
    holdFixed: ["Mesh", "time step", "chemistry", "inlet/outlet conditions", "initialization", "numerical flux"],
    expectedOutcome: "Pressure amplitude and impulse move together toward the experiment without shifting wave frequency or count.",
    confirmationCriterion: "Both amplitude and impulse mismatch shrink by at least 25%, with frequency changing by less than 2%.",
    rejectionCriterion: "Amplitude and impulse change by less than their combined uncertainty.",
    alternativeHypothesis: "If wall-loss sensitivity is weak, test chemistry integration or front resolution next.",
  };
  if (hypothesis.id === "missing-unsteadiness") return {
    ...common,
    title: "Run one inlet-unsteadiness sensitivity case",
    change: "Add a bounded inlet fluctuation matching the measured facility variability.",
    reason: "The CFD is more repeatable cycle-to-cycle than the experiment.",
    holdFixed: ["Mean inlet state", "mesh", "time step", "chemistry", "walls", "initialization"],
    expectedOutcome: "Cycle variability approaches the experiment without shifting the mean mode.",
    confirmationCriterion: "Variability difference shrinks by at least 25% and mean frequency changes by less than 2%.",
    rejectionCriterion: "Variability remains unchanged or the mean operating point shifts outside uncertainty.",
    alternativeHypothesis: "If inlet fluctuations do not matter, examine turbulence/combustion coupling and 3D effects.",
  };
  return {
    ...common,
    title: "Add the nearest unvalidated operating point",
    change: "Run and test the nearest operating condition in equivalence ratio while keeping the hardware and numerical method fixed.",
    reason: "The current case does not expose a resolved mismatch; the next value is broader validation coverage.",
    holdFixed: ["Geometry", "mesh strategy", "time step strategy", "chemistry", "boundary formulation", "diagnostic locations"],
    expectedOutcome: "The demonstrated agreement envelope expands by one controlled condition.",
    confirmationCriterion: "The new case passes validity/data-quality checks and reports uncertainty-aware comparisons.",
    rejectionCriterion: "The new case reveals a resolved mismatch, which becomes the next diagnostic target.",
    alternativeHypothesis: "Repeat the current case to quantify repeatability before expanding the envelope.",
  };
}

export function buildCaseAssessment(
  metadata: CaseMetadata,
  comparisons: Comparison[],
  testMode: RdeModeResult,
  cfdMode: RdeModeResult,
  caseHistory: CaseHistoryEvidence[] = [],
): CaseAssessment {
  const durationTest = average(comparisons.map((comparison) => comparison.testQuality.durationMs));
  const durationCfd = average(comparisons.map((comparison) => comparison.cfdQuality.durationMs));
  const frequencyDifference = cfdMode.waveFrequencyKHz - testMode.waveFrequencyKHz;
  const testFrequencyUncertainty = frequencyUncertaintyKHz(testMode.waveFrequencyKHz, durationTest, metadata.timingUncertaintyUs);
  const cfdFrequencyUncertainty = frequencyUncertaintyKHz(cfdMode.waveFrequencyKHz, durationCfd, metadata.cfdTimingUncertaintyUs);
  const frequencyAssessment = assessResolvedDifference(frequencyDifference, testFrequencyUncertainty, cfdFrequencyUncertainty);
  const frequencyMetric: MetricAssessment = {
    id: "frequency",
    label: "Wave frequency",
    purpose: "Rotational event rate",
    experiment: testMode.waveFrequencyKHz,
    cfd: cfdMode.waveFrequencyKHz,
    difference: frequencyDifference,
    percentDifference: 100 * frequencyDifference / Math.max(testMode.waveFrequencyKHz, 1e-12),
    unit: "kHz",
    uncertainty: frequencyAssessment.combined,
    uncertaintyLabel: "Timing + finite-record spectral uncertainty (RSS, k=1)",
    assessment: frequencyAssessment,
    tone: statusTone(frequencyAssessment.status),
  };

  const speedDifference = cfdMode.waveSpeedMps - testMode.waveSpeedMps;
  const diameterRelativeUncertainty = Number.isFinite(metadata.annulusDiameterUncertaintyMm)
    ? metadata.annulusDiameterUncertaintyMm / Math.max(metadata.annulusMeanDiameterMm, 1e-12)
    : 0;
  const testSpeedUncertainty = testMode.waveSpeedMps * Math.hypot(testFrequencyUncertainty / Math.max(testMode.waveFrequencyKHz, 1e-12), diameterRelativeUncertainty);
  const cfdSpeedUncertainty = cfdMode.waveSpeedMps * Math.hypot(cfdFrequencyUncertainty / Math.max(cfdMode.waveFrequencyKHz, 1e-12), diameterRelativeUncertainty);
  const speedAssessment = assessResolvedDifference(speedDifference, testSpeedUncertainty, cfdSpeedUncertainty);
  const speedMetric: MetricAssessment = {
    id: "speed",
    label: "Wave speed",
    purpose: "Circumferential propagation",
    experiment: testMode.waveSpeedMps,
    cfd: cfdMode.waveSpeedMps,
    difference: speedDifference,
    percentDifference: 100 * speedDifference / Math.max(testMode.waveSpeedMps, 1e-12),
    unit: "m/s",
    uncertainty: speedAssessment.combined,
    uncertaintyLabel: Number.isFinite(metadata.annulusDiameterUncertaintyMm) ? "Frequency + mean-diameter uncertainty (conservative RSS)" : "Frequency contribution only; diameter uncertainty missing",
    assessment: speedAssessment,
    tone: statusTone(speedAssessment.status),
  };

  const amplitude = resolvedPressureMetric({ id: "amplitude", label: "Pressure amplitude", purpose: "Mean oscillation amplitude", unit: "MPa", test: pressureMetric(comparisons, "oscillationAmplitude", "test"), cfd: pressureMetric(comparisons, "oscillationAmplitude", "cfd"), metadata });
  const peak = resolvedPressureMetric({ id: "peak-pressure", label: "Cycle peak pressure", purpose: "Mean peak across detected cycles", unit: "MPa", test: pressureMetric(comparisons, "peakPressure", "test"), cfd: pressureMetric(comparisons, "peakPressure", "cfd"), metadata });
  const meanPressure = resolvedPressureMetric({ id: "mean-pressure", label: "Mean pressure", purpose: "Average chamber pressure at probes", unit: "MPa", test: pressureMetric(comparisons, "meanPressure", "test"), cfd: pressureMetric(comparisons, "meanPressure", "cfd"), metadata });
  const impulse = resolvedPressureMetric({ id: "impulse", label: "Pressure impulse", purpose: "Positive pressure area per wave passage", unit: "MPa·ms", test: pressureMetric(comparisons, "impulsePerCycleMpaMs", "test"), cfd: pressureMetric(comparisons, "impulsePerCycleMpaMs", "cfd"), metadata, includeTiming: true, testFrequencyKHz: testMode.waveFrequencyKHz, cfdFrequencyKHz: cfdMode.waveFrequencyKHz });

  const testRise = pressureMetric(comparisons, "riseTimeUs", "test");
  const cfdRise = pressureMetric(comparisons, "riseTimeUs", "cfd");
  const riseDifference = cfdRise - testRise;
  const riseAssessment = assessResolvedDifference(riseDifference, metadata.timingUncertaintyUs, metadata.cfdTimingUncertaintyUs);
  const rise: MetricAssessment = {
    id: "rise-time", label: "10–90% rise time", purpose: "Detonation-front sharpness", experiment: testRise, cfd: cfdRise, difference: riseDifference,
    percentDifference: 100 * riseDifference / Math.max(Math.abs(testRise), 1e-12), unit: "µs", uncertainty: riseAssessment.combined,
    uncertaintyLabel: "Combined experiment + CFD timing uncertainty (RSS, k=1)", assessment: riseAssessment, tone: statusTone(riseAssessment.status),
  };

  const testHarmonics = pressureMetric(comparisons, "secondHarmonicRatio", "test");
  const cfdHarmonics = pressureMetric(comparisons, "secondHarmonicRatio", "cfd");
  const harmonicDifference = cfdHarmonics - testHarmonics;
  const harmonicPercent = 100 * harmonicDifference / Math.max(Math.abs(testHarmonics), 1e-12);
  const harmonicWithin = Math.abs(harmonicPercent) <= 100 * REVIEW_THRESHOLDS.maximumHarmonicRatioError;
  const harmonicAssessment = prototypeAssessment(harmonicWithin, "±30% method limit", "No spectral-estimator uncertainty is available yet; this uses an explicit prototype review limit.");
  const harmonics: MetricAssessment = {
    id: "harmonics", label: "Second-harmonic ratio", purpose: "Secondary waveform structure", experiment: testHarmonics, cfd: cfdHarmonics, difference: harmonicDifference,
    percentDifference: harmonicPercent, unit: "", uncertainty: null, uncertaintyLabel: "Prototype ±30% method limit", assessment: harmonicAssessment, tone: statusTone(harmonicAssessment.status),
  };

  const testVariability = pressureMetric(comparisons, "cycleVariabilityPct", "test");
  const cfdVariability = pressureMetric(comparisons, "cycleVariabilityPct", "cfd");
  const variabilityDifference = cfdVariability - testVariability;
  const variabilityWithin = Math.abs(variabilityDifference) <= REVIEW_THRESHOLDS.maximumCycleVariabilityDifferencePct;
  const variabilityAssessment = prototypeAssessment(variabilityWithin, "±10 percentage-point method limit", "Repeatability uncertainty is not supplied; this uses a prototype review limit.");
  const variability: MetricAssessment = {
    id: "cycle-variability", label: "Cycle variability", purpose: "Cycle-to-cycle pressure-range variation", experiment: testVariability, cfd: cfdVariability, difference: variabilityDifference,
    percentDifference: null, unit: "%", uncertainty: null, uncertaintyLabel: "Prototype ±10 percentage-point method limit", assessment: variabilityAssessment, tone: statusTone(variabilityAssessment.status),
  };

  const phaseError = phasePatternErrorDeg(testMode, cfdMode);
  const phaseAssessment = prototypeAssessment(phaseError <= 20, "≤20° RMS phase-pattern limit", "The shared time shift is removed; this compares relative phase around the probe array.");
  const phasePattern: MetricAssessment = {
    id: "phase-pattern", label: "Probe phase pattern", purpose: "Circumferential propagation agreement", experiment: "Reference", cfd: phaseError, difference: phaseError,
    percentDifference: null, unit: "° RMS", uncertainty: null, uncertaintyLabel: "Prototype ≤20° RMS method limit", assessment: phaseAssessment, tone: statusTone(phaseAssessment.status),
  };

  const driftDifference = cfdMode.frequencyDriftPct - testMode.frequencyDriftPct;
  const driftAssessment = prototypeAssessment(Math.abs(driftDifference) <= 3, "±3 percentage-point drift limit", "Compares the fitted cycle-frequency trend over the loaded record.");
  const frequencyDrift: MetricAssessment = {
    id: "frequency-drift", label: "Frequency drift", purpose: "Cycle-frequency trend across the record", experiment: testMode.frequencyDriftPct, cfd: cfdMode.frequencyDriftPct, difference: driftDifference,
    percentDifference: null, unit: "%", uncertainty: null, uncertaintyLabel: "Prototype ±3 percentage-point method limit", assessment: driftAssessment, tone: statusTone(driftAssessment.status),
  };

  const jitterDifference = cfdMode.phaseJitterDeg - testMode.phaseJitterDeg;
  const jitterAssessment = prototypeAssessment(Math.abs(jitterDifference) <= 10, "±10° phase-jitter limit", "Sliding-window relative-phase variation; sensor timing uncertainty is not yet propagated into this estimator.");
  const phaseJitter: MetricAssessment = {
    id: "phase-jitter", label: "Phase jitter", purpose: "Window-to-window propagation consistency", experiment: testMode.phaseJitterDeg, cfd: cfdMode.phaseJitterDeg, difference: jitterDifference,
    percentDifference: null, unit: "°", uncertainty: null, uncertaintyLabel: "Prototype ±10° method limit", assessment: jitterAssessment, tone: statusTone(jitterAssessment.status),
  };

  const metrics = [
    frequencyMetric,
    speedMetric,
    categoricalMetric("wave-count", "Wave count", "Number of rotating waves", testMode.waveCount, cfdMode.waveCount),
    categoricalMetric("direction", "Direction", "Direction of rotation", testMode.direction, cfdMode.direction),
    categoricalMetric("stability", "Mode stability", "Classification over the analysis window", testMode.stability, cfdMode.stability),
    categoricalMetric("mode-transitions", "Mode transitions", "Count/direction changes across analysis windows", testMode.modeTransitions, cfdMode.modeTransitions),
    phasePattern,
    frequencyDrift,
    phaseJitter,
    amplitude,
    peak,
    meanPressure,
    impulse,
    rise,
    harmonics,
    variability,
  ];

  const dataQuality = caseDataQuality(comparisons);
  const matchCheck: ValidityCheck = metadata.comparisonMatchConfirmed
    ? { label: "Matched physical case", status: "Pass", detail: "The user confirmed matching geometry, operating point, probe coordinates, and comparison window." }
    : { label: "Matched physical case", status: "Blocked", detail: "Matching geometry, operating point, probe coordinates, and comparison window have not been confirmed." };
  const layoutRisk = probeLayoutReview(metadata.probePositionsDeg);
  const synchronizationCheck: ValidityCheck = metadata.probeSynchronizationConfirmed
    ? { label: "Synchronized probe clocks", status: "Pass", detail: "The user confirmed one common time base within each pressure-probe array." }
    : { label: "Synchronized probe clocks", status: "Blocked", detail: "Wave count, direction, phase, and speed require synchronized probe timing." };
  const modeStatus = testMode.identifiability === "Not identifiable" || cfdMode.identifiability === "Not identifiable"
    ? "Review" as const
    : testMode.identifiability === "Identified" && cfdMode.identifiability === "Identified"
      ? "Pass" as const
      : "Review" as const;
  const checks: ValidityCheck[] = [
    matchCheck,
    synchronizationCheck,
    { label: "Probe layout", status: layoutRisk || metadata.probePositionsDeg.length < 4 ? "Review" : "Pass", detail: layoutRisk ? "Equally spaced probes can alias wave count and direction." : metadata.probePositionsDeg.length < 4 ? "Three nonuniform probes support a candidate mode; four or more are recommended for stronger separation." : `${metadata.probePositionsDeg.length} nonuniform probes reduce common spatial aliases.` },
    { label: "Common evidence window", status: dataQuality.status === "Ready" ? "Pass" : "Review", detail: dataQuality.status === "Ready" ? "All traces provide a continuous, usable comparison window." : "At least one trace has a sampling, duration, continuity, or clipping finding." },
    { label: "Mode identifiability", status: modeStatus, detail: `Experiment: ${testMode.identifiability}, ${testMode.phaseResidualDeg.toFixed(1)}° residual; CFD: ${cfdMode.identifiability}, ${cfdMode.phaseResidualDeg.toFixed(1)}° residual.` },
  ];
  const validity = {
    checks,
    status: checks.some((check) => check.status === "Blocked") ? "Blocked" as const : checks.some((check) => check.status === "Review") ? "Review" as const : "Valid" as const,
  };
  const coverage: CoverageItem[] = [
    { module: "Wave dynamics", status: modeStatus === "Pass" ? "Assessed" : "Inconclusive", detail: "Frequency, speed, count, direction, phase pattern, drift, jitter, and mode transitions" },
    { module: "Pressure", status: "Assessed", detail: "Amplitude, peaks, mean, impulse, rise time, harmonics, residuals, and cycle variability" },
    { module: "Uncertainty", status: metrics.some((metric) => metric.assessment.status === "inconclusive") ? "Inconclusive" : "Assessed", detail: "Experiment and CFD pressure/timing inputs propagated where supported" },
    { module: "Thermal", status: "Not assessed", detail: "No temperature or heat-flux data loaded" },
    { module: "Performance", status: "Not assessed", detail: "No thrust or total-pressure data loaded" },
  ];
  const hypotheses = buildHypotheses(metadata, metrics, validity, dataQuality, caseHistory);
  return { validity, dataQuality, metrics, coverage, hypotheses, nextRun: nextRunFor(hypotheses[0], metadata) };
}
