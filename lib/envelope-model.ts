import type { EngineDesign } from "./design-workspace.ts";
import type { EnvelopeAxisKey, EnvelopeClassification, EnvelopePoint } from "./operating-envelope.ts";

export const ENVELOPE_MODEL_MINIMUM_POINTS = 12;
export const PROSPECTIVE_VALIDATION_MINIMUM_POINTS = 5;
const SUPPORT_RADIUS = 0.48;
const KERNEL_BANDWIDTH = 0.24;

export type EnvelopeFeatures = Pick<EnvelopePoint, "inletPressureBar" | "massFlowKgS" | "equivalenceRatio" | "backPressureBar" | "inletTemperatureK">;

export type EnvelopePrediction = {
  supported: boolean;
  classification: Exclude<EnvelopeClassification, "Unclassified"> | null;
  stabilityProbabilities: Record<"Stable" | "Transitional" | "Unstable", number>;
  waveModeProbabilities: Record<string, number>;
  uncertainty: number;
  nearestDistance: number;
  neighborCount: number;
};

export type EnvelopeModel = {
  status: "Not ready yet" | "Exploratory model ready";
  reason: string;
  observationCount: number;
  classCount: number;
  leaveOneOutAccuracy: number | null;
  leaveOneOutCoverage: number;
  prospectiveCount: number;
  prospectiveAccuracy: number | null;
  prospectiveBrierScore: number | null;
  validationLevel: "Not fitted" | "Retrospective only" | "Prospective gate in progress" | "Prototype prospective gate passed";
  gates: Array<{ id: "observations" | "classes" | "validation" | "prospective"; label: string; value: string; passed: boolean; detail: string }>;
  points: EnvelopePoint[];
  predict: (features: EnvelopeFeatures) => EnvelopePrediction;
};

type Domain = Record<keyof EnvelopeFeatures, readonly [number, number]>;

function observedRange(values: number[], fallback: number): readonly [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [Math.max(0.01, fallback * 0.75), Math.max(0.02, fallback * 1.25)];
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  if (high > low) return [low, high];
  const span = Math.max(Math.abs(low) * 0.25, 0.1);
  return [Math.max(0.001, low - span), high + span];
}

function preferredRange(low: number, high: number, values: number[], fallback: number): readonly [number, number] {
  return Number.isFinite(low) && Number.isFinite(high) && high > low ? [low, high] : observedRange(values, fallback);
}

export function envelopeModelDomain(design: EngineDesign, points: EnvelopePoint[]): Domain {
  return {
    inletPressureBar: preferredRange(design.inletPressureBarMin, design.inletPressureBarMax, points.map((point) => point.inletPressureBar), 1),
    massFlowKgS: preferredRange(design.massFlowKgSMin, design.massFlowKgSMax, points.map((point) => point.massFlowKgS), 1),
    equivalenceRatio: preferredRange(design.equivalenceRatioMin, design.equivalenceRatioMax, points.map((point) => point.equivalenceRatio), 1),
    backPressureBar: observedRange(points.map((point) => point.backPressureBar), design.backPressureBar),
    inletTemperatureK: observedRange(points.map((point) => point.inletTemperatureK), design.inletTemperatureK),
  };
}

function normalizedDistance(left: EnvelopeFeatures, right: EnvelopeFeatures, domain: Domain) {
  const keys = Object.keys(domain) as (keyof EnvelopeFeatures)[];
  const squared = keys.map((key) => {
    const limits = domain[key];
    const span = Math.max(limits[1] - limits[0], 1e-12);
    return ((left[key] - right[key]) / span) ** 2;
  });
  return Math.sqrt(squared.reduce((sum, value) => sum + value, 0));
}

function emptyPrediction(nearestDistance = Number.POSITIVE_INFINITY): EnvelopePrediction {
  return {
    supported: false,
    classification: null,
    stabilityProbabilities: { Stable: 0, Transitional: 0, Unstable: 0 },
    waveModeProbabilities: {},
    uncertainty: 1,
    nearestDistance,
    neighborCount: 0,
  };
}

