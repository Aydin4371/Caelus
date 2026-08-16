import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RAW_DATASET_VALIDATION_CASES } from "../lib/published-benchmarks.ts";
import type { Signal } from "../lib/rde-analysis.ts";
import { analyzeRdeProbeSet, circumferentialWaveSpeedMps } from "../lib/wave-dynamics.ts";

type PublishedFixture = {
  schema: string;
  caseId: string;
  sourceDoi: string;
  license: string;
  modeLabel: string;
  modeDescription: string;
  pressureUnit: string;
  timeMs: number[];
  probePositionsDeg: number[];
  pressureByProbe: number[][];
};

function loadFixture(id: "bd0041" | "bd0038" | "ce2029") {
  return JSON.parse(readFileSync(new URL(`./fixtures/zenodo-${id}.json`, import.meta.url), "utf8")) as PublishedFixture;
}

function fixtureHash(id: "bd0041" | "bd0038" | "ce2029") {
  const contents = readFileSync(new URL(`./fixtures/zenodo-${id}.json`, import.meta.url));
  return createHash("sha256").update(contents).digest("hex");
}

function signalsFor(fixture: PublishedFixture, probeIndices = fixture.pressureByProbe.map((_, index) => index)): Signal[] {
  return probeIndices.map((sourceIndex) => ({
    name: `${fixture.caseId} · P${sourceIndex + 1}`,
    time: fixture.timeMs,
    pressure: fixture.pressureByProbe[sourceIndex],
  }));
}

test("published BD0041 pressure record does not produce a false single-mode identification", () => {
  const fixture = loadFixture("bd0041");
  const registry = RAW_DATASET_VALIDATION_CASES.find((item) => item.id === fixture.caseId);
  assert.equal(registry?.validationStatus, "mandatory-fixture");
  assert.equal(fixtureHash("bd0041"), registry?.fixtureSha256);
  assert.equal(fixture.sourceDoi, "10.5281/zenodo.18886925");
  assert.equal(fixture.license, "CC-BY-4.0");
  assert.equal(fixture.modeLabel, "2CR");
  assert.equal(fixture.pressureUnit, "source-processed-channel-unit");
  const result = analyzeRdeProbeSet(signalsFor(fixture), fixture.probePositionsDeg, 76, { maximumWaveCount: 6, synchronizationConfirmed: true });
  assert.ok(Math.abs(result.waveFrequencyKHz - 3.995) < 0.08, `published passage frequency drifted: ${result.waveFrequencyKHz}`);
  assert.equal(result.identifiability, "Not identifiable");
  assert.equal(result.complexModeDetected, false);
  assert.ok(result.phaseResidualDeg > 40, "same-frequency counter-rotation should defeat a one-mode phase fit");
  assert.ok(!Number.isFinite(result.waveSpeedMps), "speed must not be reported when the mode count is unresolved");
});

test("published BD0038 pressure record exposes the second counter-rotating component", () => {
  const fixture = loadFixture("bd0038");
  const registry = RAW_DATASET_VALIDATION_CASES.find((item) => item.id === fixture.caseId);
  assert.equal(registry?.validationStatus, "mandatory-fixture");
  assert.equal(fixtureHash("bd0038"), registry?.fixtureSha256);
  assert.equal(fixture.sourceDoi, "10.5281/zenodo.18886925");
  assert.equal(fixture.modeLabel, "2CRT");
  const result = analyzeRdeProbeSet(signalsFor(fixture), fixture.probePositionsDeg, 76, { maximumWaveCount: 6, synchronizationConfirmed: true });
  assert.ok(Math.abs(result.waveFrequencyKHz - 4.096) < 0.08, `dominant published frequency drifted: ${result.waveFrequencyKHz}`);
  assert.equal(result.complexModeDetected, true);
  assert.equal(result.identifiability, "Not identifiable");
  const second = result.spectralPeaks.find((peak) => !peak.harmonicOfPrimary && Math.abs(peak.frequencyKHz - result.waveFrequencyKHz) > 0.1 && peak.frequencyKHz < 1.5 * result.waveFrequencyKHz);
  assert.ok(second, "the second traveling component should be retained");
  assert.ok(Math.abs(second.frequencyKHz - 3.919) < 0.09, `secondary published frequency drifted: ${second.frequencyKHz}`);
  assert.ok(second.relativeAmplitude > 0.3);
});

test("published CE2029 record exposes a second component without inventing unique probe angles", () => {
  const fixture = loadFixture("ce2029");
  const registry = RAW_DATASET_VALIDATION_CASES.find((item) => item.id === "CE2029");
  assert.equal(registry?.validationStatus, "mandatory-fixture");
  assert.equal(fixtureHash("ce2029"), registry?.fixtureSha256);
  assert.equal(fixture.sourceDoi, "10.5281/zenodo.18886925");
  assert.equal(fixture.modeLabel, "DS2");
  assert.equal(registry?.sourceStartIndex, 70921);
  assert.equal(registry?.sourceStride, 2);
  assert.equal(registry?.sourceSampleRateHz, 500000);

  const uniqueProbeIndices = fixture.probePositionsDeg.reduce<number[]>((indices, angle, index) => {
    if (!indices.some((selected) => fixture.probePositionsDeg[selected] === angle)) indices.push(index);
    return indices;
  }, []);
  assert.deepEqual(uniqueProbeIndices, registry?.circumferentialProbeIndices);
  assert.equal(uniqueProbeIndices.length, 4, "the source contains seven channels but only four unique circumferential angles");
  assert.throws(
    () => analyzeRdeProbeSet(signalsFor(fixture), fixture.probePositionsDeg, 76, { maximumWaveCount: 6, synchronizationConfirmed: true }),
    /angles must be unique/i,
    "the analyzer must not silently treat repeated source angles as distinct azimuths",
  );

  const result = analyzeRdeProbeSet(
    signalsFor(fixture, uniqueProbeIndices),
    uniqueProbeIndices.map((index) => fixture.probePositionsDeg[index]),
    76,
    { maximumWaveCount: 6, synchronizationConfirmed: true },
  );
  assert.ok(Math.abs(result.waveFrequencyKHz - 4.881) < 0.09, `dominant published frequency drifted: ${result.waveFrequencyKHz}`);
  const second = result.spectralPeaks.find((peak) => !peak.harmonicOfPrimary && Math.abs(peak.frequencyKHz - 7.690) < 0.1);
  assert.ok(second, "the strong second published component should be retained");
  assert.ok(second.relativeAmplitude > 0.7);
  assert.equal(result.complexModeDetected, true);
  assert.equal(result.identifiability, "Not identifiable");
  assert.ok(!Number.isFinite(result.waveSpeedMps), "speed must not be reported for the unresolved multi-component mode");
  assert.ok(result.warnings.some((warning) => /second non-harmonic pressure component/i.test(warning)));
});

test("published Xue et al. frequency and annulus values reproduce tabulated wave speeds", () => {
  const meanDiameterMm = 0.5 * (206 + 166);
  const cases = [
    { frequencyKHz: 1.950, speedMps: 1138.88 },
    { frequencyKHz: 1.936, speedMps: 1130.69 },
    { frequencyKHz: 1.804, speedMps: 1053.61 },
    { frequencyKHz: 1.700, speedMps: 992.87 },
  ];
  for (const item of cases) {
    const calculated = circumferentialWaveSpeedMps(meanDiameterMm, item.frequencyKHz, 1);
    assert.ok(Math.abs(calculated - item.speedMps) < 0.7, `expected ${item.speedMps} m/s, calculated ${calculated} m/s`);
  }
});
