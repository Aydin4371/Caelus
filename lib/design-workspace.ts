import type { FileImportProvenance } from "./data-import.ts";
import type { Signal } from "./rde-analysis.ts";
import type { RdePhysicsMeasurements } from "./caevera-types.ts";

export type RdeApplication = "Rocket" | "Air-breathing";

export type EngineDesign = {
  id: string;
  name: string;
  source: "user" | "published" | "demo";
  application: RdeApplication;
  fuel: string;
  oxidizer: string;
  annulusInnerDiameterMm: number;
  annulusOuterDiameterMm: number;
  chamberLengthMm: number;
  injectorType: string;
  injectorCount: number;
  injectorDiameterMm: number;
  injectorAngleDeg: number;
  plenumVolumeCm3: number;
  wallCondition: string;
  exhaustConfiguration: string;
  equivalenceRatioMin: number;
  equivalenceRatioMax: number;
  massFlowKgSMin: number;
  massFlowKgSMax: number;
  inletPressureBarMin: number;
  inletPressureBarMax: number;
  inletTemperatureK: number;
  backPressureBar: number;
};

export type OperatingPoint = {
  id: string;
  designId: string;
  name: string;
  source: "uploaded" | "published" | "demo";
  inletPressureBar: number;
  inletTemperatureK: number;
  equivalenceRatio: number;
  massFlowKgS: number;
  backPressureBar: number;
  experiment?: OperatingPointExperiment | null;
  publishedObservation?: PublishedOperatingPointObservation | null;
};

export type PublishedOperatingPointObservation = {
  sourceTitle: string;
  sourceUrl: string;
  sourceLocator: string;
  reportedMode: string;
  classification: "Stable" | "Transitional" | "Unstable";
  waveCount: number | null;
  waveFrequencyKHz: number;
  airMassFlowKgS: number;
  fuelMassFlowKgS: number;
  limitation: string;
  waveSpeedMps?: number | null;
  physics?: Partial<RdePhysicsMeasurements> | null;
  evidenceNotes?: Partial<Record<"performance" | "feed" | "thermal" | "repeatability", string>>;
};

export type OperatingPointExperiment = {
  signals: Signal[];
  importProvenance?: FileImportProvenance | null;
  annulusMeanDiameterMm: number;
  annulusDiameterUncertaintyMm: number;
  probePositionsDeg: number[];
  maximumWaveCount: number;
  probeSynchronizationConfirmed: boolean;
  experimentSensorBandwidthKHz: number;
  experimentFilterCutoffKHz: number;
  pressureUncertaintyPct: number;
  timingUncertaintyUs: number;
  physics?: Partial<RdePhysicsMeasurements> | null;
};

export type DesignCalculations = {
  meanDiameterMm: number;
  annulusGapMm: number;
  annulusAreaMm2: number;
  chamberVolumeCm3: number;
  injectorAreaMm2: number;
  injectorAreaRatioPct: number;
  annulusMassFluxMinKgM2S: number;
  annulusMassFluxMaxKgM2S: number;
  injectorMassFluxMinKgM2S: number;
  injectorMassFluxMaxKgM2S: number;
  minimumPressureRatio: number;
  maximumPressureRatio: number;
};

export type PlannedOperatingPoint = {
  id: string;
  role: "Baseline" | "Equivalence-ratio bracket" | "Mass-flow bracket" | "Coupled boundary" | "Pressure bracket" | "Uncertain boundary";
  equivalenceRatio: number;
  massFlowKgS: number;
  inletPressureBar: number;
  inletTemperatureK: number;
  matchedOperatingPointId: string | null;
  nearestDistance: number | null;
};

