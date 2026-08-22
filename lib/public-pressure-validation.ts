import type { Signal } from "./rde-analysis.ts";
import { analyzeRdeProbeSet } from "./wave-dynamics.ts";
import { RAW_DATASET_VALIDATION_CASES } from "./published-benchmarks.ts";

export type PublicPressureFixture = {
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

export type PublicPressureCheck = {
  caseId: string;
  samplesPerChannel: number;
  analyzedProbeCount: number;
  sourceMode: string;
  dominantFrequencyKHz: number;
  identifiability: string;
  complexModeDetected: boolean;
  phaseResidualDeg: number;
  strongestSecondaryKHz: number | null;
  passed: boolean;
  checks: Array<{ label: string; value: string; passed: boolean }>;
};

function uniqueProbeIndices(fixture: PublicPressureFixture) {
  return fixture.probePositionsDeg.reduce<number[]>((indices, angle, index) => {
    if (!indices.some((selected) => fixture.probePositionsDeg[selected] === angle)) indices.push(index);
    return indices;
  }, []);
}

function near(value: number, expected: number, tolerance: number) {
  return Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
}

/** Runs the production probe analyzer over a public fixture. */
export function evaluatePublicPressureFixture(fixture: PublicPressureFixture): PublicPressureCheck {
  const registry = RAW_DATASET_VALIDATION_CASES.find((item) => item.id === fixture.caseId);
  if (!registry) throw new Error(`No public validation rule is registered for ${fixture.caseId}.`);
  if (fixture.timeMs.length !== 4096 || fixture.pressureByProbe.some((values) => values.length !== fixture.timeMs.length)) {
    throw new Error(`${fixture.caseId} does not contain the registered 4,096-sample pressure window.`);
  }
  const probeIndices = uniqueProbeIndices(fixture);
  const signals: Signal[] = probeIndices.map((sourceIndex) => ({
    name: `${fixture.caseId} · P${sourceIndex + 1}`,
    time: fixture.timeMs,
    pressure: fixture.pressureByProbe[sourceIndex],
  }));
  const angles = probeIndices.map((index) => fixture.probePositionsDeg[index]);
  const result = analyzeRdeProbeSet(signals, angles, 76, { maximumWaveCount: 6, synchronizationConfirmed: true });
  const secondary = result.spectralPeaks
    .filter((peak) => !peak.harmonicOfPrimary && Math.abs(peak.frequencyKHz - result.waveFrequencyKHz) > 0.1)
    .sort((left, right) => right.relativeAmplitude - left.relativeAmplitude)[0] ?? null;
  const common = [
    { label: "Conservative mode result", value: result.identifiability, passed: result.identifiability === "Not identifiable" },
    { label: "Source sample window", value: `${fixture.timeMs.length.toLocaleString()} samples/channel`, passed: fixture.timeMs.length === 4096 },
  ];
  const caseChecks = fixture.caseId === "BD0041"
    ? [
      { label: "Dominant frequency", value: `${result.waveFrequencyKHz.toFixed(3)} kHz`, passed: near(result.waveFrequencyKHz, 3.995, 0.08) },
      { label: "One-mode phase residual", value: `${result.phaseResidualDeg.toFixed(1)}°`, passed: result.phaseResidualDeg > 40 },
    ]
    : fixture.caseId === "BD0038"
      ? [
        { label: "Dominant frequency", value: `${result.waveFrequencyKHz.toFixed(3)} kHz`, passed: near(result.waveFrequencyKHz, 4.096, 0.08) },
        { label: "Second component", value: secondary ? `${secondary.frequencyKHz.toFixed(3)} kHz` : "not found", passed: !!secondary && near(secondary.frequencyKHz, 3.919, 0.09) },
      ]
      : [
        { label: "Unique measured angles", value: `${angles.length} of ${fixture.probePositionsDeg.length} channels`, passed: angles.length === 4 },
        { label: "Second component", value: secondary ? `${secondary.frequencyKHz.toFixed(3)} kHz` : "not found", passed: !!secondary && near(secondary.frequencyKHz, 7.690, 0.1) },
      ];
  const checks = [...common, ...caseChecks];
  return {
    caseId: fixture.caseId,
    samplesPerChannel: fixture.timeMs.length,
    analyzedProbeCount: angles.length,
    sourceMode: fixture.modeDescription,
    dominantFrequencyKHz: result.waveFrequencyKHz,
    identifiability: result.identifiability,
    complexModeDetected: result.complexModeDetected,
    phaseResidualDeg: result.phaseResidualDeg,
    strongestSecondaryKHz: secondary?.frequencyKHz ?? null,
    passed: checks.every((item) => item.passed),
    checks,
  };
}
