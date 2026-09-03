import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_ENGINE_DESIGN } from "../lib/design-workspace.ts";
import { midpointCondition } from "../lib/rde-2d-workflow.ts";
import {
  assessLocalCfdReadiness,
  createLocalCfdRunRequest,
  parseRde3dVolumeResult,
  recommendLocalRde3dChange,
  validateRde3dVolumeResult,
  type LocalRunnerStatus,
  type Rde3dVolumeResult,
} from "../lib/local-cfd.ts";

const design = {
  ...EMPTY_ENGINE_DESIGN,
  id: "engine-r1",
  name: "Hydrogen annular RDRE",
  application: "Rocket" as const,
  fuel: "Hydrogen",
  oxidizer: "Oxygen",
  annulusInnerDiameterMm: 78,
  annulusOuterDiameterMm: 86,
  chamberLengthMm: 120,
  injectorCount: 120,
  injectorDiameterMm: 0.8,
  equivalenceRatioMin: 0.9,
  equivalenceRatioMax: 1.1,
  massFlowKgSMin: 0.5,
  massFlowKgSMax: 0.7,
  inletPressureBarMin: 7,
  inletPressureBarMax: 9,
  inletTemperatureK: 300,
  backPressureBar: 1,
  revision: { number: 1, createdAt: "2026-09-03T00:00:00.000Z", supersedesDesignId: null, fingerprint: "fp-engine-r1" },
};

const readyStatus: LocalRunnerStatus = {
  apiVersion: 1,
  desktop: true,
  runtimeInstalled: true,
  runtimeVersion: "1.0.0",
  solverInstalled: true,
  solverName: "PeleC RDRE solver pack",
  solverVersion: "1.0.0",
  hardware: { platform: "windows", architecture: "x86_64", logicalCpuCount: 24, memoryGb: 64, gpuName: "NVIDIA GPU", gpuMemoryGb: 24, cudaAvailable: true },
  details: [],
};

function volumeResult(): Rde3dVolumeResult {
  const cells = 12;
  return {
    schema: "kythros-rde-3d-volume",
    formatVersion: 1,
    runId: "rde3d-test",
    designId: design.id,
    designFingerprint: design.revision.fingerprint,
    operatingConditionId: midpointCondition(design).id,
    solver: { name: "PeleC RDRE solver pack", version: "1.0.0", executableHash: "sha256:abc" },
    provenance: { computedAt: "2026-09-03T00:00:00.000Z", host: "local-desktop", caseDefinitionId: "gas-fed-annular-hydrogen-v1", validationStatus: "development-unvalidated" },
    grid: { coordinateSystem: "cylindrical-r-theta-x", storageOrder: "axial-circumferential-radial", radialCells: 2, circumferentialCells: 3, axialCells: 2, innerRadiusM: 0.039, outerRadiusM: 0.043, axialLengthM: 0.12 },
    fields: {
      pressurePa: Array(cells).fill(800_000),
      temperatureK: Array(cells).fill(1800),
      reactionProgress: Array(cells).fill(0.8),
      velocityAxialMps: Array(cells).fill(450),
      velocityRadialMps: Array(cells).fill(3),
      velocityCircumferentialMps: Array(cells).fill(1700),
    },
    summary: { solverConverged: true, massConservationErrorPct: 0.2, peakPressureBar: 18, peakTemperatureK: 2900, waveCount: 1, dominantFrequencyKHz: 6, injectorBackflowPct: 8, estimatedThrustN: 450, peakWallHeatFluxMWm2: null, adjacentGridChangePct: 1.2, adjacentTimeStepChangePct: 0.8 },
  };
}

test("Full 3D readiness requires desktop runtime, supported case, and CUDA hardware", () => {
  assert.equal(assessLocalCfdReadiness(readyStatus, "development", design).ready, true);
  const browser = { ...readyStatus, desktop: false };
  assert.equal(assessLocalCfdReadiness(browser, "development", design).ready, false);
  assert.match(assessLocalCfdReadiness(browser, "development", design).blockingIssues[0], /desktop app/);
  const unsupported = { ...design, fuel: "Kerosene" };
  assert.ok(assessLocalCfdReadiness(readyStatus, "development", unsupported).blockingIssues.some((issue) => /hydrogen/.test(issue)));
});

test("Full 3D request preserves immutable engine and operating-condition identity", () => {
  const condition = midpointCondition(design);
  const request = createLocalCfdRunRequest(design, condition, "workstation", "2026-09-03T00:00:00.000Z", "rde3d-fixed");
  assert.equal(request.runId, "rde3d-fixed");
  assert.equal(request.engine.designFingerprint, design.revision.fingerprint);
  assert.equal(request.operatingCondition.id, condition.id);
  assert.equal(request.numerics.approximateCells, 24_000_000);
  assert.deepEqual(request.requiredOutputs, ["pressure", "temperature", "reaction-progress", "velocity-axial", "velocity-radial", "velocity-circumferential"]);
});

test("Full 3D parser accepts only complete finite volumetric fields with provenance", () => {
  const result = volumeResult();
  assert.deepEqual(validateRde3dVolumeResult(result), []);
  assert.equal(parseRde3dVolumeResult(JSON.stringify(result)).grid.radialCells, 2);
  const missingRadialVelocity = structuredClone(result);
  missingRadialVelocity.fields.velocityRadialMps.pop();
  assert.match(validateRde3dVolumeResult(missingRadialVelocity).join(" "), /radial velocity field/);
  const nonPhysical = structuredClone(result);
  nonPhysical.fields.pressurePa[0] = -1;
  assert.match(validateRde3dVolumeResult(nonPhysical).join(" "), /Pressure must remain positive/);
});

test("Full 3D advice waits for numerical evidence then names one engine change", () => {
  const condition = midpointCondition(design);
  const unconverged = volumeResult();
  unconverged.summary.adjacentGridChangePct = null;
  unconverged.summary.adjacentTimeStepChangePct = null;
  assert.equal(recommendLocalRde3dChange(design, condition, unconverged).resultUsable, false);
  assert.match(recommendLocalRde3dChange(design, condition, unconverged).simulation.title, /adjacent grid/);
  const recommendation = recommendLocalRde3dChange(design, condition, volumeResult());
  assert.equal(recommendation.resultUsable, true);
  assert.match(recommendation.engine.title, /Raise inlet pressure/);
  assert.match(recommendation.engine.action, /Change only inlet pressure/);
});
