import type { AnalysisCase, CaseMetadata, SensitivityVariable } from "./caevera-types.ts";
import { buildCaseAssessment, type CaseAssessment, type MetricAssessment } from "./diagnostics.ts";
import type { DiagnosticCauseId } from "./diagnostic-knowledge.ts";
import { compareProbeSets, analyzeRdeProbeSet, type RdeModeResult } from "./wave-dynamics.ts";
import type { Signal } from "./rde-analysis.ts";

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

export type CaseHistoryEvidence = {
  causeId: DiagnosticCauseId;
  state: "supports" | "weakens" | "unknown";
  strength: "strong" | "moderate";
  caseId: string;
  caseName: string;
  detail: string;
  controlled: boolean;
  targetedMetrics: string[];
  errorReductionPct: number | null;
  responseMagnitudePct: number | null;
};

const CAUSE_BY_CHANGE: Record<SensitivityVariable, DiagnosticCauseId | null> = {
  mesh: "spatial-resolution",
  "time-step": "chemistry-timescale",
  chemistry: "chemistry-timescale",
  inlet: "inlet-boundary",
  wall: "wall-loss",
  initialization: "initialization-mode",
  other: null,
};

const GROUP_FIELDS: Record<SensitivityVariable, (keyof CaseMetadata)[]> = {
  mesh: ["meshCells", "minimumCellSizeMm", "cellsPerInductionLength", "nearWallCellSizeMm", "spatialScheme", "spatialOrder", "numericalFlux", "limiterFilter"],
  "time-step": ["timeStepUs", "cfl", "temporalScheme", "temporalOrder", "chemistryIntegrator"],
  chemistry: ["chemistryModel", "chemistrySpecies", "chemistryReactions", "combustionModel"],
  inlet: ["inletBoundaryCondition"],
  wall: ["wallBoundaryCondition"],
  initialization: ["initializationMethod"],
  other: [],
};

function metric(summary: CaseSummary, id: string) { return summary.metrics[id]; }
function numberValue(value: number | string) { return typeof value === "number" ? value : Number.NaN; }
function valueEqual(left: unknown, right: unknown) { return Array.isArray(left) && Array.isArray(right) ? JSON.stringify(left) === JSON.stringify(right) : left === right; }

const OUTCOME_RULES: Record<Exclude<SensitivityVariable, "other">, { targets: string[]; minimumResponsePct: number }> = {
  mesh: { targets: ["peak-pressure", "rise-time", "harmonics"], minimumResponsePct: 5 },
  "time-step": { targets: ["frequency", "rise-time"], minimumResponsePct: 1 },
  chemistry: { targets: ["frequency", "amplitude", "impulse"], minimumResponsePct: 2 },
  inlet: { targets: ["mean-pressure", "frequency"], minimumResponsePct: 2 },
  wall: { targets: ["amplitude", "impulse"], minimumResponsePct: 2 },
  initialization: { targets: ["wave-count", "direction", "mode-transitions"], minimumResponsePct: 1 },
};

function metricError(result: MetricAssessment) {
  if (typeof result.difference === "string") {
    if (result.difference === "No difference") return 0;
    if (result.difference === "Different") return 100;
    return Number.NaN;
  }
  return Number.isFinite(result.percentDifference) ? Math.abs(result.percentDifference!) : Number.NaN;
}

function relativeError(result: MetricAssessment) {
  return metricError(result);
}

function simulationResponse(baseline: MetricAssessment, candidate: MetricAssessment) {
  if (typeof baseline.cfd === "string" || typeof candidate.cfd === "string") {
    return baseline.cfd === candidate.cfd ? 0 : 100;
  }
  if (!Number.isFinite(baseline.cfd) || !Number.isFinite(candidate.cfd)) return Number.NaN;
  return 100 * Math.abs(candidate.cfd - baseline.cfd) / Math.max(Math.abs(baseline.cfd), 1e-12);
}

function signalFingerprint(signals: Signal[]) {
  return signals.map((signal) => `${signal.time.length}:${signal.time[0]}:${signal.time.at(-1)}:${signal.pressure.slice(0, 12).map((value) => value.toPrecision(8)).join(",")}`).join("|");
}

function changedGroups(baseline: CaseMetadata, candidate: CaseMetadata) {
  return (Object.entries(GROUP_FIELDS) as [SensitivityVariable, (keyof CaseMetadata)[]][])
    .filter(([group, fields]) => group !== "other" && fields.some((field) => !valueEqual(baseline[field], candidate[field])))
    .map(([group]) => group);
}

