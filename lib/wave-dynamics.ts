import { waveSpeedFromPassageFrequency } from "./published-benchmarks.ts";
import {
  assessSignalQuality,
  compareSignals,
  dominantFrequency,
  spectrum,
  type Comparison,
  type Signal,
} from "./rde-analysis.ts";

export type RotationDirection = "Clockwise" | "Counter-clockwise";
export type ModeIdentifiability = "Identified" | "Candidate" | "Not identifiable";

export type ModeCandidate = {
  waveCount: number;
  direction: RotationDirection;
  phaseResidualDeg: number;
};

export type SpectralPeak = {
  frequencyKHz: number;
  relativeAmplitude: number;
  harmonicOfPrimary: boolean;
};

export type CycleSeriesPoint = {
  timeMs: number;
  frequencyKHz: number;
  peakPressureMpa: number;
};

export type RdeModeResult = {
  waveFrequencyKHz: number;
  waveSpeedMps: number;
  waveCount: number;
  direction: RotationDirection;
  stability: "Stable" | "Transitional" | "Unstable";
  identifiability: ModeIdentifiability;
  frequencyDrift: number;
  frequencyDriftPct: number;
  frequencyVariationPct: number;
  phaseFit: number;
  phaseResidualDeg: number;
  phaseJitterDeg: number;
  modeConfidence: number;
  modeTransitions: number;
  analyzedWindows: number;
  alternativeWaveCount: number;
  alternativeDirection: RotationDirection;
  alternativeResidualDeg: number;
  candidateModes: ModeCandidate[];
  spectralPeaks: SpectralPeak[];
  complexModeDetected: boolean;
  probePhasesDeg: number[];
  fittedProbePhasesDeg: number[];
  cycleSeries: CycleSeriesPoint[];
  warnings: string[];
};

export type ProbeSetComparison = {
  comparisons: Comparison[];
  sharedLagUs: number;
  individualLagUs: number[];
  alignmentSpreadUs: number;
};

type ModeOptions = {
  maximumWaveCount?: number;
  synchronizationConfirmed?: boolean;
  sensorBandwidthKHz?: number;
  filterCutoffKHz?: number;
};

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values: number[]) {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
}

function wrapAngle(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function normalizeAngleDeg(value: number) {
  return radiansToDegrees(wrapAngle((value * Math.PI) / 180));
}

function phaseAtFrequency(signal: Signal, frequencyKHz: number, startIndex = 0, endIndex = signal.time.length) {
  const pressure = signal.pressure.slice(startIndex, endIndex);
  const center = mean(pressure);
  let real = 0;
  let imaginary = 0;
  const count = Math.max(1, endIndex - startIndex);
  for (let index = startIndex; index < endIndex; index += 1) {
    const local = index - startIndex;
    const window = count === 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * local) / (count - 1));
    const angle = 2 * Math.PI * frequencyKHz * signal.time[index];
    const value = (signal.pressure[index] - center) * window;
    real += value * Math.cos(angle);
    imaginary -= value * Math.sin(angle);
  }
  return Math.atan2(imaginary, real);
}

function relativePhases(signals: Signal[], frequencyKHz: number, startIndex = 0, endIndex?: number) {
  const phases = signals.map((signal) => phaseAtFrequency(signal, frequencyKHz, startIndex, endIndex ?? signal.time.length));
  return phases.map((phase) => wrapAngle(phase - phases[0]));
}

function fitCandidates(phases: number[], positionsDeg: number[], maximumWaveCount: number) {
  const positions = positionsDeg.map((position) => ((position - positionsDeg[0]) * Math.PI) / 180);
  const candidates: ModeCandidate[] = [];
  for (let waveCount = 1; waveCount <= maximumWaveCount; waveCount += 1) {
    for (const direction of ["Counter-clockwise", "Clockwise"] as const) {
      const sign = direction === "Counter-clockwise" ? -1 : 1;
      const squaredError = phases.slice(1).reduce((sum, phase, index) => {
        const residual = wrapAngle(phase - sign * waveCount * positions[index + 1]);
        return sum + residual ** 2;
      }, 0);
      candidates.push({
        waveCount,
        direction,
        phaseResidualDeg: radiansToDegrees(Math.sqrt(squaredError / Math.max(phases.length - 1, 1))),
      });
    }
  }
  return candidates.sort((left, right) => left.phaseResidualDeg - right.phaseResidualDeg);
}

