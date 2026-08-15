import type { CaseMetadata, SensitivityVariable } from "./caevera-types.ts";
import { RESEARCH_CLAIMS_BY_CAUSE, SOURCE_IDS_BY_CAUSE, type DiagnosticCauseId, type DiagnosticResearchClaim } from "./diagnostic-knowledge.ts";
import {
  CONFIRMATION_ERROR_REDUCTION_PCT,
  CONTROLLED_VARIABLE_LABELS,
  CONTROLLED_RERUN_RULES,
  NUMERICAL_CONVERGENCE_RESPONSE_PCT,
  RECOMMENDATION_POLICY_VERSION,
  REJECTION_ERROR_WORSENING_PCT,
  TARGET_METRIC_LABELS,
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
  basis: "case" | "case-history" | "literature" | "policy";
  sourceIds: string[];
};

export type CaseHistoryEvidence = {
  baselineCaseId?: string;
  causeId: DiagnosticCauseId;
  changedVariable?: SensitivityVariable;
  state: "supports" | "weakens" | "unknown";
  strength: "strong" | "moderate";
  caseId: string;
  caseName: string;
  caseSource?: "uploaded" | "demo";
  referenceCaseId?: string;
  referenceCaseName?: string;
  detail: string;
  controlled: boolean;
  targetedMetrics?: string[];
  errorReductionPct?: number | null;
  responseMagnitudePct?: number | null;
  incrementalResponsePct?: number | null;
  newMismatchMetricIds?: string[];
  relationshipIssues?: string[];
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
  researchClaims: DiagnosticResearchClaim[];
};

export type ControlledNextRun = {
  question: string;
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
  reasoningLedger: {
    hypothesisId: DiagnosticCauseId;
    hypothesisTitle: string;
    supports: DiagnosticEvidence[];
    weakens: DiagnosticEvidence[];
    unknowns: DiagnosticEvidence[];
  };
  decisionPolicy: {
    basis: "prototype-policy" | "case-specific-gate";
    version: string;
    evaluationMode: "numerical-convergence" | "model-sensitivity" | "case-specific";
    changedVariable: ControlledSensitivityVariable | null;
    targetedMetricIds: string[];
    confirmationErrorReductionPct: number | null;
    minimumResponsePct: number | null;
    convergenceResponsePct: number | null;
    rejectionErrorWorseningPct: number | null;
    requiresNoNewMismatch: boolean;
  };
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
    uncertaintyLabel: "Combined measurement and CFD uncertainty (root-sum-square, one standard uncertainty)",
    assessment,
    tone: statusTone(assessment.status),
  };
}

