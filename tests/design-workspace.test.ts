import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_ENGINE_DESIGN, buildScreeningPlan, calculateDesign, selectCoverageNextPoint, validateEngineDesign, type OperatingPoint } from "../lib/design-workspace.ts";
import { deserializeWorkspace, serializeWorkspace } from "../lib/workspace.ts";
import { makeDemoProbeSignals } from "../lib/rde-analysis.ts";
import { GE_2022_DESIGN, buildGe2022OperatingPoints } from "../lib/published-envelope-data.ts";
import { createEngineRevision, engineManifestFingerprint, normalizedEngineRevision } from "../lib/engine-manifest.ts";

const design = {
  ...EMPTY_ENGINE_DESIGN,
  id: "design-1",
  name: "Hydrogen annular demonstrator",
  annulusInnerDiameterMm: 78,
  annulusOuterDiameterMm: 86,
  chamberLengthMm: 120,
  injectorCount: 120,
  injectorDiameterMm: 0.8,
  plenumVolumeCm3: 300,
  equivalenceRatioMin: 0.7,
  equivalenceRatioMax: 1.3,
  massFlowKgSMin: 0.4,
  massFlowKgSMax: 0.8,
  inletPressureBarMin: 6,
  inletPressureBarMax: 10,
  inletTemperatureK: 300,
  backPressureBar: 1,
};

test("calculates geometry and flow quantities directly from entered design values", () => {
  assert.deepEqual(validateEngineDesign(design), []);
  const result = calculateDesign(design);
  assert.equal(result.meanDiameterMm, 82);
  assert.equal(result.annulusGapMm, 4);
  assert.ok(result.annulusAreaMm2 > 0);
  assert.ok(result.injectorAreaRatioPct > 0);
  assert.equal(result.minimumPressureRatio, 6);
});

test("creates immutable engine revisions without changing the prior evidence identity", () => {
  const first = createEngineRevision(design, null, "2026-08-27T00:00:00.000Z");
  const second = createEngineRevision({ ...first, chamberLengthMm: 130 }, first, "2026-08-28T00:00:00.000Z");
  assert.equal(normalizedEngineRevision(first).number, 1);
  assert.equal(normalizedEngineRevision(second).number, 2);
  assert.equal(second.revision?.supersedesDesignId, first.id);
  assert.notEqual(second.id, first.id);
  assert.notEqual(engineManifestFingerprint(second), engineManifestFingerprint(first));
  assert.equal(first.chamberLengthMm, 120);
});

test("requires and preserves a real air-breathing inlet definition", () => {
  const airBreathing = {
    ...design,
    application: "Air-breathing" as const,
    oxidizer: "Air",
    build: {
      ...design.build!,
      airInletArchitecture: "Ram-fed" as const,
      airFuelPreparation: "Separate fuel injection" as const,
    },
  };
  assert.deepEqual(validateEngineDesign(airBreathing), []);
  assert.match(validateEngineDesign({ ...airBreathing, build: { ...airBreathing.build, airInletArchitecture: "Not defined" as const } }).join(" "), /air-inlet architecture/i);
});

test("starts an unobserved screening plan at the entered range center", () => {
  const points = buildScreeningPlan(design, []);
  assert.equal(points.length, 9);
  assert.equal(selectCoverageNextPoint(points)?.id, "baseline");
  assert.equal(points[0].equivalenceRatio, 1);
  assert.ok(Math.abs(points[0].massFlowKgS - 0.6) < 1e-12);
  assert.equal(points[0].inletPressureBar, 8);
});

test("marks a directly observed operating point without inventing predictions", () => {
  const item: OperatingPoint = {
    id: "observed",
    designId: design.id,
    name: "Observed center",
    source: "uploaded",
    equivalenceRatio: 1,
    massFlowKgS: 0.6,
    inletPressureBar: 8,
    inletTemperatureK: 300,
    backPressureBar: 1,
  };
  const points = buildScreeningPlan(design, [item]);
  assert.equal(points[0].matchedOperatingPointId, item.id);
  assert.notEqual(selectCoverageNextPoint(points)?.id, "baseline");
});

test("saves engine designs without saving generated recommendations", () => {
  const text = serializeWorkspace({ cases: [], activeCaseId: null, baselineCaseId: null, designs: [design], activeDesignId: design.id, operatingPoints: [], activeOperatingPointId: null });
  assert.doesNotMatch(text, /coverage-based next point|predicted stable/i);
  const restored = deserializeWorkspace(text);
  assert.equal(restored.designs[0].name, design.name);
  assert.equal(restored.activeDesignId, design.id);
  assert.equal(restored.designs[0].revision?.number, 1);
  assert.equal(restored.designs[0].revision?.fingerprint, engineManifestFingerprint(restored.designs[0]));
});

test("saves a measured operating point before any CFD run exists", () => {
  const demo = makeDemoProbeSignals();
  const point: OperatingPoint = {
    id: "measured-only",
    designId: design.id,
    name: "Measured only",
    source: "uploaded",
    inletPressureBar: 8,
    inletTemperatureK: 300,
    equivalenceRatio: 1,
    massFlowKgS: 0.6,
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
      physics: { netThrustN: 125, sustainedDurationS: 2.5 },
    },
  };
  const text = serializeWorkspace({ cases: [], activeCaseId: null, baselineCaseId: null, designs: [design], activeDesignId: design.id, operatingPoints: [point], activeOperatingPointId: point.id });
  const restored = deserializeWorkspace(text);
  assert.equal(restored.cases.length, 0);
  assert.equal(restored.operatingPoints[0].experiment?.signals.length, demo.test.length);
  assert.equal(restored.operatingPoints[0].experiment?.physics?.netThrustN, 125);
  assert.equal(restored.operatingPoints[0].experiment?.physics?.sustainedDurationS, 2.5);
  assert.equal(restored.activeOperatingPointId, point.id);
});

test("round-trips source-backed published summaries with unreported plenum pressure", () => {
  const points = buildGe2022OperatingPoints();
  assert.deepEqual(validateEngineDesign(GE_2022_DESIGN), []);
  const text = serializeWorkspace({ cases: [], activeCaseId: null, baselineCaseId: null, designs: [GE_2022_DESIGN], activeDesignId: GE_2022_DESIGN.id, operatingPoints: points, activeOperatingPointId: points[0].id });
  const restored = deserializeWorkspace(text);
  assert.equal(restored.operatingPoints.length, 13);
  assert.equal(restored.operatingPoints[0].source, "published");
  assert.ok(Number.isNaN(restored.operatingPoints[0].inletPressureBar));
  assert.match(restored.operatingPoints[0].publishedObservation?.sourceLocator ?? "", /Table 1/i);
});
