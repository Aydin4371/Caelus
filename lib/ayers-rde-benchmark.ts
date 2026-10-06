import { EMPTY_ENGINE_DESIGN, type EngineDesign } from "./design-workspace.ts";
import { runFastRde2d, type FastRde2dResult, type FastRde2dRunOptions } from "./fast-rde-2d.ts";
import type { Rde2dCondition, Rde2dSettings } from "./rde-2d-workflow.ts";

/** Author-manuscript printed pages 6 and 13; never replace observations with model outputs. */
export const AYERS_EXPERIMENT = {
  id: "ayers-2023-config-a-case-i",
  title: "Purdue / NASA · premixed hydrogen–air RDE",
  authors: "Z. M. Ayers, V. Athmanathan, T. R. Meyer, D. E. Paxson",
  doi: "10.2514/1.B38868",
  url: "https://ntrs.nasa.gov/api/citations/20220016805/downloads/Ayers_JPP_2022_11042022.pdf",
  sourceLocator: "Figure 1(a), Table 1 case (i), Figure 6; author manuscript pp. 6, 13",
  innerDiameterMm: 120.9, outerDiameterMm: 135.6, chamberLengthMm: 138.1,
  massFluxKgM2S: 55, equivalenceRatio: 1.03, premixedFraction: 1,
  manifoldTemperatureK: 295, manifoldPressureBar: 8.9,
  measuredMeanPressureBar: 1.10, pressureProbeAxialMm: 9.1,
  observedMode: "Two counterpropagating waves",
  pressureUncertaintyBar: null,
  geometryNote: "Figure 1 labels 120.9/135.6 mm diameters, implying a 7.35 mm gap, but the text and inset give 7.62 mm. This case uses the labeled diameters; the discrepancy needs author clarification.",
} as const;

export const AYERS_MODEL_LIMITATIONS = [
  "The experiment uses a porous injector. Fast 2D applies the reported manifold pressure directly at a uniform inlet and does not model the porous pressure drop. The existing inlet-speed clipping also means entered flow is not guaranteed at the boundary. This is a known boundary mismatch, not a calibrated representation.",
  "The model uses constant gas properties and uncalibrated one-step heat release; it omits wall heat loss, radial flow, and the experimental predetonator.",
  "The outlet is assumed to be 1.01325 bar; this is an ambient-pressure assumption, not a measured value in Table 1.",
  "A 1 ms startup run is compared descriptively with a reported experimental mean. It does not reproduce the experiment’s established firing interval or CTAP sensor response.",
  "The paper provides a scalar mean and optical wave observations, not a raw pressure history for this case. No measured waveform or experimental movie is synthesized.",
] as const;

export function ayersBenchmarkCase() {
  const e = AYERS_EXPERIMENT;
  const areaM2 = Math.PI / 4 * (e.outerDiameterMm ** 2 - e.innerDiameterMm ** 2) * 1e-6;
  const massFlowKgS = e.massFluxKgM2S * areaM2;
  const design: EngineDesign = {
    ...EMPTY_ENGINE_DESIGN, build: undefined, id: e.id, name: "Ayers Configuration A · case (i)", source: "published",
    application: "Air-breathing", fuel: "Hydrogen", oxidizer: "Air",
    annulusInnerDiameterMm: e.innerDiameterMm, annulusOuterDiameterMm: e.outerDiameterMm,
    chamberLengthMm: e.chamberLengthMm, injectorType: "Porous premixed injector (not represented by Fast 2D)",
    injectorCount: 0, injectorDiameterMm: 0, injectorAngleDeg: 0, plenumVolumeCm3: 0,
    wallCondition: "Inviscid model; experimental heat transfer not represented", exhaustConfiguration: "Straight annulus, ambient outlet assumption",
    equivalenceRatioMin: e.equivalenceRatio, equivalenceRatioMax: e.equivalenceRatio,
    massFlowKgSMin: massFlowKgS, massFlowKgSMax: massFlowKgS,
    inletPressureBarMin: e.manifoldPressureBar, inletPressureBarMax: e.manifoldPressureBar,
    inletTemperatureK: e.manifoldTemperatureK, backPressureBar: 1.01325,
  };
  const condition: Rde2dCondition = { id: `${e.id}-condition`, name: "Table 1 case (i)", inletPressureBar: e.manifoldPressureBar,
    inletTemperatureK: e.manifoldTemperatureK, equivalenceRatio: e.equivalenceRatio, massFlowKgS, backPressureBar: 1.01325 };
  return { design, condition, areaM2 };
}

export const AYERS_RUNS = {
  baseline: { label: "Baseline", circumferentialCells: 64, axialCells: 24, timeStepNs: 500 },
  mesh: { label: "Finer mesh", circumferentialCells: 128, axialCells: 48, timeStepNs: 500 },
  time: { label: "Smaller time step", circumferentialCells: 64, axialCells: 24, timeStepNs: 250 },
} as const;
export type AyersRunId = keyof typeof AYERS_RUNS;

export function ayersRunSettings(id: AyersRunId): Rde2dSettings {
  return { ...AYERS_RUNS[id], endTimeMs: 1, solver: "Kythros Fast 2D", chemistryMechanism: "Simplified one-step heat release", probeCount: 1 };
}

export function compareAyersExperiment(result: FastRde2dResult) {
  const recording = result.recording;
  if (result.designId !== AYERS_EXPERIMENT.id || result.operatingConditionId !== `${AYERS_EXPERIMENT.id}-condition` || !recording) {
    throw new Error("Choose a recorded Ayers benchmark result from this case.");
  }
  const mean = recording.meanProbePressureBar;
  return {
    status: "not-validated" as const,
    measuredMeanPressureBar: AYERS_EXPERIMENT.measuredMeanPressureBar,
    calculatedMeanPressureBar: mean,
    descriptiveDifferencePct: mean === null ? null : 100 * (mean - AYERS_EXPERIMENT.measuredMeanPressureBar) / AYERS_EXPERIMENT.measuredMeanPressureBar,
    executionCompleted: Math.abs(result.screeningDiagnostics.simulatedTimeMs - 1) < 1e-6,
    numericalScreenPassed: result.solverConverged,
    observedMode: AYERS_EXPERIMENT.observedMode,
    modeAgreement: "Not assessed: the screening peak count does not establish counterpropagation.",
    interpretation: "Descriptive discrepancy only. Boundary conditions, sampling interval, geometry ambiguity, and missing uncertainty prevent a validation pass/fail claim.",
  };
}

export async function runAyersBenchmark(id: AyersRunId, options: Pick<FastRde2dRunOptions, "signal" | "onProgress"> = {}) {
  const { design, condition } = ayersBenchmarkCase();
  return runFastRde2d(design, condition, ayersRunSettings(id), {
    ...options, maxSteps: 20000, yieldEverySteps: 40,
    recording: { frameCount: 48, probeAxialMm: AYERS_EXPERIMENT.pressureProbeAxialMm, averagingStartMs: 0.5 },
  });
}
