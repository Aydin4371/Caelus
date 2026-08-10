import assert from "node:assert/strict";
import test from "node:test";

import { buildCaseDelta, buildCaseHistoryEvidence, summarizeCase } from "../lib/case-history.ts";
import type { AnalysisCase, CaseMetadata } from "../lib/caevera-types.ts";
import { buildCaseAssessment } from "../lib/diagnostics.ts";
import { DIAGNOSTIC_SOURCES, SOURCE_IDS_BY_CAUSE } from "../lib/diagnostic-knowledge.ts";
import {
  assessSignalQuality,
  compareSignals,
  makeDemoProbeSignals,
  parseProbeCsv,
  parseSignalCsv,
  recommendationFor,
  serializeReport,
  type Signal,
} from "../lib/rde-analysis.ts";
import { analyzeRdeProbeSet, compareProbeSets, phasePatternErrorDeg } from "../lib/wave-dynamics.ts";
import { assessResolvedDifference } from "../lib/uncertainty.ts";
import { CASE_INPUT_HELP } from "../lib/case-input-help.ts";
import { WAVE_METHOD_SOURCES } from "../lib/wave-method-sources.ts";

function sineSignal({
  name,
  amplitude = 1,
  bias = 1.5,
  frequency = 8,
  shiftMs = 0,
}: {
  name: string;
  amplitude?: number;
  bias?: number;
  frequency?: number;
  shiftMs?: number;
}): Signal {
  const count = 1600;
  const dtMs = 0.0025;
  const time = Array.from({ length: count }, (_, index) => index * dtMs);
  return {
    name,
    time,
    pressure: time.map((value) => bias + amplitude * Math.sin(2 * Math.PI * frequency * (value + shiftMs))),
  };
}

