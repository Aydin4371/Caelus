import assert from "node:assert/strict";
import test from "node:test";
import { buildRde2dPackage, DEFAULT_RDE_2D_SETTINGS, midpointCondition } from "../lib/rde-2d-workflow.ts";
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
});

test("2D package blocks invalid geometry without claiming solver readiness", () => {
  const pkg = buildRde2dPackage({ ...design, annulusOuterDiameterMm: 70 }, midpointCondition(design), DEFAULT_RDE_2D_SETTINGS);
  assert.equal(pkg.readiness.exportReady, false);
  assert.equal(pkg.readiness.solverReady, false);
  assert.ok(pkg.readiness.blockingIssues.length > 0);
});
