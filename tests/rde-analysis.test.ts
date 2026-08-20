import assert from "node:assert/strict";
import test from "node:test";

import { buildCaseDelta, buildCaseHistoryEvidence, selectIndependentPrecedents, selectPlanningEvidence, summarizeCase, type CaseHistoryEvidence } from "../lib/case-history.ts";
import type { AnalysisCase, CaseMetadata } from "../lib/caevera-types.ts";
import { buildCaseAssessment } from "../lib/diagnostics.ts";
import { DIAGNOSTIC_SOURCES, RESEARCH_CLAIMS_BY_CAUSE, SOURCE_IDS_BY_CAUSE } from "../lib/diagnostic-knowledge.ts";
import {
  assessSignalQuality,
  compareSignals,
  makeDemoProbeSignals,
  parseProbeCsv,
  parseSignalCsv,
  serializeReport,
  type Signal,
} from "../lib/rde-analysis.ts";
import { analyzeRdeProbeSet, compareProbeSets, phasePatternErrorDeg } from "../lib/wave-dynamics.ts";
import { assessResolvedDifference } from "../lib/uncertainty.ts";
import { CASE_INPUT_HELP } from "../lib/case-input-help.ts";
import { WAVE_METHOD_SOURCES } from "../lib/wave-method-sources.ts";
import { mapProbeTable, parseDelimitedTable, suggestImportMapping } from "../lib/data-import.ts";
import { deserializeWorkspace, serializeWorkspace, WORKSPACE_SCHEMA } from "../lib/workspace.ts";
import { PUBLISHED_VALIDATION_SOURCES, PUBLISHED_WAVE_SPEED_BENCHMARKS, RAW_DATASET_VALIDATION_CASES, waveSpeedFromPassageFrequency } from "../lib/published-benchmarks.ts";

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
  solverRuntimeHours: 10,
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
  assert.ok(result.hypotheses[0].researchClaims.length > 0);
  assert.ok(result.nextRun.holdFixed.length >= 4);
  assert.match(result.nextRun.confirmationCriterion, /%|cycles|uncertainty/i);
  assert.ok(["Evidence gate", "Numerical verification", "Physics sensitivity", "Validation expansion"].includes(result.nextRun.stage));
  assert.match(result.nextRun.whyThisRunFirst, /first|prerequisite/i);
  assert.match(result.nextRun.inconclusiveCriterion, /does not reach.*does not meet|uncertainty/i);
  assert.ok(result.nextRun.ifConfirmed.length > 30);
  assert.ok(result.nextRun.ifRejected.length > 30);
  assert.ok(result.nextRun.ifInconclusive.length > 30);
  assert.equal(result.nextRun.reasoningLedger.hypothesisTitle, result.hypotheses[0].title);
  assert.ok(result.nextRun.reasoningLedger.supports.every((item) => item.state === "supports"));
  assert.ok(result.nextRun.reasoningLedger.weakens.every((item) => item.state === "weakens"));
  assert.ok(result.nextRun.reasoningLedger.unknowns.every((item) => item.state === "unknown" || item.state === "cannot-assess"));
  assert.ok(result.nextRun.reasoningLedger.unknowns.length > 0, "an unresolved next-run requirement must be explicit");
  assert.ok(result.nextRun.reasoningLedger.unknowns.some((item) => item.basis === "policy") || result.hypotheses[0].evidence.some((item) => item.state === "unknown" || item.state === "cannot-assess"));
  assert.equal(result.nextRun.question.endsWith("?"), true);
  assert.ok(result.nextRun.decisionPolicy.targetedMetricIds.length > 0);
  assert.equal(result.nextRun.decisionPolicy.basis, "prototype-policy");
  assert.match(result.nextRun.decisionPolicy.version, /^2026\./);
  assert.equal(result.nextRun.latestControlledResult.status, "Awaiting result");
  assert.ok(result.coverage.some((item) => item.module === "Thermal" && item.status === "Not assessed"));
});

