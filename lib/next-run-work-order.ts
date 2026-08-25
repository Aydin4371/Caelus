import type { AnalysisCase } from "./caevera-types.ts";
import { ANALYSIS_VERSION } from "./rde-analysis.ts";
import type { ControlledNextRun } from "./diagnostics.ts";
import { ALL_CONTROLLED_FIELDS, CONTROLLED_PARAMETERS, suggestedTargetValue, type ControlledParameter } from "./controlled-parameters.ts";

export const NEXT_RUN_WORK_ORDER_SCHEMA = "kythros-cfd-next-run-work-order";
export const NEXT_RUN_WORK_ORDER_VERSION = 1;

export type NextRunWorkOrder = {
  schema: typeof NEXT_RUN_WORK_ORDER_SCHEMA;
  formatVersion: typeof NEXT_RUN_WORK_ORDER_VERSION;
  id: string;
  frozenAt: string;
  analysisVersion: string;
  policyVersion: string;
  engineDesignId: string | null;
  operatingPointId: string | null;
  startingCase: { id: string; name: string };
  change: {
    parameter: ControlledParameter;
    label: string;
    guidance: string;
    currentValue: string | number;
    currentSettings: Record<string, string | number>;
    suggestedTargetValue: string | number | null;
    allowedMetadataFields: string[];
  };
  lockedMetadataFields: string[];
  lockedSettings: Record<string, string | number>;
  comparisonDefinition: {
    probePositionsDeg: number[];
    windowMs: { start: number; end: number };
    experimentSources: string[];
  };
  requiredOutputs: string[];
  question: string;
  compare: string;
  decisionRule: {
    mode: ControlledNextRun["decisionPolicy"]["evaluationMode"];
    targetedMetrics: string[];
    confirmation: string;
    rejection: string;
    inconclusive: string;
  };
  evidenceBoundary: string;
};

function stableToken(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createNextRunWorkOrder(
  nextRun: ControlledNextRun,
  startingCase: AnalysisCase,
  frozenAt = new Date().toISOString(),
): NextRunWorkOrder | null {
  const parameter = nextRun.decisionPolicy.changedParameter;
  if (!parameter) return null;
  const definition = CONTROLLED_PARAMETERS[parameter];
  const rawCurrent = startingCase.metadata[definition.primaryField];
  const currentValue = typeof rawCurrent === "number" && Number.isFinite(rawCurrent) ? rawCurrent : String(rawCurrent ?? "");
  const suggestedTarget = suggestedTargetValue(parameter, startingCase.metadata);
  const modelFields = [...new Set([
    ...ALL_CONTROLLED_FIELDS,
    "solver", "solverVersion", "dimensionality", "turbulenceModel", "outletBoundaryCondition",
  ] as (keyof typeof startingCase.metadata)[])];
  const lockedFields = modelFields.filter((field) => !definition.fields.includes(field));
  const settingRecord = (fields: (keyof typeof startingCase.metadata)[]) => Object.fromEntries(fields.map((field) => {
    const value = startingCase.metadata[field];
    return [String(field), typeof value === "number" || typeof value === "string" ? value : JSON.stringify(value)];
  }));
  const windowStart = Math.max(...startingCase.testSignals.map((signal) => signal.time[0]));
  const windowEnd = Math.min(...startingCase.testSignals.map((signal) => signal.time.at(-1)!));
  const identity = `${startingCase.id}|${parameter}|${nextRun.question}|${frozenAt}`;
  return {
    schema: NEXT_RUN_WORK_ORDER_SCHEMA,
    formatVersion: NEXT_RUN_WORK_ORDER_VERSION,
    id: `krun-${stableToken(identity)}`,
    frozenAt,
    analysisVersion: ANALYSIS_VERSION,
    policyVersion: nextRun.decisionPolicy.version,
    engineDesignId: startingCase.designId ?? null,
    operatingPointId: startingCase.operatingPointId ?? null,
    startingCase: { id: startingCase.id, name: startingCase.metadata.name },
    change: {
      parameter,
      label: definition.label,
      guidance: definition.guidance,
      currentValue,
      currentSettings: settingRecord(definition.fields),
      suggestedTargetValue: suggestedTarget,
      allowedMetadataFields: definition.fields.map(String),
    },
    lockedMetadataFields: lockedFields.map(String),
    lockedSettings: settingRecord(lockedFields),
    comparisonDefinition: {
      probePositionsDeg: [...startingCase.metadata.probePositionsDeg],
      windowMs: { start: windowStart, end: windowEnd },
      experimentSources: startingCase.testSignals.map((signal) => signal.name),
    },
    requiredOutputs: [
      ...startingCase.metadata.probePositionsDeg.map((angle, index) => `P${index + 1} pressure history at ${angle}°`),
      "Solver run time and convergence history",
      `Pressure histories spanning the frozen ${windowStart.toFixed(6)} to ${windowEnd.toFixed(6)} ms comparison window`,
    ],
    question: nextRun.question,
    compare: nextRun.expectedOutcome,
    decisionRule: {
      mode: nextRun.decisionPolicy.evaluationMode,
      targetedMetrics: [...nextRun.decisionPolicy.targetedMetricIds],
      confirmation: nextRun.confirmationCriterion,
      rejection: nextRun.rejectionCriterion,
      inconclusive: nextRun.inconclusiveCriterion,
    },
    evidenceBoundary: "This frozen work order records the requested controlled test. It does not predict the result or prove the diagnostic explanation.",
  };
}

export function recommendationSnapshot(workOrder: NextRunWorkOrder) {
  return {
    id: workOrder.id,
    frozenAt: workOrder.frozenAt,
    analysisVersion: workOrder.analysisVersion,
    policyVersion: workOrder.policyVersion,
    startingCaseId: workOrder.startingCase.id,
    parameter: workOrder.change.parameter,
    currentValue: workOrder.change.currentValue,
    suggestedTargetValue: workOrder.change.suggestedTargetValue,
    question: workOrder.question,
  };
}

export function nextRunWorkOrderFileName(workOrder: NextRunWorkOrder) {
  return `kythros-next-run-${workOrder.startingCase.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || workOrder.id}.json`;
}
