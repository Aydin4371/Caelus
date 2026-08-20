import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisCase, CaseMetadata } from "../lib/caevera-types.ts";
import type { OperatingPoint } from "../lib/design-workspace.ts";
import { EMPTY_ENGINE_DESIGN } from "../lib/design-workspace.ts";
import { ENVELOPE_MODEL_MINIMUM_POINTS, fitEnvelopeModel } from "../lib/envelope-model.ts";
import { buildEnvelopeDataset } from "../lib/operating-envelope.ts";
import { GE_2022_DESIGN, buildGe2022OperatingPoints } from "../lib/published-envelope-data.ts";
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
    backPressureBar: 1,
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
  const point: OperatingPoint = { id: "point", designId: "design", name: "Baseline", source: "demo", inletPressureBar: 8, inletTemperatureK: 300, equivalenceRatio: 1, massFlowKgS: 0.62, backPressureBar: 1 };
  const baseline: AnalysisCase = { id: "baseline", designId: "design", operatingPointId: point.id, source: "demo", relationship: null, metadata: metadata("Baseline"), testSignals: demo.test, cfdSignals: demo.cfd };
  const rerun: AnalysisCase = {
    ...baseline,
    id: "mesh",
    relationship: { baselineCaseId: baseline.id, referenceCaseId: baseline.id, changedVariable: "mesh", description: "Refined mesh" },
    metadata: { ...metadata("Mesh rerun"), meshCells: 4_000_000, minimumCellSizeMm: 0.1 },
  };
  const result = buildEnvelopeDataset([point], [baseline, rerun]);
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].cfdRerunCount, 1);
  assert.equal(result.status, "Demonstration only");
  assert.equal(result.points[0].evidenceType, "Experiment + CFD");
});

test("does not convert an observed map into an unvalidated prediction", () => {
  const demo = makeDemoProbeSignals();
  const point: OperatingPoint = { id: "physical-point", designId: "design", name: "Physical point", source: "uploaded", inletPressureBar: 8, inletTemperatureK: 300, equivalenceRatio: 1, massFlowKgS: 0.62, backPressureBar: 1 };
  const baseline: AnalysisCase = { id: "physical", designId: "design", operatingPointId: point.id, source: "uploaded", relationship: null, metadata: metadata("Physical point"), testSignals: demo.test, cfdSignals: demo.cfd };
  const result = buildEnvelopeDataset([point], [baseline]);
  assert.equal(result.status, "Measured envelope");
  assert.match(result.nextRequirement, /more measured operating points/i);
  assert.equal(result.points[0].modelUse, "Eligible observation");
});

test("builds a measured envelope point from experiment data without requiring CFD", () => {
  const demo = makeDemoProbeSignals();
  const point: OperatingPoint = {
    id: "experiment-only",
    designId: "design",
    name: "Experiment only",
    source: "uploaded",
    inletPressureBar: 8,
    inletTemperatureK: 300,
    equivalenceRatio: 1,
    massFlowKgS: 0.62,
    backPressureBar: 1,
    experiment: {
      signals: demo.test,
      annulusMeanDiameterMm: 82,
      annulusDiameterUncertaintyMm: 0.1,
      probePositionsDeg: demo.positionsDeg,
      maximumWaveCount: 4,
      probeSynchronizationConfirmed: true,
      experimentSensorBandwidthKHz: 100,
      experimentFilterCutoffKHz: 80,
      pressureUncertaintyPct: 1.5,
      timingUncertaintyUs: 0.5,
    },
  };
  const result = buildEnvelopeDataset([point], []);
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].evidenceType, "Experiment only");
  assert.equal(result.points[0].runCount, 0);
  assert.equal(result.points[0].modelUse, "Eligible observation");
});

test("gates the exploratory envelope model and leaves unsupported space blank", () => {
  const demo = makeDemoProbeSignals();
  const point: OperatingPoint = { id: "seed-point", designId: "design", name: "Seed", source: "uploaded", inletPressureBar: 8, inletTemperatureK: 300, equivalenceRatio: 1, massFlowKgS: 0.62, backPressureBar: 1 };
  const baseline: AnalysisCase = { id: "seed-run", designId: "design", operatingPointId: point.id, source: "uploaded", relationship: null, metadata: metadata("Seed"), testSignals: demo.test, cfdSignals: demo.cfd };
  const seed = buildEnvelopeDataset([point], [baseline]).points[0];
  const design = { ...EMPTY_ENGINE_DESIGN, id: "design", name: "Model test", annulusInnerDiameterMm: 78, annulusOuterDiameterMm: 86, chamberLengthMm: 120, injectorCount: 120, injectorDiameterMm: 0.8, plenumVolumeCm3: 300, equivalenceRatioMin: 0.9, equivalenceRatioMax: 1.1, massFlowKgSMin: 0.5, massFlowKgSMax: 0.7, inletPressureBarMin: 6, inletPressureBarMax: 10, inletTemperatureK: 300, backPressureBar: 1 };
  const blocked = fitEnvelopeModel([seed], design);
  assert.equal(blocked.status, "Not ready yet");
  assert.match(blocked.reason, new RegExp(`1 of ${ENVELOPE_MODEL_MINIMUM_POINTS}`));
  assert.equal(blocked.gates[0].value, `1 / ${ENVELOPE_MODEL_MINIMUM_POINTS}`);

  const points = Array.from({ length: ENVELOPE_MODEL_MINIMUM_POINTS }, (_, index) => ({
    ...seed,
    operatingPointId: `point-${index}`,
    caseId: `run-${index}`,
    name: `Point ${index}`,
    inletPressureBar: 6.5 + index * 3 / (ENVELOPE_MODEL_MINIMUM_POINTS - 1),
    massFlowKgS: 0.59 + 0.005 * (index % 3),
    classification: index < ENVELOPE_MODEL_MINIMUM_POINTS / 2 ? "Stable" as const : "Unstable" as const,
    signalQuality: "Ready" as const,
    identifiability: "Identified" as const,
    numericalStatus: "Converged" as const,
    evidenceQuality: "High" as const,
    modelUse: "Eligible observation" as const,
  }));
  const ready = fitEnvelopeModel(points, design);
  assert.equal(ready.status, "Exploratory model ready");
  assert.ok((ready.leaveOneOutAccuracy ?? 0) >= 0.55);
  const unsupported = ready.predict({ inletPressureBar: 30, massFlowKgS: 2, equivalenceRatio: 1, backPressureBar: 1 });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.uncertainty, 1);
});

test("loads published operating conditions without pretending summary rows are raw pressure data", () => {
  const points = buildGe2022OperatingPoints();
  const dataset = buildEnvelopeDataset(points, []);
  assert.equal(points.length, 13);
  assert.equal(dataset.physicalPointCount, 13);
  assert.equal(dataset.publishedPointCount, 13);
  assert.equal(dataset.signalReadyPointCount, 0);
  assert.equal(dataset.stablePointCount, 4);
  assert.equal(dataset.transitionalPointCount, 7);
  assert.equal(dataset.unstablePointCount, 2);
  assert.equal(dataset.points[0].evidenceType, "Published experiment summary");
  assert.equal(dataset.points[0].signalQuality, "Not available");
  assert.equal(dataset.points[0].modelUse, "Published summary only");
  assert.ok(Number.isNaN(points[0].inletPressureBar));

  const model = fitEnvelopeModel(dataset.points, GE_2022_DESIGN);
  assert.equal(model.status, "Not ready yet");
  assert.equal(model.observationCount, 0);
  assert.equal(model.gates[0].value, `0 / ${ENVELOPE_MODEL_MINIMUM_POINTS}`);
});
