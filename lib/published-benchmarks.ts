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
    validationUse: "Open raw and processed MATLAB pressure records with simultaneous mode labels provide a future real-noise benchmark for ambiguous counter-rotating modes.",
    limitation: "The 3.4 GB archive is experiment-only and is registered for manual/fixture extraction; it is not represented as complete paired experiment–CFD validation.",
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
  { id: "BD0041", expectedMode: "two counter-rotating waves at similar speed", sourceId: "oexle-bohon-2026", automationStatus: "registered-not-embedded" },
  { id: "BD0038", expectedMode: "two counter-rotating waves at different speeds", sourceId: "oexle-bohon-2026", automationStatus: "registered-not-embedded" },
  { id: "CE2029", expectedMode: "one dominant wave plus two counter-rotating traveling waves", sourceId: "oexle-bohon-2026", automationStatus: "registered-not-embedded" },
] as const;
