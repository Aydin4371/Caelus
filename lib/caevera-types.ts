import type { Signal } from "./rde-analysis.ts";
import type { FileImportProvenance } from "./data-import.ts";

export type Dimensionality = "2D" | "3D" | "";

export type SensitivityVariable = "mesh" | "time-step" | "chemistry" | "inlet" | "wall" | "initialization" | "unsteadiness" | "other";

export type CaseRelationship = {
  baselineCaseId: string;
  referenceCaseId?: string;
  changedVariable: SensitivityVariable;
  description: string;
};

export type CaseMetadata = {
  name: string;
  annulusMeanDiameterMm: number;
  annulusDiameterUncertaintyMm: number;
  probePositionsDeg: number[];
  maximumWaveCount: number;
  probeSynchronizationConfirmed: boolean;
  experimentSensorBandwidthKHz: number;
  experimentFilterCutoffKHz: number;
  inletPressureBar: number;
  inletTemperatureK: number;
  equivalenceRatio: number;
  massFlowKgS: number;
  backPressureBar: number;
  comparisonMatchConfirmed: boolean;
  solver: string;
  solverVersion: string;
  dimensionality: Dimensionality;
  spatialScheme: string;
  spatialOrder: number;
  numericalFlux: string;
  limiterFilter: string;
  temporalScheme: string;
  temporalOrder: number;
  cfl: number;
  turbulenceModel: string;
  combustionModel: string;
  chemistryModel: string;
  chemistrySpecies: number;
  chemistryReactions: number;
  chemistryIntegrator: string;
  meshCells: number;
  minimumCellSizeMm: number;
  cellsPerInductionLength: number;
  nearWallCellSizeMm: number;
  timeStepUs: number;
  solverRuntimeHours: number;
  wallBoundaryCondition: string;
  inletBoundaryCondition: string;
  outletBoundaryCondition: string;
  initializationMethod: string;
  meshConvergencePct: number;
  timeStepConvergencePct: number;
  pressureUncertaintyPct: number;
  timingUncertaintyUs: number;
  cfdPressureUncertaintyPct: number;
  cfdTimingUncertaintyUs: number;
};

export type AnalysisCase = {
  id: string;
  designId?: string | null;
  operatingPointId?: string | null;
  source: "uploaded" | "demo";
  relationship?: CaseRelationship | null;
  metadata: CaseMetadata;
  testSignals: Signal[];
  cfdSignals: Signal[];
  imports?: { experiment: FileImportProvenance; cfd: FileImportProvenance } | null;
};

export const EMPTY_METADATA: CaseMetadata = {
  name: "",
  annulusMeanDiameterMm: Number.NaN,
  annulusDiameterUncertaintyMm: Number.NaN,
  probePositionsDeg: [Number.NaN, Number.NaN, Number.NaN],
  maximumWaveCount: 4,
  probeSynchronizationConfirmed: false,
  experimentSensorBandwidthKHz: Number.NaN,
  experimentFilterCutoffKHz: Number.NaN,
  inletPressureBar: Number.NaN,
  inletTemperatureK: Number.NaN,
  equivalenceRatio: Number.NaN,
  massFlowKgS: Number.NaN,
  backPressureBar: Number.NaN,
  comparisonMatchConfirmed: false,
  solver: "",
  solverVersion: "",
  dimensionality: "",
  spatialScheme: "",
  spatialOrder: Number.NaN,
  numericalFlux: "",
  limiterFilter: "",
  temporalScheme: "",
  temporalOrder: Number.NaN,
  cfl: Number.NaN,
  turbulenceModel: "",
  combustionModel: "",
  chemistryModel: "",
  chemistrySpecies: Number.NaN,
  chemistryReactions: Number.NaN,
  chemistryIntegrator: "",
  meshCells: Number.NaN,
  minimumCellSizeMm: Number.NaN,
  cellsPerInductionLength: Number.NaN,
  nearWallCellSizeMm: Number.NaN,
  timeStepUs: Number.NaN,
  solverRuntimeHours: Number.NaN,
  wallBoundaryCondition: "",
  inletBoundaryCondition: "",
  outletBoundaryCondition: "",
  initializationMethod: "",
  meshConvergencePct: Number.NaN,
  timeStepConvergencePct: Number.NaN,
  pressureUncertaintyPct: Number.NaN,
  timingUncertaintyUs: Number.NaN,
  cfdPressureUncertaintyPct: Number.NaN,
  cfdTimingUncertaintyUs: Number.NaN,
};

export function cloneMetadata(metadata: CaseMetadata): CaseMetadata {
  return { ...metadata, probePositionsDeg: [...metadata.probePositionsDeg] };
}