function close(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

const DEMO_METADATA: CaseMetadata = {
  name: "Synthetic test",
  annulusMeanDiameterMm: 82,
  annulusDiameterUncertaintyMm: 0.1,
  probePositionsDeg: [0, 47, 131, 226, 311],
  maximumWaveCount: 4,
  probeSynchronizationConfirmed: true,
  experimentSensorBandwidthKHz: 100,
  experimentFilterCutoffKHz: 80,
  inletPressureBar: 8,
  inletTemperatureK: 300,
  equivalenceRatio: 1,
  massFlowKgS: 0.62,
  comparisonMatchConfirmed: true,
  solver: "Research solver",
  solverVersion: "2026.1",
  dimensionality: "3D",
  spatialScheme: "MUSCL",
  spatialOrder: 2,
  numericalFlux: "HLLC",
  limiterFilter: "Venkatakrishnan limiter",
  temporalScheme: "SSPRK3",
  temporalOrder: 3,
  cfl: 0.35,
  turbulenceModel: "SST k-omega",
  combustionModel: "Finite-rate",
  chemistryModel: "Hydrogen reduced mechanism",
  chemistrySpecies: 9,
  chemistryReactions: 19,
  chemistryIntegrator: "Implicit BDF",
  meshCells: 2_500_000,
  minimumCellSizeMm: 0.25,
  cellsPerInductionLength: 8,
  nearWallCellSizeMm: 0.1,
  timeStepUs: 0.25,
  wallBoundaryCondition: "Isothermal 450 K",
  inletBoundaryCondition: "Measured total state + mass flow",
  outletBoundaryCondition: "Non-reflecting pressure outlet",
  initializationMethod: "Single-point ignition kernel",
  meshConvergencePct: 4.8,
  timeStepConvergencePct: 1.2,
  pressureUncertaintyPct: 1.5,
  timingUncertaintyUs: 0.5,
  cfdPressureUncertaintyPct: 2,
  cfdTimingUncertaintyUs: 0.25,
};

test("identical signals produce exact waveform agreement and cycle metrics", () => {
  const testSignal = sineSignal({ name: "test" });
  const result = compareSignals(testSignal, { ...testSignal, name: "cfd" });

  close(result.testFrequency, 8, 0.05, "test frequency");
  close(result.cfdFrequency, 8, 0.05, "CFD frequency");
  close(result.correlation, 1, 1e-12, "correlation");
  close(result.amplitudeError, 0, 1e-12, "amplitude error");
  close(result.phaseLagUs, 0, 1e-12, "phase lag");
  close(result.rmse, 0, 1e-12, "RMSE");
  assert.ok(result.testMetrics.cycleCount > 20);
  assert.ok(Number.isFinite(result.testMetrics.riseTimeUs));
  assert.equal(result.testQuality.status, "Ready");
  assert.ok(!("score" in result), "the arbitrary composite agreement score should be removed");
});

test("recovers a known sub-cycle lag and amplitude mismatch", () => {
  const testSignal = sineSignal({ name: "test" });
  const cfdSignal = sineSignal({ name: "cfd", amplitude: 0.8, shiftMs: 0.01 });
  const result = compareSignals(testSignal, cfdSignal);

  close(Math.abs(result.phaseLagUs), 10, 0.01, "absolute phase lag");
  close(result.amplitudeError, 0.2, 0.005, "amplitude error");
  assert.ok(result.correlation > 0.999);
  assert.equal(recommendationFor(result).title, "Test pressure-amplitude drivers");
});

test("data-quality assessment detects a missing sample interval", () => {
  const signal = sineSignal({ name: "gapped" });
  signal.time = signal.time.map((value, index) => index > 700 ? value + 0.01 : value);
  const quality = assessSignalQuality(signal, 8);
  assert.equal(quality.status, "Review");
  assert.equal(quality.detectedGaps, 1);
  assert.match(quality.findings.join(" "), /acquisition gap/i);
});

test("CSV parser converts SI units and records dropped source rows", () => {
  const rows = ["time_s,pressure_kPa"];
  for (let index = 0; index < 40; index += 1) rows.push(`${index * 0.0001},${1000 + index}`);
  rows.splice(20, 0, "bad,row");
  const signal = parseSignalCsv(rows.join("\n"), "unit-conversion.csv");
  close(signal.time[1], 0.1, 1e-12, "converted time");
  close(signal.pressure[0], 1, 1e-12, "converted pressure");
  assert.equal(signal.droppedRows, 1);
});

test("CSV parser rejects unnamed engineering columns", () => {
  const rows = ["column_a,column_b"];
  for (let index = 0; index < 40; index += 1) rows.push(`${index},${index + 1}`);
  assert.throws(() => parseSignalCsv(rows.join("\n"), "ambiguous.csv"), /named time and pressure columns/i);
});

test("three-probe parser reads synchronized pressure columns", () => {
  const rows = ["time_ms,p1_MPa,p2_kPa,p3_Pa"];
  for (let index = 0; index < 40; index += 1) rows.push(`${index * 0.01},${1 + index * 0.01},${2000 + index},${3_000_000 + index}`);
  const signals = parseProbeCsv(rows.join("\n"), "three-probe.csv");
  assert.equal(signals.length, 3);
  close(signals[0].pressure[0], 1, 1e-12, "P1 pressure");
  close(signals[1].pressure[0], 2, 1e-12, "P2 pressure");
  close(signals[2].pressure[0], 3, 1e-12, "P3 pressure");
});

test("five nonuniform probes recover an identifiable wave mode and alternative", () => {
  const demo = makeDemoProbeSignals();
  const result = analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82);
  assert.equal(result.waveCount, 1);
  assert.equal(result.direction, "Counter-clockwise");
  assert.equal(result.stability, "Stable");
  close(result.waveFrequencyKHz, 8.42, 0.08, "wave frequency");
  close(result.waveSpeedMps, Math.PI * 82 * 8.42, 22, "wave speed");
  assert.ok(result.phaseFit > 0.95);
  assert.ok(result.modeConfidence > 0.6);
  assert.equal(result.identifiability, "Identified");
  assert.ok(result.phaseResidualDeg < 5);
  assert.ok(result.alternativeWaveCount >= 1);
  const cfd = analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82);
  assert.ok(phasePatternErrorDeg(result, cfd) < 10);
});

