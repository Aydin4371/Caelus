import { buildCaseHistoryEvidence } from "./case-history.ts";
import type { AnalysisCase } from "./caevera-types.ts";
import type { OperatingPoint } from "./design-workspace.ts";
import { assessSignalQuality } from "./rde-analysis.ts";
import { analyzeRdeProbeSet } from "./wave-dynamics.ts";

export type EnvelopeAxisKey = "equivalenceRatio" | "inletPressureBar" | "massFlowKgS" | "backPressureBar";
export type EnvelopeClassification = "Stable" | "Transitional" | "Unstable" | "Unclassified";
export type EnvelopeNumericalStatus = "Converged" | "Sequence open" | "Not checked";
export type EnvelopeEvidenceQuality = "High" | "Moderate" | "Review";

export type EnvelopePoint = {
  operatingPointId: string;
  caseId: string;
  name: string;
  source: OperatingPoint["source"];
  equivalenceRatio: number;
  inletPressureBar: number;
  massFlowKgS: number;
  backPressureBar: number;
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
  runCount: number;
  cfdRerunCount: number;
  evidenceType: "Experiment only" | "Experiment + CFD";
  evidenceQuality: EnvelopeEvidenceQuality;
  modelUse: "Eligible observation" | "Demonstration only" | "Needs clearer mode data";
};

export type EnvelopeDataset = {
  points: EnvelopePoint[];
  uploadedPointCount: number;
  demonstrationPointCount: number;
  identifiedPointCount: number;
  convergedPointCount: number;
  stablePointCount: number;
  transitionalPointCount: number;
  unstablePointCount: number;
  status: "No completed operating points" | "Demonstration only" | "Measured envelope";
  nextRequirement: string;
};

export const ENVELOPE_AXES: { key: EnvelopeAxisKey; label: string; unit: string }[] = [
  { key: "inletPressureBar", label: "Inlet / plenum pressure", unit: "bar" },
  { key: "massFlowKgS", label: "Mass flow", unit: "kg/s" },
  { key: "equivalenceRatio", label: "Equivalence ratio", unit: "" },
  { key: "backPressureBar", label: "Back pressure", unit: "bar" },
];

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

function numericalStatus(runs: AnalysisCase[], baseline: AnalysisCase): EnvelopeNumericalStatus {
  const numericalEvidence = buildCaseHistoryEvidence(runs, baseline.id)
    .filter((evidence) => evidence.changedVariable === "mesh" || evidence.changedVariable === "time-step");
  if (numericalEvidence.some((evidence) => evidence.sequenceStatus === "converged")) return "Converged";
  if (numericalEvidence.some((evidence) => evidence.controlled)) return "Sequence open";
  return "Not checked";
}

function quality(source: OperatingPoint["source"], signalQuality: EnvelopePoint["signalQuality"], identifiability: EnvelopePoint["identifiability"]): EnvelopeEvidenceQuality {
  if (source === "demo" || signalQuality !== "Ready" || identifiability !== "Identified") return "Review";
  return "High";
}

function modelUse(point: Pick<EnvelopePoint, "source" | "identifiability" | "signalQuality">): EnvelopePoint["modelUse"] {
  if (point.source === "demo") return "Demonstration only";
  if (point.identifiability !== "Identified" || point.signalQuality !== "Ready") return "Needs clearer mode data";
  return "Eligible observation";
}