function predictor(points: EnvelopePoint[], domain: Domain) {
  return (features: EnvelopeFeatures, excludedCaseId?: string, exclusionBuffer = 0): EnvelopePrediction => {
    const ranked = points
      .filter((point) => point.caseId !== excludedCaseId && (!exclusionBuffer || normalizedDistance(features, point, domain) > exclusionBuffer))
      .map((point) => ({ point, distance: normalizedDistance(features, point, domain) }))
      .sort((left, right) => left.distance - right.distance);
    const nearestDistance = ranked[0]?.distance ?? Number.POSITIVE_INFINITY;
    const neighbors = ranked.filter((item) => item.distance <= SUPPORT_RADIUS);
    if (neighbors.length < 3) return emptyPrediction(nearestDistance);
    const stabilityWeights = { Stable: 0.05, Transitional: 0.05, Unstable: 0.05 };
    const waveWeights = new Map<string, number>();
    let total = 0.15;
    for (const item of neighbors) {
      const weight = Math.exp(-0.5 * (item.distance / KERNEL_BANDWIDTH) ** 2) * (item.point.evidenceQuality === "High" ? 1 : item.point.evidenceQuality === "Moderate" ? 0.75 : 0.4);
      if (item.point.classification !== "Unclassified") stabilityWeights[item.point.classification] += weight;
      if (item.point.waveCount) waveWeights.set(String(item.point.waveCount), (waveWeights.get(String(item.point.waveCount)) ?? 0) + weight);
      total += weight;
    }
    const probabilities = {
      Stable: stabilityWeights.Stable / total,
      Transitional: stabilityWeights.Transitional / total,
      Unstable: stabilityWeights.Unstable / total,
    };
    const rankedClasses = (Object.entries(probabilities) as [Exclude<EnvelopeClassification, "Unclassified">, number][]).sort((left, right) => right[1] - left[1]);
    const entropy = -rankedClasses.reduce((sum, [, probability]) => probability > 0 ? sum + probability * Math.log(probability) : sum, 0) / Math.log(3);
    const distanceUncertainty = Math.min(1, nearestDistance / SUPPORT_RADIUS);
    const waveTotal = [...waveWeights.values()].reduce((sum, value) => sum + value, 0);
    return {
      supported: true,
      classification: rankedClasses[0][0],
      stabilityProbabilities: probabilities,
      waveModeProbabilities: Object.fromEntries([...waveWeights.entries()].map(([mode, weight]) => [mode, waveTotal ? weight / waveTotal : 0])),
      uncertainty: Math.min(1, Math.max(entropy, distanceUncertainty * 0.8)),
      nearestDistance,
      neighborCount: neighbors.length,
    };
  };
}

export function fitEnvelopeModel(allPoints: EnvelopePoint[], design: EngineDesign): EnvelopeModel {
  const points = allPoints.filter((point) => point.source === "uploaded" && point.classification !== "Unclassified" && point.signalQuality === "Ready");
  const classes = new Set(points.map((point) => point.classification));
  const domain = envelopeModelDomain(design, points);
  const predictRaw = predictor(points, domain);
  const leaveOneOut = points.map((point) => predictRaw(point, point.caseId, 0.08)).filter((prediction) => prediction.supported);
  const supportedResults = points.flatMap((point) => {
    const prediction = predictRaw(point, point.caseId, 0.08);
    return prediction.supported ? [{ actual: point.classification, predicted: prediction.classification }] : [];
  });
  const observedClasses = [...new Set(supportedResults.map((result) => result.actual))];
  const perClassAccuracy = observedClasses.map((classification) => {
    const classResults = supportedResults.filter((result) => result.actual === classification);
    return classResults.filter((result) => result.predicted === classification).length / classResults.length;
  });
  const accuracy = perClassAccuracy.length ? perClassAccuracy.reduce((sum, value) => sum + value, 0) / perClassAccuracy.length : null;
  const prospective = points.flatMap((point) => {
    const snapshot = point.recommendation;
    if (!snapshot || snapshot.kind !== "uncertain-boundary" || !snapshot.predictedClass || !snapshot.stabilityProbabilities) return [];
    const actual = point.classification as "Stable" | "Transitional" | "Unstable";
    const probabilities = snapshot.stabilityProbabilities;
    const brier = (["Stable", "Transitional", "Unstable"] as const).reduce((sum, label) => sum + (probabilities[label] - (label === actual ? 1 : 0)) ** 2, 0) / 3;
    return [{ correct: snapshot.predictedClass === actual, brier }];
  });
  const prospectiveAccuracy = prospective.length ? prospective.filter((item) => item.correct).length / prospective.length : null;
  const prospectiveBrierScore = prospective.length ? prospective.reduce((sum, item) => sum + item.brier, 0) / prospective.length : null;
  const retrospectivePassed = points.length >= ENVELOPE_MODEL_MINIMUM_POINTS && classes.size >= 2 && accuracy !== null && accuracy >= 0.6 && leaveOneOut.length / points.length >= 0.7;
  const prospectivePassed = prospective.length >= PROSPECTIVE_VALIDATION_MINIMUM_POINTS && prospectiveAccuracy !== null && prospectiveAccuracy >= 0.6 && prospectiveBrierScore !== null && prospectiveBrierScore <= 0.22;
  let reason = "The exploratory model is available only after enough real, signal-ready experimental operating points cover at least two observed stability classes.";
  let status: EnvelopeModel["status"] = "Not ready yet";
  if (points.length < ENVELOPE_MODEL_MINIMUM_POINTS) {
    reason = `${points.length} of ${ENVELOPE_MODEL_MINIMUM_POINTS} required real, signal-ready experimental operating points are available.`;
  } else if (classes.size < 2) {
    reason = "At least two measured stability classes are required before Kythros can estimate a boundary.";
  } else if (!retrospectivePassed) {
    reason = "Buffered leave-one-condition-out validation has not reached 60% balanced accuracy with at least 70% prediction coverage.";
  } else {
    status = "Exploratory model ready";
    reason = `The local kernel model passed its data and leave-one-out gates at ${(accuracy * 100).toFixed(0)}% accuracy. Predictions remain unavailable outside measured support.`;
  }
  return {
    status,
    reason,
    observationCount: points.length,
    classCount: classes.size,
    leaveOneOutAccuracy: accuracy,
    leaveOneOutCoverage: points.length ? leaveOneOut.length / points.length : 0,
    prospectiveCount: prospective.length,
    prospectiveAccuracy,
    prospectiveBrierScore,
    validationLevel: status !== "Exploratory model ready" ? "Not fitted" : prospectivePassed ? "Prototype prospective gate passed" : prospective.length ? "Prospective gate in progress" : "Retrospective only",
    gates: [
      { id: "observations", label: "Signal-ready measured points", value: `${points.length} / ${ENVELOPE_MODEL_MINIMUM_POINTS}`, passed: points.length >= ENVELOPE_MODEL_MINIMUM_POINTS, detail: "Only uploaded synchronized pressure data with an identified mode count here; published summaries and synthetic data do not." },
      { id: "classes", label: "Observed stability classes", value: `${classes.size} / 2`, passed: classes.size >= 2, detail: "At least two classes are needed to estimate a boundary instead of only describing one regime." },
      { id: "validation", label: "Buffered holdout validation", value: accuracy === null ? "Not tested" : `${(accuracy * 100).toFixed(0)}% accuracy · ${(points.length ? leaveOneOut.length / points.length * 100 : 0).toFixed(0)}% coverage`, passed: retrospectivePassed, detail: "Each condition is predicted without itself. The exploratory gate requires at least 60% balanced accuracy and 70% supported holdouts." },
      { id: "prospective", label: "Blind recommended tests", value: `${prospective.length} / ${PROSPECTIVE_VALIDATION_MINIMUM_POINTS}`, passed: prospectivePassed, detail: prospective.length ? `Predictions were saved before measurement. Accuracy ${prospectiveAccuracy === null ? "not available" : `${(prospectiveAccuracy * 100).toFixed(0)}%`}; three-class Brier score ${prospectiveBrierScore === null ? "not available" : prospectiveBrierScore.toFixed(3)} (0 best; 0.667 worst).` : "Run model-recommended points after the model snapshot is saved. These results must not be used to rewrite the prediction they test." },
    ],
    points,
    predict: status === "Exploratory model ready" ? (features) => predictRaw(features) : () => emptyPrediction(),
  };
}