test("case assessment blocks recommendations when the physical pairing is unconfirmed", () => {
  const demo = makeDemoProbeSignals();
  const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
  const experiment = analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82);
  const simulation = analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82);
  const result = buildCaseAssessment({ ...DEMO_METADATA, comparisonMatchConfirmed: false }, comparisons, experiment, simulation);
  assert.equal(result.validity.status, "Blocked");
  assert.match(result.nextRun.title, /correct/i);
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
    metadata: { ...DEMO_METADATA, name: "Fine mesh", meshCells: 5_000_000, minimumCellSizeMm: 0.125, cellsPerInductionLength: 16, nearWallCellSizeMm: 0.05, meshConvergencePct: 1.7, solverRuntimeHours: 18 },
    testSignals: demo.test,
    cfdSignals: demo.cfd.map((signal, probe) => ({ ...signal, pressure: signal.pressure.map((value, index) => value + 0.95 * (demo.test[probe].pressure[index] - value)) })),
  };
  const history = buildCaseHistoryEvidence([baseline, refined], baseline.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].controlled, true);
  assert.equal(history[0].causeId, "spatial-resolution");
  assert.equal(history[0].state, "supports");
  assert.equal(history[0].strength, "strong");
  assert.equal(history[0].sequenceStatus, "effect-confirmed");
  assert.equal(history[0].planDisposition, "continue");
  assert.ok((history[0].errorReductionPct ?? 0) >= 25);
  assert.ok((history[0].responseMagnitudePct ?? 0) > 0);
  assert.deepEqual(history[0].targetedMetrics, ["peak-pressure", "rise-time", "harmonics"]);

  const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
  const result = buildCaseAssessment(DEMO_METADATA, comparisons, analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82), analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82), history);
  assert.equal(result.hypotheses[0].id, "spatial-resolution");
  assert.match(result.nextRun.title, /mesh.*convergence/i);
  assert.match(result.nextRun.change, /0\.125 mm/, "the next run must start from the accepted fine mesh, not stale baseline metadata");
  assert.equal(result.nextRun.latestControlledResult.status, "Confirmed");
  assert.equal(result.nextRun.latestControlledResult.caseName, "Fine mesh");
  assert.equal(result.nextRun.decisionPolicy.evaluationMode, "numerical-convergence");
  assert.match(result.nextRun.confirmationCriterion, /no more than 2%/i);
  assert.match(result.nextRun.rejectionCriterion, /more than 2%/i);
  assert.match(result.nextRun.inconclusiveCriterion, /not a valid one-change pair|targeted CFD value is unavailable/i);
  assert.equal(result.nextRun.precedent.level, "Demonstration");
  assert.equal(result.nextRun.precedent.matchedCount, 1);
  assert.equal(result.nextRun.precedent.confirmedCount, 1);
  assert.equal(result.nextRun.precedent.syntheticCount, 1);
  assert.equal(result.nextRun.precedent.uploadedCount, 0);
  close(result.nextRun.precedent.meanRuntimeMultiplier ?? 0, 1.8, 1e-12, "precedent runtime multiplier");
  assert.equal(result.nextRun.precedent.runtimeCaseCount, 1);
  assert.ok(result.nextRun.precedent.metricImprovements.some((item) => item.metricId === "peak-pressure" && item.meanReductionPct > 0));
});

test("numerical convergence stays separate from experiment agreement", () => {
  const demo = makeDemoProbeSignals();
  const blend = (factor: number) => demo.cfd.map((signal, probe) => ({
    ...signal,
    pressure: signal.pressure.map((value, index) => value + factor * (demo.test[probe].pressure[index] - value)),
  }));
  const baseline: AnalysisCase = { id: "base", source: "demo", relationship: null, metadata: DEMO_METADATA, testSignals: demo.test, cfdSignals: demo.cfd };
  const fine: AnalysisCase = {
    id: "fine",
    source: "demo",
    relationship: { baselineCaseId: baseline.id, referenceCaseId: baseline.id, changedVariable: "mesh", description: "First mesh refinement" },
    metadata: { ...DEMO_METADATA, name: "Fine mesh", meshCells: 5_000_000, minimumCellSizeMm: 0.125, cellsPerInductionLength: 16, nearWallCellSizeMm: 0.05 },
    testSignals: demo.test,
    cfdSignals: blend(0.95),
  };
  const finer: AnalysisCase = {
    id: "finer",
    source: "demo",
    relationship: { baselineCaseId: baseline.id, referenceCaseId: fine.id, changedVariable: "mesh", description: "Second mesh refinement" },
    metadata: { ...fine.metadata, name: "Finer mesh", meshCells: 10_000_000, minimumCellSizeMm: 0.0625, cellsPerInductionLength: 32, nearWallCellSizeMm: 0.025 },
    testSignals: demo.test,
    cfdSignals: blend(0.55),
  };

  const history = buildCaseHistoryEvidence([baseline, fine, finer], baseline.id);
  assert.ok((history[1].incrementalResponsePct ?? 0) > 2, "the adjacent mesh response must remain above the convergence limit");
  assert.ok((history[1].errorReductionPct ?? 0) < -5, "agreement must worsen for this regression case");
  assert.equal(history[1].sequenceStatus, "effect-confirmed", "worse agreement must not be mistaken for mesh independence");
  assert.equal(history[1].planDisposition, "continue");
  assert.match(history[1].detail, /did not complete numerical convergence/i);
  assert.match(history[1].detail, /CFD-to-experiment error.*increased/i);
  assert.equal(selectPlanningEvidence(history, baseline.id)?.caseId, finer.id, "the finer numerical setting remains the accepted starting point");
});

