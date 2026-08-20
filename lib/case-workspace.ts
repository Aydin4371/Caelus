import type { AnalysisCase } from "./caevera-types.ts";

export const WORKSPACE_SCHEMA = "caevera-pressure-wave-workspace-v1";

export type SavedWorkspace = {
  schema: typeof WORKSPACE_SCHEMA;
  analysisVersion: string;
  savedAt: string;
  activeCaseId: string | null;
  cases: AnalysisCase[];
};

function nonFiniteReplacer(_key: string, value: unknown) {
  if (typeof value === "number" && !Number.isFinite(value)) return { $caeveraNumber: String(value) };
  return value;
}

function nonFiniteReviver(_key: string, value: unknown) {
  if (value && typeof value === "object" && "$caeveraNumber" in value) {
    const encoded = (value as { $caeveraNumber: string }).$caeveraNumber;
    if (encoded === "NaN") return Number.NaN;
    if (encoded === "Infinity") return Number.POSITIVE_INFINITY;
    if (encoded === "-Infinity") return Number.NEGATIVE_INFINITY;
  }
  return value;
}

function validateCase(value: unknown, index: number): asserts value is AnalysisCase {
  if (!value || typeof value !== "object") throw new Error(`Case ${index + 1} is not an object.`);
  const item = value as Partial<AnalysisCase>;
  if (typeof item.id !== "string" || !item.id) throw new Error(`Case ${index + 1} has no valid ID.`);
  if (!item.metadata || typeof item.metadata !== "object" || typeof item.metadata.name !== "string") throw new Error(`Case ${index + 1} has invalid metadata.`);
  if (!Array.isArray(item.testSignals) || !Array.isArray(item.cfdSignals) || item.testSignals.length < 3 || item.testSignals.length !== item.cfdSignals.length) {
    throw new Error(`Case ${index + 1} must contain matching experiment and CFD arrays with at least three probes.`);
  }
  for (const [kind, signals] of [["experiment", item.testSignals], ["CFD", item.cfdSignals]] as const) {
    for (const signal of signals) {
      if (!signal || !Array.isArray(signal.time) || !Array.isArray(signal.pressure) || signal.time.length < 32 || signal.time.length !== signal.pressure.length) {
        throw new Error(`Case ${index + 1} contains an invalid ${kind} pressure signal.`);
      }
    }
  }
}

export function serializeWorkspace(cases: AnalysisCase[], activeCaseId: string | null, analysisVersion: string) {
  const payload: SavedWorkspace = {
    schema: WORKSPACE_SCHEMA,
    analysisVersion,
    savedAt: new Date().toISOString(),
    activeCaseId,
    cases,
  };
  return JSON.stringify(payload, nonFiniteReplacer, 2);
}

export function parseWorkspace(text: string): SavedWorkspace {
  let payload: unknown;
  try {
    payload = JSON.parse(text, nonFiniteReviver);
  } catch {
    throw new Error("This is not valid JSON and cannot be opened as a Kythros workspace.");
  }
  if (!payload || typeof payload !== "object") throw new Error("The workspace file is empty or invalid.");
  const workspace = payload as Partial<SavedWorkspace>;
  if (workspace.schema !== WORKSPACE_SCHEMA) throw new Error(`Unsupported workspace schema. Expected ${WORKSPACE_SCHEMA}.`);
  if (!Array.isArray(workspace.cases) || !workspace.cases.length) throw new Error("The workspace does not contain any cases.");
  workspace.cases.forEach(validateCase);
  const ids = new Set(workspace.cases.map((item) => item.id));
  if (ids.size !== workspace.cases.length) throw new Error("The workspace contains duplicate case IDs.");
  for (const item of workspace.cases) {
    if (item.relationship?.baselineCaseId && !ids.has(item.relationship.baselineCaseId)) throw new Error(`${item.metadata.name} links to a baseline case that is not present.`);
  }
  const activeCaseId = workspace.activeCaseId && ids.has(workspace.activeCaseId) ? workspace.activeCaseId : workspace.cases[0].id;
  return {
    schema: WORKSPACE_SCHEMA,
    analysisVersion: typeof workspace.analysisVersion === "string" ? workspace.analysisVersion : "unknown",
    savedAt: typeof workspace.savedAt === "string" ? workspace.savedAt : "unknown",
    activeCaseId,
    cases: workspace.cases,
  };
}