export function buildEnvelopeDataset(operatingPoints: OperatingPoint[], allRuns: AnalysisCase[]): EnvelopeDataset {
  const points = operatingPoints.flatMap((operatingPoint): EnvelopePoint[] => {
    const runs = allRuns.filter((run) => run.operatingPointId === operatingPoint.id);
    const baseline = runs.find((run) => !run.relationship) ?? null;
    const experiment = operatingPoint.experiment ?? (baseline ? {
      signals: baseline.testSignals,
      annulusMeanDiameterMm: baseline.metadata.annulusMeanDiameterMm,
      annulusDiameterUncertaintyMm: baseline.metadata.annulusDiameterUncertaintyMm,
      probePositionsDeg: baseline.metadata.probePositionsDeg,
      maximumWaveCount: baseline.metadata.maximumWaveCount,
      probeSynchronizationConfirmed: baseline.metadata.probeSynchronizationConfirmed,
      experimentSensorBandwidthKHz: baseline.metadata.experimentSensorBandwidthKHz,
      experimentFilterCutoffKHz: baseline.metadata.experimentFilterCutoffKHz,
      pressureUncertaintyPct: baseline.metadata.pressureUncertaintyPct,
      timingUncertaintyUs: baseline.metadata.timingUncertaintyUs,
    } : null);
    if (!experiment) return [];
    const mode = analyzeRdeProbeSet(experiment.signals, experiment.probePositionsDeg, experiment.annulusMeanDiameterMm, {
      maximumWaveCount: experiment.maximumWaveCount,
      synchronizationConfirmed: experiment.probeSynchronizationConfirmed,
      sensorBandwidthKHz: experiment.experimentSensorBandwidthKHz,
      filterCutoffKHz: experiment.experimentFilterCutoffKHz,
    });
    const signalQuality = experiment.signals.every((signal) => assessSignalQuality(signal, mode.waveFrequencyKHz).status === "Ready") ? "Ready" : "Review";
    const status = baseline ? numericalStatus(runs, baseline) : "Not checked";
    const identifiability = mode.identifiability;
    const point: EnvelopePoint = {
      operatingPointId: operatingPoint.id,
      caseId: baseline?.id ?? operatingPoint.id,
      name: operatingPoint.name,
      source: operatingPoint.source,
      equivalenceRatio: operatingPoint.equivalenceRatio,
      inletPressureBar: operatingPoint.inletPressureBar,
      massFlowKgS: operatingPoint.massFlowKgS,
      backPressureBar: operatingPoint.backPressureBar,
      inletTemperatureK: operatingPoint.inletTemperatureK,
      classification: identifiability === "Not identifiable" ? "Unclassified" : mode.stability,
      identifiability,
      waveCount: identifiability === "Not identifiable" ? null : mode.waveCount,
      waveFrequencyKHz: mode.waveFrequencyKHz,
      waveSpeedMps: Number.isFinite(mode.waveSpeedMps) ? mode.waveSpeedMps : null,
      meanPressureMpa: average(experiment.signals.map((signal) => average(signal.pressure))),
      frequencyVariationPct: mode.frequencyVariationPct,
      phaseJitterDeg: Number.isFinite(mode.phaseJitterDeg) ? mode.phaseJitterDeg : null,
      signalQuality,
      numericalStatus: status,
      runCount: runs.length,
      cfdRerunCount: runs.filter((run) => run.relationship).length,
      evidenceType: baseline ? "Experiment + CFD" : "Experiment only",
      evidenceQuality: quality(operatingPoint.source, signalQuality, identifiability),
      modelUse: "Needs clearer mode data",
    };
    point.modelUse = modelUse(point);
    return [point];
  });

  const uploadedPointCount = points.filter((point) => point.source === "uploaded").length;
  const demonstrationPointCount = points.length - uploadedPointCount;
  const identifiedPointCount = points.filter((point) => point.identifiability === "Identified").length;
  const convergedPointCount = points.filter((point) => point.numericalStatus === "Converged").length;
  const stablePointCount = points.filter((point) => point.source === "uploaded" && point.classification === "Stable").length;
  const transitionalPointCount = points.filter((point) => point.source === "uploaded" && point.classification === "Transitional").length;
  const unstablePointCount = points.filter((point) => point.source === "uploaded" && point.classification === "Unstable").length;
  const status = points.length === 0 ? "No completed operating points" : uploadedPointCount === 0 ? "Demonstration only" : "Measured envelope";
  const nextRequirement = points.length === 0
    ? "Add the first measured operating point and its synchronized experimental pressure data."
    : uploadedPointCount === 0
      ? "Add a user-provided operating point. Synthetic runs never train or validate an envelope."
      : identifiedPointCount < uploadedPointCount
        ? "Resolve probe or signal limitations so every measured operating point has an identifiable experimental mode."
        : "Add more measured operating points until the predictive-model data and validation gates are met.";

  return { points, uploadedPointCount, demonstrationPointCount, identifiedPointCount, convergedPointCount, stablePointCount, transitionalPointCount, unstablePointCount, status, nextRequirement };
}

export function envelopeAxisValue(point: EnvelopePoint, axis: EnvelopeAxisKey) {
  return point[axis];
}