function samePhysicalCase(baseline: AnalysisCase, candidate: AnalysisCase) {
  const keys: (keyof CaseMetadata)[] = ["annulusMeanDiameterMm", "annulusDiameterUncertaintyMm", "probePositionsDeg", "maximumWaveCount", "probeSynchronizationConfirmed", "experimentSensorBandwidthKHz", "experimentFilterCutoffKHz", "inletPressureBar", "inletTemperatureK", "equivalenceRatio", "massFlowKgS"];
  return keys.every((key) => valueEqual(baseline.metadata[key], candidate.metadata[key]))
    && signalFingerprint(baseline.testSignals) === signalFingerprint(candidate.testSignals);
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
  return cases.filter((item) => item.relationship?.baselineCaseId === baselineCaseId).map((candidate) => {
    const relation = candidate.relationship!;
    const groups = changedGroups(baseline.metadata, candidate.metadata);
    const causeId = CAUSE_BY_CHANGE[relation.changedVariable];
    const controlled = Boolean(causeId) && samePhysicalCase(baseline, candidate) && groups.length === 1 && groups[0] === relation.changedVariable;
    if (!controlled || !causeId) return {
      causeId: causeId ?? "validation-coverage",
      state: "unknown" as const,
      strength: "moderate" as const,
      caseId: candidate.id,
      caseName: candidate.metadata.name,
      controlled: false,
      targetedMetrics: [],
      errorReductionPct: null,
      responseMagnitudePct: null,
      detail: `Comparison only: ${samePhysicalCase(baseline, candidate) ? "the physical case matches" : "the physical case or experiment trace changed"}; detected CFD change groups: ${groups.join(", ") || "none"}.`,
    };

    const candidateSummary = summarizeCase(candidate);
    const rule = OUTCOME_RULES[relation.changedVariable as Exclude<SensitivityVariable, "other">];
    const targets = rule.targets;
    const baselineErrors = targets.map((id) => metricError(metric(baselineSummary, id))).filter(Number.isFinite);
    const candidateErrors = targets.map((id) => metricError(metric(candidateSummary, id))).filter(Number.isFinite);
    const responses = targets.map((id) => simulationResponse(metric(baselineSummary, id), metric(candidateSummary, id))).filter(Number.isFinite);
    const baselineMean = baselineErrors.length ? baselineErrors.reduce((sum, value) => sum + value, 0) / baselineErrors.length : 0;
    const candidateMean = candidateErrors.length ? candidateErrors.reduce((sum, value) => sum + value, 0) / candidateErrors.length : 0;
    const errorReductionPct = baselineMean > 1e-9 ? 100 * (baselineMean - candidateMean) / baselineMean : 0;
    const responseMagnitudePct = responses.length ? responses.reduce((sum, value) => sum + value, 0) / responses.length : 0;
    const state = errorReductionPct >= 25
      ? "supports" as const
      : responseMagnitudePct < rule.minimumResponsePct || errorReductionPct <= -5
        ? "weakens" as const
        : "unknown" as const;
    const detail = state === "supports"
      ? `${relation.description || relation.changedVariable} produced the predicted response: targeted error across ${targets.join(", ")} fell by ${errorReductionPct.toFixed(1)}%.`
      : state === "weakens" && responseMagnitudePct < rule.minimumResponsePct
        ? `${relation.description || relation.changedVariable} rejected the predicted response: targeted CFD outputs changed by only ${responseMagnitudePct.toFixed(1)}%, below the ${rule.minimumResponsePct.toFixed(1)}% response threshold.`
        : state === "weakens"
          ? `${relation.description || relation.changedVariable} rejected the predicted response: targeted error across ${targets.join(", ")} increased by ${Math.abs(errorReductionPct).toFixed(1)}%.`
          : `${relation.description || relation.changedVariable} was inconclusive: targeted error changed by ${Math.abs(errorReductionPct).toFixed(1)}% and did not meet the confirmation or rejection rule.`;
    return {
      causeId,
      state,
      strength: "strong" as const,
      caseId: candidate.id,
      caseName: candidate.metadata.name,
      controlled: true,
      targetedMetrics: targets,
      errorReductionPct,
      responseMagnitudePct,
      detail,
    };
  });
}
