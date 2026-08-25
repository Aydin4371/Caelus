import type { CaseMetadata, SensitivityVariable } from "./caevera-types.ts";

export type ControlledParameter =
  | "mesh-resolution"
  | "spatial-method"
  | "flow-time-step"
  | "temporal-method"
  | "chemistry-mechanism"
  | "chemistry-integration"
  | "combustion-model"
  | "inlet-treatment"
  | "wall-treatment"
  | "initialization-method"
  | "inlet-unsteadiness";

export type ControlledParameterDefinition = {
  id: ControlledParameter;
  variable: Exclude<SensitivityVariable, "other">;
  label: string;
  fields: (keyof CaseMetadata)[];
  primaryField: keyof CaseMetadata;
  guidance: string;
};

export const CONTROLLED_PARAMETER_DEFINITIONS: ControlledParameterDefinition[] = [
  { id: "mesh-resolution", variable: "mesh", label: "Mesh resolution level", fields: ["meshCells", "minimumCellSizeMm", "cellsPerInductionLength", "nearWallCellSizeMm"], primaryField: "minimumCellSizeMm", guidance: "Change the documented mesh level while keeping the spatial method fixed." },
  { id: "spatial-method", variable: "mesh", label: "Spatial discretization method", fields: ["spatialScheme", "spatialOrder", "numericalFlux", "limiterFilter"], primaryField: "spatialScheme", guidance: "Change one documented spatial-method bundle while keeping the mesh fixed." },
  { id: "flow-time-step", variable: "time-step", label: "Flow time step", fields: ["timeStepUs", "cfl"], primaryField: "timeStepUs", guidance: "Change the flow step; CFL may change only as its documented consequence." },
  { id: "temporal-method", variable: "time-step", label: "Temporal integration method", fields: ["temporalScheme", "temporalOrder"], primaryField: "temporalScheme", guidance: "Change the temporal scheme and its stated order while keeping the time step fixed." },
  { id: "chemistry-mechanism", variable: "chemistry", label: "Chemical mechanism", fields: ["chemistryModel", "chemistrySpecies", "chemistryReactions"], primaryField: "chemistryModel", guidance: "Change the named mechanism and its documented species and reaction counts." },
  { id: "chemistry-integration", variable: "chemistry", label: "Chemistry integration method", fields: ["chemistryIntegrator"], primaryField: "chemistryIntegrator", guidance: "Change only the chemistry integrator." },
  { id: "combustion-model", variable: "chemistry", label: "Combustion model", fields: ["combustionModel"], primaryField: "combustionModel", guidance: "Change only the combustion-model formulation." },
  { id: "inlet-treatment", variable: "inlet", label: "Inlet boundary treatment", fields: ["inletBoundaryCondition"], primaryField: "inletBoundaryCondition", guidance: "Change only the inlet boundary treatment." },
  { id: "wall-treatment", variable: "wall", label: "Wall thermal treatment", fields: ["wallBoundaryCondition"], primaryField: "wallBoundaryCondition", guidance: "Change only the wall thermal treatment." },
  { id: "initialization-method", variable: "initialization", label: "Ignition / initialization method", fields: ["initializationMethod"], primaryField: "initializationMethod", guidance: "Change only the initialization method." },
  { id: "inlet-unsteadiness", variable: "unsteadiness", label: "Measured inlet forcing", fields: ["inletForcingMethod"], primaryField: "inletForcingMethod", guidance: "Change only how the documented inlet time history is imposed." },
];

export const CONTROLLED_PARAMETERS = Object.fromEntries(
  CONTROLLED_PARAMETER_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<ControlledParameter, ControlledParameterDefinition>;

export const ALL_CONTROLLED_FIELDS = [...new Set(CONTROLLED_PARAMETER_DEFINITIONS.flatMap((definition) => definition.fields))];

export const DEFAULT_PARAMETER_BY_VARIABLE: Record<Exclude<SensitivityVariable, "other">, ControlledParameter> = {
  mesh: "mesh-resolution",
  "time-step": "flow-time-step",
  chemistry: "chemistry-mechanism",
  inlet: "inlet-treatment",
  wall: "wall-treatment",
  initialization: "initialization-method",
  unsteadiness: "inlet-unsteadiness",
};

export function parameterLabel(parameter: ControlledParameter | null | undefined) {
  return parameter ? CONTROLLED_PARAMETERS[parameter].label : "Single CFD parameter";
}

export function inferControlledParameter(
  variable: SensitivityVariable,
  changedFields: (keyof CaseMetadata)[],
): ControlledParameter | null {
  if (variable === "other" || !changedFields.length) return null;
  const candidates = CONTROLLED_PARAMETER_DEFINITIONS.filter((definition) =>
    definition.variable === variable && changedFields.every((field) => definition.fields.includes(field)),
  );
  return candidates.length === 1 ? candidates[0].id : null;
}

export function suggestedTargetValue(parameter: ControlledParameter, metadata: CaseMetadata) {
  if (parameter === "mesh-resolution" && Number.isFinite(metadata.minimumCellSizeMm)) return metadata.minimumCellSizeMm / 2;
  if (parameter === "flow-time-step" && Number.isFinite(metadata.timeStepUs)) return metadata.timeStepUs / 2;
  return null;
}
