import type { SensitivityVariable } from "./caevera-types.ts";
import type { DiagnosticCauseId } from "./diagnostic-knowledge.ts";

export type ControlledSensitivityVariable = Exclude<SensitivityVariable, "other">;

export type ControlledRerunRule = {
  causeId: DiagnosticCauseId;
  targets: string[];
  minimumResponsePct: number;
  convergenceResponsePct: number | null;
};

export const CONFIRMATION_ERROR_REDUCTION_PCT = 25;
export const REJECTION_ERROR_WORSENING_PCT = 5;
export const NUMERICAL_CONVERGENCE_RESPONSE_PCT = 2;

export const CONTROLLED_RERUN_RULES: Record<ControlledSensitivityVariable, ControlledRerunRule> = {
  mesh: { causeId: "spatial-resolution", targets: ["peak-pressure", "rise-time", "harmonics"], minimumResponsePct: 5, convergenceResponsePct: NUMERICAL_CONVERGENCE_RESPONSE_PCT },
  "time-step": { causeId: "chemistry-timescale", targets: ["frequency", "rise-time"], minimumResponsePct: 1, convergenceResponsePct: NUMERICAL_CONVERGENCE_RESPONSE_PCT },
  chemistry: { causeId: "chemistry-timescale", targets: ["frequency", "amplitude", "impulse"], minimumResponsePct: 2, convergenceResponsePct: null },
  inlet: { causeId: "inlet-boundary", targets: ["mean-pressure", "frequency"], minimumResponsePct: 2, convergenceResponsePct: null },
  wall: { causeId: "wall-loss", targets: ["amplitude", "impulse"], minimumResponsePct: 2, convergenceResponsePct: null },
  initialization: { causeId: "initialization-mode", targets: ["wave-count", "direction", "mode-transitions"], minimumResponsePct: 1, convergenceResponsePct: null },
  unsteadiness: { causeId: "missing-unsteadiness", targets: ["cycle-variability", "frequency-drift", "phase-jitter"], minimumResponsePct: 2, convergenceResponsePct: null },
};

export function sensitivityLabel(variable: SensitivityVariable) {
  if (variable === "time-step") return "time-step";
  return variable;
}
