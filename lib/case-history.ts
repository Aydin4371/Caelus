import type { AnalysisCase, CaseMetadata, SensitivityVariable } from "./caevera-types.ts";
import { buildCaseAssessment, type CaseAssessment, type MetricAssessment } from "./diagnostics.ts";
import type { DiagnosticCauseId } from "./diagnostic-knowledge.ts";
import {
  CONFIRMATION_ERROR_REDUCTION_PCT,
  CONTROLLED_RERUN_RULES,
  REJECTION_ERROR_WORSENING_PCT,
  type ControlledSensitivityVariable,
} from "./recommendation-rules.ts";
import { compareProbeSets, analyzeRdeProbeSet, type RdeModeResult } from "./wave-dynamics.ts";

export type CaseSummary = {
  item: AnalysisCase;
  experiment: RdeModeResult;
  simulation: RdeModeResult;
  assessment: CaseAssessment;
  metrics: Record<string, MetricAssessment>;
};

export type CaseDelta = {
  condition: { inletPressureBar: number; inletTemperatureK: number; equivalenceRatio: number; massFlowKgS: number };
  experiment: { frequencyKHz: number; waveSpeedMps: number; pressureAmplitudeMpa: number; peakPressureMpa: number; cycleVariabilityPoints: number };
  cfdAgreement: { frequencyErrorPointChange: number; peakPressureErrorPointChange: number; amplitudeErrorPointChange: number };
};

export type RerunSequenceStatus = "effect-confirmed" | "converged" | "rejected" | "inconclusive" | "comparison-only";
export type PlanDisposition = "continue" | "advance" | "repeat" | "ignore";

export type CaseHistoryEvidence = {
  causeId: DiagnosticCauseId;
  changedVariable: SensitivityVariable;
  state: "supports" | "weakens" | "unknown";
  strength: "strong" | "moderate";
  caseId: string;
  caseName: string;
  caseSource: AnalysisCase["source"];
  referenceCaseId: string;
  referenceCaseName: string;
  caseMetadata: CaseMetadata;
  detail: string;
  controlled: boolean;
  targetedMetrics: string[];
  errorReductionPct: number | null;
  responseMagnitudePct: number | null;
  incrementalResponsePct: number | null;
  metricErrorReductionPct: Record<string, number>;
  baselineMismatchMetricIds: string[];
  runtimeMultiplier: number | null;
  newMismatchMetricIds: string[];
  sequenceStatus: RerunSequenceStatus;
  planDisposition: PlanDisposition;
};

const GROUP_FIELDS: Record<SensitivityVariable, (keyof CaseMetadata)[]> = {
  mesh: ["meshCells", "minimumCellSizeMm", "cellsPerInductionLength", "nearWallCellSizeMm", "spatialScheme", "spatialOrder", "numericalFlux", "limiterFilter"],
  "time-step": ["timeStepUs", "cfl", "temporalScheme", "temporalOrder"],
  chemistry: ["chemistryModel", "chemistrySpecies", "chemistryReactions", "chemistryIntegrator", "combustionModel"],
  inlet: ["inletBoundaryCondition"],
  wall: ["wallBoundaryCondition"],
  initialization: ["initializationMethod"],
  unsteadiness: ["inletBoundaryCondition"],
  other: ["solver", "solverVersion", "dimensionality", "turbulenceModel", "outletBoundaryCondition", "cfdPressureUncertaintyPct", "cfdTimingUncertaintyUs"],
};

const PHYSICAL_CASE_FIELDS: (keyof CaseMetadata)[] = [
  "annulusMeanDiameterMm", "annulusDiameterUncertaintyMm", "probePositionsDeg", "maximumWaveCount",
  "probeSynchronizationConfirmed", "experimentSensorBandwidthKHz", "experimentFilterCutoffKHz",
  "inletPressureBar", "inletTemperatureK", "equivalenceRatio", "massFlowKgS", "comparisonMatchConfirmed",
  "pressureUncertaintyPct", "timingUncertaintyUs",
];

function metric(summary: CaseSummary, id: string) { return summary.metrics[id]; }
function numberValue(value: number | string) { return typeof value === "number" ? value : Number.NaN; }
function valueEqual(left: unknown, right: unknown) { return Array.isArray(left) && Array.isArray(right) ? JSON.stringify(left) === JSON.stringify(right) : Object.is(left, right); }

