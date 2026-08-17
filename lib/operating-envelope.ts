import { buildCaseHistoryEvidence } from "./case-history.ts";
import type { AnalysisCase } from "./caevera-types.ts";
import { compareProbeSets } from "./wave-dynamics.ts";
import { analyzeRdeProbeSet } from "./wave-dynamics.ts";

export type EnvelopeAxisKey = "equivalenceRatio" | "inletPressureBar" | "massFlowKgS";
export type EnvelopeClassification = "Stable" | "Transitional" | "Unstable" | "Unclassified";
export type EnvelopeNumericalStatus = "Converged" | "Sequence open" | "Not checked";

export type EnvelopePoint = {
  caseId: string;
  name: string;
  source: AnalysisCase["source"];
  equivalenceRatio: number;
  inletPressureBar: number;
  massFlowKgS: number;
  inletTemperatureK: number;
  classification: EnvelopeClassification;
  identifiability: "Identified" | "Candidate" | "Not identifiable";
  waveCount: number | null;
  waveFrequencyKHz: number;
  waveSpeedMps: number | null;
  meanPressureMpa: number;
  frequencyVariationPct: number;
  phaseJitterDeg: number | null;
  signalQuality: "Ready" | "Review";
  numericalStatus: EnvelopeNumericalStatus;
  cfdRerunCount: number;
  backflowStatus: "Not assessed";
  modelUse: "Eligible observation" | "Demonstration only" | "Needs clearer mode data" | "Needs numerical convergence";
};

export type EnvelopeDataset = {
  points: EnvelopePoint[];
  uploadedPointCount: number;
  demonstrationPointCount: number;
  identifiedPointCount: number;
  convergedPointCount: number;
  status: "No operating points" | "Demonstration only" | "Observed map only";
  nextRequirement: string;
};

export const ENVELOPE_AXES: { key: EnvelopeAxisKey; label: string; unit: string }[] = [
  { key: "equivalenceRatio", label: "Equivalence ratio", unit: "" },
  { key: "inletPressureBar", label: "Inlet pressure", unit: "bar" },
  { key: "massFlowKgS", label: "Mass flow", unit: "kg/s" },
];

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

function numericalStatus(cases: AnalysisCase[], baseline: AnalysisCase): EnvelopeNumericalStatus {
  const numericalEvidence = buildCaseHistoryEvidence(cases, baseline.id)
    .filter((evidence) => evidence.changedVariable === "mesh" || evidence.changedVariable === "time-step");
  if (numericalEvidence.some((evidence) => evidence.sequenceStatus === "converged")) return "Converged";
  if (numericalEvidence.some((evidence) => evidence.controlled)) return "Sequence open";
  return "Not checked";
}

function modelUse(point: Pick<EnvelopePoint, "source" | "identifiability" | "signalQuality" | "numericalStatus">): EnvelopePoint["modelUse"] {
  if (point.source === "demo") return "Demonstration only";
  if (point.identifiability !== "Identified" || point.signalQuality !== "Ready") return "Needs clearer mode data";
  if (point.numericalStatus !== "Converged") return "Needs numerical convergence";
  return "Eligible observation";
}

export function buildEnvelopeDataset(cases: AnalysisCase[]): EnvelopeDataset {
  const baselines = cases.filter((item) => !item.relationship);
  const points = baselines.map((item): EnvelopePoint => {
    const mode = analyzeRdeProbeSet(item.testSignals, item.metadata.probePositionsDeg, item.metadata.annulusMeanDiameterMm, {
      maximumWaveCount: item.metadata.maximumWaveCount,
      synchronizationConfirmed: item.metadata.probeSynchronizationConfirmed,
      sensorBandwidthKHz: item.metadata.experimentSensorBandwidthKHz,
      filterCutoffKHz: item.metadata.experimentFilterCutoffKHz,
    });
    const comparison = compareProbeSets(item.testSignals, item.cfdSignals);
    const signalQuality = comparison.comparisons.every((result) => result.testQuality.status === "Ready" && result.cfdQuality.status === "Ready")
      ? "Ready"
      : "Review";
    const status = numericalStatus(cases, item);
    const identifiability = mode.identifiability;
    const point: EnvelopePoint = {
      caseId: item.id,
      name: item.metadata.name,
      source: item.source,
      equivalenceRatio: item.metadata.equivalenceRatio,
      inletPressureBar: item.metadata.inletPressureBar,
      massFlowKgS: item.metadata.massFlowKgS,
      inletTemperatureK: item.metadata.inletTemperatureK,
      classification: identifiability === "Not identifiable" ? "Unclassified" : mode.stability,
      identifiability,
      waveCount: identifiability === "Not identifiable" ? null : mode.waveCount,
      waveFrequencyKHz: mode.waveFrequencyKHz,
      waveSpeedMps: Number.isFinite(mode.waveSpeedMps) ? mode.waveSpeedMps : null,
      meanPressureMpa: average(comparison.comparisons.map((result) => result.testMetrics.meanPressure)),
      frequencyVariationPct: mode.frequencyVariationPct,
      phaseJitterDeg: Number.isFinite(mode.phaseJitterDeg) ? mode.phaseJitterDeg : null,
      signalQuality,
      numericalStatus: status,
      cfdRerunCount: cases.filter((candidate) => candidate.relationship?.baselineCaseId === item.id).length,
      backflowStatus: "Not assessed",
      modelUse: "Needs numerical convergence",
    };
    point.modelUse = modelUse(point);
    return point;
  });

  const uploadedPointCount = points.filter((point) => point.source === "uploaded").length;
  const demonstrationPointCount = points.length - uploadedPointCount;
  const identifiedPointCount = points.filter((point) => point.identifiability === "Identified").length;
  const convergedPointCount = points.filter((point) => point.numericalStatus === "Converged").length;
  const status = points.length === 0
    ? "No operating points"
    : uploadedPointCount === 0
      ? "Demonstration only"
      : "Observed map only";
  const nextRequirement = points.length === 0
    ? "Add a matched experiment and CFD case to create the first observed operating point."
    : uploadedPointCount === 0
      ? "Add a user-provided operating point. Synthetic cases demonstrate the workflow but cannot train or validate an envelope."
      : identifiedPointCount < uploadedPointCount
        ? "Resolve probe or signal limitations so each physical operating point has an identifiable experimental mode."
        : convergedPointCount < uploadedPointCount
          ? "Complete the mesh or time-step sequence for each physical operating point before using CFD outputs to fit a model."
          : "Record additional physical operating points under one explicitly documented engine configuration before fitting and validating a surrogate."

  return {
    points,
    uploadedPointCount,
    demonstrationPointCount,
    identifiedPointCount,
    convergedPointCount,
    status,
    nextRequirement,
  };
}

export function envelopeAxisValue(point: EnvelopePoint, axis: EnvelopeAxisKey) {
  return point[axis];
}
