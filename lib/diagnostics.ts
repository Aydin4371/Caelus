import type { CaseMetadata, SensitivityVariable } from "./caevera-types.ts";
import { SOURCE_IDS_BY_CAUSE, type DiagnosticCauseId } from "./diagnostic-knowledge.ts";
import {
  CONFIRMATION_ERROR_REDUCTION_PCT,
  CONTROLLED_RERUN_RULES,
  NUMERICAL_CONVERGENCE_RESPONSE_PCT,
  REJECTION_ERROR_WORSENING_PCT,
  type ControlledSensitivityVariable,
} from "./recommendation-rules.ts";
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
  changedVariable?: SensitivityVariable;
  state: "supports" | "weakens" | "unknown";
  strength: "strong" | "moderate";
  caseId: string;
  caseName: string;
  caseSource?: "uploaded" | "demo";
  detail: string;
  controlled: boolean;
  targetedMetrics?: string[];
  errorReductionPct?: number | null;
  responseMagnitudePct?: number | null;
  incrementalResponsePct?: number | null;
  newMismatchMetricIds?: string[];
  metricErrorReductionPct?: Record<string, number>;
  baselineMismatchMetricIds?: string[];
  runtimeMultiplier?: number | null;
  sequenceStatus?: "effect-confirmed" | "converged" | "rejected" | "inconclusive" | "comparison-only";
  planDisposition?: "continue" | "advance" | "repeat" | "ignore";
  caseMetadata?: CaseMetadata;
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
  stage: "Evidence gate" | "Numerical verification" | "Physics sensitivity" | "Validation expansion";
  whyThisRunFirst: string;
  inconclusiveCriterion: string;
  ifConfirmed: string;
  ifRejected: string;
  ifInconclusive: string;
  latestControlledResult: {
    status: "Awaiting result" | "Confirmed" | "Converged" | "Rejected" | "Inconclusive";
    caseName: string | null;
    detail: string;
  };
  precedent: ComparableCasePrecedent;
};

