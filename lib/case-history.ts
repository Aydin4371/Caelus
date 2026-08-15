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
  baselineCaseId: string;
  causeId: DiagnosticCauseId;
  changedVariable: SensitivityVariable;
  state: "supports" | "weakens" | "unknown";
  strength: "strong" | "moderate";
  caseId: string;
  caseName: string;
  caseSource: AnalysisCase["source"];
  referenceCaseId: string;
  referenceCaseName: string;
  changedSettings: (keyof CaseMetadata)[];
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
  relationshipIssues: string[];
  sequenceStatus: RerunSequenceStatus;
  planDisposition: PlanDisposition;
};

export const CONTROLLED_RERUN_FIELDS: Record<SensitivityVariable, (keyof CaseMetadata)[]> = {
  mesh: ["meshCells", "minimumCellSizeMm", "cellsPerInductionLength", "nearWallCellSizeMm", "spatialScheme", "spatialOrder", "numericalFlux", "limiterFilter"],
  "time-step": ["timeStepUs", "cfl", "temporalScheme", "temporalOrder"],
  chemistry: ["chemistryModel", "chemistrySpecies", "chemistryReactions", "chemistryIntegrator", "combustionModel"],
  inlet: ["inletBoundaryCondition"],
  wall: ["wallBoundaryCondition"],
  initialization: ["initializationMethod"],
  unsteadiness: ["inletBoundaryCondition"],
  other: ["solver", "solverVersion", "dimensionality", "turbulenceModel", "outletBoundaryCondition"],
};

const PHYSICAL_CASE_FIELDS: (keyof CaseMetadata)[] = [
  "annulusMeanDiameterMm", "annulusDiameterUncertaintyMm", "probePositionsDeg", "maximumWaveCount",
  "probeSynchronizationConfirmed", "experimentSensorBandwidthKHz", "experimentFilterCutoffKHz",
  "inletPressureBar", "inletTemperatureK", "equivalenceRatio", "massFlowKgS", "comparisonMatchConfirmed",
  "pressureUncertaintyPct", "timingUncertaintyUs",
];

const FIELD_LABELS: Partial<Record<keyof CaseMetadata, string>> = {
  annulusMeanDiameterMm: "annulus diameter",
  annulusDiameterUncertaintyMm: "diameter uncertainty",
  probePositionsDeg: "probe positions",
  maximumWaveCount: "maximum expected wave count",
  probeSynchronizationConfirmed: "probe synchronization confirmation",
  experimentSensorBandwidthKHz: "sensor bandwidth",
  experimentFilterCutoffKHz: "filter cutoff",
  inletPressureBar: "inlet pressure",
  inletTemperatureK: "inlet temperature",
  equivalenceRatio: "equivalence ratio",
  massFlowKgS: "mass flow",
  comparisonMatchConfirmed: "comparison-match confirmation",
  pressureUncertaintyPct: "experiment pressure uncertainty",
  timingUncertaintyUs: "experiment timing uncertainty",
  solver: "solver",
  solverVersion: "solver version",
  dimensionality: "dimensionality",
  spatialScheme: "spatial scheme",
  spatialOrder: "spatial order",
  numericalFlux: "numerical flux",
  limiterFilter: "limiter/filter",
  temporalScheme: "temporal scheme",
  temporalOrder: "temporal order",
  cfl: "CFL",
  turbulenceModel: "turbulence model",
  combustionModel: "combustion model",
  chemistryModel: "chemical mechanism",
  chemistrySpecies: "chemistry species count",
  chemistryReactions: "chemistry reaction count",
  chemistryIntegrator: "chemistry integrator",
  meshCells: "mesh cell count",
  minimumCellSizeMm: "minimum front cell",
  cellsPerInductionLength: "cells per induction length",
  nearWallCellSizeMm: "near-wall cell size",
  timeStepUs: "time step",
  wallBoundaryCondition: "wall treatment",
  inletBoundaryCondition: "inlet treatment",
  outletBoundaryCondition: "outlet treatment",
  initializationMethod: "initialization",
  cfdPressureUncertaintyPct: "CFD pressure uncertainty",
  cfdTimingUncertaintyUs: "CFD timing uncertainty",
};

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
  const fields = [...new Set(Object.values(CONTROLLED_RERUN_FIELDS).flat())];
  return fields.filter((field) => !valueEqual(baseline[field], candidate[field]));
}

