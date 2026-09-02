import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_ENGINE_DESIGN } from "../lib/design-workspace.ts";
import { runFastRde2d } from "../lib/fast-rde-2d.ts";
import { analyzeRde2dResult, midpointCondition, settingsForPreset } from "../lib/rde-2d-workflow.ts";

const design = {
  ...EMPTY_ENGINE_DESIGN,
  id: "fast-solver-engine",
  name: "Fast solver regression engine",
  annulusInnerDiameterMm: 80,
  annulusOuterDiameterMm: 100,
  chamberLengthMm: 120,
  injectorCount: 60,
  injectorDiameterMm: 1,
  equivalenceRatioMin: 0.8,
  equivalenceRatioMax: 1.2,
  massFlowKgSMin: 0.8,
  massFlowKgSMax: 1.2,
  inletPressureBarMin: 8,
  inletPressureBarMax: 12,
  inletTemperatureK: 300,
  backPressureBar: 1,
  fuel: "Hydrogen",
  oxidizer: "Oxygen",
};

test("Kythros Fast 2D calculates finite fields and a traceable screening result", async () => {
  const condition = midpointCondition(design);
  const settings = { ...settingsForPreset("quick"), circumferentialCells: 40, axialCells: 16, endTimeMs: 0.01 };
  const progress: number[] = [];
  const result = await runFastRde2d(design, condition, settings, {
    maxSteps: 500,
    yieldEverySteps: 5,
    onProgress: (value) => progress.push(value.fraction),
  });

  assert.equal(result.schema, "kythros-rde-2d-result");
  assert.equal(result.evidenceClass, "browser-screening");
  assert.equal(result.designId, design.id);
  assert.equal(result.operatingConditionId, condition.id);
  assert.equal(result.field.nx, 40);
  assert.equal(result.field.ny, 16);
  assert.equal(result.field.pressureBar.length, 640);
  assert.ok(result.field.pressureBar.every((value) => Number.isFinite(value) && value > 0));
  assert.ok(result.field.temperatureK.every((value) => Number.isFinite(value) && value > 0));
  assert.ok(result.field.reactionProgress.every((value) => value >= 0 && value <= 1));
  assert.equal(result.field.circumferentialVelocityMps.length, 640);
  assert.equal(result.field.axialVelocityMps.length, 640);
  assert.ok(result.field.circumferentialVelocityMps.every((value) => Number.isFinite(value)));
  assert.ok(result.field.axialVelocityMps.every((value) => Number.isFinite(value)));
  assert.ok(result.screeningDiagnostics.steps > 0);
  assert.ok(result.screeningDiagnostics.massConservationErrorPct < 1);
  assert.equal(result.solverConverged, true);
  assert.equal(progress.at(-1), 1);

  const recommendation = analyzeRde2dResult(design, condition, result);
  assert.equal(recommendation.resultUsable, true);
  assert.match(recommendation.engine.action, /Change only/);
});

test("Kythros Fast 2D honors cancellation before allocating a run", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runFastRde2d(design, midpointCondition(design), settingsForPreset("quick"), { signal: controller.signal }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
});