export const EMPTY_ENGINE_DESIGN: EngineDesign = {
  id: "",
  name: "",
  source: "user",
  application: "Rocket",
  fuel: "Hydrogen",
  oxidizer: "Air",
  annulusInnerDiameterMm: Number.NaN,
  annulusOuterDiameterMm: Number.NaN,
  chamberLengthMm: Number.NaN,
  injectorType: "Discrete orifices",
  injectorCount: Number.NaN,
  injectorDiameterMm: Number.NaN,
  injectorAngleDeg: 0,
  plenumVolumeCm3: Number.NaN,
  wallCondition: "Documented test condition",
  exhaustConfiguration: "Open exit",
  equivalenceRatioMin: Number.NaN,
  equivalenceRatioMax: Number.NaN,
  massFlowKgSMin: Number.NaN,
  massFlowKgSMax: Number.NaN,
  inletPressureBarMin: Number.NaN,
  inletPressureBarMax: Number.NaN,
  inletTemperatureK: Number.NaN,
  backPressureBar: Number.NaN,
};

export function cloneEngineDesign(design: EngineDesign): EngineDesign {
  return { ...design };
}

export function cloneOperatingPoint(point: OperatingPoint): OperatingPoint {
  return {
    ...point,
    experiment: point.experiment ? {
      ...point.experiment,
      physics: point.experiment.physics ? { ...point.experiment.physics } : point.experiment.physics,
      probePositionsDeg: [...point.experiment.probePositionsDeg],
      signals: point.experiment.signals.map((signal) => ({ ...signal, time: [...signal.time], pressure: [...signal.pressure] })),
    } : point.experiment,
    publishedObservation: point.publishedObservation ? {
      ...point.publishedObservation,
      physics: point.publishedObservation.physics ? { ...point.publishedObservation.physics } : point.publishedObservation.physics,
      evidenceNotes: point.publishedObservation.evidenceNotes ? { ...point.publishedObservation.evidenceNotes } : point.publishedObservation.evidenceNotes,
    } : point.publishedObservation,
  };
}

export function validateOperatingPoint(point: OperatingPoint) {
  const issues: string[] = [];
  if (!point.id) issues.push("Operating-point identifier is required.");
  if (!point.designId) issues.push("An engine design is required.");
  if (!point.name.trim()) issues.push("Operating-point name is required.");
  if (point.source !== "uploaded" && point.source !== "published" && point.source !== "demo") issues.push("Operating-point source must be uploaded, published, or demonstration data.");
  if (point.source !== "published" && !(point.inletPressureBar > 0)) issues.push("Inlet pressure must be greater than zero.");
  if (!(point.inletTemperatureK > 0)) issues.push("Inlet temperature must be greater than zero.");
  if (!(point.equivalenceRatio > 0)) issues.push("Equivalence ratio must be greater than zero.");
  if (!(point.massFlowKgS > 0)) issues.push("Mass flow must be greater than zero.");
  if (!(point.backPressureBar > 0)) issues.push("Back pressure must be greater than zero.");
  if (Number.isFinite(point.inletPressureBar) && Number.isFinite(point.backPressureBar) && point.inletPressureBar <= point.backPressureBar) issues.push("Inlet pressure must exceed back pressure.");
  if (point.source === "published") {
    const observation = point.publishedObservation;
    if (!observation?.sourceTitle.trim() || !observation.sourceUrl.trim() || !observation.sourceLocator.trim()) issues.push("Published operating points require a traceable source citation.");
    if (!observation?.reportedMode.trim()) issues.push("Published operating points require the mode reported by the source.");
    if (!observation || !["Stable", "Transitional", "Unstable"].includes(observation.classification)) issues.push("Published operating points require a mapped stability class.");
  }
  if (point.experiment) {
    const experiment = point.experiment;
    if (!(experiment.annulusMeanDiameterMm > 0)) issues.push("Experiment annulus mean diameter must be greater than zero.");
    if (!(experiment.annulusDiameterUncertaintyMm >= 0)) issues.push("Experiment diameter uncertainty must be zero or greater.");
    if (!Array.isArray(experiment.probePositionsDeg) || experiment.probePositionsDeg.length < 3 || experiment.probePositionsDeg.some((value) => !Number.isFinite(value))) issues.push("Experiment requires at least three valid probe angles.");
    if (!Number.isInteger(experiment.maximumWaveCount) || experiment.maximumWaveCount < 1 || experiment.maximumWaveCount > 12) issues.push("Experiment maximum wave count must be an integer from 1 to 12.");
    if (!experiment.probeSynchronizationConfirmed) issues.push("Experiment probe synchronization must be confirmed.");
    if (!(experiment.experimentSensorBandwidthKHz > 0) || !(experiment.experimentFilterCutoffKHz > 0)) issues.push("Experiment bandwidth and filter cutoff must be greater than zero.");
    if (!(experiment.pressureUncertaintyPct >= 0) || !(experiment.timingUncertaintyUs >= 0)) issues.push("Experiment uncertainty values must be zero or greater.");
    if (!Array.isArray(experiment.signals) || experiment.signals.length !== experiment.probePositionsDeg.length) issues.push("Experiment signals must match the saved probe angles.");
    const physics = experiment.physics;
    if (physics) {
      const nonnegative = [physics.netThrustN, physics.specificImpulseS, physics.injectorPressureRatio, physics.backflowFractionPct, physics.wallHeatFluxMWm2, physics.peakWallTemperatureK, physics.sustainedDurationS];
      if (nonnegative.some((value) => value != null && Number.isFinite(value) && value < 0)) issues.push("Optional engine-physics measurements must be zero or greater, except pressure gain, which may be negative.");
    }
  }
  return issues;
}