test("probe-set comparison applies one shared lag to preserve spatial phase", () => {
  const demo = makeDemoProbeSignals();
  const result = compareProbeSets(demo.test, demo.cfd);
  assert.equal(result.comparisons.length, demo.test.length);
  assert.ok(result.comparisons.every((comparison) => Math.abs(comparison.phaseLagUs - result.sharedLagUs) < 1e-9));
  assert.ok(Number.isFinite(result.alignmentSpreadUs));
});

test("unconfirmed probe synchronization prevents a confident mode", () => {
  const demo = makeDemoProbeSignals();
  const result = analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82, { synchronizationConfirmed: false });
  assert.equal(result.identifiability, "Not identifiable");
  assert.ok(result.warnings.some((warning) => /synchronization/i.test(warning)));
});

test("cycle tracking detects frequency drift", () => {
  const positions = [0, 47, 131, 226, 311];
  const count = 2400;
  const dtMs = 0.002;
  const time = Array.from({ length: count }, (_, index) => index * dtMs);
  const signals = positions.map((position, probe) => ({
    name: `drifting P${probe + 1}`,
    time,
    pressure: time.map((value) => 1.5 + Math.sin(2 * Math.PI * (8 * value + 0.15 * value ** 2) - position * Math.PI / 180)),
  }));
  const result = analyzeRdeProbeSet(signals, positions, 82, { maximumWaveCount: 3, synchronizationConfirmed: true });
  assert.ok(Math.abs(result.frequencyDriftPct) > 5);
  assert.equal(result.stability, "Unstable");
  assert.ok(result.cycleSeries.length > 20);
});

test("sliding phase windows detect a wave-count transition", () => {
  const positions = [0, 47, 131, 226, 311];
  const count = 2400;
  const dtMs = 0.002;
  const time = Array.from({ length: count }, (_, index) => index * dtMs);
  const midpoint = time.at(-1)! / 2;
  const signals = positions.map((position, probe) => ({
    name: `switching P${probe + 1}`,
    time,
    pressure: time.map((value) => {
      const waves = value < midpoint ? 1 : 2;
      return 1.5 + Math.sin(2 * Math.PI * 8 * value - waves * position * Math.PI / 180);
    }),
  }));
  const result = analyzeRdeProbeSet(signals, positions, 82, { maximumWaveCount: 3, synchronizationConfirmed: true });
  assert.ok(result.modeTransitions >= 1);
  assert.equal(result.stability, "Unstable");
});

test("uncertainty distinguishes unresolved and resolved differences", () => {
  assert.equal(assessResolvedDifference(0.05, 0.04, 0.04).status, "within-uncertainty");
  assert.equal(assessResolvedDifference(0.1, 0.02, 0.02).status, "resolved-mismatch");
  assert.equal(assessResolvedDifference(0.1, Number.NaN, 0.02).status, "inconclusive");
});

test("case assessment connects validity, uncertainty, model inputs, and next run", () => {
  const demo = makeDemoProbeSignals();
  const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
  const experiment = analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82);
  const simulation = analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82);
  const result = buildCaseAssessment(DEMO_METADATA, comparisons, experiment, simulation);

  assert.equal(result.validity.status, "Valid");
  assert.equal(result.dataQuality.status, "Ready");
  assert.equal(result.metrics.length, 16);
  assert.ok(result.metrics.some((metric) => metric.id === "phase-pattern"));
  assert.ok(result.metrics.some((metric) => metric.id === "phase-jitter"));
  assert.ok(result.metrics.some((metric) => metric.assessment.status === "resolved-mismatch"));
  assert.ok(result.hypotheses[0].modelInputs.length > 0);
  assert.ok(!("score" in result.hypotheses[0]), "diagnostic ranking must not expose an arbitrary score");
  assert.ok(result.hypotheses[0].evidence.every((item) => ["supports", "weakens", "unknown", "cannot-assess"].includes(item.state)));
  assert.ok(result.hypotheses[0].sourceIds.length > 0);
  assert.ok(result.nextRun.holdFixed.length >= 4);
  assert.match(result.nextRun.confirmationCriterion, /%|cycles|uncertainty/i);
  assert.ok(result.coverage.some((item) => item.module === "Thermal" && item.status === "Not assessed"));
});