export const ENVELOPE_VALIDATION_SOURCES = [
  {
    title: "Assessing the performance of spatial cross-validation approaches for models of spatially structured data",
    authors: "Mahoney et al.",
    year: 2023,
    url: "https://arxiv.org/abs/2303.07334",
    contribution: "Supports separated or buffered holdouts when neighboring observations are dependent and ordinary random validation can be optimistic.",
  },
  {
    title: "Active Learning with Statistical Models",
    authors: "Cohn, Ghahramani, and Jordan",
    year: 1996,
    url: "https://doi.org/10.1613/jair.295",
    contribution: "Supports choosing new observations to reduce predictive uncertainty rather than simply filling a grid.",
  },
] as const;

export type BoundaryRecommendation = {
  features: EnvelopeFeatures;
  prediction: EnvelopePrediction;
  score: number;
} | null;

export function recommendBoundaryPoint(
  model: EnvelopeModel,
  domain: Domain,
  xAxis: EnvelopeAxisKey,
  yAxis: EnvelopeAxisKey,
  fixed: EnvelopeFeatures,
): BoundaryRecommendation {
  if (model.status !== "Exploratory model ready") return null;
  const candidates: Exclude<BoundaryRecommendation, null>[] = [];
  for (let xi = 0; xi < 15; xi += 1) {
    for (let yi = 0; yi < 15; yi += 1) {
      const features = { ...fixed };
      features[xAxis] = domain[xAxis][0] + (xi / 14) * (domain[xAxis][1] - domain[xAxis][0]);
      features[yAxis] = domain[yAxis][0] + (yi / 14) * (domain[yAxis][1] - domain[yAxis][0]);
      const prediction = model.predict(features);
      if (!prediction.supported || prediction.nearestDistance < 0.06) continue;
      const probabilities = Object.values(prediction.stabilityProbabilities).sort((left, right) => right - left);
      const boundaryAmbiguity = 1 - (probabilities[0] - probabilities[1]);
      if (boundaryAmbiguity < 0.55) continue;
      candidates.push({ features, prediction, score: 0.7 * boundaryAmbiguity + 0.3 * prediction.uncertainty });
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
}