test("a rejected chained rerun resumes from the latest accepted case without reusing baseline error reduction", () => {
  const demo = makeDemoProbeSignals();
  const blend = (signals: Signal[], factor: number) => signals.map((signal, probe) => ({
    ...signal,
    pressure: signal.pressure.map((value, index) => value + factor * (demo.test[probe].pressure[index] - value)),
  }));
  const baseline: AnalysisCase = { id: "base", source: "demo", relationship: null, metadata: DEMO_METADATA, testSignals: demo.test, cfdSignals: demo.cfd };
  const fineSignals = blend(demo.cfd, 0.95);
  const fine: AnalysisCase = {
    id: "fine",
    source: "demo",
    relationship: { baselineCaseId: baseline.id, referenceCaseId: baseline.id, changedVariable: "mesh", description: "First mesh refinement" },
    metadata: { ...DEMO_METADATA, name: "Fine mesh", meshCells: 5_000_000, minimumCellSizeMm: 0.125, cellsPerInductionLength: 16, nearWallCellSizeMm: 0.05 },
    testSignals: demo.test,
    cfdSignals: fineSignals,
  };
  const wall: AnalysisCase = {
    id: "wall",
    source: "demo",
    relationship: { baselineCaseId: baseline.id, referenceCaseId: fine.id, changedVariable: "wall", description: "Adjacent wall condition" },
    metadata: { ...fine.metadata, name: "Wall bracket", wallBoundaryCondition: "Adiabatic" },
    testSignals: demo.test,
    cfdSignals: blend(fineSignals, 0.001),
  };

  const history = buildCaseHistoryEvidence([baseline, fine, wall], baseline.id);
  assert.equal(history[0].sequenceStatus, "effect-confirmed");
  assert.equal(history[1].referenceCaseId, fine.id);
  assert.equal(history[1].sequenceStatus, "rejected");
  assert.ok(Math.abs(history[1].errorReductionPct ?? 100) < 1, "wall outcome must be measured from the fine-mesh starting case");
  assert.equal(selectPlanningEvidence(history, baseline.id)?.caseId, fine.id);

  const fineSummary = summarizeCase(fine);
  const plan = buildCaseAssessment(fine.metadata, compareProbeSets(fine.testSignals, fine.cfdSignals).comparisons, fineSummary.experiment, fineSummary.simulation, history);
  assert.match(plan.nextRun.title, /mesh.*convergence/i);
  assert.match(plan.nextRun.change, /0\.125 mm/);
  assert.ok(plan.nextRun.reasoningLedger.unknowns.some((item) => /convergence rule/i.test(item.observation)));
});

test("uploaded pressure arrays determine precedent effects instead of preset values", () => {
  const demo = makeDemoProbeSignals();
  const compute = (blend: number) => {
    const baseline: AnalysisCase = { id: "uploaded-base", source: "uploaded", relationship: null, metadata: DEMO_METADATA, testSignals: demo.test, cfdSignals: demo.cfd };
    const refined: AnalysisCase = {
      id: `uploaded-fine-${blend}`,
      source: "uploaded",
      relationship: { baselineCaseId: baseline.id, changedVariable: "mesh", description: "Uploaded mesh refinement" },
      metadata: { ...DEMO_METADATA, name: `Uploaded fine mesh ${blend}`, meshCells: 5_000_000, minimumCellSizeMm: 0.125, cellsPerInductionLength: 16, nearWallCellSizeMm: 0.05, solverRuntimeHours: 18 },
      testSignals: demo.test,
      cfdSignals: demo.cfd.map((signal, probe) => ({ ...signal, pressure: signal.pressure.map((value, index) => value + blend * (demo.test[probe].pressure[index] - value)) })),
    };
    const history = buildCaseHistoryEvidence([baseline, refined], baseline.id);
    const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
    const assessment = buildCaseAssessment(DEMO_METADATA, comparisons, analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82), analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82), history, history);
    return { evidence: history[0], precedent: assessment.nextRun.precedent };
  };
  const moderate = compute(0.9);
  const strong = compute(0.95);
  assert.equal(moderate.precedent.level, "Limited");
  assert.equal(moderate.precedent.uploadedCount, 1);
  assert.equal(moderate.precedent.syntheticCount, 0);
  assert.equal(moderate.precedent.runtimeCaseCount, 1);
  close(moderate.precedent.meanRuntimeMultiplier ?? 0, 1.8, 1e-12, "uploaded runtime multiplier");
  const moderatePeak = moderate.precedent.metricImprovements.find((item) => item.metricId === "peak-pressure")?.meanReductionPct ?? Number.NaN;
  const strongPeak = strong.precedent.metricImprovements.find((item) => item.metricId === "peak-pressure")?.meanReductionPct ?? Number.NaN;
  close(moderatePeak, moderate.evidence.metricErrorReductionPct["peak-pressure"], 1e-12, "moderate uploaded peak reduction");
  close(strongPeak, strong.evidence.metricErrorReductionPct["peak-pressure"], 1e-12, "strong uploaded peak reduction");
  assert.ok(strongPeak > moderatePeak, "changing the uploaded CFD arrays must change the displayed precedent effect");
});