function cycleSeries(signal: Signal) {
  const baseline = mean(signal.pressure);
  const crossings: number[] = [];
  const indices: number[] = [];
  for (let index = 1; index < signal.pressure.length; index += 1) {
    const before = signal.pressure[index - 1] - baseline;
    const after = signal.pressure[index] - baseline;
    if (before <= 0 && after > 0) {
      const fraction = -before / Math.max(after - before, 1e-12);
      crossings.push(signal.time[index - 1] + fraction * (signal.time[index] - signal.time[index - 1]));
      indices.push(index);
    }
  }
  const result: CycleSeriesPoint[] = [];
  for (let cycle = 0; cycle < crossings.length - 1; cycle += 1) {
    const period = crossings[cycle + 1] - crossings[cycle];
    if (period <= 0 || indices[cycle + 1] - indices[cycle] < 3) continue;
    result.push({
      timeMs: 0.5 * (crossings[cycle] + crossings[cycle + 1]),
      frequencyKHz: 1 / period,
      peakPressureMpa: Math.max(...signal.pressure.slice(indices[cycle], indices[cycle + 1] + 1)),
    });
  }
  return result;
}

function linearDriftPct(points: CycleSeriesPoint[]) {
  if (points.length < 3) return Number.NaN;
  const times = points.map((point) => point.timeMs);
  const frequencies = points.map((point) => point.frequencyKHz);
  const timeMean = mean(times);
  const frequencyMean = mean(frequencies);
  const numerator = times.reduce((sum, time, index) => sum + (time - timeMean) * (frequencies[index] - frequencyMean), 0);
  const denominator = times.reduce((sum, time) => sum + (time - timeMean) ** 2, 0);
  const slope = numerator / Math.max(denominator, 1e-12);
  return 100 * slope * (times.at(-1)! - times[0]) / Math.max(frequencyMean, 1e-12);
}

function circularStandardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const cosine = mean(values.map(Math.cos));
  const sine = mean(values.map(Math.sin));
  const length = Math.min(1, Math.hypot(cosine, sine));
  return Math.sqrt(Math.max(0, -2 * Math.log(Math.max(length, 1e-12))));
}

function equalSpacingRisk(positionsDeg: number[]) {
  const normalized = positionsDeg.map((value) => ((value % 360) + 360) % 360).sort((a, b) => a - b);
  const gaps = normalized.map((value, index) => {
    const next = normalized[(index + 1) % normalized.length] + (index === normalized.length - 1 ? 360 : 0);
    return next - value;
  });
  return Math.max(...gaps) - Math.min(...gaps) < 2;
}

/**
 * Builds one robust spectrum from every synchronized probe. Each probe is
 * normalized before averaging so one high-gain channel cannot hide a real
 * component seen by the rest of the annulus.
 */
function sharedSpectralPeaks(signals: Signal[], primaryFrequencyKHz: number) {
  const spectra = signals.map((signal) => {
    const dt = median(signal.time.slice(1).map((value, index) => value - signal.time[index]));
    return spectrum(signal.pressure, dt);
  });
  const length = Math.min(...spectra.map((item) => item.amplitude.length));
  const frequency = spectra[0].frequency.slice(0, length);
  const normalized = spectra.map((item) => {
    const maximum = Math.max(...item.amplitude.slice(0, length), 1e-16);
    return item.amplitude.slice(0, length).map((value) => value / maximum);
  });
  const amplitude = frequency.map((_, index) => mean(normalized.map((item) => item[index])));
  const localMaxima = amplitude.flatMap((value, index) =>
    index > 0 && index < amplitude.length - 1 && value >= amplitude[index - 1] && value > amplitude[index + 1]
      ? [{ index, value }]
      : []);
  const maximum = Math.max(...localMaxima.map((item) => item.value), 1e-16);
  const binWidth = frequency.length > 1 ? frequency[1] - frequency[0] : Number.NaN;
  const selected: SpectralPeak[] = [];
  for (const peak of localMaxima.sort((left, right) => right.value - left.value)) {
    const peakFrequency = frequency[peak.index];
    if (selected.some((item) => Math.abs(item.frequencyKHz - peakFrequency) <= 2 * binWidth)) continue;
    const harmonicNumber = Math.round(peakFrequency / Math.max(primaryFrequencyKHz, 1e-12));
    const harmonicTolerance = Math.max(2.5 * binWidth, 0.012 * Math.max(harmonicNumber, 1) * primaryFrequencyKHz);
    const harmonicOfPrimary = harmonicNumber >= 2
      && harmonicNumber <= 5
      && Math.abs(peakFrequency - harmonicNumber * primaryFrequencyKHz) <= harmonicTolerance;
    selected.push({ frequencyKHz: peakFrequency, relativeAmplitude: peak.value / maximum, harmonicOfPrimary });
    if (selected.length >= 8) break;
  }
  // A strong shared component between half and 2.5 times the primary cannot be
  // explained as the same single rotating mode once integer harmonics have
  // already been excluded. Keep the band finite so unrelated high-frequency
  // sensor noise does not automatically make the mode "complex".
  const significantNonHarmonic = selected.find((peak) =>
    !peak.harmonicOfPrimary
    && peak.frequencyKHz >= 0.5 * primaryFrequencyKHz
    && peak.frequencyKHz <= 2.5 * primaryFrequencyKHz
    && Math.abs(peak.frequencyKHz - primaryFrequencyKHz) > Math.max(2.5 * binWidth, 0.015 * primaryFrequencyKHz)
    && peak.relativeAmplitude >= 0.25);
  return { peaks: selected, significantNonHarmonic };
}