function metricError(result: MetricAssessment | undefined) {
  if (!result) return Number.NaN;
  if (typeof result.difference === "string") {
    if (result.difference === "No difference") return 0;
    if (result.difference === "Different") return 100;
    return Number.NaN;
  }
  return Number.isFinite(result.percentDifference) ? Math.abs(result.percentDifference!) : Number.NaN;
}

function relativeError(result: MetricAssessment) { return metricError(result); }

function simulationResponse(reference: MetricAssessment | undefined, candidate: MetricAssessment | undefined) {
  if (!reference || !candidate) return Number.NaN;
  if (typeof reference.cfd === "string" || typeof candidate.cfd === "string") return reference.cfd === candidate.cfd ? 0 : 100;
  if (!Number.isFinite(reference.cfd) || !Number.isFinite(candidate.cfd)) return Number.NaN;
  return 100 * Math.abs(candidate.cfd - reference.cfd) / Math.max(Math.abs(reference.cfd), 1e-12);
}

function signalsEqual(left: AnalysisCase["testSignals"], right: AnalysisCase["testSignals"]) {
  return left.length === right.length && left.every((signal, index) => {
    const other = right[index];
    return Boolean(other)
      && signal.time.length === other.time.length
      && signal.pressure.length === other.pressure.length
      && signal.time.every((value, sample) => Object.is(value, other.time[sample]))
      && signal.pressure.every((value, sample) => Object.is(value, other.pressure[sample]));
  });
}

function changedCfdSettings(baseline: CaseMetadata, candidate: CaseMetadata) {
  const fields = [...new Set(Object.values(GROUP_FIELDS).flat())];
  return fields.filter((field) => !valueEqual(baseline[field], candidate[field]));
}

function samePhysicalCase(baseline: AnalysisCase, candidate: AnalysisCase) {
  return PHYSICAL_CASE_FIELDS.every((key) => valueEqual(baseline.metadata[key], candidate.metadata[key]))
    && signalsEqual(baseline.testSignals, candidate.testSignals);
}

function newMismatchIds(baseline: CaseSummary, candidate: CaseSummary) {
  return candidate.assessment.metrics
    .filter((candidateMetric) => candidateMetric.tone === "review" && metric(baseline, candidateMetric.id)?.tone !== "review")
    .map((candidateMetric) => candidateMetric.id);
}

