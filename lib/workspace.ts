import type { AnalysisCase } from "./caevera-types.ts";
import { validateEngineDesign, validateOperatingPoint, type EngineDesign, type OperatingPoint } from "./design-workspace.ts";
import { ANALYSIS_VERSION } from "./rde-analysis.ts";
import { experimentPhysicsFromMetadata } from "./physics-evidence.ts";
import { wallFieldImportIsValid } from "./spatial-field.ts";
import { CONTROLLED_PARAMETERS } from "./controlled-parameters.ts";
import { engineManifestFingerprint, normalizeEngineDesign } from "./engine-manifest.ts";
import { NEXT_RUN_WORK_ORDER_SCHEMA, NEXT_RUN_WORK_ORDER_VERSION, type FrozenRunPlan } from "./next-run-work-order.ts";

export const WORKSPACE_SCHEMA = "kythros-pressure-wave-workspace";
export const LEGACY_WORKSPACE_SCHEMA = "caevera-pressure-wave-workspace";
export const WORKSPACE_FORMAT_VERSION = 6;

export type WorkspaceState = {
  cases: AnalysisCase[];
  activeCaseId: string | null;
  baselineCaseId: string | null;
  designs: EngineDesign[];
  activeDesignId: string | null;
  operatingPoints: OperatingPoint[];
  activeOperatingPointId: string | null;
  frozenRunPlans: FrozenRunPlan[];
};

type WorkspaceEnvelope = {
  schema: typeof WORKSPACE_SCHEMA;
  formatVersion: number;
  analysisVersion: string;
  savedAt: string;
  state: WorkspaceState;
};

type WorkspaceInputState = Omit<WorkspaceState, "frozenRunPlans"> & { frozenRunPlans?: FrozenRunPlan[] };

function numberReplacer(_key: string, value: unknown) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { __caeveraNumber: Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity" };
  }
  return value;
}

