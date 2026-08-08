import type { AnalysisCase } from "./caevera-types.ts";
import { buildCaseAssessment, type CaseAssessment, type MetricAssessment } from "./diagnostics.ts";
import { analyzeRdeProbeSet, compareSignals, type RdeModeResult } from "./rde-analysis.ts";

export type CampaignSummary = {
  item: AnalysisCase;
  experiment: RdeModeResult;
  simulation: RdeModeResult;
  assessment: CaseAssessment;
  metrics: Record<string, MetricAssessment>;
};

export type CampaignDelta = {
  condition: {
    inletPressureBar: number;
    inletTemperatureK: number;
    equivalenceRatio: number;
    massFlowKgS: number;
  };
  experiment: {
    frequencyKHz: number;
    waveSpeedMps: number;
    pressureAmplitudeMpa: number;
    peakPressureMpa: number;
    cycleVariabilityPoints: number;
  };
  cfdAgreement: {
    frequencyErrorPointChange: number;
    peakPressureErrorPointChange: number;
    amplitudeErrorPointChange: number;
  };
};

function metric(summary: CampaignSummary, id: string) {
  return summary.metrics[id];
}

function numberValue(value: number | string) {
  return typeof value === "number" ? value : Number.NaN;
}

export function summarizeCampaignCase(item: AnalysisCase): CampaignSummary {
  const comparisons = item.testSignals.map((signal, index) => compareSignals(signal, item.cfdSignals[index]));
  const experiment = analyzeRdeProbeSet(item.testSignals, item.metadata.probePositionsDeg, item.metadata.annulusMeanDiameterMm);
  const simulation = analyzeRdeProbeSet(item.cfdSignals, item.metadata.probePositionsDeg, item.metadata.annulusMeanDiameterMm);
  const assessment = buildCaseAssessment(item.metadata, comparisons, experiment, simulation);
  return {
    item,
    experiment,
    simulation,
    assessment,
    metrics: Object.fromEntries(assessment.metrics.map((result) => [result.id, result])),
  };
}

export function buildCampaignDelta(baseline: CampaignSummary, candidate: CampaignSummary): CampaignDelta {
  const relativeError = (result: MetricAssessment) => Math.abs(result.percentDifference ?? 0);
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