test("three uploaded comparable reruns become repeated workspace precedent", () => {
  const demo = makeDemoProbeSignals();
  const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
  const experiment = analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82);
  const simulation = analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82);
  const precedents = [1, 2, 3].map((index) => ({
    causeId: "spatial-resolution" as const,
    changedVariable: "mesh" as const,
    state: "supports" as const,
    strength: "strong" as const,
    caseId: `prior-${index}`,
    caseName: `Prior mesh ${index}`,
    caseSource: "uploaded" as const,
    detail: "Controlled mesh refinement reduced the targeted mismatch.",
    controlled: true,
    sequenceStatus: "effect-confirmed" as const,
    planDisposition: "continue" as const,
    baselineMismatchMetricIds: ["peak-pressure", "rise-time"],
    metricErrorReductionPct: { "peak-pressure": 60 + index, "rise-time": 40 + index },
    runtimeMultiplier: 1.5 + index * 0.1,
  }));
  const result = buildCaseAssessment(DEMO_METADATA, comparisons, experiment, simulation, precedents.slice(0, 1), precedents);
  assert.equal(result.nextRun.precedent.level, "Repeated");
  assert.equal(result.nextRun.precedent.matchedCount, 3);
  assert.equal(result.nextRun.precedent.confirmedCount, 3);
  assert.equal(result.nextRun.precedent.uploadedCount, 3);
  close(result.nextRun.precedent.meanRuntimeMultiplier ?? 0, 1.7, 1e-12, "mean runtime multiplier");
  assert.equal(result.nextRun.precedent.runtimeCaseCount, 3);
});

test("adaptive plan exposes rejected and inconclusive controlled outcomes", () => {
  const demo = makeDemoProbeSignals();
  const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
  const experiment = analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82);
  const simulation = analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82);
  const baseEvidence = {
    causeId: "spatial-resolution" as const,
    strength: "strong" as const,
    caseId: "rerun",
    caseName: "Controlled rerun",
    detail: "The controlled run did not produce a decisive targeted response.",
    controlled: true,
  };
  const rejected = buildCaseAssessment(DEMO_METADATA, comparisons, experiment, simulation, [{ ...baseEvidence, changedVariable: "mesh", state: "weakens", sequenceStatus: "rejected", planDisposition: "advance" }]);
  const inconclusive = buildCaseAssessment(DEMO_METADATA, comparisons, experiment, simulation, [{ ...baseEvidence, changedVariable: "mesh", state: "unknown", sequenceStatus: "inconclusive", planDisposition: "repeat" }]);
  assert.equal(rejected.nextRun.latestControlledResult.status, "Rejected");
  assert.doesNotMatch(rejected.nextRun.title, /mesh/i, "a rejected mesh sensitivity must advance to another hypothesis");
  assert.match(rejected.nextRun.ifRejected, /next|repair|keep/i);
  assert.equal(inconclusive.nextRun.latestControlledResult.status, "Inconclusive");
  assert.match(inconclusive.nextRun.title, /repeat the mesh test/i);
  assert.match(inconclusive.nextRun.ifInconclusive, /adjacent-level|unavailable/i);
});