export function operatingPointLabel(point: Pick<OperatingPoint, "inletPressureBar" | "massFlowKgS" | "equivalenceRatio" | "backPressureBar">) {
  const inlet = Number.isFinite(point.inletPressureBar) ? `${point.inletPressureBar.toFixed(2)} bar inlet` : "inlet pressure not reported";
  const back = Number.isFinite(point.backPressureBar) ? `Pb ${point.backPressureBar.toFixed(2)} bar` : "back pressure not reported";
  return `${inlet} · ${point.massFlowKgS.toFixed(3)} kg/s · φ ${point.equivalenceRatio.toFixed(2)} · ${back}`;
}

export function validateEngineDesign(design: EngineDesign) {
  const issues: string[] = [];
  if (design.source !== "user" && design.source !== "published" && design.source !== "demo") issues.push("Design source must be user, published, or demonstration data.");
  if (design.application !== "Rocket" && design.application !== "Air-breathing") issues.push("Application must be rocket or air-breathing.");
  if (!design.name.trim()) issues.push("Design name is required.");
  if (!design.fuel.trim() || !design.oxidizer.trim()) issues.push("Fuel and oxidizer are required.");
  if (!design.injectorType.trim() || !design.wallCondition.trim() || !design.exhaustConfiguration.trim()) issues.push("Injector, wall, and exhaust definitions are required.");
  if (!(design.annulusInnerDiameterMm > 0)) issues.push("Annulus inner diameter must be greater than zero.");
  if (!(design.annulusOuterDiameterMm > design.annulusInnerDiameterMm)) issues.push("Annulus outer diameter must exceed the inner diameter.");
  if (!(design.chamberLengthMm > 0)) issues.push("Chamber length must be greater than zero.");
  if (!Number.isInteger(design.injectorCount) || design.injectorCount < 1) issues.push("Injector count must be a positive integer.");
  if (design.source !== "published" && !(design.injectorDiameterMm > 0)) issues.push("Injector diameter must be greater than zero.");
  if (design.source !== "published" && !(design.injectorAngleDeg >= 0 && design.injectorAngleDeg <= 90)) issues.push("Injector angle must be between 0 and 90 degrees.");
  if (design.source !== "published" && !(design.plenumVolumeCm3 > 0)) issues.push("Plenum volume must be greater than zero.");
  if (!(design.equivalenceRatioMin > 0 && design.equivalenceRatioMax > design.equivalenceRatioMin)) issues.push("Equivalence-ratio maximum must exceed its positive minimum.");
  if (!(design.massFlowKgSMin > 0 && design.massFlowKgSMax > design.massFlowKgSMin)) issues.push("Mass-flow maximum must exceed its positive minimum.");
  if (design.source !== "published" && !(design.inletPressureBarMin > 0 && design.inletPressureBarMax > design.inletPressureBarMin)) issues.push("Inlet-pressure maximum must exceed its positive minimum.");
  if (!(design.inletTemperatureK > 0)) issues.push("Inlet temperature must be greater than zero.");
  if (!(design.backPressureBar > 0)) issues.push("Back pressure must be greater than zero.");
  if (Number.isFinite(design.inletPressureBarMin) && Number.isFinite(design.backPressureBar) && design.inletPressureBarMin <= design.backPressureBar) issues.push("The full inlet-pressure range must exceed the entered back pressure.");
  return issues;
}

