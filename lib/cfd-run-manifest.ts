import type { CaseMetadata, Dimensionality } from "./caevera-types.ts";

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
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${key}\\s+([^;\\n]+)\\s*;`, "i"));
  return match?.[1]?.trim() ?? null;
}

function blockDefault(text: string, block: string) {
  const body = text.match(new RegExp(`${block}\\s*\\{([\\s\\S]*?)\\}`, "i"))?.[1] ?? "";
  return dictionaryValue(body, "default");
}

export function parseOpenFoamCaseFiles(files: Array<{ name: string; text: string }>): CfdManifestImport {
  if (!files.length) throw new Error("Choose at least one OpenFOAM dictionary file.");
  const byName = (name: string) => files.find((file) => file.name.toLowerCase().endsWith(name.toLowerCase()))?.text ?? "";
  const control = byName("controlDict");
  const schemes = byName("fvSchemes");
  const solution = byName("fvSolution");
  const combined = files.map((file) => file.text).join("\n");
  const metadata: Partial<Pick<CaseMetadata, CfdManifestField>> = { solver: "OpenFOAM" };
  const application = dictionaryValue(control, "application");
  if (application) metadata.solver = application;
  const version = dictionaryValue(combined, "version");
  if (version) metadata.solverVersion = version;
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
  const detected = Object.entries(metadata).map(([field, value]) => ({ field: field as CfdManifestField, value: value as string | number }));
  return {
    source: "openfoam",
    metadata,
    detected,
    warnings: ["OpenFOAM dictionaries expose only part of the model card. Mesh, chemistry, boundary, version, and uncertainty fields still require review unless separately detected."],
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
