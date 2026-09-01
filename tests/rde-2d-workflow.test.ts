import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRde2dResult, buildRde2dPackage, DEFAULT_RDE_2D_SETTINGS, midpointCondition, parseRde2dResult, relativeRde2dWork, settingsForPreset, type Rde2dResultSummary } from "../lib/rde-2d-workflow.ts";
import { EMPTY_ENGINE_DESIGN } from "../lib/design-workspace.ts";

const design = {
  ...EMPTY_ENGINE_DESIGN,
  id: "engine-1",
  name: "Test RDRE",
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
};

test("2D package unwraps the mean annulus and creates periodic mesh patches", () => {
  const pkg = buildRde2dPackage(design, midpointCondition(design), DEFAULT_RDE_2D_SETTINGS, "2026-08-30T00:00:00.000Z");
  assert.equal(pkg.readiness.exportReady, true);
  assert.equal(pkg.readiness.solverReady, false);
  assert.equal(pkg.discretization.totalCells, 172800);
  assert.ok(Math.abs(pkg.geometry.circumferenceMm - Math.PI * 90) < 1e-9);
  const mesh = pkg.files.find((file) => file.path === "system/blockMeshDict")?.content ?? "";
  assert.match(mesh, /type cyclic/);
  assert.match(mesh, /frontAndBack \{ type empty/);
  assert.match(mesh, /\(720 240 1\)/);
  assert.ok(pkg.files.some((file) => file.path === "system/controlDict.mesh"));
  assert.match(pkg.files.find((file) => file.path === "system/kythrosRunControl")?.content ?? "", /deltaT 5\.000000000000e-9/);
  assert.ok(pkg.files.some((file) => file.path === "kythros-result.template.json"));
});

test("2D package blocks invalid geometry without claiming solver readiness", () => {
  const pkg = buildRde2dPackage({ ...design, annulusOuterDiameterMm: 70 }, midpointCondition(design), DEFAULT_RDE_2D_SETTINGS);
  assert.equal(pkg.readiness.exportReady, false);
  assert.equal(pkg.readiness.solverReady, false);
  assert.ok(pkg.readiness.blockingIssues.length > 0);
});

test("2D presets reduce relative numerical work for quick screening", () => {
  const quick = settingsForPreset("quick");
  const balanced = settingsForPreset("balanced");
  assert.ok(relativeRde2dWork(quick) < relativeRde2dWork(balanced));
  assert.ok(relativeRde2dWork(balanced) < relativeRde2dWork(DEFAULT_RDE_2D_SETTINGS));
});

test("2D result analysis blocks engine changes until convergence evidence passes", () => {
  const condition = midpointCondition(design);
  const result: Rde2dResultSummary = {
    schema: "kythros-rde-2d-result",
    formatVersion: 1,
    designId: design.id,
    designFingerprint: null,
    operatingConditionId: condition.id,
    solverName: "Test solver",
    solverConverged: true,
    meshChangePct: 8,
    timeStepChangePct: 1,
    propagationMode: "stable-detonation",
    waveCount: 1,
    dominantFrequencyKHz: 5,
    pressureGainPct: 2,
    injectorBackflowPct: 12,
    peakWallHeatFluxMWm2: 8,
    peakWallTemperatureK: 900,
  };
  const recommendation = analyzeRde2dResult(design, condition, result);
  assert.equal(recommendation.resultUsable, false);
  assert.equal(recommendation.engine.title, "Do not change the engine yet");
  assert.equal(recommendation.simulation.title, "Run the next finer mesh");
});

test("2D result analysis recommends one feed-system change after numerical gates pass", () => {
  const condition = midpointCondition(design);
  const raw = JSON.stringify({
    schema: "kythros-rde-2d-result",
    formatVersion: 1,
    designId: design.id,
    designFingerprint: null,
    operatingConditionId: condition.id,
    solverName: "Test solver",
    solverConverged: true,
    meshChangePct: 1,
    timeStepChangePct: 1,
    propagationMode: "stable-detonation",
    waveCount: 1,
    dominantFrequencyKHz: 5,
    pressureGainPct: 2,
    injectorBackflowPct: 12,
    peakWallHeatFluxMWm2: 8,
    peakWallTemperatureK: 900,
  });
  const recommendation = analyzeRde2dResult(design, condition, parseRde2dResult(raw));
  assert.equal(recommendation.resultUsable, true);
  assert.equal(recommendation.engine.target, "feed-system");
  assert.match(recommendation.engine.action, /either feed pressure or total injector area, not both/);
});