test("a related case is diagnostic only when every experiment sample and one CFD group match", () => {
  const demo = makeDemoProbeSignals();
  const baseline: AnalysisCase = { id: "base", source: "demo", relationship: null, metadata: DEMO_METADATA, testSignals: demo.test, cfdSignals: demo.cfd };
  const changedExperiment = demo.test.map((signal, probe) => ({
    ...signal,
    pressure: signal.pressure.map((value, index) => probe === 0 && index === signal.pressure.length - 1 ? value + 0.01 : value),
  }));
  const candidate: AnalysisCase = {
    id: "candidate",
    source: "demo",
    relationship: { baselineCaseId: "base", changedVariable: "mesh", description: "Mesh plus hidden changes" },
    metadata: { ...DEMO_METADATA, name: "Uncontrolled", minimumCellSizeMm: 0.125, meshCells: 5_000_000, turbulenceModel: "LES" },
    testSignals: changedExperiment,
    cfdSignals: demo.cfd,
  };
  const evidence = buildCaseHistoryEvidence([baseline, candidate], baseline.id)[0];
  assert.equal(evidence.controlled, false);
  assert.equal(evidence.sequenceStatus, "comparison-only");
  assert.equal(evidence.planDisposition, "ignore");
  assert.ok(evidence.relationshipIssues.some((issue) => /experiment pressure samples differ/i.test(issue)));
  assert.ok(evidence.relationshipIssues.some((issue) => /turbulence model/i.test(issue)));
  assert.match(evidence.detail, /experiment pressure samples differ/i);
  assert.match(evidence.detail, /more than one CFD setting group changed.*additional changes: turbulence model/i);

  const unchangedInlet: AnalysisCase = {
    id: "unchanged-inlet",
    source: "demo",
    relationship: { baselineCaseId: "base", referenceCaseId: "base", changedVariable: "inlet", description: "Declared inlet rerun" },
    metadata: { ...DEMO_METADATA, name: "Unchanged inlet" },
    testSignals: demo.test,
    cfdSignals: demo.cfd,
  };
  const unchangedEvidence = buildCaseHistoryEvidence([baseline, unchangedInlet], baseline.id)[0];
  assert.equal(unchangedEvidence.controlled, false);
  assert.deepEqual(unchangedEvidence.relationshipIssues, ["No inlet setting differs from the starting case Synthetic test."]);

  const uncertaintyUpdated: AnalysisCase = {
    id: "uncertainty-updated",
    source: "demo",
    relationship: { baselineCaseId: "base", referenceCaseId: "base", changedVariable: "mesh", description: "Mesh rerun with updated result uncertainty" },
    metadata: { ...DEMO_METADATA, name: "Mesh uncertainty update", minimumCellSizeMm: 0.125, cfdPressureUncertaintyPct: 1.5, cfdTimingUncertaintyUs: 0.15 },
    testSignals: demo.test,
    cfdSignals: demo.cfd,
  };
  const uncertaintyEvidence = buildCaseHistoryEvidence([baseline, uncertaintyUpdated], baseline.id)[0];
  assert.equal(uncertaintyEvidence.controlled, true, "run-result uncertainty metadata is not an additional CFD model change");
  assert.deepEqual(uncertaintyEvidence.changedSettings, ["minimumCellSizeMm"]);
});

test("measured unsteady forcing has a classifiable rerun path", () => {
  const demo = makeDemoProbeSignals();
  const baseline: AnalysisCase = { id: "base", source: "demo", relationship: null, metadata: DEMO_METADATA, testSignals: demo.test, cfdSignals: demo.cfd };
  const candidate: AnalysisCase = {
    id: "forcing",
    source: "demo",
    relationship: { baselineCaseId: "base", changedVariable: "unsteadiness", description: "Measured inlet-pressure history" },
    metadata: { ...DEMO_METADATA, name: "Measured forcing", inletBoundaryCondition: "Measured synchronized inlet-pressure history" },
    testSignals: demo.test,
    cfdSignals: demo.cfd.map((signal) => ({ ...signal, pressure: signal.pressure.map((value, index) => value * (1 + 0.02 * Math.sin(index / 90))) })),
  };
  const evidence = buildCaseHistoryEvidence([baseline, candidate], baseline.id)[0];
  assert.equal(evidence.controlled, true);
  assert.equal(evidence.causeId, "missing-unsteadiness");
  assert.deepEqual(evidence.targetedMetrics, ["cycle-variability", "frequency-drift", "phase-jitter"]);
});

