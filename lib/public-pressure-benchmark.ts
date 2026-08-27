import type { Signal } from "./rde-analysis.ts";
import { analyzeRdeProbeSet, type RdeModeResult } from "./wave-dynamics.ts";

export type PublicPressureBenchmark = {
  schema: "caevera-published-pressure-benchmark-v1";
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

function finiteArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

export function parsePublicPressureBenchmark(text: string): PublicPressureBenchmark {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("The benchmark file is not valid JSON."); }
  if (!value || typeof value !== "object") throw new Error("The benchmark file is malformed.");
  const parsed = value as Partial<PublicPressureBenchmark>;
  if (parsed.schema !== "caevera-published-pressure-benchmark-v1" || typeof parsed.caseId !== "string" || typeof parsed.sourceDoi !== "string" || typeof parsed.modeLabel !== "string" || typeof parsed.modeDescription !== "string" || typeof parsed.pressureUnit !== "string") throw new Error("This is not a supported Kythros public pressure benchmark.");
  if (!finiteArray(parsed.timeMs) || !finiteArray(parsed.probePositionsDeg) || !Array.isArray(parsed.pressureByProbe) || parsed.pressureByProbe.length !== parsed.probePositionsDeg.length) throw new Error("The public pressure benchmark has an invalid time or probe definition.");
  if (parsed.pressureByProbe.some((values) => !finiteArray(values) || values.length !== parsed.timeMs!.length)) throw new Error("A public pressure channel has an invalid sample count.");
  if (parsed.timeMs.some((value, index) => index > 0 && value <= parsed.timeMs![index - 1])) throw new Error("Public pressure time values must be strictly increasing.");
  return parsed as PublicPressureBenchmark;
}

export function analyzePublicPressureBenchmark(benchmark: PublicPressureBenchmark, annulusMeanDiameterMm = 76) {
  const uniqueIndices = benchmark.probePositionsDeg.reduce<number[]>((indices, angle, index) => {
    if (!indices.some((selected) => benchmark.probePositionsDeg[selected] === angle)) indices.push(index);
    return indices;
  }, []);
  const signals: Signal[] = uniqueIndices.map((sourceIndex) => ({
    name: `${benchmark.caseId} · P${sourceIndex + 1}`,
    time: [...benchmark.timeMs],
    pressure: [...benchmark.pressureByProbe[sourceIndex]],
  }));
  const positions = uniqueIndices.map((index) => benchmark.probePositionsDeg[index]);
  const analysis: RdeModeResult = analyzeRdeProbeSet(signals, positions, annulusMeanDiameterMm, { maximumWaveCount: 6, synchronizationConfirmed: true });
  return {
    benchmark,
    signals,
    positions,
    analysis,
    excludedDuplicateProbeCount: benchmark.probePositionsDeg.length - positions.length,
    amplitudeComparable: false,
    evidenceRole: "Real experiment-only analyzer benchmark. It tests frequency and conservative mode handling; it contains no matched CFD and cannot validate a next-run recommendation.",
  };
}
