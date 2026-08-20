import type { AnalysisCase } from "./caevera-types.ts";

export type RdeApplication = "Rocket" | "Air-breathing";

export type EngineDesign = {
  id: string;
  name: string;
  source: "user" | "demo";
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
  role: "Baseline" | "Equivalence-ratio bracket" | "Mass-flow bracket" | "Coupled boundary" | "Pressure bracket";
  equivalenceRatio: number;
  massFlowKgS: number;
  inletPressureBar: number;
  matchedCaseId: string | null;
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

export function validateEngineDesign(design: EngineDesign) {
  const issues: string[] = [];
  if (design.source !== "user" && design.source !== "demo") issues.push("Design source must be user or demonstration data.");
  if (design.application !== "Rocket" && design.application !== "Air-breathing") issues.push("Application must be rocket or air-breathing.");
  if (!design.name.trim()) issues.push("Design name is required.");
  if (!design.fuel.trim() || !design.oxidizer.trim()) issues.push("Fuel and oxidizer are required.");
  if (!design.injectorType.trim() || !design.wallCondition.trim() || !design.exhaustConfiguration.trim()) issues.push("Injector, wall, and exhaust definitions are required.");
  if (!(design.annulusInnerDiameterMm > 0)) issues.push("Annulus inner diameter must be greater than zero.");
  if (!(design.annulusOuterDiameterMm > design.annulusInnerDiameterMm)) issues.push("Annulus outer diameter must exceed the inner diameter.");
  if (!(design.chamberLengthMm > 0)) issues.push("Chamber length must be greater than zero.");
  if (!Number.isInteger(design.injectorCount) || design.injectorCount < 1) issues.push("Injector count must be a positive integer.");
  if (!(design.injectorDiameterMm > 0)) issues.push("Injector diameter must be greater than zero.");
  if (!(design.injectorAngleDeg >= 0 && design.injectorAngleDeg <= 90)) issues.push("Injector angle must be between 0 and 90 degrees.");
  if (!(design.plenumVolumeCm3 > 0)) issues.push("Plenum volume must be greater than zero.");
  if (!(design.equivalenceRatioMin > 0 && design.equivalenceRatioMax > design.equivalenceRatioMin)) issues.push("Equivalence-ratio maximum must exceed its positive minimum.");
  if (!(design.massFlowKgSMin > 0 && design.massFlowKgSMax > design.massFlowKgSMin)) issues.push("Mass-flow maximum must exceed its positive minimum.");
  if (!(design.inletPressureBarMin > 0 && design.inletPressureBarMax > design.inletPressureBarMin)) issues.push("Inlet-pressure maximum must exceed its positive minimum.");
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

function pointDistance(design: EngineDesign, point: Pick<PlannedOperatingPoint, "equivalenceRatio" | "massFlowKgS" | "inletPressureBar">, item: AnalysisCase) {
  const phi = normalize(point.equivalenceRatio, design.equivalenceRatioMin, design.equivalenceRatioMax) - normalize(item.metadata.equivalenceRatio, design.equivalenceRatioMin, design.equivalenceRatioMax);
  const mass = normalize(point.massFlowKgS, design.massFlowKgSMin, design.massFlowKgSMax) - normalize(item.metadata.massFlowKgS, design.massFlowKgSMin, design.massFlowKgSMax);
  const pressure = normalize(point.inletPressureBar, design.inletPressureBarMin, design.inletPressureBarMax) - normalize(item.metadata.inletPressureBar, design.inletPressureBarMin, design.inletPressureBarMax);
  return Math.hypot(phi, mass, pressure);
}

export function buildScreeningPlan(design: EngineDesign, cases: AnalysisCase[]): PlannedOperatingPoint[] {
  const phiMid = midpoint(design.equivalenceRatioMin, design.equivalenceRatioMax);
  const massMid = midpoint(design.massFlowKgSMin, design.massFlowKgSMax);
  const pressureMid = midpoint(design.inletPressureBarMin, design.inletPressureBarMax);
  const definitions: Omit<PlannedOperatingPoint, "matchedCaseId" | "nearestDistance">[] = [
    { id: "baseline", role: "Baseline", equivalenceRatio: phiMid, massFlowKgS: massMid, inletPressureBar: pressureMid },
    { id: "phi-low", role: "Equivalence-ratio bracket", equivalenceRatio: design.equivalenceRatioMin, massFlowKgS: massMid, inletPressureBar: pressureMid },
    { id: "phi-high", role: "Equivalence-ratio bracket", equivalenceRatio: design.equivalenceRatioMax, massFlowKgS: massMid, inletPressureBar: pressureMid },
    { id: "mass-low", role: "Mass-flow bracket", equivalenceRatio: phiMid, massFlowKgS: design.massFlowKgSMin, inletPressureBar: pressureMid },
    { id: "mass-high", role: "Mass-flow bracket", equivalenceRatio: phiMid, massFlowKgS: design.massFlowKgSMax, inletPressureBar: pressureMid },
    { id: "coupled-low", role: "Coupled boundary", equivalenceRatio: design.equivalenceRatioMin, massFlowKgS: design.massFlowKgSMin, inletPressureBar: pressureMid },
    { id: "coupled-high", role: "Coupled boundary", equivalenceRatio: design.equivalenceRatioMax, massFlowKgS: design.massFlowKgSMax, inletPressureBar: pressureMid },
    { id: "pressure-low", role: "Pressure bracket", equivalenceRatio: phiMid, massFlowKgS: massMid, inletPressureBar: design.inletPressureBarMin },
    { id: "pressure-high", role: "Pressure bracket", equivalenceRatio: phiMid, massFlowKgS: massMid, inletPressureBar: design.inletPressureBarMax },
  ];
  const observations = cases.filter((item) => !item.relationship && item.designId === design.id && item.source === "uploaded");
  return definitions.map((point) => {
    const ranked = observations
      .map((item) => ({ item, distance: pointDistance(design, point, item) }))
      .sort((left, right) => left.distance - right.distance);
    const nearest = ranked[0] ?? null;
    const matched = nearest && nearest.distance <= 0.03 ? nearest.item : null;
    return { ...point, matchedCaseId: matched?.id ?? null, nearestDistance: nearest?.distance ?? null };
  });
}

export function selectCoverageNextPoint(points: PlannedOperatingPoint[]) {
  const baseline = points.find((point) => point.role === "Baseline");
  if (baseline && baseline.nearestDistance === null) return baseline;
  const untested = points.filter((point) => !point.matchedCaseId);
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