export function calculateDesign(design: EngineDesign): DesignCalculations {
  const meanDiameterMm = 0.5 * (design.annulusOuterDiameterMm + design.annulusInnerDiameterMm);
  const annulusGapMm = 0.5 * (design.annulusOuterDiameterMm - design.annulusInnerDiameterMm);
  const annulusAreaMm2 = Math.PI * 0.25 * (design.annulusOuterDiameterMm ** 2 - design.annulusInnerDiameterMm ** 2);
  const chamberVolumeCm3 = annulusAreaMm2 * design.chamberLengthMm / 1000;
  const injectorAreaMm2 = design.injectorCount * Math.PI * 0.25 * design.injectorDiameterMm ** 2;
  const annulusAreaM2 = annulusAreaMm2 * 1e-6;
  const injectorAreaM2 = injectorAreaMm2 * 1e-6;
  return {
    meanDiameterMm,
    annulusGapMm,
    annulusAreaMm2,
    chamberVolumeCm3,
    injectorAreaMm2,
    injectorAreaRatioPct: 100 * injectorAreaMm2 / annulusAreaMm2,
    annulusMassFluxMinKgM2S: design.massFlowKgSMin / annulusAreaM2,
    annulusMassFluxMaxKgM2S: design.massFlowKgSMax / annulusAreaM2,
    injectorMassFluxMinKgM2S: design.massFlowKgSMin / injectorAreaM2,
    injectorMassFluxMaxKgM2S: design.massFlowKgSMax / injectorAreaM2,
    minimumPressureRatio: design.inletPressureBarMin / design.backPressureBar,
    maximumPressureRatio: design.inletPressureBarMax / design.backPressureBar,
  };
}

function midpoint(low: number, high: number) {
  return 0.5 * (low + high);
}

function normalize(value: number, low: number, high: number) {
  return (value - low) / Math.max(high - low, 1e-12);
}

function pointDistance(design: EngineDesign, point: Pick<PlannedOperatingPoint, "equivalenceRatio" | "massFlowKgS" | "inletPressureBar">, item: OperatingPoint) {
  const phi = normalize(point.equivalenceRatio, design.equivalenceRatioMin, design.equivalenceRatioMax) - normalize(item.equivalenceRatio, design.equivalenceRatioMin, design.equivalenceRatioMax);
  const mass = normalize(point.massFlowKgS, design.massFlowKgSMin, design.massFlowKgSMax) - normalize(item.massFlowKgS, design.massFlowKgSMin, design.massFlowKgSMax);
  const pressure = normalize(point.inletPressureBar, design.inletPressureBarMin, design.inletPressureBarMax) - normalize(item.inletPressureBar, design.inletPressureBarMin, design.inletPressureBarMax);
  return Math.hypot(phi, mass, pressure);
}