test("case assessment blocks recommendations when the physical pairing is unconfirmed", () => {
  const demo = makeDemoProbeSignals();
  const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
  const experiment = analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82);
  const simulation = analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82);
  const result = buildCaseAssessment({ ...DEMO_METADATA, comparisonMatchConfirmed: false }, comparisons, experiment, simulation);
  assert.equal(result.validity.status, "Blocked");
  assert.match(result.nextRun.title, /verify/i);
});

test("case-history comparison calculates direct physical and CFD-error deltas", () => {
  const demo = makeDemoProbeSignals();
  const baseline: AnalysisCase = { id: "a", source: "demo", metadata: DEMO_METADATA, testSignals: demo.test, cfdSignals: demo.cfd };
  const candidate: AnalysisCase = {
    id: "b",
    source: "demo",
    metadata: { ...DEMO_METADATA, name: "Candidate", equivalenceRatio: 1.05 },
    testSignals: demo.test.map((signal) => ({ ...signal, pressure: signal.pressure.map((value) => value * 1.05) })),
    cfdSignals: demo.cfd.map((signal) => ({ ...signal, pressure: signal.pressure.map((value) => value * 1.05) })),
  };
  const delta = buildCaseDelta(summarizeCase(baseline), summarizeCase(candidate));
  close(delta.condition.equivalenceRatio, 0.05, 1e-12, "equivalence-ratio delta");
  assert.ok(delta.experiment.peakPressureMpa > 0);
  assert.ok(Number.isFinite(delta.cfdAgreement.amplitudeErrorPointChange));
});

test("controlled mesh rerun becomes strong case-history evidence", () => {
  const demo = makeDemoProbeSignals();
  const baseline: AnalysisCase = { id: "base", source: "demo", relationship: null, metadata: DEMO_METADATA, testSignals: demo.test, cfdSignals: demo.cfd };
  const refined: AnalysisCase = {
    id: "fine",
    source: "demo",
    relationship: { baselineCaseId: "base", changedVariable: "mesh", description: "50% front-cell refinement" },
    metadata: { ...DEMO_METADATA, name: "Fine mesh", meshCells: 5_000_000, minimumCellSizeMm: 0.125, cellsPerInductionLength: 16, nearWallCellSizeMm: 0.05, meshConvergencePct: 1.7 },
    testSignals: demo.test,
    cfdSignals: demo.cfd.map((signal, probe) => ({ ...signal, pressure: signal.pressure.map((value, index) => value + 0.95 * (demo.test[probe].pressure[index] - value)) })),
  };
  const history = buildCaseHistoryEvidence([baseline, refined], baseline.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].controlled, true);
  assert.equal(history[0].causeId, "spatial-resolution");
  assert.equal(history[0].state, "supports");
  assert.equal(history[0].strength, "strong");

  const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
  const result = buildCaseAssessment(DEMO_METADATA, comparisons, analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82), analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82), history);
  assert.equal(result.hypotheses[0].id, "spatial-resolution");
  assert.match(result.nextRun.title, /mesh-convergence/i);
});