export type ComparableCasePrecedent = {
  level: "None yet" | "Demonstration" | "Limited" | "Repeated";
  matchedCount: number;
  uploadedCount: number;
  syntheticCount: number;
  confirmedCount: number;
  convergedCount: number;
  rejectedCount: number;
  inconclusiveCount: number;
  metricImprovements: Array<{ metricId: string; label: string; meanReductionPct: number; caseCount: number }>;
  meanRuntimeMultiplier: number | null;
  runtimeCaseCount: number;
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

function inconclusiveMetric(id: string, label: string, purpose: string, experiment = "Not identifiable", cfd = "Not identifiable"): MetricAssessment {
  const assessment: UncertaintyAssessment = {
    combined: null,
    status: "inconclusive",
    label: "Not identifiable",
    explanation: "The available probe geometry or data quality does not support this conclusion.",
  };
  return {
    id,
    label,
    purpose,
    experiment,
    cfd,
    difference: "Not assessed",
    percentDifference: null,
    unit: "",
    uncertainty: null,
    uncertaintyLabel: "Withheld by identifiability gate",
    assessment,
    tone: "neutral",
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

function buildHypotheses(metadata: CaseMetadata, metrics: MetricAssessment[], validity: CaseAssessment["validity"], dataQuality: CaseAssessment["dataQuality"], caseHistory: CaseHistoryEvidence[], precedentHistory: CaseHistoryEvidence[]) {
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
    const history = caseHistory.filter((item) => item.controlled && item.causeId === id).map((item) => evidence(item.detail, item.state, item.strength, "case-history"));
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
    const hasControlledMeshEvidence = caseHistory.some((item) => item.controlled && item.causeId === "spatial-resolution");
    add("spatial-resolution", "Spatial resolution or numerical dissipation", [
      evidence(`CFD peak pressure is ${Math.abs(peakPressure!.percentDifference ?? 0).toFixed(1)}% low.`, "supports", "moderate"),
      evidence(`CFD pressure rise is ${Math.abs(riseTime?.percentDifference ?? 0).toFixed(1)}% longer.`, "supports", "moderate"),
      ...(!hasControlledMeshEvidence ? [evidence(Number.isFinite(metadata.meshConvergencePct) ? `User-entered mesh-change effect is ${metadata.meshConvergencePct.toFixed(1)}%.` : "No controlled mesh-convergence result was supplied.", Number.isFinite(metadata.meshConvergencePct) ? (metadata.meshConvergencePct > NUMERICAL_CONVERGENCE_RESPONSE_PCT ? "supports" : "weakens") : "unknown", "strong")] : []),
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
  for (const item of caseHistory.filter((entry) => entry.controlled)) {
    if (!candidates.some((candidate) => candidate.id === item.causeId)) {
      add(item.causeId, historyTitles[item.causeId] ?? "Related-case sensitivity", [], [item.detail]);
    }
  }

  if (!candidates.length) {
    add("validation-coverage", "Validation-envelope coverage", [evidence("No current comparison is resolved beyond uncertainty or fails an exact mode check.", "supports", "context")], [`${metadata.inletPressureBar} bar`, `${metadata.inletTemperatureK} K`, `φ ${metadata.equivalenceRatio}`]);
  }
  const rank = (candidate: DiagnosticHypothesis) => {
    const states = candidate.evidence;
    const latest = caseHistory.filter((item) => item.controlled && item.causeId === candidate.id).at(-1);
    const completed = latest?.planDisposition === "advance" || latest?.planDisposition === "ignore";
    const actionPriority = latest?.planDisposition === "repeat" ? 2 : completed ? 0 : 1;
    const precedents = comparableHistory(candidate.id, metrics, precedentHistory);
    const precedentNet = precedents.filter((item) => item.sequenceStatus === "effect-confirmed" || !item.sequenceStatus && item.state === "supports").length
      - precedents.filter((item) => item.sequenceStatus === "rejected" || !item.sequenceStatus && item.state === "weakens").length;
    return [
      candidate.id === "case-validity" ? 2 : candidate.id === "data-quality" ? 1 : 0,
      actionPriority,
      states.filter((item) => item.basis === "case-history" && item.state === "supports").length,
      states.filter((item) => item.state === "supports").length - states.filter((item) => item.state === "weakens").length,
      states.filter((item) => item.strength === "strong" && item.state === "supports").length,
      precedentNet,
      -states.filter((item) => item.state === "unknown" || item.state === "cannot-assess").length,
    ];
  };
  return candidates.sort((left, right) => {
    const a = rank(left); const b = rank(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
    return left.title.localeCompare(right.title);
  }).slice(0, 3);
}

type CoreNextRun = Omit<ControlledNextRun,
  "stage" | "whyThisRunFirst" | "inconclusiveCriterion" | "ifConfirmed" | "ifRejected" | "ifInconclusive" | "latestControlledResult" | "precedent"
>;

function nextRunFor(hypothesis: DiagnosticHypothesis, metadata: CaseMetadata, latest?: CaseHistoryEvidence): CoreNextRun {
  const supporting = hypothesis.evidence.filter((item) => item.state === "supports");
  const common = {
    evidence: hypothesis.evidence.map((item) => `${item.state}: ${item.observation}`),
    evidenceStrength: supporting.some((item) => item.strength === "strong") ? "High" as const : supporting.length ? "Moderate" as const : "Exploratory" as const,
  };
  const flowTimeStepReady = Number.isFinite(metadata.timeStepConvergencePct) && metadata.timeStepConvergencePct <= NUMERICAL_CONVERGENCE_RESPONSE_PCT
    || latest?.changedVariable === "time-step" && latest.sequenceStatus === "converged";
  const variableByCause: Partial<Record<DiagnosticCauseId, ControlledSensitivityVariable>> = {
    "spatial-resolution": "mesh",
    "chemistry-timescale": flowTimeStepReady || latest?.changedVariable === "chemistry" ? "chemistry" : "time-step",
    "inlet-boundary": "inlet",
    "wall-loss": "wall",
    "initialization-mode": "initialization",
    "missing-unsteadiness": "unsteadiness",
  };
  const plannedRule = variableByCause[hypothesis.id] ? CONTROLLED_RERUN_RULES[variableByCause[hypothesis.id]!] : null;
  const confirmationCriterion = `Mean targeted error falls by at least ${CONFIRMATION_ERROR_REDUCTION_PCT}% from the baseline and no new resolved mismatch appears.`;
  const rejectionCriterion = `The targeted response stays below ${plannedRule?.minimumResponsePct ?? 2}%, mean targeted error worsens by at least ${REJECTION_ERROR_WORSENING_PCT}%, or a new resolved mismatch appears.`;

  if (hypothesis.id === "case-validity") return {
    ...common,
    title: "Correct the experiment–CFD pairing",
    change: "Re-export one common time window after verifying the exact geometry, operating point, probe coordinates, trigger reference, and probe pairing.",
    reason: supporting.map((item) => item.observation).join(" ") || "The current pairing is not confirmed.",
    holdFixed: ["CFD solution", "signal processing settings", "physical operating point"],
    expectedOutcome: "The pairing checks pass before any CFD model variable is changed.",
    confirmationCriterion: "Every mapping and case-match check passes and the common window contains at least five usable cycles.",
    rejectionCriterion: "If the corrected pairing still produces the same resolved discrepancy, case mapping is weakened as the explanation.",
    alternativeHypothesis: "Use the highest-ranked CFD sensitivity only after the pairing is valid.",
  };
  if (hypothesis.id === "data-quality") return {
    ...common,
    title: "Repair the limiting pressure record",
    change: "Re-export or reacquire only the affected record with continuous timestamps, no clipping, and enough bandwidth and duration to clear the listed quality gate.",
    reason: supporting.map((item) => item.observation).join(" "),
    holdFixed: ["Operating point", "CFD model", "probe coordinates", "analysis window definition"],
    expectedOutcome: "The named unavailable outputs become identifiable without changing the physical case.",
    confirmationCriterion: "No gaps or clipping, at least five cycles, at least 20 samples per cycle for phase work, and spectral SNR at or above 10 dB.",
    rejectionCriterion: "The replacement record passes every quality gate but the resolved experiment–CFD discrepancy remains.",
    alternativeHypothesis: "After the evidence is usable, proceed to the highest-ranked physical or numerical sensitivity.",
  };
  if (hypothesis.id === "spatial-resolution") {
    const supportedByRerun = hypothesis.evidence.some((item) => item.basis === "case-history" && item.state === "supports" && item.strength === "strong");
    return {
      ...common,
      title: supportedByRerun ? "Complete the documented mesh-convergence sequence" : "Add one front-region spatial-refinement case",
      change: supportedByRerun
        ? `Advance one level beyond the current ${metadata.minimumCellSizeMm.toFixed(3)} mm front-region minimum using the same documented refinement sequence.`
        : `Create one documented finer front-region mesh from the current ${metadata.minimumCellSizeMm.toFixed(3)} mm minimum; do not change the flux, limiter, chemistry, or time-step strategy.`,
      reason: supportedByRerun
        ? "A verified one-variable related case already moved the targeted pressure error toward experiment."
        : "The mismatch pattern makes front resolution a discriminating sensitivity, but the current case history does not yet show a controlled mesh response.",
      holdFixed: ["Chemical mechanism and chemistry integration", "time step and CFL", "boundaries and wall treatment", "initialization"],
      expectedOutcome: `Peak pressure and rise time move together. An adjacent-level response at or below ${NUMERICAL_CONVERGENCE_RESPONSE_PCT}% completes mesh convergence.`,
      confirmationCriterion,
      rejectionCriterion,
      alternativeHypothesis: "If the response is unresolved, test chemistry time integration or wall-loss treatment according to the remaining evidence.",
    };
  }
  if (hypothesis.id === "initialization-mode") return {
    ...common,
    title: "Run one initialization-only mode test",
    change: `Repeat the current ${metadata.initializationMethod} case with one second physically documented ignition pattern; keep the ${metadata.dimensionality || "current"} domain and all steady inputs unchanged.`,
    reason: "A wave-count, direction, phase-pattern, or transition mismatch can represent a different selected attractor.",
    holdFixed: ["Mesh", "time step", "chemistry", "boundary conditions", "wall treatment"],
    expectedOutcome: "The alternate start either reaches the experimental identified mode or reproduces the original CFD mode.",
    confirmationCriterion: "The alternate initialization reaches the experimentally identified count and direction for the final usable analysis windows.",
    rejectionCriterion: "Both initializations reach the same nonexperimental identified mode.",
    alternativeHypothesis: "If mode selection is insensitive to ignition, investigate domain dimensionality and inlet/plenum representation.",
  };
  if (hypothesis.id === "chemistry-timescale") return {
    ...common,
    ...(flowTimeStepReady ? {
      title: "Tighten only chemistry time integration",
      change: `Keep the converged ${metadata.timeStepUs.toFixed(3)} µs flow step fixed and advance the ${metadata.chemistryIntegrator} internal tolerance or substep by one documented refinement level.`,
      reason: "Flow time-step sensitivity is complete, so this isolates chemistry integration without changing the mechanism.",
      holdFixed: ["Mesh", "flow time step and CFL", "chemical mechanism", "boundaries", "wall treatment", "initialization"],
      expectedOutcome: "Wave frequency moves toward experiment without changing an already identified wave mode.",
      confirmationCriterion,
      rejectionCriterion,
      alternativeHypothesis: "If chemistry integration is insensitive, test the current inlet representation next.",
    } : {
      title: latest?.changedVariable === "time-step" && latest.state === "supports" ? "Complete the documented time-step sequence" : "Add one flow-time-step refinement",
      change: `Reduce only the current ${metadata.timeStepUs.toFixed(3)} µs flow step by one documented refinement level; keep the temporal scheme and chemistry integrator unchanged.`,
      reason: "Flow time-step independence must be established before a chemistry-timescale mismatch can be assigned to chemistry integration or the mechanism.",
      holdFixed: ["Mesh", "temporal scheme", "chemistry integrator and mechanism", "boundaries", "wall treatment", "initialization"],
      expectedOutcome: `Frequency and rise time respond together. An adjacent-level response at or below ${NUMERICAL_CONVERGENCE_RESPONSE_PCT}% completes time-step convergence.`,
      confirmationCriterion,
      rejectionCriterion,
      alternativeHypothesis: "After time-step convergence, isolate chemistry integration before changing the chemical mechanism.",
    }),
  };
  if (hypothesis.id === "inlet-boundary") return {
    ...common,
    title: "Test the recorded inlet representation",
    change: `Replace only “${metadata.inletBoundaryCondition}” with the closest hardware-matched injection/backflow treatment available in the same solver.`,
    reason: "The cited RDE evidence makes inlet injection and detonation-driven backflow a relevant sensitivity, but the pressure data alone do not identify a unique inlet mechanism.",
    holdFixed: ["Mesh", "time step", "chemistry", "outlet", "wall treatment", "initialization"],
    expectedOutcome: "The targeted mean-pressure, frequency, or amplitude discrepancy responds while unrelated outputs remain within uncertainty.",
    confirmationCriterion,
    rejectionCriterion,
    alternativeHypothesis: "If inlet representation is insensitive, examine wall loss or front resolution according to the remaining evidence.",
  };
  if (hypothesis.id === "wall-loss") return {
    ...common,
    title: "Bracket the recorded wall treatment",
    change: `Run one physically documented adjacent condition to “${metadata.wallBoundaryCondition}”; change no other model setting.`,
    reason: "Amplitude and impulse disagreement can respond to total wall loss even when frequency and mode agree.",
    holdFixed: ["Mesh", "time step", "chemistry", "inlet and outlet", "initialization", "numerical flux"],
    expectedOutcome: "Amplitude and impulse move together while the identified frequency and mode remain unchanged within uncertainty.",
    confirmationCriterion,
    rejectionCriterion,
    alternativeHypothesis: "If the pressure response is unresolved, test chemistry integration or front resolution next.",
  };
  if (hypothesis.id === "missing-unsteadiness") return {
    ...common,
    title: "Use one measured inlet-history sensitivity",
    change: "If a synchronized facility inlet history exists, impose that measured fluctuation while holding its mean state fixed. If it does not exist, acquire it before creating this run.",
    reason: "CFD cycle variability cannot be attributed to inlet forcing from pressure probes alone, and an invented fluctuation would not be evidence.",
    holdFixed: ["Mean inlet state", "mesh", "time step", "chemistry", "walls", "initialization"],
    expectedOutcome: "Cycle variability approaches experiment without shifting the mean identified mode.",
    confirmationCriterion,
    rejectionCriterion,
    alternativeHypothesis: "If measured forcing is weak, examine turbulence/combustion coupling and three-dimensional effects.",
  };
  return {
    ...common,
    title: "Add the nearest documented operating point",
    change: "Select the nearest already planned equivalence-ratio or mass-flow condition and keep hardware, numerical method, and probe mapping fixed.",
    reason: "The current pressure/wave case does not expose a resolved mismatch, so the next useful evidence expands validation coverage.",
    holdFixed: ["Geometry", "mesh and time-step strategies", "chemistry", "boundary formulations", "probe locations"],
    expectedOutcome: "The demonstrated pressure/wave agreement region expands by one controlled operating point.",
    confirmationCriterion: "The new case passes pairing, quality, uncertainty, and identifiability checks.",
    rejectionCriterion: "A resolved discrepancy appears; that specific metric becomes the next sensitivity target.",
    alternativeHypothesis: "Repeat the current experiment first if operating-point repeatability is not quantified.",
  };
}

function stageFor(causeId: DiagnosticCauseId): ControlledNextRun["stage"] {
  if (["case-validity", "data-quality"].includes(causeId)) return "Evidence gate";
  if (["spatial-resolution", "chemistry-timescale"].includes(causeId)) return "Numerical verification";
  if (causeId === "validation-coverage") return "Validation expansion";
  return "Physics sensitivity";
}

function latestControlledResult(caseHistory: CaseHistoryEvidence[], currentCauseId: DiagnosticCauseId): ControlledNextRun["latestControlledResult"] {
  const controlled = caseHistory.filter((item) => item.controlled);
  const latest = controlled.filter((item) => item.causeId === currentCauseId).at(-1) ?? controlled.at(-1);
  if (!latest) return {
    status: "Awaiting result",
    caseName: null,
    detail: "No controlled rerun result has been linked to this baseline yet.",
  };
  return {
    status: latest.sequenceStatus === "converged" ? "Converged" : latest.state === "supports" ? "Confirmed" : latest.state === "weakens" ? "Rejected" : "Inconclusive",
    caseName: latest.caseName,
    detail: latest.detail,
  };
}

function inferredDisposition(item: CaseHistoryEvidence | undefined): "continue" | "advance" | "repeat" | "ignore" | null {
  if (!item) return null;
  if (item.planDisposition) return item.planDisposition;
  if (!item.controlled) return "ignore";
  if (item.state === "unknown") return "repeat";
  if (item.state === "weakens") return "advance";
  return ["spatial-resolution", "chemistry-timescale", "initialization-mode"].includes(item.causeId) ? "continue" : "advance";
}

function latestForCause(caseHistory: CaseHistoryEvidence[], causeId: DiagnosticCauseId) {
  return caseHistory.filter((item) => item.controlled && item.causeId === causeId).at(-1);
}

function repeatRun(core: CoreNextRun, latest: CaseHistoryEvidence): CoreNextRun {
  const variable = latest.changedVariable === "time-step" ? "time-step" : latest.changedVariable ?? "selected";
  return {
    ...core,
    title: `Repeat the ${variable} test with a wider controlled bracket`,
    change: `From ${latest.caseName}, change only the ${variable} setting by one larger documented adjacent level, or reduce the uncertainty that made the first result inconclusive.`,
    reason: `${latest.detail} A stronger one-variable contrast is required before another hypothesis is tested.`,
    expectedOutcome: "The targeted outputs respond enough to meet a confirmation or rejection rule while all unrelated outputs remain stable.",
  };
}

function confirmationBranch(causeId: DiagnosticCauseId) {
  if (causeId === "case-validity" || causeId === "data-quality") return "Reanalyze the corrected evidence, then select the highest-ranked CFD sensitivity run.";
  if (causeId === "spatial-resolution") return "Complete the next mesh level. If the targeted outputs change by less than 2%, treat them as numerically converged and move to the remaining physics mismatch.";
  if (causeId === "chemistry-timescale") return "Complete time-step convergence. If frequency remains unresolved after convergence, isolate the chemistry mechanism in the following run.";
  if (causeId === "inlet-boundary") return "Retain the better-supported inlet treatment and test the next unresolved pressure or wave hypothesis.";
  if (causeId === "wall-loss") return "Retain the supported wall treatment and test whether the remaining mismatch is sensitive to chemistry or front resolution.";
  if (causeId === "initialization-mode") return "Repeat the supported initialization once for robustness, then check the mode at the nearest operating condition.";
  if (causeId === "missing-unsteadiness") return "Retain the measured fluctuation model and test whether the improved variability persists across a second comparison window.";
  return "Add the next nearest operating condition to expand the demonstrated validation envelope.";
}

function comparableHistory(
  causeId: DiagnosticCauseId,
  metrics: MetricAssessment[],
  precedentHistory: CaseHistoryEvidence[],
): CaseHistoryEvidence[] {
  const currentMismatchIds = new Set(metrics.filter((result) => result.tone === "review").map((result) => result.id));
  const seen = new Set<string>();
  return precedentHistory.filter((item) => {
    if (!item.controlled || item.causeId !== causeId || item.sequenceStatus === "comparison-only") return false;
    const key = `${item.caseId}:${item.caseName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const priorSignature = item.baselineMismatchMetricIds ?? [];
    return currentMismatchIds.size === 0 || priorSignature.length === 0 || priorSignature.some((id) => currentMismatchIds.has(id));
  });
}

function buildComparablePrecedent(
  causeId: DiagnosticCauseId,
  metrics: MetricAssessment[],
  precedentHistory: CaseHistoryEvidence[],
): ComparableCasePrecedent {
  const matched = comparableHistory(causeId, metrics, precedentHistory);
  const confirmed = matched.filter((item) => item.sequenceStatus === "effect-confirmed" || !item.sequenceStatus && item.state === "supports");
  const metricLabels = new Map(metrics.map((result) => [result.id, result.label]));
  const metricValues = new Map<string, number[]>();
  for (const item of confirmed) {
    for (const [metricId, reduction] of Object.entries(item.metricErrorReductionPct ?? {})) {
      if (!Number.isFinite(reduction)) continue;
      metricValues.set(metricId, [...(metricValues.get(metricId) ?? []), reduction]);
    }
  }
  const metricImprovements = [...metricValues.entries()]
    .map(([metricId, reductions]) => ({
      metricId,
      label: metricLabels.get(metricId) ?? metricId.replaceAll("-", " "),
      meanReductionPct: average(reductions),
      caseCount: reductions.length,
    }))
    .sort((left, right) => right.caseCount - left.caseCount || right.meanReductionPct - left.meanReductionPct)
    .slice(0, 3);
  const runtimes = confirmed.map((item) => item.runtimeMultiplier ?? Number.NaN).filter(Number.isFinite);
  const meanRuntimeMultiplier = runtimes.length ? average(runtimes) : null;
  const uploadedCount = matched.filter((item) => item.caseSource !== "demo").length;
  const syntheticCount = matched.length - uploadedCount;
  return {
    level: uploadedCount >= 3 ? "Repeated" : uploadedCount ? "Limited" : syntheticCount ? "Demonstration" : "None yet",
    matchedCount: matched.length,
    uploadedCount,
    syntheticCount,
    confirmedCount: confirmed.length,
    convergedCount: matched.filter((item) => item.sequenceStatus === "converged").length,
    rejectedCount: matched.filter((item) => item.sequenceStatus === "rejected" || !item.sequenceStatus && item.state === "weakens").length,
    inconclusiveCount: matched.filter((item) => item.sequenceStatus === "inconclusive" || !item.sequenceStatus && item.state === "unknown").length,
    metricImprovements,
    meanRuntimeMultiplier,
    runtimeCaseCount: runtimes.length,
  };
}

function buildAdaptiveRunPlan(
  hypotheses: DiagnosticHypothesis[],
  metadata: CaseMetadata,
  metrics: MetricAssessment[],
  caseHistory: CaseHistoryEvidence[],
  precedentHistory: CaseHistoryEvidence[],
): ControlledNextRun {
  const acceptedCase = [...caseHistory].reverse().find((item) => item.controlled && (item.sequenceStatus === "effect-confirmed" || item.sequenceStatus === "converged"));
  const currentMetadata = acceptedCase?.caseMetadata ?? metadata;
  const gate = hypotheses.find((hypothesis) => stageFor(hypothesis.id) === "Evidence gate");
  const actionable = hypotheses.find((hypothesis) => {
    if (stageFor(hypothesis.id) === "Evidence gate") return true;
    const latest = latestForCause(caseHistory, hypothesis.id);
    const disposition = inferredDisposition(latest);
    if (disposition === "advance" || disposition === "ignore") return false;
    if (hypothesis.id === "chemistry-timescale"
      && latest?.changedVariable === "time-step"
      && latest.sequenceStatus === "converged"
      && !hypothesis.evidence.some((item) => item.basis === "case" && item.state === "supports")) return false;
    if (hypothesis.id === "spatial-resolution" && !latest && Number.isFinite(currentMetadata.meshConvergencePct) && currentMetadata.meshConvergencePct <= NUMERICAL_CONVERGENCE_RESPONSE_PCT) return false;
    return true;
  });
  const primary = gate ?? actionable ?? {
    id: "validation-coverage" as const,
    title: "Validation-envelope coverage",
    evidence: [{ state: "supports" as const, strength: "context" as const, observation: "Every currently ranked sensitivity is complete or rejected; no unresolved actionable cause remains in the loaded pressure evidence.", basis: "case" as const, sourceIds: [] }],
    modelInputs: [`${currentMetadata.inletPressureBar} bar`, `${currentMetadata.inletTemperatureK} K`, `φ ${currentMetadata.equivalenceRatio}`],
    sourceIds: SOURCE_IDS_BY_CAUSE["validation-coverage"],
  };
  const alternative = hypotheses.find((hypothesis) => hypothesis.id !== primary.id && inferredDisposition(latestForCause(caseHistory, hypothesis.id)) !== "advance");
  const latest = latestForCause(caseHistory, primary.id);
  const baseCore = nextRunFor(primary, currentMetadata, latest);
  const core = inferredDisposition(latest) === "repeat" ? repeatRun(baseCore, latest!) : baseCore;
  const precedent = buildComparablePrecedent(primary.id, metrics, precedentHistory);
  const supporting = primary.evidence.filter((item) => item.state === "supports").length;
  const strong = primary.evidence.filter((item) => item.state === "supports" && item.strength === "strong").length;
  const controlled = primary.evidence.filter((item) => item.state === "supports" && item.basis === "case-history").length;
  const evidenceGate = stageFor(primary.id) === "Evidence gate";
  const whyThisRunFirst = evidenceGate
    ? `${primary.title} is a prerequisite. Caevera does not rank model changes until this evidence gate is resolved.`
    : `${primary.title} is first because it has ${supporting} supporting observation${supporting === 1 ? "" : "s"}${strong ? `, including ${strong} strong` : ""}${controlled ? ` and ${controlled} from a controlled rerun` : ""}${precedent.matchedCount ? `. ${precedent.confirmedCount} of ${precedent.matchedCount} comparable loaded reruns confirmed this response` : ""}. Caevera ranks prerequisite gates, required repeats, unfinished sensitivities, controlled-rerun evidence, net supporting evidence, and then fewer unknowns.${alternative ? ` This places it ahead of ${alternative.title}.` : ""}`;
  return {
    ...core,
    stage: stageFor(primary.id),
    whyThisRunFirst,
    inconclusiveCriterion: `The result reaches neither ${CONFIRMATION_ERROR_REDUCTION_PCT}% mean error reduction nor a rejection rule, and it does not reach the ${NUMERICAL_CONVERGENCE_RESPONSE_PCT}% adjacent-level convergence limit when that limit applies.`,
    ifConfirmed: confirmationBranch(primary.id),
    ifRejected: evidenceGate
      ? "Keep the comparison blocked and repair the unresolved evidence before changing CFD."
      : `${core.alternativeHypothesis}${alternative ? ` The next ranked hypothesis is ${alternative.title}.` : ""}`,
    ifInconclusive: "Increase the controlled perturbation or reduce the relevant uncertainty, then repeat without changing additional model settings.",
    latestControlledResult: latestControlledResult(caseHistory, primary.id),
    precedent,
  };
}

export function buildCaseAssessment(
  metadata: CaseMetadata,
  comparisons: Comparison[],
  testMode: RdeModeResult,
  cfdMode: RdeModeResult,
  caseHistory: CaseHistoryEvidence[] = [],
  precedentHistory: CaseHistoryEvidence[] = caseHistory,
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

  const modeIdentifiable = testMode.identifiability !== "Not identifiable" && cfdMode.identifiability !== "Not identifiable";
  const speedDifference = cfdMode.waveSpeedMps - testMode.waveSpeedMps;
  const diameterRelativeUncertainty = Number.isFinite(metadata.annulusDiameterUncertaintyMm)
    ? metadata.annulusDiameterUncertaintyMm / Math.max(metadata.annulusMeanDiameterMm, 1e-12)
    : 0;
  const testSpeedUncertainty = testMode.waveSpeedMps * Math.hypot(testFrequencyUncertainty / Math.max(testMode.waveFrequencyKHz, 1e-12), diameterRelativeUncertainty);
  const cfdSpeedUncertainty = cfdMode.waveSpeedMps * Math.hypot(cfdFrequencyUncertainty / Math.max(cfdMode.waveFrequencyKHz, 1e-12), diameterRelativeUncertainty);
  const speedAssessment = assessResolvedDifference(speedDifference, testSpeedUncertainty, cfdSpeedUncertainty);
  const speedMetric: MetricAssessment = modeIdentifiable ? {
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
  } : inconclusiveMetric("speed", "Wave speed", "Circumferential propagation");

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
  const phasePattern: MetricAssessment = modeIdentifiable ? {
    id: "phase-pattern", label: "Probe phase pattern", purpose: "Circumferential propagation agreement", experiment: "Reference", cfd: phaseError, difference: phaseError,
    percentDifference: null, unit: "° RMS", uncertainty: null, uncertaintyLabel: "Prototype ≤20° RMS method limit", assessment: phaseAssessment, tone: statusTone(phaseAssessment.status),
  } : inconclusiveMetric("phase-pattern", "Probe phase pattern", "Circumferential propagation agreement");

  const driftDifference = cfdMode.frequencyDriftPct - testMode.frequencyDriftPct;
  const driftAssessment = prototypeAssessment(Math.abs(driftDifference) <= 3, "±3 percentage-point drift limit", "Compares the fitted cycle-frequency trend over the loaded record.");
  const frequencyDrift: MetricAssessment = {
    id: "frequency-drift", label: "Frequency drift", purpose: "Cycle-frequency trend across the record", experiment: testMode.frequencyDriftPct, cfd: cfdMode.frequencyDriftPct, difference: driftDifference,
    percentDifference: null, unit: "%", uncertainty: null, uncertaintyLabel: "Prototype ±3 percentage-point method limit", assessment: driftAssessment, tone: statusTone(driftAssessment.status),
  };

  const jitterDifference = cfdMode.phaseJitterDeg - testMode.phaseJitterDeg;
  const jitterAssessment = prototypeAssessment(Math.abs(jitterDifference) <= 10, "±10° phase-jitter limit", "Sliding-window relative-phase variation; sensor timing uncertainty is not yet propagated into this estimator.");
  const phaseJitter: MetricAssessment = modeIdentifiable ? {
    id: "phase-jitter", label: "Phase jitter", purpose: "Window-to-window propagation consistency", experiment: testMode.phaseJitterDeg, cfd: cfdMode.phaseJitterDeg, difference: jitterDifference,
    percentDifference: null, unit: "°", uncertainty: null, uncertaintyLabel: "Prototype ±10° method limit", assessment: jitterAssessment, tone: statusTone(jitterAssessment.status),
  } : inconclusiveMetric("phase-jitter", "Phase jitter", "Window-to-window propagation consistency");

  const metrics = [
    frequencyMetric,
    speedMetric,
    modeIdentifiable ? categoricalMetric("wave-count", "Wave count", "Number of rotating waves", testMode.waveCount, cfdMode.waveCount) : inconclusiveMetric("wave-count", "Wave count", "Number of rotating waves"),
    modeIdentifiable ? categoricalMetric("direction", "Direction", "Direction of rotation", testMode.direction, cfdMode.direction) : inconclusiveMetric("direction", "Direction", "Direction of rotation"),
    modeIdentifiable ? categoricalMetric("stability", "Mode stability", "Classification over the analysis window", testMode.stability, cfdMode.stability) : inconclusiveMetric("stability", "Mode stability", "Classification over the analysis window"),
    modeIdentifiable ? categoricalMetric("mode-transitions", "Mode transitions", "Count/direction changes across analysis windows", testMode.modeTransitions, cfdMode.modeTransitions) : inconclusiveMetric("mode-transitions", "Mode transitions", "Count/direction changes across analysis windows"),
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
  const hypotheses = buildHypotheses(metadata, metrics, validity, dataQuality, caseHistory, precedentHistory);
  return { validity, dataQuality, metrics, coverage, hypotheses, nextRun: buildAdaptiveRunPlan(hypotheses, metadata, metrics, caseHistory, precedentHistory) };
}