export function buildScreeningPlan(design: EngineDesign, operatingPoints: OperatingPoint[]): PlannedOperatingPoint[] {
  const phiMid = midpoint(design.equivalenceRatioMin, design.equivalenceRatioMax);
  const massMid = midpoint(design.massFlowKgSMin, design.massFlowKgSMax);
  const pressureMid = midpoint(design.inletPressureBarMin, design.inletPressureBarMax);
  const definitions: Omit<PlannedOperatingPoint, "matchedOperatingPointId" | "nearestDistance">[] = [
    { id: "baseline", role: "Baseline", equivalenceRatio: phiMid, massFlowKgS: massMid, inletPressureBar: pressureMid, inletTemperatureK: design.inletTemperatureK },
    { id: "phi-low", role: "Equivalence-ratio bracket", equivalenceRatio: design.equivalenceRatioMin, massFlowKgS: massMid, inletPressureBar: pressureMid, inletTemperatureK: design.inletTemperatureK },
    { id: "phi-high", role: "Equivalence-ratio bracket", equivalenceRatio: design.equivalenceRatioMax, massFlowKgS: massMid, inletPressureBar: pressureMid, inletTemperatureK: design.inletTemperatureK },
    { id: "mass-low", role: "Mass-flow bracket", equivalenceRatio: phiMid, massFlowKgS: design.massFlowKgSMin, inletPressureBar: pressureMid, inletTemperatureK: design.inletTemperatureK },
    { id: "mass-high", role: "Mass-flow bracket", equivalenceRatio: phiMid, massFlowKgS: design.massFlowKgSMax, inletPressureBar: pressureMid, inletTemperatureK: design.inletTemperatureK },
    { id: "coupled-low", role: "Coupled boundary", equivalenceRatio: design.equivalenceRatioMin, massFlowKgS: design.massFlowKgSMin, inletPressureBar: pressureMid, inletTemperatureK: design.inletTemperatureK },
    { id: "coupled-high", role: "Coupled boundary", equivalenceRatio: design.equivalenceRatioMax, massFlowKgS: design.massFlowKgSMax, inletPressureBar: pressureMid, inletTemperatureK: design.inletTemperatureK },
    { id: "pressure-low", role: "Pressure bracket", equivalenceRatio: phiMid, massFlowKgS: massMid, inletPressureBar: design.inletPressureBarMin, inletTemperatureK: design.inletTemperatureK },
    { id: "pressure-high", role: "Pressure bracket", equivalenceRatio: phiMid, massFlowKgS: massMid, inletPressureBar: design.inletPressureBarMax, inletTemperatureK: design.inletTemperatureK },
  ];
  const observations = operatingPoints.filter((item) => item.designId === design.id && item.source === "uploaded");
  return definitions.map((point) => {
    const ranked = observations
      .map((item) => ({ item, distance: pointDistance(design, point, item) }))
      .sort((left, right) => left.distance - right.distance);
    const nearest = ranked[0] ?? null;
    const matched = nearest && nearest.distance <= 0.03 ? nearest.item : null;
    return { ...point, matchedOperatingPointId: matched?.id ?? null, nearestDistance: nearest?.distance ?? null };
  });
}

export function selectCoverageNextPoint(points: PlannedOperatingPoint[]) {
  const baseline = points.find((point) => point.role === "Baseline");
  if (baseline && baseline.nearestDistance === null) return baseline;
  const untested = points.filter((point) => !point.matchedOperatingPointId);
  if (!untested.length) return null;
  return [...untested].sort((left, right) => {
    const rightDistance = right.nearestDistance ?? Number.POSITIVE_INFINITY;
    const leftDistance = left.nearestDistance ?? Number.POSITIVE_INFINITY;
    if (rightDistance !== leftDistance) return rightDistance - leftDistance;
    return left.id.localeCompare(right.id);
  })[0];
}

export function designFileName(design: EngineDesign, extension: "json" | "csv") {
  const safeName = design.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "engine-design";
  return `${safeName}-screening-plan.${extension}`;
}