export function circumferentialWaveSpeedMps(annulusMeanDiameterMm: number, passageFrequencyKHz: number, waveCount: number) {
  if (![annulusMeanDiameterMm, passageFrequencyKHz, waveCount].every(Number.isFinite) || annulusMeanDiameterMm <= 0 || passageFrequencyKHz <= 0 || !Number.isInteger(waveCount) || waveCount < 1) {
    return Number.NaN;
  }
  return waveSpeedFromPassageFrequency(passageFrequencyKHz, annulusMeanDiameterMm, waveCount);
}

/**
 * Infers the dominant circumferential traveling mode from synchronized pressure
 * probes. A mode is explicitly downgraded when the probe geometry or the data
 * cannot separate it from the next-best count/direction candidate.
 */
export function analyzeRdeProbeSet(
  signals: Signal[],
  positionsDeg: number[],
  annulusMeanDiameterMm: number,
  options: ModeOptions = {},
): RdeModeResult {
  if (signals.length < 3 || signals.length !== positionsDeg.length) {
    throw new Error("Wave analysis requires at least three signals with one matching angle per probe.");
  }
  if (!Number.isFinite(annulusMeanDiameterMm) || annulusMeanDiameterMm <= 0) {
    throw new Error("Annulus mean diameter must be a positive number in millimetres.");
  }
  if (positionsDeg.some((value) => !Number.isFinite(value))) {
    throw new Error("Every probe position must be a finite angle in degrees.");
  }
  const normalizedPositions = positionsDeg.map((value) => ((value % 360) + 360) % 360);
  if (new Set(normalizedPositions.map((value) => value.toFixed(6))).size !== normalizedPositions.length) {
    throw new Error("Probe angles must be unique around the annulus.");
  }
  const qualities = signals.map((signal) => assessSignalQuality(signal));
  const maximumWaveCount = Math.max(1, Math.min(12, Math.round(options.maximumWaveCount ?? 4)));
  const frequencies = signals.map((signal) => {
    const dt = median(signal.time.slice(1).map((value, index) => value - signal.time[index]));
    return dominantFrequency(spectrum(signal.pressure, dt));
  });
  const waveFrequencyKHz = median(frequencies);
  const spectralResult = sharedSpectralPeaks(signals, waveFrequencyKHz);
  const complexModeDetected = Boolean(spectralResult.significantNonHarmonic);
  const phases = relativePhases(signals, waveFrequencyKHz);
  const candidates = fitCandidates(phases, positionsDeg, maximumWaveCount);
  const best = candidates[0];
  const alternative = candidates[1];
  const separationDeg = alternative.phaseResidualDeg - best.phaseResidualDeg;
  const fittedProbePhasesDeg = positionsDeg.map((position) => {
    const sign = best.direction === "Counter-clockwise" ? -1 : 1;
    return normalizeAngleDeg(sign * best.waveCount * (position - positionsDeg[0]));
  });

  const series = cycleSeries(signals[0]);
  const frequencyDriftPct = linearDriftPct(series);
  const cycleFrequencies = series.map((point) => point.frequencyKHz);
  const frequencyVariationPct = cycleFrequencies.length > 1
    ? 100 * standardDeviation(cycleFrequencies) / Math.max(mean(cycleFrequencies), 1e-12)
    : Number.NaN;
  const capturedCycles = (signals[0].time.at(-1)! - signals[0].time[0]) * waveFrequencyKHz;
  const desiredWindows = Math.max(2, Math.min(12, Math.floor(capturedCycles / 3)));
  const windowLength = Math.floor(Math.min(...signals.map((signal) => signal.time.length)) / desiredWindows);
  const windowModes: ModeCandidate[] = [];
  const windowResidualsByProbe = positionsDeg.map(() => [] as number[]);
  for (let window = 0; window < desiredWindows; window += 1) {
    const start = window * windowLength;
    const end = window === desiredWindows - 1 ? Math.min(...signals.map((signal) => signal.time.length)) : (window + 1) * windowLength;
    if (end - start < 64) continue;
    const windowFrequencies = signals.map((signal) => {
      const dt = median(signal.time.slice(start + 1, end).map((value, index) => value - signal.time[start + index]));
      return dominantFrequency(spectrum(signal.pressure.slice(start, end), dt));
    });
    const windowFrequency = median(windowFrequencies);
    const windowPhases = relativePhases(signals, windowFrequency, start, end);
    windowModes.push(fitCandidates(windowPhases, positionsDeg, maximumWaveCount)[0]);
    windowPhases.forEach((phase, index) => {
      windowResidualsByProbe[index].push(wrapAngle(phase - (fittedProbePhasesDeg[index] * Math.PI) / 180));
    });
  }
  const modeTransitions = windowModes.slice(1).filter((candidate, index) =>
    candidate.waveCount !== windowModes[index].waveCount || candidate.direction !== windowModes[index].direction,
  ).length;
  const phaseJitterDeg = mean(windowResidualsByProbe.slice(1).map((values) => radiansToDegrees(circularStandardDeviation(values))));

  let identifiability: ModeIdentifiability = best.phaseResidualDeg <= 20 && separationDeg >= 10 && signals.length >= 4
    ? "Identified"
    : best.phaseResidualDeg <= 45 && separationDeg >= 5
      ? "Candidate"
      : "Not identifiable";
  const phaseQualityUsable = qualities.every((quality) => quality.phaseUsable);
  if (options.synchronizationConfirmed === false || !phaseQualityUsable || complexModeDetected || modeTransitions > Math.max(1, Math.floor(windowModes.length / 3))) {
    identifiability = "Not identifiable";
  }
  const phaseFit = Math.max(0, 1 - (best.phaseResidualDeg * Math.PI / 180) / Math.PI);
  const modeConfidence = Math.max(0, Math.min(1,
    0.5 * Math.max(0, 1 - best.phaseResidualDeg / 90) +
    0.35 * Math.min(1, separationDeg / 45) +
    0.15 * Math.min(1, (signals.length - 2) / 3),
  ));
  const stableFrequency = Number.isFinite(frequencyDriftPct) && Math.abs(frequencyDriftPct) <= 3 && frequencyVariationPct <= 2;
  const transitionalFrequency = Number.isFinite(frequencyDriftPct) && Math.abs(frequencyDriftPct) <= 8 && frequencyVariationPct <= 5;
  const stability = identifiability === "Identified" && modeTransitions === 0 && stableFrequency && phaseJitterDeg <= 15
    ? "Stable"
    : identifiability !== "Not identifiable" && modeTransitions <= 1 && transitionalFrequency && phaseJitterDeg <= 30
      ? "Transitional"
      : "Unstable";

  const warnings: string[] = [];
  if (signals.length === 3) warnings.push("With only three probes, different wave modes can produce similar phase patterns. Use four or more nonuniform probe locations to separate them more reliably.");
  if (equalSpacingRisk(positionsDeg)) warnings.push("Equal probe spacing can make different wave counts or directions produce the same measured phase pattern.");
  if (options.synchronizationConfirmed === false) warnings.push("Probe synchronization was not confirmed, so wave count and direction are not identifiable.");
  if (!phaseQualityUsable) warnings.push("At least one probe does not meet the minimum sampling or spectral signal-to-noise requirement. Kythros therefore does not report wave count, direction, propagation speed, or phase jitter as identified results.");
  if (complexModeDetected && spectralResult.significantNonHarmonic) warnings.push(`A second non-harmonic pressure component at ${spectralResult.significantNonHarmonic.frequencyKHz.toFixed(2)} kHz is ${(100 * spectralResult.significantNonHarmonic.relativeAmplitude).toFixed(0)}% of the shared spectral peak; a single-mode phase fit is not a complete mode description.`);
  if (identifiability !== "Identified") warnings.push(`Kythros cannot uniquely identify one rotating mode. The best fit is ${best.waveCount}-wave ${best.direction.toLowerCase()}, and the next-best fit is ${alternative.waveCount}-wave ${alternative.direction.toLowerCase()}.`);
  const minimumNyquist = Math.min(...qualities.map((quality) => quality.nyquistKHz));
  if (minimumNyquist < 3 * waveFrequencyKHz) warnings.push("The sample rate is too low to represent the third harmonic of the detected wave-passage frequency.");
  if (Number.isFinite(options.sensorBandwidthKHz) && options.sensorBandwidthKHz! < 2 * waveFrequencyKHz) warnings.push("Experimental sensor bandwidth does not cover the second harmonic; sharp-front and harmonic comparisons are limited.");
  if (Number.isFinite(options.filterCutoffKHz) && options.filterCutoffKHz! < 2 * waveFrequencyKHz) warnings.push("Experimental filter cutoff attenuates the second-harmonic band.");
  if (Number.isFinite(options.filterCutoffKHz) && options.filterCutoffKHz! > minimumNyquist) warnings.push("The entered filter cutoff is above half the sample rate. Verify the anti-alias filter before interpreting the spectrum.");

  return {
    waveFrequencyKHz,
    waveSpeedMps: identifiability === "Not identifiable"
      ? Number.NaN
      : circumferentialWaveSpeedMps(annulusMeanDiameterMm, waveFrequencyKHz, best.waveCount),
    waveCount: best.waveCount,
    direction: best.direction,
    stability,
    identifiability,
    frequencyDrift: Math.abs(frequencyDriftPct) / 100,
    frequencyDriftPct,
    frequencyVariationPct,
    phaseFit,
    phaseResidualDeg: best.phaseResidualDeg,
    phaseJitterDeg,
    modeConfidence,
    modeTransitions,
    analyzedWindows: windowModes.length,
    alternativeWaveCount: alternative.waveCount,
    alternativeDirection: alternative.direction,
    alternativeResidualDeg: alternative.phaseResidualDeg,
    candidateModes: candidates.slice(0, 4),
    spectralPeaks: spectralResult.peaks,
    complexModeDetected,
    probePhasesDeg: phases.map(radiansToDegrees),
    fittedProbePhasesDeg,
    cycleSeries: series,
    warnings,
  };
}