function fieldNames(fields: (keyof CaseMetadata)[]) {
  return fields.map(caseFieldLabel).join(", ");
}

export function caseFieldLabel(field: keyof CaseMetadata) {
  return FIELD_LABELS[field] ?? String(field);
}

function physicalCaseDifferences(baseline: AnalysisCase, candidate: AnalysisCase) {
  return PHYSICAL_CASE_FIELDS.filter((field) => !valueEqual(baseline.metadata[field], candidate.metadata[field]));
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

function agreementDetail(errorReductionPct: number, newMismatchMetricIds: string[]) {
  const agreement = !Number.isFinite(errorReductionPct)
    ? "Experimental agreement could not be resolved from the targeted outputs."
    : Math.abs(errorReductionPct) < 0.05
      ? "Mean targeted experimental agreement was unchanged."
      : errorReductionPct > 0
        ? `Mean targeted experimental error fell by ${errorReductionPct.toFixed(1)}%.`
        : `Mean targeted experimental error increased by ${Math.abs(errorReductionPct).toFixed(1)}%.`;
  const mismatches = newMismatchMetricIds.length
    ? ` A new resolved mismatch appeared in ${newMismatchMetricIds.join(", ")}.`
    : " No new resolved mismatch appeared.";
  return `${agreement}${mismatches}`;
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
  const summaries = new Map<string, CaseSummary>([[baseline.id, baselineSummary]]);
  const summaryFor = (item: AnalysisCase) => {
    const existing = summaries.get(item.id);
    if (existing) return existing;
    const result = summarizeCase(item);
    summaries.set(item.id, result);
    return result;
  };
  const previousControlled = new Map<ControlledSensitivityVariable, { item: AnalysisCase; summary: CaseSummary; evidence: CaseHistoryEvidence }>();

  return cases.filter((item) => item.relationship?.baselineCaseId === baselineCaseId).map((candidate) => {
    const relation = candidate.relationship!;
    const variable = relation.changedVariable;
    const rule = variable === "other" ? null : CONTROLLED_RERUN_RULES[variable];
    const previous = variable === "other" ? undefined : previousControlled.get(variable);
    const requestedReference = relation.referenceCaseId ? cases.find((item) => item.id === relation.referenceCaseId) : null;
    const referenceCase = requestedReference ?? previous?.item ?? baseline;
    const referenceSummary = summaryFor(referenceCase);
    const changedSettings = changedCfdSettings(referenceCase.metadata, candidate.metadata);
    const physicalDifferences = physicalCaseDifferences(referenceCase, candidate);
    const experimentMatches = signalsEqual(referenceCase.testSignals, candidate.testSignals);
    const physicalCaseMatches = physicalDifferences.length === 0 && experimentMatches;
    const referenceInFamily = referenceCase.id === baseline.id || referenceCase.relationship?.baselineCaseId === baseline.id;
    const expectedChangedSettings = rule ? changedSettings.filter((field) => CONTROLLED_RERUN_FIELDS[variable].includes(field)) : [];
    const extraChangedSettings = rule ? changedSettings.filter((field) => !CONTROLLED_RERUN_FIELDS[variable].includes(field)) : changedSettings;
    const relationshipIssues: string[] = [];
    if (!rule || variable === "other") relationshipIssues.push("Choose one declared CFD change instead of Other / comparison only.");
    if (!referenceInFamily) relationshipIssues.push("The selected starting case is outside this case family.");
    if (physicalDifferences.length) relationshipIssues.push(`Case inputs changed: ${fieldNames(physicalDifferences)}.`);
    if (!experimentMatches) relationshipIssues.push(`Experiment pressure samples differ from ${referenceCase.metadata.name}.`);
    if (rule && expectedChangedSettings.length === 0) relationshipIssues.push(`No ${variable === "time-step" ? "time-step" : variable} setting changed from ${referenceCase.metadata.name}.`);
    if (extraChangedSettings.length) relationshipIssues.push(`Additional CFD settings changed: ${fieldNames(extraChangedSettings)}.`);
    const controlled = Boolean(rule)
      && referenceCase.id !== candidate.id
      && referenceInFamily
      && physicalCaseMatches
      && expectedChangedSettings.length > 0
      && extraChangedSettings.length === 0;
    const fallbackCause = rule?.causeId ?? "validation-coverage";

    if (!controlled || !rule || variable === "other") return {
      baselineCaseId: baseline.id,
      causeId: fallbackCause,
      changedVariable: variable,
      state: "unknown" as const,
      strength: "moderate" as const,
      caseId: candidate.id,
      caseName: candidate.metadata.name,
      caseSource: candidate.source,
      referenceCaseId: referenceCase.id,
      referenceCaseName: referenceCase.metadata.name,
      changedSettings,
      caseMetadata: candidate.metadata,
      controlled: false,
      targetedMetrics: [],
      errorReductionPct: null,
      responseMagnitudePct: null,
      incrementalResponsePct: null,
      metricErrorReductionPct: {},
      baselineMismatchMetricIds: referenceSummary.assessment.metrics.filter((result) => result.tone === "review").map((result) => result.id),
      runtimeMultiplier: null,
      newMismatchMetricIds: [],
      relationshipIssues,
      sequenceStatus: "comparison-only" as const,
      planDisposition: "ignore" as const,
      detail: `Comparison only: ${relationshipIssues.join(" ") || "the declared relationship could not be verified."}`,
    };

    const candidateSummary = summaryFor(candidate);
    const reference = referenceSummary;
    const targets = rule.targets.filter((id) => metric(reference, id) && metric(candidateSummary, id));
    const pairedErrors = targets.map((id) => ({ id, base: metricError(metric(reference, id)), next: metricError(metric(candidateSummary, id)) })).filter(({ base, next }) => Number.isFinite(base) && Number.isFinite(next));
    const baselineMean = mean(pairedErrors.map(({ base }) => base));
    const candidateMean = mean(pairedErrors.map(({ next }) => next));
    const errorReductionPct = Number.isFinite(baselineMean) && baselineMean > 1e-9 ? 100 * (baselineMean - candidateMean) / baselineMean : Number.NaN;
    const metricErrorReductionPct = Object.fromEntries(pairedErrors
      .map(({ id, base, next }) => [id, base > 1e-9 ? 100 * (base - next) / base : Number.NaN] as const)
      .filter(([, value]) => Number.isFinite(value)));
    const responseMagnitudePct = mean(targets.map((id) => simulationResponse(metric(reference, id), metric(candidateSummary, id))));
    const incrementalResponsePct = mean(targets.map((id) => simulationResponse(metric(reference, id), metric(candidateSummary, id))));
    const newMismatches = newMismatchIds(reference, candidateSummary);
    const hasNewMismatch = newMismatches.length > 0;
    const numerical = rule.convergenceResponsePct !== null;
    const numericalResponseAvailable = numerical && Number.isFinite(incrementalResponsePct);
    const converged = numericalResponseAvailable && incrementalResponsePct <= rule.convergenceResponsePct!;
    const numericalEffectRemains = numericalResponseAvailable && incrementalResponsePct > rule.convergenceResponsePct!;
    const confirmed = Number.isFinite(errorReductionPct)
      && errorReductionPct >= CONFIRMATION_ERROR_REDUCTION_PCT
      && !hasNewMismatch;
    const rejectedForResponse = Number.isFinite(responseMagnitudePct) && responseMagnitudePct < rule.minimumResponsePct;
    const rejectedForError = Number.isFinite(errorReductionPct) && errorReductionPct <= -REJECTION_ERROR_WORSENING_PCT;

    let state: CaseHistoryEvidence["state"] = "unknown";
    let sequenceStatus: RerunSequenceStatus = "inconclusive";
    let planDisposition: PlanDisposition = "repeat";
    if (numerical) {
      if (converged) {
        state = "weakens";
        sequenceStatus = "converged";
        planDisposition = variable === "time-step" ? "continue" : "advance";
      } else if (numericalEffectRemains) {
        state = "supports";
        sequenceStatus = "effect-confirmed";
        planDisposition = "continue";
      }
    } else if (confirmed) {
      state = "supports";
      sequenceStatus = "effect-confirmed";
      planDisposition = variable === "initialization" ? "continue" : "advance";
    } else if (rejectedForResponse || rejectedForError || hasNewMismatch) {
      state = "weakens";
      sequenceStatus = "rejected";
      planDisposition = "advance";
    }

    const change = relation.description || relation.changedVariable;
    const agreement = agreementDetail(errorReductionPct, newMismatches);
    const detail = sequenceStatus === "converged"
      ? `${change} completed the numerical check: targeted CFD outputs changed by ${incrementalResponsePct.toFixed(1)}%, at or below the ${rule.convergenceResponsePct!.toFixed(1)}% convergence limit. ${agreement}`
      : sequenceStatus === "effect-confirmed" && numerical
        ? `${change} did not complete numerical convergence: targeted CFD outputs changed by ${incrementalResponsePct.toFixed(1)}%, above the ${rule.convergenceResponsePct!.toFixed(1)}% limit. ${agreement}`
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
      baselineCaseId: baseline.id,
      causeId: rule.causeId,
      changedVariable: variable,
      state,
      strength: "strong",
      caseId: candidate.id,
      caseName: candidate.metadata.name,
      caseSource: candidate.source,
      referenceCaseId: referenceCase.id,
      referenceCaseName: referenceCase.metadata.name,
      changedSettings,
      caseMetadata: candidate.metadata,
      controlled: true,
      targetedMetrics: targets,
      errorReductionPct: Number.isFinite(errorReductionPct) ? errorReductionPct : null,
      responseMagnitudePct: Number.isFinite(responseMagnitudePct) ? responseMagnitudePct : null,
      incrementalResponsePct: Number.isFinite(incrementalResponsePct) ? incrementalResponsePct : null,
      metricErrorReductionPct,
      baselineMismatchMetricIds: referenceSummary.assessment.metrics.filter((result) => result.tone === "review").map((result) => result.id),
      runtimeMultiplier: Number.isFinite(candidate.metadata.solverRuntimeHours) && candidate.metadata.solverRuntimeHours > 0
        && Number.isFinite(referenceCase.metadata.solverRuntimeHours) && referenceCase.metadata.solverRuntimeHours > 0
        ? candidate.metadata.solverRuntimeHours / referenceCase.metadata.solverRuntimeHours
        : null,
      newMismatchMetricIds: newMismatches,
      relationshipIssues: [],
      sequenceStatus,
      planDisposition,
      detail,
    };
    previousControlled.set(variable, { item: candidate, summary: candidateSummary, evidence });
    return evidence;
  });
}

export function selectPlanningEvidence(history: CaseHistoryEvidence[], baselineCaseId: string) {
  let acceptedTipId = baselineCaseId;
  let accepted: CaseHistoryEvidence | null = null;
  for (const item of history) {
    if (!item.controlled || item.referenceCaseId !== acceptedTipId) continue;
    if (item.sequenceStatus !== "effect-confirmed" && item.sequenceStatus !== "converged") continue;
    acceptedTipId = item.caseId;
    accepted = item;
  }
  return accepted;
}
