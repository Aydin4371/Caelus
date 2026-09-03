import type { SensitivityVariable } from "./caevera-types.ts";
import type { DiagnosticCauseId } from "./diagnostic-knowledge.ts";
import { DEFAULT_PARAMETER_BY_VARIABLE, parameterLabel, type ControlledParameter } from "./controlled-parameters.ts";

export type ControlledSensitivityVariable = Exclude<SensitivityVariable, "other">;

export type ControlledRerunRule = {
  causeId: DiagnosticCauseId;
  parameter: ControlledParameter;
  targets: string[];
  minimumResponsePct: number;
  convergenceResponsePct: number | null;
};

export const CONFIRMATION_ERROR_REDUCTION_PCT = 25;
export const REJECTION_ERROR_WORSENING_PCT = 5;
export const NUMERICAL_CONVERGENCE_RESPONSE_PCT = 2;
export const RECOMMENDATION_POLICY_VERSION = "2026.08.4";

export const CONTROLLED_VARIABLE_LABELS: Record<ControlledSensitivityVariable, string> = {
  mesh: parameterLabel(DEFAULT_PARAMETER_BY_VARIABLE.mesh),
  "time-step": parameterLabel(DEFAULT_PARAMETER_BY_VARIABLE["time-step"]),
  chemistry: parameterLabel(DEFAULT_PARAMETER_BY_VARIABLE.chemistry),
  inlet: "inlet treatment",
  wall: "wall treatment",
  initialization: "initialization method",
  unsteadiness: "measured inlet unsteadiness",
};

export const TARGET_METRIC_LABELS: Record<string, string> = {
  "peak-pressure": "peak pressure",
  "rise-time": "pressure rise time",
  harmonics: "second-harmonic content",
  frequency: "wave frequency",
  amplitude: "pressure amplitude",
  impulse: "wave-passage impulse",
  "mean-pressure": "mean pressure",
  "wave-count": "wave count",
  direction: "wave direction",
  "mode-transitions": "mode transitions",
  "cycle-variability": "cycle variability",
  "frequency-drift": "frequency drift",
  "phase-jitter": "phase jitter",
};

export const CONTROLLED_RERUN_RULES: Record<ControlledSensitivityVariable, ControlledRerunRule> = {
  mesh: { causeId: "spatial-resolution", parameter: "mesh-resolution", targets: ["peak-pressure", "rise-time", "harmonics"], minimumResponsePct: 5, convergenceResponsePct: NUMERICAL_CONVERGENCE_RESPONSE_PCT },
  "time-step": { causeId: "chemistry-timescale", parameter: "flow-time-step", targets: ["frequency", "rise-time"], minimumResponsePct: 1, convergenceResponsePct: NUMERICAL_CONVERGENCE_RESPONSE_PCT },
  chemistry: { causeId: "chemistry-timescale", parameter: "chemistry-mechanism", targets: ["frequency", "amplitude", "impulse"], minimumResponsePct: 2, convergenceResponsePct: null },
  inlet: { causeId: "inlet-boundary", parameter: "inlet-treatment", targets: ["mean-pressure", "frequency"], minimumResponsePct: 2, convergenceResponsePct: null },
  wall: { causeId: "wall-loss", parameter: "wall-treatment", targets: ["amplitude", "impulse"], minimumResponsePct: 2, convergenceResponsePct: null },
  initialization: { causeId: "initialization-mode", parameter: "initialization-method", targets: ["wave-count", "direction", "mode-transitions"], minimumResponsePct: 1, convergenceResponsePct: null },
  unsteadiness: { causeId: "missing-unsteadiness", parameter: "inlet-unsteadiness", targets: ["cycle-variability", "frequency-drift", "phase-jitter"], minimumResponsePct: 2, convergenceResponsePct: null },
};

export function sensitivityLabel(variable: SensitivityVariable) {
  if (variable === "time-step") return "time-step";
  return variable;
}
