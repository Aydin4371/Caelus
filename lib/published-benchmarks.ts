export type PublishedWaveSpeedBenchmark = {
  id: string;
  configuration: string;
  annulusMeanDiameterMm: number;
  passageFrequencyKHz: number;
  waveCount: number;
  reportedWaveSpeedMps: number;
  toleranceMps: number;
  sourceId: "xue-et-al-2023";
};

export const PUBLISHED_VALIDATION_SOURCES = {
  "xue-et-al-2023": {
    title: "Experimental study on the rotating detonation engine based on a gas mixture",
    authors: "Sainan Xue; Xin Zhang; Jianlu Yang; Denghang Liu; Hu Ma; Changsheng Zhou",
    year: 2023,
    doi: "10.3389/fenrg.2023.1136156",
    url: "https://doi.org/10.3389/fenrg.2023.1136156",
    validationUse: "Exact tabulated/printed passage frequencies, annulus dimensions, wave count, and propagation velocities benchmark the deterministic frequency-to-wave-speed calculation.",
    limitation: "The paper does not release a paired experimental-and-CFD pressure array; these cases do not validate CFD agreement or raw-file signal processing.",
  },
  "oexle-bohon-2026": {
    title: "High speed video image and pressure data of counter rotating detonation waves",
    authors: "David Oexle; Myles Bohon",
    year: 2026,
    doi: "10.5281/zenodo.18886925",
    url: "https://doi.org/10.5281/zenodo.18886925",
    validationUse: "Three traceable 4,096-sample fixtures extracted from the published pressure records are mandatory regression tests for ambiguous and multi-component wave modes.",
    limitation: "The archive contains experiment data only. CE2029 also has repeated circumferential probe angles, leaving four unique azimuths for phase analysis. These fixtures test whether Caevera reports such modes conservatively; they are not independent case-family evidence and cannot validate an experiment-CFD recommendation.",
  },
} as const;

/** Circumferential wave speed from passage frequency, mean diameter, and wave count. */
export function waveSpeedFromPassageFrequency(passageFrequencyKHz: number, annulusMeanDiameterMm: number, waveCount: number) {
  if (![passageFrequencyKHz, annulusMeanDiameterMm, waveCount].every(Number.isFinite) || passageFrequencyKHz <= 0 || annulusMeanDiameterMm <= 0 || !Number.isInteger(waveCount) || waveCount < 1) {
    throw new Error("Wave-speed conversion requires positive frequency and diameter plus a positive integer wave count.");
  }
  return Math.PI * annulusMeanDiameterMm * passageFrequencyKHz / waveCount;
}

/**
 * Xue et al. report a 206 mm outer and 166 mm inner diameter, giving a
 * 186 mm mean diameter. The printed frequencies are rounded, so a 2 m/s
 * reproduction tolerance is used and recorded explicitly.
 */
export const PUBLISHED_WAVE_SPEED_BENCHMARKS: PublishedWaveSpeedBenchmark[] = [
  { id: "xue-slot-3mm", configuration: "3 mm inlet slot, continuous mode", annulusMeanDiameterMm: 186, passageFrequencyKHz: 1.950, waveCount: 1, reportedWaveSpeedMps: 1138.88, toleranceMps: 2, sourceId: "xue-et-al-2023" },
  { id: "xue-slot-4mm", configuration: "4 mm inlet slot, continuous mode", annulusMeanDiameterMm: 186, passageFrequencyKHz: 1.936, waveCount: 1, reportedWaveSpeedMps: 1130.69, toleranceMps: 2, sourceId: "xue-et-al-2023" },
  { id: "xue-slot-5mm", configuration: "5 mm inlet slot, continuous mode", annulusMeanDiameterMm: 186, passageFrequencyKHz: 1.804, waveCount: 1, reportedWaveSpeedMps: 1053.61, toleranceMps: 2, sourceId: "xue-et-al-2023" },
  { id: "xue-slot-6mm", configuration: "6 mm inlet slot, intermittent mode", annulusMeanDiameterMm: 186, passageFrequencyKHz: 1.700, waveCount: 1, reportedWaveSpeedMps: 992.87, toleranceMps: 2, sourceId: "xue-et-al-2023" },
  { id: "xue-short-double-wave", configuration: "80 mm combustor, homodromous double-wave interval", annulusMeanDiameterMm: 186, passageFrequencyKHz: 3.50714, waveCount: 2, reportedWaveSpeedMps: 1024.16, toleranceMps: 2, sourceId: "xue-et-al-2023" },
];

export const RAW_DATASET_VALIDATION_CASES = [
  {
    id: "BD0041",
    expectedMode: "two counter-rotating waves at similar speed",
    sourceId: "oexle-bohon-2026",
    validationStatus: "mandatory-fixture",
    fixturePath: "tests/fixtures/zenodo-bd0041.json",
    fixtureSha256: "64ceb3a5b27a806ec8011ca68b21a06e82ca26cef0f2b3d6cd236b8f544fdb7f",
    sourceArchivePath: "data/data_output/01_pressure/BD0041.mat",
    sourceStartIndex: 70921,
    sourceStride: 2,
    sourceSampleRateHz: 500000,
    circumferentialProbeIndices: [0, 1, 2, 3, 4, 5, 6, 7],
    validatedBehavior: "The analyzer must withhold a unique single-mode result because the one-mode spatial phase residual is too large.",
  },
  {
    id: "BD0038",
    expectedMode: "two counter-rotating waves at different speed",
    sourceId: "oexle-bohon-2026",
    validationStatus: "mandatory-fixture",
    fixturePath: "tests/fixtures/zenodo-bd0038.json",
    fixtureSha256: "90758839db36e792911f3277a1a675881932f3a2256d8500f16c6e9aab040066",
    sourceArchivePath: "data/data_output/01_pressure/BD0038.mat",
    sourceStartIndex: 70921,
    sourceStride: 2,
    sourceSampleRateHz: 500000,
    circumferentialProbeIndices: [0, 1, 2, 3, 4, 5, 6, 7],
    validatedBehavior: "The analyzer must detect the second non-harmonic component and withhold a unique single-mode result.",
  },
  {
    id: "CE2029",
    expectedMode: "one dominant wave plus two counter-rotating traveling waves",
    sourceId: "oexle-bohon-2026",
    validationStatus: "mandatory-fixture",
    fixturePath: "tests/fixtures/zenodo-ce2029.json",
    fixtureSha256: "cd8f2fbb5662011871be16233a9521acb2f9fd9902bf18cdf77ba542d590cde3",
    sourceArchivePath: "data/data_output/01_pressure/CE2029.mat",
    sourceStartIndex: 70921,
    sourceStride: 2,
    sourceSampleRateHz: 500000,
    circumferentialProbeIndices: [0, 1, 2, 6],
    validatedBehavior: "The source exposes only four unique circumferential angles. On those measured azimuths, the analyzer must retain the strong second non-harmonic component and withhold a unique single-mode result.",
  },
] as const;

export const PUBLISHED_VALIDATION_SUMMARY = {
  waveSpeedCases: PUBLISHED_WAVE_SPEED_BENCHMARKS.length,
  pressureFixtureCases: RAW_DATASET_VALIDATION_CASES.filter((item) => item.validationStatus === "mandatory-fixture").length,
  claim: "Published benchmarks test analyzer behavior only; recommendations are calculated from the active uploaded case and qualifying workspace reruns.",
} as const;
