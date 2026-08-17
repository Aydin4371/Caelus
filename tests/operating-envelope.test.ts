import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisCase, CaseMetadata } from "../lib/caevera-types.ts";
import { buildEnvelopeDataset } from "../lib/operating-envelope.ts";
import { makeDemoProbeSignals } from "../lib/rde-analysis.ts";

function metadata(name: string): CaseMetadata {
  const demo = makeDemoProbeSignals();
  return {
    name,
    annulusMeanDiameterMm: 82,
    annulusDiameterUncertaintyMm: 0.1,
    probePositionsDeg: demo.positionsDeg,
    maximumWaveCount: 4,
    probeSynchronizationConfirmed: true,
    experimentSensorBandwidthKHz: 100,
    experimentFilterCutoffKHz: 80,
    inletPressureBar: 8,
    inletTemperatureK: 300,
    equivalenceRatio: 1,
    massFlowKgS: 0.62,
    comparisonMatchConfirmed: true,
    solver: "Test solver",
    solverVersion: "1",
    dimensionality: "3D",
    spatialScheme: "MUSCL",
    spatialOrder: 2,
    numericalFlux: "HLLC",
    limiterFilter: "Limiter",
    temporalScheme: "SSPRK3",
    temporalOrder: 3,
    cfl: 0.3,
    turbulenceModel: "SST",
    combustionModel: "Finite-rate",
    chemistryModel: "Reduced",
    chemistrySpecies: 9,
    chemistryReactions: 19,
    chemistryIntegrator: "Implicit",
    meshCells: 2_000_000,
    minimumCellSizeMm: 0.2,
    cellsPerInductionLength: 8,
    nearWallCellSizeMm: 0.1,
    timeStepUs: 0.2,
    solverRuntimeHours: 10,
    wallBoundaryCondition: "Isothermal",
    inletBoundaryCondition: "Measured",
    outletBoundaryCondition: "Non-reflecting",
    initializationMethod: "Kernel",
    meshConvergencePct: Number.NaN,
    timeStepConvergencePct: Number.NaN,
    pressureUncertaintyPct: 1.5,
    timingUncertaintyUs: 0.5,
    cfdPressureUncertaintyPct: 2,
    cfdTimingUncertaintyUs: 0.25,
  };
}

test("builds one observed envelope point per baseline, not per CFD rerun", () => {
  const demo = makeDemoProbeSignals();
  const baseline: AnalysisCase = { id: "baseline", source: "demo", relationship: null, metadata: metadata("Baseline"), testSignals: demo.test, cfdSignals: demo.cfd };
  const rerun: AnalysisCase = {
    ...baseline,
    id: "mesh",
    relationship: { baselineCaseId: baseline.id, referenceCaseId: baseline.id, changedVariable: "mesh", description: "Refined mesh" },
    metadata: { ...metadata("Mesh rerun"), meshCells: 4_000_000, minimumCellSizeMm: 0.1 },
  };
  const result = buildEnvelopeDataset([baseline, rerun]);
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].cfdRerunCount, 1);
  assert.equal(result.status, "Demonstration only");
  assert.equal(result.points[0].backflowStatus, "Not assessed");
});

test("does not convert an observed map into an unvalidated prediction", () => {
  const demo = makeDemoProbeSignals();
  const baseline: AnalysisCase = { id: "physical", source: "uploaded", relationship: null, metadata: metadata("Physical point"), testSignals: demo.test, cfdSignals: demo.cfd };
  const result = buildEnvelopeDataset([baseline]);
  assert.equal(result.status, "Observed map only");
  assert.match(result.nextRequirement, /mesh or time-step sequence/i);
  assert.equal(result.points[0].modelUse, "Needs numerical convergence");
});