test("a data-quality gate outranks model tuning", () => {
  const demo = makeDemoProbeSignals();
  const addGap = (signal: Signal) => ({ ...signal, time: signal.time.map((value, index) => index >= 800 ? value + 0.025 : value) });
  const experimentSignals = demo.test.map(addGap);
  const cfdSignals = demo.cfd.map(addGap);
  const comparisons = compareProbeSets(experimentSignals, cfdSignals).comparisons;
  const result = buildCaseAssessment(DEMO_METADATA, comparisons, analyzeRdeProbeSet(experimentSignals, demo.positionsDeg, 82), analyzeRdeProbeSet(cfdSignals, demo.positionsDeg, 82));
  assert.equal(result.dataQuality.status, "Review");
  assert.equal(result.hypotheses[0].id, "data-quality");
  assert.equal(result.nextRun.stage, "Evidence gate");
});

test("a second numerical level below two percent closes mesh convergence and advances", () => {
  const demo = makeDemoProbeSignals();
  const blend = (factor: number) => demo.cfd.map((signal, probe) => ({
    ...signal,
    pressure: signal.pressure.map((value, index) => value + factor * (demo.test[probe].pressure[index] - value)),
  }));
  const baseline: AnalysisCase = { id: "base", source: "demo", relationship: null, metadata: { ...DEMO_METADATA, meshConvergencePct: Number.NaN }, testSignals: demo.test, cfdSignals: demo.cfd };
  const fine: AnalysisCase = {
    id: "fine", source: "demo", relationship: { baselineCaseId: "base", changedVariable: "mesh", description: "First mesh refinement" },
    metadata: { ...DEMO_METADATA, name: "Fine", minimumCellSizeMm: 0.125, meshCells: 5_000_000, cellsPerInductionLength: 16, nearWallCellSizeMm: 0.05, meshConvergencePct: Number.NaN },
    testSignals: demo.test, cfdSignals: blend(0.95),
  };
  const finer: AnalysisCase = {
    id: "finer", source: "demo", relationship: { baselineCaseId: "base", changedVariable: "mesh", description: "Second mesh refinement" },
    metadata: { ...DEMO_METADATA, name: "Finer", minimumCellSizeMm: 0.0625, meshCells: 10_000_000, cellsPerInductionLength: 32, nearWallCellSizeMm: 0.025, meshConvergencePct: Number.NaN },
    testSignals: demo.test, cfdSignals: blend(0.951),
  };
  const history = buildCaseHistoryEvidence([baseline, fine, finer], baseline.id);
  assert.equal(history[0].sequenceStatus, "effect-confirmed");
  assert.equal(history[1].sequenceStatus, "converged");
  assert.equal(history[1].planDisposition, "advance");
  assert.ok((history[1].incrementalResponsePct ?? 100) <= 2);
  const summary = summarizeCase(finer);
  const assessment = buildCaseAssessment(finer.metadata, compareProbeSets(finer.testSignals, finer.cfdSignals).comparisons, summary.experiment, summary.simulation, history);
  assert.doesNotMatch(assessment.nextRun.title, /mesh/i, "a converged mesh sequence must not request another mesh level");
});

test("the displayed rerun criteria match the classifier thresholds", () => {
  const demo = makeDemoProbeSignals();
  const comparisons = compareProbeSets(demo.test, demo.cfd).comparisons;
  const experiment = analyzeRdeProbeSet(demo.test, demo.positionsDeg, 82);
  const simulation = analyzeRdeProbeSet(demo.cfd, demo.positionsDeg, 82);
  const result = buildCaseAssessment(DEMO_METADATA, comparisons, experiment, simulation);
  assert.match(result.nextRun.confirmationCriterion, /25%/);
  assert.match(result.nextRun.confirmationCriterion, /no new resolved mismatch/i);
  assert.match(result.nextRun.rejectionCriterion, /5%/);
  assert.doesNotMatch(result.nextRun.inconclusiveCriterion, /adjacent-level convergence/i);
  assert.equal(result.nextRun.decisionPolicy.evaluationMode, "model-sensitivity");
  assert.equal(result.nextRun.decisionPolicy.convergenceResponsePct, null);
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
  const mappedSourceIds = new Set(Object.values(SOURCE_IDS_BY_CAUSE).flat());
  for (const mappedIds of Object.values(SOURCE_IDS_BY_CAUSE)) {
    for (const id of mappedIds) assert.ok(sourceIds.has(id), `unknown mapped source ${id}`);
  }
  for (const id of sourceIds) assert.ok(mappedSourceIds.has(id), `diagnostic source ${id} is retained but not used by any rule`);
  for (const [causeId, claims] of Object.entries(RESEARCH_CLAIMS_BY_CAUSE)) {
    for (const claim of claims) {
      assert.ok(claim.statement.length > 30, `${causeId} needs a specific research claim`);
      assert.ok(claim.boundary.length > 30, `${causeId} needs an applicability boundary`);
      assert.ok(claim.sourceIds.length > 0, `${causeId} research claim needs an exact source`);
      for (const id of claim.sourceIds) assert.ok(SOURCE_IDS_BY_CAUSE[causeId as keyof typeof SOURCE_IDS_BY_CAUSE].includes(id), `${causeId} claim uses an unmapped source ${id}`);
    }
    assert.deepEqual(
      [...new Set(claims.flatMap((claim) => claim.sourceIds))].sort(),
      [...SOURCE_IDS_BY_CAUSE[causeId as keyof typeof SOURCE_IDS_BY_CAUSE]].sort(),
      `${causeId} cause-level sources and claim-level sources must match`,
    );
  }
  assert.ok(SOURCE_IDS_BY_CAUSE["spatial-resolution"].length >= 2);
  assert.deepEqual(SOURCE_IDS_BY_CAUSE["initialization-mode"], ["yao-wang-2016"]);
  assert.deepEqual(SOURCE_IDS_BY_CAUSE["missing-unsteadiness"], []);
});

