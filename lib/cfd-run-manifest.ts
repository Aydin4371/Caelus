import type { CaseMetadata, Dimensionality } from "./caevera-types.ts";
import type { NextRunWorkOrder } from "./next-run-work-order.ts";

export const CFD_RUN_MANIFEST_SCHEMA = "kythros-cfd-run-manifest";
export const CFD_RUN_MANIFEST_VERSION = 1;

export const CFD_MANIFEST_FIELDS = [
  "solver", "solverVersion", "dimensionality", "spatialScheme", "spatialOrder", "numericalFlux", "limiterFilter",
  "temporalScheme", "temporalOrder", "cfl", "turbulenceModel", "combustionModel", "chemistryModel", "chemistrySpecies",
  "chemistryReactions", "chemistryIntegrator", "meshCells", "minimumCellSizeMm", "cellsPerInductionLength", "nearWallCellSizeMm",
  "timeStepUs", "wallBoundaryCondition", "inletBoundaryCondition", "inletForcingMethod", "outletBoundaryCondition", "initializationMethod",
] as const satisfies readonly (keyof CaseMetadata)[];

export type CfdManifestField = typeof CFD_MANIFEST_FIELDS[number];

export type CfdRunManifest = {
  schema: typeof CFD_RUN_MANIFEST_SCHEMA;
  formatVersion: typeof CFD_RUN_MANIFEST_VERSION;
  source: "generic" | "openfoam" | "fluent";
  generatedAt: string;
  metadata: Pick<CaseMetadata, CfdManifestField>;
};

