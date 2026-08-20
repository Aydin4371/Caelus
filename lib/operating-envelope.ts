import { buildCaseHistoryEvidence } from "./case-history.ts";
import type { AnalysisCase } from "./caevera-types.ts";
import type { OperatingPoint } from "./design-workspace.ts";
import { assessSignalQuality } from "./rde-analysis.ts";
import { analyzeRdeProbeSet } from "./wave-dynamics.ts";

export type EnvelopeAxisKey = "equivalenceRatio" | "inletPressureBar" | "massFlowKgS" | "backPressureBar" | "inletTemperatureK";
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
  signalQuality: "Ready" | "Review" | "Not available";
  numericalStatus: EnvelopeNumericalStatus;
  runCount: number;
  cfdRerunCount: number;
  evidenceType: "Experiment only" | "Experiment + CFD" | "Published experiment summary";
  evidenceQuality: EnvelopeEvidenceQuality;
  modelUse: "Eligible observation" | "Published summary only" | "Demonstration only" | "Needs clearer mode data";
  evidenceOrigin: "Uploaded synchronized pressure data" | "Published summary table" | "Synthetic demonstration";
  reportedMode: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceLocator: string | null;
  evidenceFactors: Array<{ label: string; result: string; status: "passed" | "review" | "not-available" }>;
};

export type EnvelopeDataset = {
  points: EnvelopePoint[];
  uploadedPointCount: number;
  publishedPointCount: number;
  physicalPointCount: number;
  signalReadyPointCount: number;
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
  { key: "inletTemperatureK", label: "Inlet temperature", unit: "K" },
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
  if (point.source === "published") return "Published summary only";
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
    if (!experiment && operatingPoint.publishedObservation) {
      const observation = operatingPoint.publishedObservation;
      const point: EnvelopePoint = {
        operatingPointId: operatingPoint.id,
        caseId: operatingPoint.id,
        name: operatingPoint.name,
        source: operatingPoint.source,
        equivalenceRatio: operatingPoint.equivalenceRatio,
        inletPressureBar: operatingPoint.inletPressureBar,
        massFlowKgS: operatingPoint.massFlowKgS,
        backPressureBar: operatingPoint.backPressureBar,
        inletTemperatureK: operatingPoint.inletTemperatureK,
        classification: observation.classification,
        identifiability: "Identified",
        waveCount: observation.waveCount,
        waveFrequencyKHz: observation.waveFrequencyKHz,
        waveSpeedMps: null,
        meanPressureMpa: Number.NaN,
        frequencyVariationPct: Number.NaN,
        phaseJitterDeg: null,
        signalQuality: "Not available",
        numericalStatus: "Not checked",
        runCount: runs.length,
        cfdRerunCount: runs.filter((run) => run.relationship).length,
        evidenceType: "Published experiment summary",
        evidenceQuality: "Moderate",
        modelUse: "Published summary only",
        evidenceOrigin: "Published summary table",
        reportedMode: observation.reportedMode,
        sourceTitle: observation.sourceTitle,
        sourceUrl: observation.sourceUrl,
        sourceLocator: observation.sourceLocator,
        evidenceFactors: [
          { label: "Operating condition", result: "Directly transcribed from the published table", status: "passed" },
          { label: "Propagation mode", result: `Authors reported: ${observation.reportedMode}`, status: "passed" },
          { label: "Raw synchronized signals", result: "Not released with the paper", status: "not-available" },
          { label: "Predictive-model eligibility", result: "Excluded until raw signals or an independently validated import are available", status: "review" },
        ],
      };
      return [point];
    }
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
      evidenceOrigin: operatingPoint.source === "demo" ? "Synthetic demonstration" : "Uploaded synchronized pressure data",
      reportedMode: null,
      sourceTitle: null,
      sourceUrl: null,
      sourceLocator: null,
      evidenceFactors: [
        { label: "Probe synchronization", result: experiment.probeSynchronizationConfirmed ? "Confirmed on one acquisition time base" : "Not confirmed", status: experiment.probeSynchronizationConfirmed ? "passed" : "review" },
        { label: "Signal-quality checks", result: signalQuality === "Ready" ? "Sampling, continuity, clipping, and spectral checks passed" : "One or more signal checks require review", status: signalQuality === "Ready" ? "passed" : "review" },
        { label: "Wave-mode identification", result: identifiability === "Identified" ? "One mode is identified from the probe phases" : `${identifiability}; the mode result needs review`, status: identifiability === "Identified" ? "passed" : "review" },
        { label: "Predictive-model eligibility", result: operatingPoint.source === "demo" ? "Synthetic data are always excluded" : signalQuality === "Ready" && identifiability === "Identified" ? "Eligible as one observation; model gates still apply" : "Excluded until the evidence limitations are resolved", status: operatingPoint.source !== "demo" && signalQuality === "Ready" && identifiability === "Identified" ? "passed" : "review" },
      ],
    };
    point.modelUse = modelUse(point);
    return [point];
  });

  const uploadedPointCount = points.filter((point) => point.source === "uploaded").length;
  const publishedPointCount = points.filter((point) => point.source === "published").length;
  const physicalPointCount = uploadedPointCount + publishedPointCount;
  const signalReadyPointCount = points.filter((point) => point.source === "uploaded" && point.signalQuality === "Ready" && point.identifiability === "Identified").length;
  const demonstrationPointCount = points.filter((point) => point.source === "demo").length;
  const identifiedPointCount = points.filter((point) => point.identifiability === "Identified").length;
  const convergedPointCount = points.filter((point) => point.numericalStatus === "Converged").length;
  const stablePointCount = points.filter((point) => point.source !== "demo" && point.classification === "Stable").length;
  const transitionalPointCount = points.filter((point) => point.source !== "demo" && point.classification === "Transitional").length;
  const unstablePointCount = points.filter((point) => point.source !== "demo" && point.classification === "Unstable").length;
  const status = points.length === 0 ? "No completed operating points" : physicalPointCount === 0 ? "Demonstration only" : "Measured envelope";
  const nextRequirement = points.length === 0
    ? "Add the first measured operating point and its synchronized experimental pressure data."
    : physicalPointCount === 0
      ? "Add a user-provided operating point. Synthetic runs never train or validate an envelope."
      : publishedPointCount > 0 && uploadedPointCount === 0
        ? "Published summary points establish a real observed map. Add raw synchronized pressure files before validating the signal analysis or fitting a predictive model."
      : identifiedPointCount < uploadedPointCount
        ? "Resolve probe or signal limitations so every measured operating point has an identifiable experimental mode."
        : "Add more measured operating points until the predictive-model data and validation gates are met.";

  return { points, uploadedPointCount, publishedPointCount, physicalPointCount, signalReadyPointCount, demonstrationPointCount, identifiedPointCount, convergedPointCount, stablePointCount, transitionalPointCount, unstablePointCount, status, nextRequirement };
}

export function envelopeAxisValue(point: EnvelopePoint, axis: EnvelopeAxisKey) {
  return point[axis];
}