test("comparable precedent excludes the active case family", () => {
  const evidence = [
    { baselineCaseId: "current-family", caseId: "current-rerun", caseSource: "demo" },
    { baselineCaseId: "other-family", caseId: "other-rerun", caseSource: "demo" },
    { baselineCaseId: "uploaded-family", caseId: "uploaded-rerun", caseSource: "uploaded" },
  ] as CaseHistoryEvidence[];
  assert.deepEqual(selectIndependentPrecedents(evidence, "current-family", "demo").map((item) => item.caseId), ["other-rerun"]);
  assert.deepEqual(selectIndependentPrecedents(evidence, "uploaded-family", "uploaded").map((item) => item.caseId), []);
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
  for (const item of CASE_INPUT_HELP.flatMap((group) => group.items)) {
    assert.ok(item.format.length > 8, `${item.key} needs a concrete format/unit explanation`);
    assert.ok(item.obtainFrom.length > 8, `${item.key} needs a source location`);
    assert.ok(item.usedFor.length > 8, `${item.key} needs a calculation use`);
    assert.ok(item.missingEffect.length > 8, `${item.key} needs a missing-input consequence`);
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


test("arbitrary CSV columns can be mapped, reordered, and converted before analysis", () => {
  const rows = ["clock_seconds,PT_B_bar,operator_note,PT_A_kPa,PT_C_psi"];
  for (let index = 0; index < 40; index += 1) {
    rows.push(`${index * 0.0001},${2 + index * 0.001},steady,${1000 + index},${100 + index * 0.1}`);
  }
  const table = parseDelimitedTable(rows.join("\n"), "ordinary-export.csv");
  const suggested = suggestImportMapping(table, 3);
  assert.equal(suggested.timeColumnIndex, -1, "unrecognized time headers must require an explicit mapping");
  const mapped = mapProbeTable(table, {
    timeColumnIndex: 0,
    timeUnit: "s",
    probes: [
      { label: "P1", columnIndex: 3, unit: "kPa" },
      { label: "P2", columnIndex: 1, unit: "bar" },
      { label: "P3", columnIndex: 4, unit: "psi" },
    ],
  });
  assert.equal(mapped.signals.length, 3);
  close(mapped.signals[0].time[1], 0.1, 1e-12, "mapped time");
  close(mapped.signals[0].pressure[0], 1, 1e-12, "mapped kPa");
  close(mapped.signals[1].pressure[0], 0.2, 1e-12, "mapped bar");
  close(mapped.signals[2].pressure[0], 0.6894757293, 1e-9, "mapped psi");
  assert.equal(mapped.provenance.timeColumn, "clock_seconds");
  assert.equal(mapped.preview.rows.length, 6);
});

test("mapped import reports omitted rows and rejects duplicate column assignments", () => {
  const rows = ["t_ms,left_kPa,right_kPa,third_kPa"];
  for (let index = 0; index < 40; index += 1) rows.push(`${index * 0.01},${1000 + index},${1100 + index},${1200 + index}`);
  rows.splice(10, 0, "bad,row,,,");
  const table = parseDelimitedTable(rows.join("\n"), "rows.tsv");
  const mapping = {
    timeColumnIndex: 0,
    timeUnit: "ms" as const,
    probes: [
      { label: "P1", columnIndex: 1, unit: "kPa" as const },
      { label: "P2", columnIndex: 2, unit: "kPa" as const },
      { label: "P3", columnIndex: 3, unit: "kPa" as const },
    ],
  };
  const mapped = mapProbeTable(table, mapping);
  assert.equal(mapped.provenance.droppedRows, 1);
  assert.throws(() => mapProbeTable(table, { ...mapping, probes: mapping.probes.map((probe) => ({ ...probe, columnIndex: 1 })) }), /different source column/i);
});

test("spectral noise and undersampling limit only unsupported pressure conclusions", () => {
  let state = 17;
  const count = 600;
  const dtMs = 0.02;
  const time = Array.from({ length: count }, (_, index) => index * dtMs);
  const pressure = time.map(() => {
    state = (1664525 * state + 1013904223) >>> 0;
    return 1 + (state / 0xffffffff - 0.5) * 0.02;
  });
  const signal: Signal = { name: "noise-dominated", time, pressure };
  const quality = assessSignalQuality(signal);
  assert.equal(quality.phaseUsable, false);
  assert.ok(quality.limitedOutputs.some((item) => /wave count/i.test(item)));
  const mode = analyzeRdeProbeSet([0, 1, 2, 3, 4].map((probe) => ({ ...signal, name: `noise P${probe + 1}`, time: [...time], pressure: [...pressure] })), [0, 47, 131, 226, 311], 82, { synchronizationConfirmed: true });
  assert.equal(mode.identifiability, "Not identifiable");
});

test("complete workspaces round-trip raw signals, mappings, links, and non-finite optional values", () => {
  const demo = makeDemoProbeSignals();
  const metadata = { ...DEMO_METADATA, probePositionsDeg: [...DEMO_METADATA.probePositionsDeg], meshConvergencePct: Number.NaN };
  const provenance = {
    fileName: "mapped.csv",
    delimiter: "comma" as const,
    timeColumn: "clock",
    timeUnit: "ms" as const,
    pressureColumns: demo.test.map((_, index) => ({ label: `P${index + 1}`, column: `sensor_${index + 1}`, unit: "MPa" as const })),
    sourceRows: demo.test[0].time.length,
    validRows: demo.test[0].time.length,
    droppedRows: 0,
  };
  const item: AnalysisCase = { id: "saved-case", source: "uploaded", relationship: null, metadata, testSignals: demo.test, cfdSignals: demo.cfd, imports: { experiment: provenance, cfd: { ...provenance, fileName: "cfd.csv" } } };
  const serialized = serializeWorkspace({ cases: [item], activeCaseId: item.id, baselineCaseId: item.id, designs: [], activeDesignId: null });
  assert.match(serialized, new RegExp(WORKSPACE_SCHEMA));
  assert.doesNotMatch(serialized, /controlledNextRun|metricImprovements|confirmedCount/, "workspaces store inputs, not pre-generated analytical conclusions");
  const restored = deserializeWorkspace(serialized);
  assert.equal(restored.cases.length, 1);
  assert.equal(restored.activeCaseId, item.id);
  assert.equal(restored.cases[0].imports?.experiment.timeColumn, "clock");
  assert.equal(restored.cases[0].testSignals[0].pressure.length, demo.test[0].pressure.length);
  assert.ok(Number.isNaN(restored.cases[0].metadata.meshConvergencePct));
  const legacyEnvelope = JSON.parse(serialized);
  delete legacyEnvelope.state.cases[0].metadata.solverRuntimeHours;
  assert.ok(Number.isNaN(deserializeWorkspace(JSON.stringify(legacyEnvelope)).cases[0].metadata.solverRuntimeHours));
  assert.throws(() => deserializeWorkspace('{"schema":"other"}'), /not a Caevera/i);
});

test("published RDE wave-speed values are reproduced without treating them as paired CFD validation", () => {
  for (const benchmark of PUBLISHED_WAVE_SPEED_BENCHMARKS) {
    const calculated = waveSpeedFromPassageFrequency(benchmark.passageFrequencyKHz, benchmark.annulusMeanDiameterMm, benchmark.waveCount);
    close(calculated, benchmark.reportedWaveSpeedMps, benchmark.toleranceMps, benchmark.id);
  }
  assert.equal(PUBLISHED_VALIDATION_SOURCES["xue-et-al-2023"].doi, "10.3389/fenrg.2023.1136156");
  assert.match(PUBLISHED_VALIDATION_SOURCES["xue-et-al-2023"].limitation, /does not release a paired/i);
  assert.deepEqual(RAW_DATASET_VALIDATION_CASES.map((item) => item.id), ["BD0041", "BD0038", "CE2029"]);
  assert.deepEqual(RAW_DATASET_VALIDATION_CASES.map((item) => item.validationStatus), ["mandatory-fixture", "mandatory-fixture", "mandatory-fixture"]);
});
