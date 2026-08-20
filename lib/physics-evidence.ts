import type { CaseMetadata, RdePhysicsMeasurements } from "./caevera-types.ts";

export type PhysicsLayerId = "wave" | "performance" | "feed" | "thermal" | "repeatability";
export type PhysicsLayerStatus = "supported" | "partial" | "not-measured";

export const PHYSICS_MEASUREMENT_DEFINITIONS: Array<{
  key: keyof RdePhysicsMeasurements;
  experimentKey: keyof CaseMetadata;
  cfdKey: keyof CaseMetadata;
  layer: Exclude<PhysicsLayerId, "wave">;
  label: string;
  unit: string;
  signed?: boolean;
}> = [
  { key: "netThrustN", experimentKey: "experimentNetThrustN", cfdKey: "cfdNetThrustN", layer: "performance", label: "Net thrust", unit: "N" },
  { key: "specificImpulseS", experimentKey: "experimentSpecificImpulseS", cfdKey: "cfdSpecificImpulseS", layer: "performance", label: "Specific impulse", unit: "s" },
  { key: "pressureGainPct", experimentKey: "experimentPressureGainPct", cfdKey: "cfdPressureGainPct", layer: "performance", label: "Total-pressure gain", unit: "%", signed: true },
  { key: "injectorPressureRatio", experimentKey: "experimentInjectorPressureRatio", cfdKey: "cfdInjectorPressureRatio", layer: "feed", label: "Injector pressure ratio", unit: "" },
  { key: "backflowFractionPct", experimentKey: "experimentBackflowFractionPct", cfdKey: "cfdBackflowFractionPct", layer: "feed", label: "Injector backflow duty cycle", unit: "%" },
  { key: "wallHeatFluxMWm2", experimentKey: "experimentWallHeatFluxMWm2", cfdKey: "cfdWallHeatFluxMWm2", layer: "thermal", label: "Wall heat flux", unit: "MW/m²" },
  { key: "peakWallTemperatureK", experimentKey: "experimentPeakWallTemperatureK", cfdKey: "cfdPeakWallTemperatureK", layer: "thermal", label: "Peak wall temperature", unit: "K" },
  { key: "sustainedDurationS", experimentKey: "experimentSustainedDurationS", cfdKey: "cfdSustainedDurationS", layer: "repeatability", label: "Sustained run duration", unit: "s" },
];

export type PhysicsComparisonRow = {
  key: keyof RdePhysicsMeasurements;
  layer: Exclude<PhysicsLayerId, "wave">;
  label: string;
  unit: string;
  experiment: number | null;
  cfd: number | null;
  difference: number | null;
};

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function experimentPhysicsFromMetadata(metadata: CaseMetadata): Partial<RdePhysicsMeasurements> {
  return Object.fromEntries(PHYSICS_MEASUREMENT_DEFINITIONS.map((item) => [item.key, finiteOrNull(metadata[item.experimentKey]) ?? Number.NaN])) as Partial<RdePhysicsMeasurements>;
}

export function cfdPhysicsFromMetadata(metadata: CaseMetadata): Partial<RdePhysicsMeasurements> {
  return Object.fromEntries(PHYSICS_MEASUREMENT_DEFINITIONS.map((item) => [item.key, finiteOrNull(metadata[item.cfdKey]) ?? Number.NaN])) as Partial<RdePhysicsMeasurements>;
}

export function physicsMetadataValues(physics: Partial<RdePhysicsMeasurements> | null | undefined) {
  return Object.fromEntries(PHYSICS_MEASUREMENT_DEFINITIONS.map((item) => [item.experimentKey, finiteOrNull(physics?.[item.key]) ?? Number.NaN])) as Partial<CaseMetadata>;
}

export function buildPhysicsComparison(metadata: CaseMetadata): PhysicsComparisonRow[] {
  return PHYSICS_MEASUREMENT_DEFINITIONS.map((item) => {
    const experiment = finiteOrNull(metadata[item.experimentKey]);
    const cfd = finiteOrNull(metadata[item.cfdKey]);
    return { ...item, experiment, cfd, difference: experiment !== null && cfd !== null ? cfd - experiment : null };
  });
}

export function physicsLayerCoverage(physics: Partial<RdePhysicsMeasurements> | null | undefined) {
  const layers: Array<Exclude<PhysicsLayerId, "wave">> = ["performance", "feed", "thermal", "repeatability"];
  return layers.map((layer) => {
    const definitions = PHYSICS_MEASUREMENT_DEFINITIONS.filter((item) => item.layer === layer);
    const available = definitions.filter((item) => finiteOrNull(physics?.[item.key]) !== null);
    const label = layer === "performance" ? "Performance" : layer === "feed" ? "Feed system" : layer === "thermal" ? "Thermal" : "Repeatability";
    const status: PhysicsLayerStatus = available.length === 0 ? "not-measured" : available.length === definitions.length ? "supported" : "partial";
    const summary = available.length === 0
      ? "No documented measurement loaded"
      : `${available.map((item) => item.label).join(" and ")} loaded`;
    return { id: layer, label, status, summary };
  });
}

export const PHYSICS_EVIDENCE_SOURCES = [
  {
    layer: "performance",
    title: "Experimental and Numerical Evaluation of Pressure Gain Combustion in a Rotating Detonation Engine",
    authors: "Rankin, Fotia, Paxson, Hoke, and Schauer",
    year: 2015,
    url: "https://doi.org/10.2514/6.2015-0877",
    contribution: "Primary experiment-and-simulation study supporting direct pressure-gain evaluation in an RDE.",
  },
  {
    layer: "performance",
    title: "Uncertainties and Limitations of Experimental Thrust and Pressure Gain Measurements in a Rotating Detonation Combustor",
    authors: "Feleo, Shepard, and Gamba",
    year: 2023,
    url: "https://www.osti.gov/biblio/1995215",
    contribution: "Primary experimental methods paper showing that thrust, specific impulse, and pressure gain require explicit definitions, corrections, and uncertainty accounting.",
  },
  {
    layer: "feed",
    title: "Experimental Investigation of a Rotating Detonation Engine Injector Temporal Response",
    authors: "Naples, Hoke, and Schauer",
    year: 2015,
    url: "https://doi.org/10.2514/6.2015-1104",
    contribution: "Primary injector-response experiment supporting time-resolved feed-system and backflow evidence.",
  },
  {
    layer: "thermal",
    title: "Experimental Investigation of Wall Heat Flux in a Rotating Detonation Rocket Engine",
    authors: "Lim, Heister, Humble, and Harroun",
    year: 2021,
    url: "https://doi.org/10.2514/1.A34840",
    contribution: "Primary experiment supporting wall heat-flux measurement as a distinct RDE evidence layer.",
  },
  {
    layer: "repeatability",
    title: "Experimental Research on a Long-Duration Operation of a Rotating Detonation Engine",
    authors: "Nishimura et al.",
    year: 2019,
    url: "https://doi.org/10.1007/978-3-319-91017-8_15",
    contribution: "Primary long-duration experiment supporting sustained-operation evidence beyond a short mode observation.",
  },
] as const;

export const PHYSICS_SOURCE_LIMITATION = "These papers support why and how the quantities are measured. They do not validate a user case, replace its measurements, or prove whole-engine performance.";