test("diagnostic source records are complete and mapped", () => {
  assert.ok(DIAGNOSTIC_SOURCES.length >= 8);
  const expectedCitations = new Map([
    ["strakey-ferguson-2022", ["10.2514/6.2022-1113", "Validation of a Computational Fluid Dynamics Model of a Methane-Oxygen Rotating Detonation Engine"]],
    ["tobias-agrawal-paxson-2022", ["10.2514/6.2022-1879", "Experimental and Computational Analysis of a Rotating Detonation Combustor"]],
    ["batista-et-al-2026", ["10.2514/6.2026-2419", "Spatiotemporal Sensitivity in Rotating Detonation Rocket Engine Large Eddy Simulations"]],
    ["dille-et-al-2024", ["10.1063/5.0195465", "Rotating detonation combustor performance informed through a novel megahertz-rate stagnation pressure measurement"]],
    ["yan-teng-ng-2021", ["10.1016/j.actaastro.2021.02.010", "Effects of slot injection on detonation wavelet characteristics in a rotating detonation engine"]],
    ["paxson-miki-2022", ["10.2514/6.2022-1263", "Computational Assessment of Inlet Backflow Effects on Rotating Detonation Engine Performance and Operability"]],
    ["yao-wang-2016", ["10.1016/j.applthermaleng.2016.07.166", "Multiple ignitions and the stability of rotating detonation waves"]],
    ["nist-ir-8298", ["10.6028/NIST.IR.8298", "A Summary of Industrial Verification, Validation, and Uncertainty Quantification Procedures in Computational Fluid Dynamics"]],
  ]);
  assert.equal(DIAGNOSTIC_SOURCES.length, expectedCitations.size);
  assert.equal(new Set(DIAGNOSTIC_SOURCES.map((source) => source.id)).size, DIAGNOSTIC_SOURCES.length);
  for (const source of DIAGNOSTIC_SOURCES) {
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.doi.length > 5);
    assert.ok(source.finding.length > 20);
    assert.ok(source.limitation.length > 20);
    assert.deepEqual([source.doi, source.title], expectedCitations.get(source.id), `citation drift for ${source.id}`);
  }
  const sourceIds = new Set(DIAGNOSTIC_SOURCES.map((source) => source.id));
  for (const mappedIds of Object.values(SOURCE_IDS_BY_CAUSE)) {
    for (const id of mappedIds) assert.ok(sourceIds.has(id), `unknown mapped source ${id}`);
  }
  assert.ok(SOURCE_IDS_BY_CAUSE["spatial-resolution"].length >= 2);
  assert.deepEqual(SOURCE_IDS_BY_CAUSE["initialization-mode"], ["yao-wang-2016"]);
  assert.deepEqual(SOURCE_IDS_BY_CAUSE["missing-unsteadiness"], []);
});

test("pressure and wave method sources retain reviewed citation metadata", () => {
  const expected = new Map([
    ["bohon-et-al-2019", "10.1007/s10494-019-00017-z"],
    ["durkee-et-al-2026", "10.2514/6.2026-2036"],
    ["pritschau-et-al-2025", "10.1016/j.combustflame.2025.114057"],
    ["tobias-et-al-2022", "10.2514/6.2022-1879"],
    ["sato-et-al-2025", "10.2514/1.A36447"],
  ]);
  assert.equal(WAVE_METHOD_SOURCES.length, expected.size);
  for (const source of WAVE_METHOD_SOURCES) {
    assert.equal(source.doi, expected.get(source.id));
    assert.equal(source.url, `https://doi.org/${source.doi}`);
    assert.ok(source.supports.length > 50);
    assert.ok(source.limitation.length > 50);
  }
});

test("case input guide documents every model-card field", () => {
  const documented = new Set(CASE_INPUT_HELP.flatMap((group) => group.items.map((item) => item.key)));
  for (const key of Object.keys(DEMO_METADATA)) assert.ok(documented.has(key as keyof CaseMetadata), `missing input help for ${key}`);
  for (const key of ["baselineCaseId", "changedVariable", "changeDescription", "experimentCsv", "cfdCsv"]) {
    assert.ok(documented.has(key as never), `missing input help for ${key}`);
  }
});

test("serialized report exposes cycle metrics, data quality, provenance, and limitations", () => {
  const result = compareSignals(sineSignal({ name: "test" }), sineSignal({ name: "cfd", bias: 1.55 }));
  const report = JSON.parse(serializeReport(result, { test: "test.csv", cfd: "cfd.csv" }));
  assert.equal(report.schema, "caevera-rde-comparison-report");
  assert.equal(report.sources.test, "test.csv");
  assert.equal(report.units.pressure, "MPa");
  close(report.metrics.pressureBias, 0.05, 1e-12, "pressure bias");
  assert.ok(report.metrics.pressureCycleMetrics.experiment.cycleCount > 20);
  assert.equal(report.dataQuality.experiment.status, "Ready");
  assert.ok(report.limitations.length >= 3);
});