/**
 * Finds one robust experiment-to-CFD time offset for the complete probe array,
 * then applies that shared lag to every pair so spatial phase differences are
 * preserved instead of independently aligned away.
 */
export function compareProbeSets(testSignals: Signal[], cfdSignals: Signal[]): ProbeSetComparison {
  if (testSignals.length < 3 || testSignals.length !== cfdSignals.length) {
    throw new Error("Experiment and CFD must contain the same three-or-more probe columns.");
  }
  const initial = testSignals.map((signal, index) => compareSignals(signal, cfdSignals[index]));
  const individualLagUs = initial.map((comparison) => comparison.phaseLagUs);
  const sharedLagUs = median(individualLagUs);
  const comparisons = testSignals.map((signal, index) => compareSignals(signal, cfdSignals[index], { fixedLagUs: sharedLagUs }));
  return {
    comparisons,
    sharedLagUs,
    individualLagUs,
    alignmentSpreadUs: individualLagUs.length > 1 ? standardDeviation(individualLagUs) : 0,
  };
}

export function phasePatternErrorDeg(reference: RdeModeResult, candidate: RdeModeResult) {
  if (reference.probePhasesDeg.length !== candidate.probePhasesDeg.length) return Number.NaN;
  const errors = reference.probePhasesDeg.slice(1).map((phase, index) =>
    normalizeAngleDeg(candidate.probePhasesDeg[index + 1] - phase),
  );
  return Math.sqrt(mean(errors.map((value) => value ** 2)));
}