function mean(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

export function summarizeCase(item: AnalysisCase): CaseSummary {
  const comparisons = compareProbeSets(item.testSignals, item.cfdSignals).comparisons;
  const modeOptions = { maximumWaveCount: item.metadata.maximumWaveCount, synchronizationConfirmed: item.metadata.probeSynchronizationConfirmed };
  const experiment = analyzeRdeProbeSet(item.testSignals, item.metadata.probePositionsDeg, item.metadata.annulusMeanDiameterMm, { ...modeOptions, sensorBandwidthKHz: item.metadata.experimentSensorBandwidthKHz, filterCutoffKHz: item.metadata.experimentFilterCutoffKHz });
  const simulation = analyzeRdeProbeSet(item.cfdSignals, item.metadata.probePositionsDeg, item.metadata.annulusMeanDiameterMm, modeOptions);
  const assessment = buildCaseAssessment(item.metadata, comparisons, experiment, simulation);
  return { item, experiment, simulation, assessment, metrics: Object.fromEntries(assessment.metrics.map((result) => [result.id, result])) };
}

export function buildCaseDelta(baseline: CaseSummary, candidate: CaseSummary): CaseDelta {
  return {
    condition: {
      inletPressureBar: candidate.item.metadata.inletPressureBar - baseline.item.metadata.inletPressureBar,
      inletTemperatureK: candidate.item.metadata.inletTemperatureK - baseline.item.metadata.inletTemperatureK,
      equivalenceRatio: candidate.item.metadata.equivalenceRatio - baseline.item.metadata.equivalenceRatio,
      massFlowKgS: candidate.item.metadata.massFlowKgS - baseline.item.metadata.massFlowKgS,
    },
    experiment: {
      frequencyKHz: candidate.experiment.waveFrequencyKHz - baseline.experiment.waveFrequencyKHz,
      waveSpeedMps: candidate.experiment.waveSpeedMps - baseline.experiment.waveSpeedMps,
      pressureAmplitudeMpa: numberValue(metric(candidate, "amplitude").experiment) - numberValue(metric(baseline, "amplitude").experiment),
      peakPressureMpa: numberValue(metric(candidate, "peak-pressure").experiment) - numberValue(metric(baseline, "peak-pressure").experiment),
      cycleVariabilityPoints: numberValue(metric(candidate, "cycle-variability").experiment) - numberValue(metric(baseline, "cycle-variability").experiment),
    },
    cfdAgreement: {
      frequencyErrorPointChange: relativeError(metric(candidate, "frequency")) - relativeError(metric(baseline, "frequency")),
      peakPressureErrorPointChange: relativeError(metric(candidate, "peak-pressure")) - relativeError(metric(baseline, "peak-pressure")),
      amplitudeErrorPointChange: relativeError(metric(candidate, "amplitude")) - relativeError(metric(baseline, "amplitude")),
    },
  };
}

export function buildCaseHistoryEvidence(cases: AnalysisCase[], baselineCaseId: string): CaseHistoryEvidence[] {
  const baseline = cases.find((item) => item.id === baselineCaseId);
  if (!baseline) return [];
  const baselineSummary = summarizeCase(baseline);
  const previousControlled = new Map<ControlledSensitivityVariable, { item: AnalysisCase; summary: CaseSummary; evidence: CaseHistoryEvidence }>();

  return cases.filter((item) => item.relationship?.baselineCaseId === baselineCaseId).map((candidate) => {
    const relation = candidate.relationship!;
    const changedSettings = changedCfdSettings(baseline.metadata, candidate.metadata);
    const variable = relation.changedVariable;
    const rule = variable === "other" ? null : CONTROLLED_RERUN_RULES[variable];
    const physicalCaseMatches = samePhysicalCase(baseline, candidate);
    const controlled = Boolean(rule)
      && physicalCaseMatches
      && changedSettings.length > 0
      && changedSettings.every((field) => GROUP_FIELDS[variable].includes(field));
    const fallbackCause = rule?.causeId ?? "validation-coverage";

    if (!controlled || !rule || variable === "other") return {
      causeId: fallbackCause,
      changedVariable: variable,
      state: "unknown" as const,
      strength: "moderate" as const,
      caseId: candidate.id,
      caseName: candidate.metadata.name,
      caseSource: candidate.source,
      referenceCaseId: baseline.id,
      referenceCaseName: baseline.metadata.name,
      caseMetadata: candidate.metadata,
      controlled: false,
      targetedMetrics: [],
      errorReductionPct: null,
      responseMagnitudePct: null,
      incrementalResponsePct: null,
      metricErrorReductionPct: {},
      baselineMismatchMetricIds: baselineSummary.assessment.metrics.filter((result) => result.tone === "review").map((result) => result.id),
      runtimeMultiplier: null,
      newMismatchMetricIds: [],
      sequenceStatus: "comparison-only" as const,
      planDisposition: "ignore" as const,
      detail: `Comparison only: ${physicalCaseMatches ? "the physical case matches" : "the physical case, experiment trace, or uncertainty definition changed"}; detected CFD setting changes: ${changedSettings.join(", ") || "none"}.`,
    };

    const candidateSummary = summarizeCase(candidate);
    const previous = previousControlled.get(variable);
    const reference = previous?.summary ?? baselineSummary;
    const targets = rule.targets.filter((id) => metric(baselineSummary, id) && metric(candidateSummary, id));
    const pairedErrors = targets.map((id) => ({ id, base: metricError(metric(baselineSummary, id)), next: metricError(metric(candidateSummary, id)) })).filter(({ base, next }) => Number.isFinite(base) && Number.isFinite(next));
    const baselineMean = mean(pairedErrors.map(({ base }) => base));
    const candidateMean = mean(pairedErrors.map(({ next }) => next));
    const errorReductionPct = Number.isFinite(baselineMean) && baselineMean > 1e-9 ? 100 * (baselineMean - candidateMean) / baselineMean : Number.NaN;
    const metricErrorReductionPct = Object.fromEntries(pairedErrors
      .map(({ id, base, next }) => [id, base > 1e-9 ? 100 * (base - next) / base : Number.NaN] as const)
      .filter(([, value]) => Number.isFinite(value)));
    const responseMagnitudePct = mean(targets.map((id) => simulationResponse(metric(baselineSummary, id), metric(candidateSummary, id))));
    const incrementalResponsePct = mean(targets.map((id) => simulationResponse(metric(reference, id), metric(candidateSummary, id))));
    const newMismatches = newMismatchIds(baselineSummary, candidateSummary);
    const hasNewMismatch = newMismatches.length > 0;
    const numerical = rule.convergenceResponsePct !== null;
    const converged = numerical
      && Number.isFinite(incrementalResponsePct)
      && incrementalResponsePct <= rule.convergenceResponsePct!
      && !hasNewMismatch
      && (!previous || previous.evidence.state === "supports" || errorReductionPct >= 0);
    const confirmed = Number.isFinite(errorReductionPct)
      && errorReductionPct >= CONFIRMATION_ERROR_REDUCTION_PCT
      && !hasNewMismatch;
    const rejectedForResponse = Number.isFinite(responseMagnitudePct) && responseMagnitudePct < rule.minimumResponsePct;
    const rejectedForError = Number.isFinite(errorReductionPct) && errorReductionPct <= -REJECTION_ERROR_WORSENING_PCT;

    let state: CaseHistoryEvidence["state"] = "unknown";
    let sequenceStatus: RerunSequenceStatus = "inconclusive";
    let planDisposition: PlanDisposition = "repeat";
    if (converged) {
      state = "weakens";
      sequenceStatus = "converged";
      planDisposition = variable === "time-step" ? "continue" : "advance";
    } else if (confirmed) {
      state = "supports";
      sequenceStatus = "effect-confirmed";
      planDisposition = numerical || variable === "initialization" ? "continue" : "advance";
    } else if (rejectedForResponse || rejectedForError || hasNewMismatch) {
      state = "weakens";
      sequenceStatus = "rejected";
      planDisposition = "advance";
    }

    const change = relation.description || relation.changedVariable;
    const detail = sequenceStatus === "converged"
      ? `${change} completed the numerical check: the incremental targeted response was ${incrementalResponsePct.toFixed(1)}%, at or below the ${rule.convergenceResponsePct!.toFixed(1)}% convergence limit, with no new resolved mismatch.`
      : sequenceStatus === "effect-confirmed"
        ? `${change} produced the predicted response: mean targeted error across ${targets.join(", ")} fell by ${errorReductionPct.toFixed(1)}%, with no new resolved mismatch.`
        : sequenceStatus === "rejected" && hasNewMismatch
          ? `${change} was rejected because it created a new resolved mismatch in ${newMismatches.join(", ")}.`
          : sequenceStatus === "rejected" && rejectedForResponse
            ? `${change} rejected the predicted response: targeted CFD outputs changed by only ${responseMagnitudePct.toFixed(1)}%, below the ${rule.minimumResponsePct.toFixed(1)}% response threshold.`
            : sequenceStatus === "rejected"
              ? `${change} rejected the predicted response: mean targeted error increased by ${Math.abs(errorReductionPct).toFixed(1)}%.`
              : `${change} was inconclusive: mean targeted error changed by ${Number.isFinite(errorReductionPct) ? Math.abs(errorReductionPct).toFixed(1) : "an unresolvable amount"}% and did not meet a confirmation, rejection, or convergence rule.`;

    const evidence: CaseHistoryEvidence = {
      causeId: rule.causeId,
      changedVariable: variable,
      state,
      strength: "strong",
      caseId: candidate.id,
      caseName: candidate.metadata.name,
      caseSource: candidate.source,
      referenceCaseId: reference.item.id,
      referenceCaseName: reference.item.metadata.name,
      caseMetadata: candidate.metadata,
      controlled: true,
      targetedMetrics: targets,
      errorReductionPct: Number.isFinite(errorReductionPct) ? errorReductionPct : null,
      responseMagnitudePct: Number.isFinite(responseMagnitudePct) ? responseMagnitudePct : null,
      incrementalResponsePct: Number.isFinite(incrementalResponsePct) ? incrementalResponsePct : null,
      metricErrorReductionPct,
      baselineMismatchMetricIds: baselineSummary.assessment.metrics.filter((result) => result.tone === "review").map((result) => result.id),
      runtimeMultiplier: Number.isFinite(candidate.metadata.solverRuntimeHours) && candidate.metadata.solverRuntimeHours > 0
        && Number.isFinite(baseline.metadata.solverRuntimeHours) && baseline.metadata.solverRuntimeHours > 0
        ? candidate.metadata.solverRuntimeHours / baseline.metadata.solverRuntimeHours
        : null,
      newMismatchMetricIds: newMismatches,
      sequenceStatus,
      planDisposition,
      detail,
    };
    previousControlled.set(variable, { item: candidate, summary: candidateSummary, evidence });
    return evidence;
  });
}