export type CfdManifestImport = {
  source: CfdRunManifest["source"];
  metadata: Partial<Pick<CaseMetadata, CfdManifestField>>;
  detected: Array<{ field: CfdManifestField; value: string | number }>;
  warnings: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function acceptedValue(field: CfdManifestField, value: unknown) {
  if (field === "dimensionality") return value === "2D" || value === "3D" ? value as Dimensionality : null;
  const numeric = ["spatialOrder", "temporalOrder", "cfl", "chemistrySpecies", "chemistryReactions", "meshCells", "minimumCellSizeMm", "cellsPerInductionLength", "nearWallCellSizeMm", "timeStepUs"];
  if (numeric.includes(field)) return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseCfdRunManifest(text: string): CfdManifestImport {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("This is not valid JSON."); }
  if (!isObject(parsed) || parsed.schema !== CFD_RUN_MANIFEST_SCHEMA || parsed.formatVersion !== CFD_RUN_MANIFEST_VERSION || !isObject(parsed.metadata)) {
    throw new Error(`Expected a ${CFD_RUN_MANIFEST_SCHEMA} version ${CFD_RUN_MANIFEST_VERSION} file.`);
  }
  const metadata: Partial<Pick<CaseMetadata, CfdManifestField>> = {};
  for (const field of CFD_MANIFEST_FIELDS) {
    const value = acceptedValue(field, parsed.metadata[field]);
    if (value !== null) metadata[field] = value as never;
  }
  const detected = Object.entries(metadata).map(([field, value]) => ({ field: field as CfdManifestField, value: value as string | number }));
  if (!detected.length) throw new Error("The manifest contains no recognized CFD settings.");
  const source = parsed.source === "openfoam" || parsed.source === "fluent" ? parsed.source : "generic";
  return { source, metadata, detected, warnings: detected.length < CFD_MANIFEST_FIELDS.length ? ["Only recognized, populated settings will be applied. Review every remaining solver field before analysis."] : [] };
}

function dictionaryValue(text: string, key: string) {
  const match = text.match(new RegExp(`(?:^|[\\n{}])\\s*${key}\\s+([^;\\n]+)\\s*;`, "i"));
  return match?.[1]?.trim() ?? null;
}

function blockDefault(text: string, block: string) {
  const body = text.match(new RegExp(`${block}\\s*\\{([\\s\\S]*?)\\}`, "i"))?.[1] ?? "";
  return dictionaryValue(body, "default");
}

function firstMatchingFile(files: Array<{ name: string; text: string }>, endings: string[]) {
  return files.find((file) => endings.some((ending) => file.name.toLowerCase().endsWith(ending.toLowerCase())))?.text ?? "";
}

function openFoamBoundarySummary(text: string, kind: "inlet" | "outlet" | "wall") {
  const matches = [...text.matchAll(/(?:^|\n)\s*([A-Za-z][\w.-]*)\s*\{[\s\S]*?\btype\s+([^;\n]+)\s*;[\s\S]*?\}/g)];
  const selected = matches.filter((match) => match[1].toLowerCase().includes(kind));
  return selected.map((match) => `${match[1]}: ${match[2].trim()}`).join(" | ");
}

export function parseOpenFoamCaseFiles(files: Array<{ name: string; text: string }>): CfdManifestImport {
  if (!files.length) throw new Error("Choose at least one OpenFOAM dictionary file.");
  const byName = (name: string) => firstMatchingFile(files, [name]);
  const control = byName("controlDict");
  const schemes = byName("fvSchemes");
  const solution = byName("fvSolution");
  const combined = files.map((file) => file.text).join("\n");
  const metadata: Partial<Pick<CaseMetadata, CfdManifestField>> = { solver: "OpenFOAM" };
  const application = dictionaryValue(control, "application");
  if (application) metadata.solver = application;
  const softwareVersion = combined.match(/\bOpenFOAM(?: Foundation)?[-\s](?:v)?([0-9][\w.+-]*)/i)?.[1];
  if (softwareVersion) metadata.solverVersion = softwareVersion;
  const deltaT = Number(dictionaryValue(control, "deltaT"));
  if (Number.isFinite(deltaT) && deltaT > 0) metadata.timeStepUs = deltaT * 1_000_000;
  const maxCo = Number(dictionaryValue(control, "maxCo"));
  if (Number.isFinite(maxCo) && maxCo > 0) metadata.cfl = maxCo;
  const ddt = blockDefault(schemes, "ddtSchemes");
  if (ddt) metadata.temporalScheme = ddt;
  const div = blockDefault(schemes, "divSchemes");
  if (div) metadata.spatialScheme = div;
  const solverNames = [...solution.matchAll(/(?:^|\n)\s*([A-Za-z][\w.]*)\s*\{[^}]*?solver\s+([^;\n]+);/g)].map((match) => `${match[1]}: ${match[2].trim()}`);
  if (solverNames.length) metadata.numericalFlux = solverNames.join(" | ");
  const checkMeshCells = Number(combined.match(/(?:^|\n)\s*cells:\s*([0-9]+)/i)?.[1]);
  if (Number.isFinite(checkMeshCells) && checkMeshCells > 0) metadata.meshCells = checkMeshCells;
  const momentum = firstMatchingFile(files, ["momentumTransport", "turbulenceProperties"]);
  const turbulenceType = dictionaryValue(momentum, "simulationType");
  const turbulenceModel = dictionaryValue(momentum, "RASModel") ?? dictionaryValue(momentum, "LESModel");
  if (turbulenceModel || turbulenceType) metadata.turbulenceModel = [turbulenceType, turbulenceModel].filter(Boolean).join(" / ");
  const combustion = firstMatchingFile(files, ["combustionProperties", "combustionProperties.orig"]);
  const combustionModel = dictionaryValue(combustion, "combustionModel") ?? dictionaryValue(combustion, "model");
  if (combustionModel) metadata.combustionModel = combustionModel;
  const chemistry = firstMatchingFile(files, ["chemistryProperties", "chemistryProperties.orig"]);
  const chemistrySolver = dictionaryValue(chemistry, "solver");
  const chemistryMethod = dictionaryValue(chemistry, "method");
  if (chemistrySolver) metadata.chemistryIntegrator = chemistrySolver;
  if (chemistryMethod) metadata.chemistryModel = chemistryMethod;
  const pressureField = firstMatchingFile(files, ["/0/p", "\\0\\p", "0/p", "0\\p"]);
  const inletSummary = openFoamBoundarySummary(pressureField, "inlet");
  const outletSummary = openFoamBoundarySummary(pressureField, "outlet");
  const wallSummary = openFoamBoundarySummary(pressureField, "wall");
  if (inletSummary) metadata.inletBoundaryCondition = inletSummary;
  if (outletSummary) metadata.outletBoundaryCondition = outletSummary;
  if (wallSummary) metadata.wallBoundaryCondition = wallSummary;
  const probeBlock = control.match(/\bprobeLocations\s*\(([\s\S]*?)\)\s*;/i)?.[1] ?? "";
  const probeLocationCount = [...probeBlock.matchAll(/\([^()]+\)/g)].length;
  const detected = Object.entries(metadata).map(([field, value]) => ({ field: field as CfdManifestField, value: value as string | number }));
  const warnings = ["OpenFOAM dictionaries expose only part of the model card. Review every setting that was not detected before analysis."];
  if (probeLocationCount) warnings.push(`${probeLocationCount} Cartesian probe locations were found. Kythros does not convert them into annulus angles without an explicitly documented coordinate origin and axis.`);
  if (!softwareVersion) warnings.push("The dictionary-format entry 'version 2.0' is not an OpenFOAM software version, so Kythros intentionally leaves solver version for review.");
  return {
    source: "openfoam",
    metadata,
    detected,
    warnings,
  };
}

export type OpenFoamNextRunHandoff = {
  schema: "kythros-openfoam-next-run-handoff";
  formatVersion: 1;
  generatedAt: string;
  workOrderId: string;
  exactAutomaticEditAvailable: boolean;
  files: Array<{ path: string; purpose: string; content: string }>;
  limitation: string;
};

export function buildOpenFoamNextRunHandoff(workOrder: NextRunWorkOrder): OpenFoamNextRunHandoff {
  const parameter = workOrder.change.parameter;
  const target = workOrder.change.suggestedTargetValue;
  const exactTimeStep = parameter === "flow-time-step" && typeof target === "number" && Number.isFinite(target) && target > 0;
  const includeContent = exactTimeStep
    ? `// Kythros frozen work order ${workOrder.id}\n// Include or copy this entry into system/controlDict after engineer review.\ndeltaT ${(target * 1e-6).toExponential(12)};\n`
    : `// Kythros frozen work order ${workOrder.id}\n// No solver-native edit is generated for ${workOrder.change.label}.\n// Apply the documented one-parameter change in the case's authoritative mesh/model source.\n`;
  const checklist = [
    `Work order: ${workOrder.id}`,
    `Starting case: ${workOrder.startingCase.name} (${workOrder.startingCase.id})`,
    `Allowed change: ${workOrder.change.label}`,
    `Current value: ${String(workOrder.change.currentValue)}`,
    `Target value: ${target === null ? "Engineer must enter and document one target" : String(target)}`,
    "Locked settings:",
    ...Object.entries(workOrder.lockedSettings).map(([key, value]) => `- ${key}: ${String(value)}`),
    "Required outputs:",
    ...workOrder.requiredOutputs.map((value) => `- ${value}`),
  ].join("\n");
  return {
    schema: "kythros-openfoam-next-run-handoff",
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    workOrderId: workOrder.id,
    exactAutomaticEditAvailable: exactTimeStep,
    files: [
      { path: "system/kythrosNextRun.include", purpose: exactTimeStep ? "Reviewed controlDict time-step override" : "Traceable placeholder; no automatic solver edit", content: includeContent },
      { path: "KYTHROS_NEXT_RUN.md", purpose: "Human-readable locked-setting and output checklist", content: checklist },
      { path: "kythros-work-order.json", purpose: "Machine-readable frozen recommendation", content: JSON.stringify(workOrder, null, 2) },
    ],
    limitation: "This handoff does not supply an RDE solver, mesh, chemistry mechanism, or validated boundary conditions. Only an exact flow-time-step target can be emitted safely without knowing the case's mesh and model-generation workflow; every edit requires engineer review.",
  };
}

export function buildCfdRunManifest(metadata: CaseMetadata, source: CfdRunManifest["source"] = "generic"): CfdRunManifest {
  return {
    schema: CFD_RUN_MANIFEST_SCHEMA,
    formatVersion: CFD_RUN_MANIFEST_VERSION,
    source,
    generatedAt: new Date().toISOString(),
    metadata: Object.fromEntries(CFD_MANIFEST_FIELDS.map((field) => [field, metadata[field]])) as Pick<CaseMetadata, CfdManifestField>,
  };
}