function prototypeAssessment(matches: boolean, label: string, explanation: string): UncertaintyAssessment {
  return {
    combined: null,
    status: matches ? "within-limit" : "review",
    label: matches ? label : "Outside prototype limit",
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
    explanation: "Caevera cannot calculate this result reliably from the probe locations and signal quality in this case.",
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
    uncertaintyLabel: "Not reported because the mode could not be identified reliably",
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
    candidates.push({ id, title, evidence: [...observations, ...history], modelInputs, sourceIds: SOURCE_IDS_BY_CAUSE[id], researchClaims: RESEARCH_CLAIMS_BY_CAUSE[id] });
  };

  if (validity.status === "Blocked") add("case-validity", "Case matching or data mapping", validity.checks.filter((check) => check.status === "Blocked").map((check) => evidence(check.detail, "supports", "strong")), ["Geometry", "operating point", "probe coordinates", "comparison window"]);
  if (dataQuality.status === "Review") add("data-quality", "Acquisition or export quality", dataQuality.findings.map((finding) => evidence(finding, "supports", "strong")), ["Sample rate", "record duration", "timestamps", "sensor range"]);
  if (isMismatch(peakPressure) && numeric(peakPressure!.cfd) < numeric(peakPressure!.experiment) && numeric(riseTime?.cfd ?? Number.NaN) > numeric(riseTime?.experiment ?? Number.NaN)) {
    const hasControlledMeshEvidence = caseHistory.some((item) => item.controlled && item.causeId === "spatial-resolution");
    add("spatial-resolution", "Spatial resolution or numerical dissipation", [
      evidence(`CFD peak pressure is ${Math.abs(peakPressure!.percentDifference ?? 0).toFixed(1)}% low.`, "supports", "moderate"),
      evidence(`CFD pressure rise is ${Math.abs(riseTime?.percentDifference ?? 0).toFixed(1)}% longer.`, "supports", "moderate"),
      ...(!hasControlledMeshEvidence ? [evidence(Number.isFinite(metadata.meshConvergencePct) ? `The manually entered documented mesh-study change is ${metadata.meshConvergencePct.toFixed(1)}%.` : "This family has no analyzed one-change mesh rerun, and no documented mesh-study percentage was entered.", Number.isFinite(metadata.meshConvergencePct) ? (metadata.meshConvergencePct > NUMERICAL_CONVERGENCE_RESPONSE_PCT ? "supports" : "weakens") : "unknown", "strong")] : []),
    ], [`${metadata.minimumCellSizeMm} mm minimum cell`, `${metadata.cellsPerInductionLength} cells/induction length`, metadata.numericalFlux, metadata.limiterFilter]);
  }
  if (isMismatch(frequency)) {
    add("chemistry-timescale", "Chemistry timescale or temporal resolution", [evidence(`Wave-frequency difference is ${Math.abs(frequency!.percentDifference ?? 0).toFixed(1)}% and is ${frequency!.assessment.label.toLowerCase()}.`, "supports")], [metadata.chemistryModel, metadata.chemistryIntegrator, `${metadata.timeStepUs} µs time step`]);
    add("inlet-boundary", "Inlet state or backflow representation", [evidence("An incorrect inlet state, injection model, or backflow treatment can produce a wave-frequency mismatch, but frequency alone cannot identify which inlet mechanism is responsible.", "supports", "context")], [metadata.inletBoundaryCondition, `${metadata.inletPressureBar} bar`, `${metadata.inletTemperatureK} K`, `φ ${metadata.equivalenceRatio}`]);
  }
  if (isMismatch(meanPressure)) {
    add("inlet-boundary", "Inlet state or backflow representation", [evidence(`Mean-pressure bias is ${numeric(meanPressure!.difference).toFixed(3)} MPa.`, "supports")], [metadata.inletBoundaryCondition, `${metadata.massFlowKgS} kg/s`, `${metadata.inletPressureBar} bar`]);
  }
  if (isMismatch(amplitude) || isMismatch(impulse)) {
    add("wall-loss", "Wall heat-loss treatment", [
      evidence(isMismatch(amplitude) ? `Pressure-amplitude difference is ${Math.abs(amplitude!.percentDifference ?? 0).toFixed(1)}% and exceeds combined uncertainty.` : "The pressure-amplitude difference does not exceed combined uncertainty, so it neither supports nor contradicts this explanation.", isMismatch(amplitude) ? "supports" : "unknown"),
      evidence(isMismatch(impulse) ? `Wave-passage impulse difference is ${Math.abs(impulse!.percentDifference ?? 0).toFixed(1)}% and exceeds combined uncertainty.` : "The pressure-impulse difference does not exceed combined uncertainty, so it neither supports nor contradicts this explanation.", isMismatch(impulse) ? "supports" : "unknown"),
    ], [metadata.wallBoundaryCondition, `${metadata.nearWallCellSizeMm} mm near-wall cell`, metadata.chemistryModel, metadata.chemistryIntegrator]);
  }
  if (isMismatch(mode) || isMismatch(phasePattern) || isMismatch(modeTransitions)) {
    add("initialization-mode", "Initialization or domain-mode sensitivity", [
      evidence(isMismatch(mode) ? "Experiment and CFD identify different rotating-wave counts." : "Wave count matches across the full record.", isMismatch(mode) ? "supports" : "unknown", "strong"),
      evidence(isMismatch(phasePattern) ? `CFD circumferential phase pattern differs by ${numeric(phasePattern!.difference).toFixed(1)}° RMS.` : "The phase-pattern difference is within Caevera's prototype product limit.", isMismatch(phasePattern) ? "supports" : "weakens"),
      evidence(isMismatch(modeTransitions) ? "Experiment and CFD contain different numbers of window-to-window mode transitions." : "Mode-transition counts match.", isMismatch(modeTransitions) ? "supports" : "weakens"),
    ], [metadata.initializationMethod, metadata.dimensionality, `${metadata.meshCells.toLocaleString()} cells`, `${metadata.probePositionsDeg.length} pressure probes`]);
  }
  if (isMismatch(harmonics)) {
    add("spatial-resolution", "Spatial resolution or numerical dissipation", [evidence(`Second-harmonic ratio differs by ${Math.abs(harmonics!.percentDifference ?? 0).toFixed(1)}%.`, "supports", "context")], [metadata.spatialScheme, metadata.numericalFlux, metadata.limiterFilter, metadata.chemistryIntegrator]);
  }
  if ((isMismatch(variability) && numeric(variability!.cfd) < numeric(variability!.experiment)) || isMismatch(frequencyDrift) || (isMismatch(phaseJitter) && numeric(phaseJitter!.cfd) < numeric(phaseJitter!.experiment))) {
    add("missing-unsteadiness", "Missing unsteadiness in the CFD setup", [
      evidence(isMismatch(variability) ? `CFD cycle variability differs by ${Math.abs(numeric(variability!.difference)).toFixed(1)} percentage points.` : "The cycle-variability difference is within Caevera's prototype product limit.", isMismatch(variability) ? "supports" : "weakens"),
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
    add("validation-coverage", "Validation-envelope coverage", [evidence("Every compared value in this case is either within the entered uncertainty or matches its exact mode category. This does not establish agreement for other outputs or operating points.", "supports", "context")], [`${metadata.inletPressureBar} bar`, `${metadata.inletTemperatureK} K`, `φ ${metadata.equivalenceRatio}`]);
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
  "stage" | "whyThisRunFirst" | "inconclusiveCriterion" | "ifConfirmed" | "ifRejected" | "ifInconclusive" | "latestControlledResult" | "precedent" | "reasoningLedger"
>;

function currentSettingSummary(variable: ControlledSensitivityVariable, metadata: CaseMetadata) {
  if (variable === "mesh") return `${metadata.minimumCellSizeMm.toFixed(3)} mm minimum cell`;
  if (variable === "time-step") return `${metadata.timeStepUs.toFixed(3)} µs flow step`;
  if (variable === "chemistry") return `${metadata.chemistryModel} with ${metadata.chemistryIntegrator}`;
  if (variable === "inlet") return metadata.inletBoundaryCondition;
  if (variable === "wall") return metadata.wallBoundaryCondition;
  if (variable === "initialization") return metadata.initializationMethod;
  return "the synchronized measured inlet history";
}

function targetMetricNames(ids: string[]) {
  return ids.map((id) => TARGET_METRIC_LABELS[id] ?? id.replaceAll("-", " "));
}

function listPhrase(items: string[]) {
  if (items.length < 2) return items[0] ?? "the targeted CFD values";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function nextRunFor(hypothesis: DiagnosticHypothesis, metadata: CaseMetadata, latest?: CaseHistoryEvidence): CoreNextRun {
  const supporting = hypothesis.evidence.filter((item) => item.state === "supports");
  const directSupporting = supporting.filter((item) => item.basis === "case" || item.basis === "case-history");
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
  const plannedVariable = variableByCause[hypothesis.id] ?? null;
  const plannedRule = plannedVariable ? CONTROLLED_RERUN_RULES[plannedVariable] : null;
  const stage = stageFor(hypothesis.id);
  const numericalLimit = plannedRule?.convergenceResponsePct ?? null;
  const evaluationMode = numericalLimit != null
    ? "numerical-convergence" as const
    : plannedRule
      ? "model-sensitivity" as const
      : "case-specific" as const;
  const targets = targetMetricNames(plannedRule?.targets ?? []);
  const targetText = listPhrase(targets);
  const reason = directSupporting.map((item) => item.observation).join(" ")
    || `Among the unresolved explanations for this case, ${hypothesis.title.toLowerCase()} has the strongest available support.`;
  const common = {
    evidence: hypothesis.evidence.map((item) => `${item.state}: ${item.observation}`),
    evidenceStrength: supporting.some((item) => item.strength === "strong") ? "High" as const : supporting.length ? "Moderate" as const : "Exploratory" as const,
    decisionPolicy: {
      basis: plannedRule ? "prototype-policy" as const : "case-specific-gate" as const,
      version: RECOMMENDATION_POLICY_VERSION,
      evaluationMode,
      changedVariable: plannedVariable,
      targetedMetricIds: plannedRule?.targets ?? [],
      confirmationErrorReductionPct: plannedRule ? CONFIRMATION_ERROR_REDUCTION_PCT : null,
      minimumResponsePct: plannedRule?.minimumResponsePct ?? null,
      convergenceResponsePct: numericalLimit,
      rejectionErrorWorseningPct: plannedRule ? REJECTION_ERROR_WORSENING_PCT : null,
      requiresNoNewMismatch: Boolean(plannedRule),
    },
  };

  if (plannedVariable && plannedRule) {
    const variableLabel = CONTROLLED_VARIABLE_LABELS[plannedVariable];
    const continuingSequence = numericalLimit != null && latest?.sequenceStatus === "effect-confirmed";
    return {
      ...common,
      question: numericalLimit != null
        ? `Do ${targetText} change by more than ${numericalLimit}% when only ${variableLabel} moves one adjacent level?`
        : `Does changing only ${variableLabel} reduce the CFD-to-experiment error in ${targetText}?`,
      title: numericalLimit != null
        ? continuingSequence ? `Continue ${variableLabel} convergence with the next adjacent level` : `Test ${variableLabel} convergence between two adjacent levels`
        : `Test one ${variableLabel} change`,
      change: `Use the accepted case with ${currentSettingSummary(plannedVariable, metadata)} as the starting point. Change only ${variableLabel} by one documented adjacent level.`,
      reason,
      holdFixed: ["Geometry and operating point", "experiment samples and probe mapping", "comparison window and uncertainty values", `all CFD settings except ${variableLabel}`],
      expectedOutcome: numericalLimit != null
        ? `Compare ${targetText} between the starting CFD result and the new CFD result. Caevera calculates convergence from these two analyzed cases, not from a CSV field.`
        : `Compare the CFD-to-experiment error before and after the change for ${targetText}. Caevera calculates the classification from the two analyzed cases.`,
      confirmationCriterion: numericalLimit != null
        ? `The targeted CFD values change by no more than ${numericalLimit}% between the two adjacent levels.`
        : `The mean CFD-to-experiment error in the targeted values falls by at least ${CONFIRMATION_ERROR_REDUCTION_PCT}%, with no new resolved mismatch.`,
      rejectionCriterion: numericalLimit != null
        ? `The targeted CFD values change by more than ${numericalLimit}%, so the numerical setting still affects the result.`
        : `The targeted CFD response is below ${plannedRule.minimumResponsePct}%, the mean targeted error increases by at least ${REJECTION_ERROR_WORSENING_PCT}%, or a new resolved mismatch appears.`,
      alternativeHypothesis: "After Caevera classifies this result, test the next unresolved explanation in the ranking.",
    };
  }

  const evidenceGate = stage === "Evidence gate";
  return {
    ...common,
    question: evidenceGate ? "After the listed problem is corrected, can this experiment-CFD pairing support a diagnosis?" : "Does the current agreement continue at the nearest documented operating point?",
    title: evidenceGate ? "Correct the blocked comparison" : "Analyze the nearest documented operating point",
    change: evidenceGate
      ? "Correct only the failed case-matching, mapping, or signal-quality item shown above. Do not change the CFD model."
      : "Add the nearest already documented operating point. Keep the hardware, numerical method, and probe mapping unchanged.",
    reason,
    holdFixed: evidenceGate
      ? ["Physical operating point", "CFD model", "pressure records that already passed", "analysis settings that already passed"]
      : ["Geometry and hardware", "numerical method", "model formulations", "probe mapping"],
    expectedOutcome: evidenceGate
      ? "Reanalyze the corrected pairing. Caevera must pass every listed check before it recommends a CFD model change."
      : "Compare the new operating point with its matching experiment. Caevera will either add it to the demonstrated agreement region or identify a resolved mismatch.",
    confirmationCriterion: evidenceGate
      ? "Every listed check passes and the previously blocked outputs can be calculated."
      : "The new case passes the case-matching, signal-quality, uncertainty, and mode-identifiability checks.",
    rejectionCriterion: evidenceGate
      ? "The corrected pairing is valid, but the experiment-CFD discrepancy remains larger than the combined uncertainty."
      : "A discrepancy larger than the combined uncertainty appears; that measured value becomes the next sensitivity target.",
    alternativeHypothesis: "Recalculate the ranking after this result is classified.",
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
    detail: "This case family does not yet include an analyzed one-change rerun for this explanation.",
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
    title: `Repeat the ${variable} test with a clearer one-variable difference`,
    change: `Start from ${latest.caseName}. Change only ${variable} by one larger documented adjacent level, or reduce the uncertainty that prevented classification.`,
    reason: `${latest.detail} Caevera needs a clearer one-variable comparison before it can move to another explanation.`,
    expectedOutcome: "Compare the same targeted values again. The new result must meet a support rule or a rejection rule while unrelated values remain within uncertainty.",
  };
}

function confirmedNextStep(stage: ControlledNextRun["stage"], evaluationMode: ControlledNextRun["decisionPolicy"]["evaluationMode"]) {
  if (evaluationMode === "numerical-convergence") return "Keep the newer numerical setting. Continue adjacent levels until the CFD values change by no more than the convergence limit, then test the next unresolved explanation.";
  if (evaluationMode === "model-sensitivity") return "Keep the supported setting and test the next unresolved explanation.";
  if (stage === "Evidence gate") return "Reanalyze the corrected pairing, then recalculate the CFD test ranking.";
  return "Add this operating point to the demonstrated agreement region, then analyze the next documented operating point.";
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
  const baselineCaseId = caseHistory.find((item) => item.baselineCaseId)?.baselineCaseId;
  let acceptedCase: CaseHistoryEvidence | undefined;
  if (baselineCaseId) {
    let acceptedTipId = baselineCaseId;
    for (const item of caseHistory) {
      if (!item.controlled || item.referenceCaseId !== acceptedTipId) continue;
      if (item.sequenceStatus !== "effect-confirmed" && item.sequenceStatus !== "converged") continue;
      acceptedTipId = item.caseId;
      acceptedCase = item;
    }
  } else {
    acceptedCase = [...caseHistory].reverse().find((item) => item.controlled && (item.sequenceStatus === "effect-confirmed" || item.sequenceStatus === "converged"));
  }
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
    evidence: [{ state: "supports" as const, strength: "context" as const, observation: "Every ranked one-change test in this case family is complete or rejected. The analyzed pressure data does not contain another unresolved explanation to test.", basis: "case" as const, sourceIds: [] }],
    modelInputs: [`${currentMetadata.inletPressureBar} bar`, `${currentMetadata.inletTemperatureK} K`, `φ ${currentMetadata.equivalenceRatio}`],
    sourceIds: SOURCE_IDS_BY_CAUSE["validation-coverage"],
    researchClaims: RESEARCH_CLAIMS_BY_CAUSE["validation-coverage"],
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
  const directUnknowns = primary.evidence.filter((item) => item.state === "unknown" || item.state === "cannot-assess");
  const policyUnknown: DiagnosticEvidence = {
    state: "unknown",
    strength: "strong",
    basis: "policy",
    sourceIds: [],
    observation: core.decisionPolicy.convergenceResponsePct != null && latest?.sequenceStatus === "effect-confirmed"
      ? `${latest.caseName} changed the targeted CFD values, but this family does not yet contain the next adjacent level needed to test the ${core.decisionPolicy.convergenceResponsePct.toFixed(1)}% convergence rule.`
      : core.decisionPolicy.changedVariable
        ? `This case family does not yet contain a qualifying one-change ${core.decisionPolicy.changedVariable} rerun for this decision.`
        : evidenceGate
          ? "The required correction has not yet been analyzed."
          : "No result from the proposed operating point has been analyzed yet.",
  };
  const whyThisRunFirst = evidenceGate
    ? `${primary.title} prevents a reliable diagnosis until the listed check passes.`
    : latest?.sequenceStatus === "inconclusive"
      ? `${latest.caseName} was inconclusive, so the same one-variable test must be resolved before another cause is changed.`
      : latest?.sequenceStatus === "effect-confirmed" && core.decisionPolicy.convergenceResponsePct != null
        ? `${latest.caseName} reduced the mean CFD-to-experiment error in the targeted values by ${Math.abs(latest.errorReductionPct ?? 0).toFixed(1)}%, but the numerical check is not complete until adjacent levels differ by no more than ${core.decisionPolicy.convergenceResponsePct.toFixed(1)}%.`
        : `${supporting} supporting finding${supporting === 1 ? "" : "s"}${strong ? `, including ${strong} strong finding${strong === 1 ? "" : "s"}` : ""}${controlled ? ` and ${controlled} one-change rerun result${controlled === 1 ? "" : "s"}` : ""} place this test first${alternative ? `, ahead of ${alternative.title}` : ""}.`;
  return {
    ...core,
    stage: stageFor(primary.id),
    whyThisRunFirst,
    inconclusiveCriterion: core.decisionPolicy.evaluationMode === "numerical-convergence"
      ? "Caevera cannot calculate the adjacent-level change because the cases are not a valid one-change pair or a targeted CFD value is unavailable."
      : `The result does not reach ${CONFIRMATION_ERROR_REDUCTION_PCT}% mean CFD-to-experiment error reduction and does not meet any rejection rule.`,
    ifConfirmed: confirmedNextStep(stageFor(primary.id), core.decisionPolicy.evaluationMode),
    ifRejected: core.decisionPolicy.evaluationMode === "numerical-convergence"
      ? `Keep the newer ${core.decisionPolicy.changedVariable ?? "numerical"} setting and run the next adjacent level. Caevera reports experiment agreement as a separate result.`
      : evidenceGate
      ? "Do not change the CFD model. Correct the remaining case-matching, mapping, or signal-quality problem first."
      : `${core.alternativeHypothesis}${alternative ? ` The next ranked hypothesis is ${alternative.title}.` : ""}`,
    ifInconclusive: core.decisionPolicy.evaluationMode === "numerical-convergence"
      ? "Correct the case relationship or missing calculation, then repeat the same adjacent-level numerical comparison."
      : "Make the same single-variable change larger or reduce the relevant uncertainty, then repeat without changing any additional CFD setting.",
    latestControlledResult: latestControlledResult(caseHistory, primary.id),
    precedent,
    reasoningLedger: {
      hypothesisId: primary.id,
      hypothesisTitle: primary.title,
      supports: primary.evidence.filter((item) => item.state === "supports"),
      weakens: primary.evidence.filter((item) => item.state === "weakens"),
      unknowns: directUnknowns.length ? directUnknowns : [policyUnknown],
    },
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
    uncertaintyLabel: "Timing and finite-record frequency uncertainty (root-sum-square, one standard uncertainty)",
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
  const harmonicAssessment = prototypeAssessment(harmonicWithin, "Within prototype limit", "Caevera has no case-specific uncertainty for this spectral ratio, so it applies its explicit ±30% prototype product limit.");
  const harmonics: MetricAssessment = {
    id: "harmonics", label: "Second-harmonic ratio", purpose: "Secondary waveform structure", experiment: testHarmonics, cfd: cfdHarmonics, difference: harmonicDifference,
    percentDifference: harmonicPercent, unit: "", uncertainty: null, uncertaintyLabel: "Caevera prototype product limit: ±30%", assessment: harmonicAssessment, tone: statusTone(harmonicAssessment.status),
  };

  const testVariability = pressureMetric(comparisons, "cycleVariabilityPct", "test");
  const cfdVariability = pressureMetric(comparisons, "cycleVariabilityPct", "cfd");
  const variabilityDifference = cfdVariability - testVariability;
  const variabilityWithin = Math.abs(variabilityDifference) <= REVIEW_THRESHOLDS.maximumCycleVariabilityDifferencePct;
  const variabilityAssessment = prototypeAssessment(variabilityWithin, "Within prototype limit", "No repeatability uncertainty was entered for this value, so Caevera applies its explicit ±10 percentage-point prototype product limit.");
  const variability: MetricAssessment = {
    id: "cycle-variability", label: "Cycle variability", purpose: "Cycle-to-cycle pressure-range variation", experiment: testVariability, cfd: cfdVariability, difference: variabilityDifference,
    percentDifference: null, unit: "%", uncertainty: null, uncertaintyLabel: "Caevera prototype product limit: ±10 percentage points", assessment: variabilityAssessment, tone: statusTone(variabilityAssessment.status),
  };

  const phaseError = phasePatternErrorDeg(testMode, cfdMode);
  const phaseAssessment = prototypeAssessment(phaseError <= 20, "Within prototype limit", "Caevera removes one shared time shift, compares the relative phase around the probe array, and applies its ≤20° RMS prototype product limit.");
  const phasePattern: MetricAssessment = modeIdentifiable ? {
    id: "phase-pattern", label: "Probe phase pattern", purpose: "Circumferential propagation agreement", experiment: "Reference", cfd: phaseError, difference: phaseError,
    percentDifference: null, unit: "° RMS", uncertainty: null, uncertaintyLabel: "Caevera prototype product limit: ≤20° RMS", assessment: phaseAssessment, tone: statusTone(phaseAssessment.status),
  } : inconclusiveMetric("phase-pattern", "Probe phase pattern", "Circumferential propagation agreement");

  const driftDifference = cfdMode.frequencyDriftPct - testMode.frequencyDriftPct;
  const driftAssessment = prototypeAssessment(Math.abs(driftDifference) <= 3, "Within prototype limit", "Caevera compares the fitted cycle-frequency trend over the analyzed time window and applies its ±3 percentage-point prototype product limit.");
  const frequencyDrift: MetricAssessment = {
    id: "frequency-drift", label: "Frequency drift", purpose: "Cycle-frequency trend across the record", experiment: testMode.frequencyDriftPct, cfd: cfdMode.frequencyDriftPct, difference: driftDifference,
    percentDifference: null, unit: "%", uncertainty: null, uncertaintyLabel: "Caevera prototype product limit: ±3 percentage points", assessment: driftAssessment, tone: statusTone(driftAssessment.status),
  };

  const jitterDifference = cfdMode.phaseJitterDeg - testMode.phaseJitterDeg;
  const jitterAssessment = prototypeAssessment(Math.abs(jitterDifference) <= 10, "Within prototype limit", "Caevera compares sliding-window relative-phase variation and applies its ±10° prototype product limit. This estimator does not yet include sensor timing uncertainty.");
  const phaseJitter: MetricAssessment = modeIdentifiable ? {
    id: "phase-jitter", label: "Phase jitter", purpose: "Window-to-window propagation consistency", experiment: testMode.phaseJitterDeg, cfd: cfdMode.phaseJitterDeg, difference: jitterDifference,
    percentDifference: null, unit: "°", uncertainty: null, uncertaintyLabel: "Caevera prototype product limit: ±10°", assessment: jitterAssessment, tone: statusTone(jitterAssessment.status),
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
    { label: "Wave mode can be identified", status: modeStatus, detail: `Experiment: ${testMode.identifiability}, ${testMode.phaseResidualDeg.toFixed(1)}° phase-fit error. CFD: ${cfdMode.identifiability}, ${cfdMode.phaseResidualDeg.toFixed(1)}° phase-fit error. A smaller error means the selected wave mode fits the probe phases better.` },
  ];
  const validity = {
    checks,
    status: checks.some((check) => check.status === "Blocked") ? "Blocked" as const : checks.some((check) => check.status === "Review") ? "Review" as const : "Valid" as const,
  };
  const coverage: CoverageItem[] = [
    { module: "Wave dynamics", status: modeStatus === "Pass" ? "Assessed" : "Inconclusive", detail: "Frequency, speed, count, direction, phase pattern, drift, jitter, and mode transitions" },
    { module: "Pressure", status: "Assessed", detail: "Amplitude, peaks, mean, impulse, rise time, harmonics, residuals, and cycle variability" },
    { module: "Uncertainty", status: metrics.some((metric) => metric.assessment.status === "inconclusive") ? "Inconclusive" : "Assessed", detail: "Entered experiment and CFD pressure/timing uncertainties are included in every supported scalar comparison" },
    { module: "Thermal", status: "Not assessed", detail: "This product version does not accept temperature or heat-flux data" },
    { module: "Performance", status: "Not assessed", detail: "This product version does not accept thrust or total-pressure data" },
  ];
  const hypotheses = buildHypotheses(metadata, metrics, validity, dataQuality, caseHistory, precedentHistory);
  return { validity, dataQuality, metrics, coverage, hypotheses, nextRun: buildAdaptiveRunPlan(hypotheses, metadata, metrics, caseHistory, precedentHistory) };
}
