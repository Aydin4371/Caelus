import type { AnalysisCase } from "./caevera-types.ts";
import { ANALYSIS_VERSION } from "./rde-analysis.ts";

export const WORKSPACE_SCHEMA = "caevera-pressure-wave-workspace";
export const WORKSPACE_FORMAT_VERSION = 1;

export type WorkspaceState = {
  cases: AnalysisCase[];
  activeCaseId: string | null;
  baselineCaseId: string | null;
};

type WorkspaceEnvelope = {
  schema: typeof WORKSPACE_SCHEMA;
  formatVersion: number;
  analysisVersion: string;
  savedAt: string;
  state: WorkspaceState;
};

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

function validateCase(value: unknown, index: number): asserts value is AnalysisCase {
  if (!isObject(value) || typeof value.id !== "string" || !isObject(value.metadata)) throw new Error(`Case ${index + 1} is malformed.`);
  if (typeof value.metadata.name !== "string" || !Array.isArray(value.metadata.probePositionsDeg)) throw new Error(`Case ${index + 1} has invalid metadata.`);
  if (!Array.isArray(value.testSignals) || !Array.isArray(value.cfdSignals) || value.testSignals.length < 3 || value.testSignals.length !== value.cfdSignals.length) {
    throw new Error(`Case ${index + 1} does not contain matched experiment and CFD probe arrays.`);
  }
  if (value.metadata.probePositionsDeg.length !== value.testSignals.length) throw new Error(`Case ${index + 1} probe angles do not match its pressure arrays.`);
  value.testSignals.forEach((signal, probe) => validateSignal(signal, `Case ${index + 1} experiment P${probe + 1}`));
  value.cfdSignals.forEach((signal, probe) => validateSignal(signal, `Case ${index + 1} CFD P${probe + 1}`));
}

export function serializeWorkspace(state: WorkspaceState) {
  const envelope: WorkspaceEnvelope = {
    schema: WORKSPACE_SCHEMA,
    formatVersion: WORKSPACE_FORMAT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    savedAt: new Date().toISOString(),
    state,
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
  if (!isObject(parsed) || parsed.schema !== WORKSPACE_SCHEMA) throw new Error("This is not a Caevera pressure-and-wave workspace.");
  if (parsed.formatVersion !== WORKSPACE_FORMAT_VERSION) throw new Error(`Workspace format ${String(parsed.formatVersion)} is not supported by this release.`);
  if (!isObject(parsed.state) || !Array.isArray(parsed.state.cases)) throw new Error("The workspace does not contain a case list.");
  parsed.state.cases.forEach(validateCase);
  const cases = parsed.state.cases as AnalysisCase[];
  const identifiers = new Set(cases.map((item) => item.id));
  if (identifiers.size !== cases.length) throw new Error("The workspace contains duplicate case identifiers.");
  const requestedActive = typeof parsed.state.activeCaseId === "string" ? parsed.state.activeCaseId : null;
  const requestedBaseline = typeof parsed.state.baselineCaseId === "string" ? parsed.state.baselineCaseId : null;
  return {
    cases,
    activeCaseId: requestedActive && identifiers.has(requestedActive) ? requestedActive : cases[0]?.id ?? null,
    baselineCaseId: requestedBaseline && identifiers.has(requestedBaseline) ? requestedBaseline : cases[0]?.id ?? null,
  };
}

export function workspaceFileName() {
  return `caevera-pressure-wave-workspace-${new Date().toISOString().slice(0, 10)}.json`;
}