function numberReviver(_key: string, value: unknown) {
  if (value && typeof value === "object" && "__caeveraNumber" in value) {
    const token = (value as { __caeveraNumber: string }).__caeveraNumber;
    return token === "NaN" ? Number.NaN : token === "Infinity" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readableFieldName(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\bcfd\b/g, "CFD")
    .replace(/\bmm\b/g, "mm")
    .replace(/\bus\b/g, "µs")
    .replace(/\bpct\b/g, "%")
    .replace(/\bkg s\b/g, "kg/s");
}

function validateSignal(value: unknown, label: string) {
  if (!isObject(value) || !Array.isArray(value.time) || !Array.isArray(value.pressure)) throw new Error(`${label} is not a pressure signal.`);
  if (value.time.length < 32 || value.time.length !== value.pressure.length) throw new Error(`${label} has an invalid sample count.`);
  for (let index = 0; index < value.time.length; index += 1) {
    const time = value.time[index];
    const pressure = value.pressure[index];
    if (typeof time !== "number" || typeof pressure !== "number" || !Number.isFinite(time) || !Number.isFinite(pressure)) throw new Error(`${label} contains a non-finite sample.`);
    if (index && time <= value.time[index - 1]) throw new Error(`${label} time values are not strictly increasing.`);
  }
}

const REQUIRED_POSITIVE_METADATA = [
  "annulusMeanDiameterMm", "experimentSensorBandwidthKHz", "experimentFilterCutoffKHz",
  "inletPressureBar", "inletTemperatureK", "equivalenceRatio", "massFlowKgS",
  "spatialOrder", "temporalOrder", "cfl", "chemistrySpecies", "chemistryReactions",
  "meshCells", "minimumCellSizeMm", "cellsPerInductionLength", "nearWallCellSizeMm", "timeStepUs",
] as const;

const REQUIRED_NONNEGATIVE_METADATA = [
  "annulusDiameterUncertaintyMm", "pressureUncertaintyPct", "timingUncertaintyUs",
  "cfdPressureUncertaintyPct", "cfdTimingUncertaintyUs",
] as const;

const REQUIRED_TEXT_METADATA = [
  "name", "solver", "solverVersion", "spatialScheme", "numericalFlux", "limiterFilter",
  "temporalScheme", "turbulenceModel", "combustionModel", "chemistryModel",
  "chemistryIntegrator", "wallBoundaryCondition", "inletBoundaryCondition",
  "inletForcingMethod", "outletBoundaryCondition", "initializationMethod",
] as const;

function validateMetadata(metadata: Record<string, unknown>, label: string) {
  for (const key of REQUIRED_POSITIVE_METADATA) {
    const value = metadata[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label}: ${readableFieldName(key)} must be a number greater than zero.`);
  }
  for (const key of REQUIRED_NONNEGATIVE_METADATA) {
    const value = metadata[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label}: ${readableFieldName(key)} must be zero or greater.`);
  }
  for (const key of REQUIRED_TEXT_METADATA) {
    if (typeof metadata[key] !== "string" || !metadata[key].trim()) throw new Error(`${label}: ${readableFieldName(key)} is required.`);
  }
  if (typeof metadata.solverRuntimeHours !== "number" || Number.isFinite(metadata.solverRuntimeHours) && metadata.solverRuntimeHours <= 0) throw new Error(`${label}: runtime must be greater than zero when it is supplied.`);
  if (metadata.dimensionality !== "2D" && metadata.dimensionality !== "3D") throw new Error(`${label}: dimensionality must be 2D or 3D.`);
  if (typeof metadata.maximumWaveCount !== "number" || !Number.isInteger(metadata.maximumWaveCount) || metadata.maximumWaveCount < 1 || metadata.maximumWaveCount > 12) throw new Error(`${label} has an invalid maximum wave count.`);
  if (typeof metadata.probeSynchronizationConfirmed !== "boolean" || typeof metadata.comparisonMatchConfirmed !== "boolean") throw new Error(`${label} is missing confirmation states.`);
  if (!Array.isArray(metadata.probePositionsDeg) || metadata.probePositionsDeg.length < 3 || metadata.probePositionsDeg.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error(`${label} has invalid probe angles.`);
  const normalized = metadata.probePositionsDeg.map((value) => (((value as number) % 360) + 360) % 360);
  if (new Set(normalized.map((value) => value.toFixed(6))).size !== normalized.length) throw new Error(`${label} has duplicate probe angles.`);
}

function validateImportProvenance(value: unknown, probeCount: number, label: string) {
  if (!isObject(value) || typeof value.fileName !== "string" || typeof value.timeColumn !== "string" || !Array.isArray(value.pressureColumns)) throw new Error(`${label} import provenance is malformed.`);
  if (value.pressureColumns.length !== probeCount) throw new Error(`${label} import mapping does not match the saved probe count.`);
}

function validateCase(value: unknown, index: number): asserts value is AnalysisCase {
  if (!isObject(value) || typeof value.id !== "string" || !isObject(value.metadata)) throw new Error(`Case ${index + 1} is malformed.`);
  if (!("solverRuntimeHours" in value.metadata)) value.metadata.solverRuntimeHours = Number.NaN;
  if (!("backPressureBar" in value.metadata)) value.metadata.backPressureBar = Number.NaN;
  if (!("inletForcingMethod" in value.metadata)) value.metadata.inletForcingMethod = "Not documented";
  validateMetadata(value.metadata, `Case ${index + 1}`);
  if (!Array.isArray(value.testSignals) || !Array.isArray(value.cfdSignals) || value.testSignals.length < 3 || value.testSignals.length !== value.cfdSignals.length) {
    throw new Error(`Case ${index + 1} does not contain matched experiment and CFD probe arrays.`);
  }
  const probePositions = value.metadata.probePositionsDeg;
  if (!Array.isArray(probePositions) || probePositions.length !== value.testSignals.length) throw new Error(`Case ${index + 1} probe angles do not match its pressure arrays.`);
  value.testSignals.forEach((signal, probe) => validateSignal(signal, `Case ${index + 1} experiment P${probe + 1}`));
  value.cfdSignals.forEach((signal, probe) => validateSignal(signal, `Case ${index + 1} CFD P${probe + 1}`));
  if (value.source !== "uploaded" && value.source !== "demo") throw new Error(`Case ${index + 1} has an invalid source type.`);
  if (value.designId != null && typeof value.designId !== "string") throw new Error(`Case ${index + 1} has an invalid engine-design link.`);
  if (value.operatingPointId != null && typeof value.operatingPointId !== "string") throw new Error(`Case ${index + 1} has an invalid operating-point link.`);
  if (value.relationship != null) {
    const allowedChanges = ["mesh", "time-step", "chemistry", "inlet", "wall", "initialization", "unsteadiness", "other"];
    if (!isObject(value.relationship)
      || typeof value.relationship.baselineCaseId !== "string"
      || value.relationship.referenceCaseId != null && typeof value.relationship.referenceCaseId !== "string"
      || !allowedChanges.includes(String(value.relationship.changedVariable))
      || value.relationship.changedParameter != null && !(String(value.relationship.changedParameter) in CONTROLLED_PARAMETERS)
      || typeof value.relationship.description !== "string") {
      throw new Error(`Case ${index + 1} has an invalid related-rerun definition.`);
    }
  }
  if (value.imports != null) {
    if (!isObject(value.imports)) throw new Error(`Case ${index + 1} import provenance is malformed.`);
    validateImportProvenance(value.imports.experiment, value.testSignals.length, `Case ${index + 1} experiment`);
    validateImportProvenance(value.imports.cfd, value.cfdSignals.length, `Case ${index + 1} CFD`);
  }
  if (value.wallFields != null) {
    if (!isObject(value.wallFields)) throw new Error(`Case ${index + 1} spatial wall evidence is malformed.`);
    if (value.wallFields.experiment != null && !wallFieldImportIsValid(value.wallFields.experiment)) throw new Error(`Case ${index + 1} experiment wall field is malformed.`);
    if (value.wallFields.cfd != null && !wallFieldImportIsValid(value.wallFields.cfd)) throw new Error(`Case ${index + 1} CFD wall field is malformed.`);
  }
}

export function serializeWorkspace(state: WorkspaceInputState) {
  const envelope: WorkspaceEnvelope = {
    schema: WORKSPACE_SCHEMA,
    formatVersion: WORKSPACE_FORMAT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    savedAt: new Date().toISOString(),
    state: { ...state, designs: state.designs.map(normalizeEngineDesign), frozenRunPlans: state.frozenRunPlans ?? [] },
  };
  return JSON.stringify(envelope, numberReplacer, 2);
}

export function deserializeWorkspace(text: string): WorkspaceState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, numberReviver);
  } catch {
    throw new Error("This is not valid JSON.");
  }
  if (!isObject(parsed) || parsed.schema !== WORKSPACE_SCHEMA && parsed.schema !== LEGACY_WORKSPACE_SCHEMA) throw new Error("This is not a Kythros pressure-and-wave workspace.");
  if (![1, 2, 3, 4, 5, WORKSPACE_FORMAT_VERSION].includes(Number(parsed.formatVersion))) throw new Error(`Workspace format ${String(parsed.formatVersion)} is not supported by this release.`);
  if (!isObject(parsed.state) || !Array.isArray(parsed.state.cases)) throw new Error("The workspace does not contain a case list.");
  parsed.state.cases.forEach(validateCase);
  const cases = parsed.state.cases as AnalysisCase[];
  if (parsed.formatVersion === WORKSPACE_FORMAT_VERSION && cases.some((item) => !(item.metadata.backPressureBar > 0))) throw new Error("Every operating point in this workspace must include a positive back pressure.");
  const identifiers = new Set(cases.map((item) => item.id));
  if (identifiers.size !== cases.length) throw new Error("The workspace contains duplicate case identifiers.");
  for (const item of cases) {
    if (item.relationship && (!identifiers.has(item.relationship.baselineCaseId) || item.relationship.baselineCaseId === item.id)) {
      throw new Error(`Case ${item.metadata.name} links to an invalid baseline case.`);
    }
    if (item.relationship?.referenceCaseId) {
      const reference = cases.find((candidate) => candidate.id === item.relationship?.referenceCaseId);
      if (!reference || reference.id === item.id || reference.id !== item.relationship.baselineCaseId && reference.relationship?.baselineCaseId !== item.relationship.baselineCaseId) {
        throw new Error(`Case ${item.metadata.name} links to an invalid starting case.`);
      }
    }
  }
  const requestedActive = typeof parsed.state.activeCaseId === "string" ? parsed.state.activeCaseId : null;
  const requestedBaseline = typeof parsed.state.baselineCaseId === "string" ? parsed.state.baselineCaseId : null;
  const rawDesigns = Array.isArray(parsed.state.designs) ? parsed.state.designs as EngineDesign[] : [];
  if (Number(parsed.formatVersion) === WORKSPACE_FORMAT_VERSION) {
    for (const design of rawDesigns) {
      if (!design.revision || design.revision.fingerprint !== engineManifestFingerprint(design)) throw new Error(`Engine design ${design.name || design.id} has an invalid immutable-revision fingerprint.`);
    }
  }
  const designs = rawDesigns.map(normalizeEngineDesign);
  const designIdentifiers = new Set<string>();
  designs.forEach((design, index) => {
    if (!isObject(design) || typeof design.id !== "string" || !design.id) throw new Error(`Engine design ${index + 1} has no valid identifier.`);
    if (designIdentifiers.has(design.id)) throw new Error("The workspace contains duplicate engine-design identifiers.");
    designIdentifiers.add(design.id);
    const issues = validateEngineDesign(design);
    if (issues.length) throw new Error(`Engine design ${index + 1}: ${issues[0]}`);
  });
  for (const item of cases) {
    if (item.designId && !designIdentifiers.has(item.designId)) throw new Error(`Case ${item.metadata.name} links to an engine design that is not present.`);
  }
  const operatingPoints = Array.isArray(parsed.state.operatingPoints) ? parsed.state.operatingPoints as OperatingPoint[] : [];
  const operatingPointIdentifiers = new Set<string>();
  operatingPoints.forEach((point, index) => {
    if (!isObject(point)) throw new Error(`Operating point ${index + 1} is malformed.`);
    const issues = validateOperatingPoint(point as OperatingPoint);
    if (issues.length) throw new Error(`Operating point ${index + 1}: ${issues[0]}`);
    if (operatingPointIdentifiers.has(point.id as string)) throw new Error("The workspace contains duplicate operating-point identifiers.");
    if (!designIdentifiers.has(point.designId as string)) throw new Error(`Operating point ${index + 1} links to an engine design that is not present.`);
    if (point.experiment) {
      point.experiment.signals.forEach((signal, probe) => validateSignal(signal, `Operating point ${index + 1} experiment P${probe + 1}`));
      if (point.experiment.importProvenance) validateImportProvenance(point.experiment.importProvenance, point.experiment.signals.length, `Operating point ${index + 1} experiment`);
    }
    operatingPointIdentifiers.add(point.id as string);
  });
  const points = [...operatingPoints];
  for (const baseline of cases.filter((item) => !item.relationship && item.designId)) {
    let point = baseline.operatingPointId ? points.find((item) => item.id === baseline.operatingPointId) : null;
    if (!point) {
      const design = designs.find((item) => item.id === baseline.designId);
      const backPressureBar = Number.isFinite(baseline.metadata.backPressureBar) && baseline.metadata.backPressureBar > 0
        ? baseline.metadata.backPressureBar
        : design?.backPressureBar ?? Number.NaN;
      point = {
        id: `op-${baseline.id}`,
        designId: baseline.designId!,
        name: baseline.metadata.name,
        source: baseline.source,
        inletPressureBar: baseline.metadata.inletPressureBar,
        inletTemperatureK: baseline.metadata.inletTemperatureK,
        equivalenceRatio: baseline.metadata.equivalenceRatio,
        massFlowKgS: baseline.metadata.massFlowKgS,
        backPressureBar,
      };
      const issues = validateOperatingPoint(point);
      if (issues.length) throw new Error(`Legacy case ${baseline.metadata.name} cannot become an operating point: ${issues[0]}`);
      points.push(point);
      operatingPointIdentifiers.add(point.id);
    }
    baseline.operatingPointId = point.id;
    baseline.metadata.backPressureBar = point.backPressureBar;
    if (!point.experiment) {
      point.experiment = {
        signals: baseline.testSignals,
        importProvenance: baseline.imports?.experiment ?? null,
        annulusMeanDiameterMm: baseline.metadata.annulusMeanDiameterMm,
        annulusDiameterUncertaintyMm: baseline.metadata.annulusDiameterUncertaintyMm,
        probePositionsDeg: [...baseline.metadata.probePositionsDeg],
        maximumWaveCount: baseline.metadata.maximumWaveCount,
        probeSynchronizationConfirmed: baseline.metadata.probeSynchronizationConfirmed,
        experimentSensorBandwidthKHz: baseline.metadata.experimentSensorBandwidthKHz,
        experimentFilterCutoffKHz: baseline.metadata.experimentFilterCutoffKHz,
        pressureUncertaintyPct: baseline.metadata.pressureUncertaintyPct,
        timingUncertaintyUs: baseline.metadata.timingUncertaintyUs,
        physics: experimentPhysicsFromMetadata(baseline.metadata),
      };
    }
    for (const run of cases.filter((item) => item.relationship?.baselineCaseId === baseline.id)) {
      run.operatingPointId = point.id;
      run.metadata.backPressureBar = point.backPressureBar;
    }
  }
  for (const run of cases) {
    if (run.operatingPointId && !operatingPointIdentifiers.has(run.operatingPointId)) throw new Error(`Run ${run.metadata.name} links to an operating point that is not present.`);
  }
  const frozenRunPlans = Array.isArray(parsed.state.frozenRunPlans) ? parsed.state.frozenRunPlans as FrozenRunPlan[] : [];
  const planIds = new Set<string>();
  for (const [index, plan] of frozenRunPlans.entries()) {
    if (!isObject(plan) || !isObject(plan.workOrder)
      || plan.workOrder.schema !== NEXT_RUN_WORK_ORDER_SCHEMA
      || plan.workOrder.formatVersion !== NEXT_RUN_WORK_ORDER_VERSION
      || typeof plan.workOrder.id !== "string"
      || !isObject(plan.workOrder.startingCase)
      || typeof plan.workOrder.startingCase.id !== "string"
      || !identifiers.has(plan.workOrder.startingCase.id)
      || plan.status !== "pending" && plan.status !== "completed") throw new Error(`Frozen run plan ${index + 1} is malformed.`);
    if (planIds.has(plan.workOrder.id)) throw new Error("The workspace contains duplicate frozen run plans.");
    if (plan.status === "completed" && (!plan.resultCaseId || !identifiers.has(plan.resultCaseId))) throw new Error(`Frozen run plan ${index + 1} does not link to its completed result.`);
    if (plan.status === "pending" && plan.resultCaseId) throw new Error(`Frozen run plan ${index + 1} is pending but already links to a result.`);
    planIds.add(plan.workOrder.id);
  }
  const requestedDesign = typeof parsed.state.activeDesignId === "string" ? parsed.state.activeDesignId : null;
  const requestedOperatingPoint = typeof parsed.state.activeOperatingPointId === "string" ? parsed.state.activeOperatingPointId : null;
  return {
    cases,
    activeCaseId: requestedActive && identifiers.has(requestedActive) ? requestedActive : cases[0]?.id ?? null,
    baselineCaseId: requestedBaseline && identifiers.has(requestedBaseline) ? requestedBaseline : cases[0]?.id ?? null,
    designs,
    activeDesignId: requestedDesign && designIdentifiers.has(requestedDesign) ? requestedDesign : designs[0]?.id ?? null,
    operatingPoints: points,
    activeOperatingPointId: requestedOperatingPoint && operatingPointIdentifiers.has(requestedOperatingPoint)
      ? requestedOperatingPoint
      : points.find((point) => point.id === cases.find((item) => item.id === requestedActive)?.operatingPointId)?.id ?? points[0]?.id ?? null,
    frozenRunPlans,
  };
}

export function workspaceFileName() {
  return `kythros-pressure-wave-workspace-${new Date().toISOString().slice(0, 10)}.json`;
}
