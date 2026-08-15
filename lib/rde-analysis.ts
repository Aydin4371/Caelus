export type Signal = {
  name: string;
  time: number[];
  pressure: number[];
  sourceRows?: number;
  droppedRows?: number;
};

export type Spectrum = {
  frequency: number[];
  amplitude: number[];
};

export type Comparison = {
  time: number[];
  test: number[];
  cfd: number[];
  testSpectrum: Spectrum;
  cfdSpectrum: Spectrum;
  testFrequency: number;
  cfdFrequency: number;
  frequencyError: number;
  testAmplitude: number;
  cfdAmplitude: number;
  amplitudeError: number;
  phaseLagUs: number;
  correlation: number;
  rmse: number;
  nrmse: number;
  pressureBias: number;
  testMetrics: PressureMetrics;
  cfdMetrics: PressureMetrics;
  testQuality: DataQualityResult;
  cfdQuality: DataQualityResult;
};

export type PressureMetrics = {
  meanPressure: number;
  peakPressure: number;
  minimumPressure: number;
  rmsPressure: number;
  oscillationAmplitude: number;
  impulsePerCycleMpaMs: number;
  riseTimeUs: number;
  secondHarmonicRatio: number;
  cycleVariabilityPct: number;
  cycleCount: number;
};

export type DataQualityResult = {
  sampleCount: number;
  durationMs: number;
  sampleRateKHz: number;
  nyquistKHz: number;
  samplesPerCycle: number;
  capturedCycles: number;
  intervalJitterPct: number;
  detectedGaps: number;
  droppedRows: number;
  clippingDetected: boolean;
  spectralSnrDb: number;
  noiseFloorMpa: number;
  aliasingRisk: boolean;
  frequencyUsable: boolean;
  phaseUsable: boolean;
  frontShapeUsable: boolean;
  limitedOutputs: string[];
  status: "Ready" | "Review";
  findings: string[];
};

export const ANALYSIS_VERSION = "1.5.0";

export const REVIEW_THRESHOLDS = {
  minimumCorrelation: 0.7,
  maximumFrequencyError: 0.05,
  maximumAmplitudeError: 0.15,
  maximumPeakPressureError: 0.15,
  maximumRiseTimeError: 0.25,
  maximumHarmonicRatioError: 0.3,
  maximumCycleVariabilityDifferencePct: 10,
} as const;

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function rms(values: number[]) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(values.length, 1));
}

function standardDeviation(values: number[]) {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validateSignal(signal: Signal) {
  if (signal.time.length !== signal.pressure.length) {
    throw new Error(`${signal.name}: time and pressure columns have different lengths.`);
  }
  if (signal.time.length < 32) {
    throw new Error(`${signal.name}: at least 32 samples are required for comparison.`);
  }
  for (let index = 0; index < signal.time.length; index += 1) {
    if (!Number.isFinite(signal.time[index]) || !Number.isFinite(signal.pressure[index])) {
      throw new Error(`${signal.name}: all time and pressure values must be finite numbers.`);
    }
    if (index > 0 && signal.time[index] <= signal.time[index - 1]) {
      throw new Error(`${signal.name}: time values must increase without duplicates.`);
    }
  }
}

function interpolate(signal: Signal, time: number) {
  const times = signal.time;
  if (time <= times[0]) return signal.pressure[0];
  if (time >= times[times.length - 1]) return signal.pressure[signal.pressure.length - 1];

  let low = 0;
  let high = times.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (times[mid] <= time) low = mid;
    else high = mid;
  }

  const fraction = (time - times[low]) / (times[high] - times[low]);
  return signal.pressure[low] + fraction * (signal.pressure[high] - signal.pressure[low]);
}

function nextPowerOfTwo(value: number) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function fft(real: number[], imaginary: number[]) {
  const n = real.length;
  for (let index = 1, reverse = 0; index < n; index += 1) {
    let bit = n >> 1;
    for (; reverse & bit; bit >>= 1) reverse ^= bit;
    reverse ^= bit;
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
      [imaginary[index], imaginary[reverse]] = [imaginary[reverse], imaginary[index]];
    }
  }
  for (let length = 2; length <= n; length *= 2) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < n; offset += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

/**
 * Computes a Hann-windowed one-sided amplitude spectrum with a radix-2 FFT.
 * Frequencies are returned in kHz because the input time base is milliseconds.
 */
export function spectrum(values: number[], dtMs: number): Spectrum {
  if (values.length < 32 || !Number.isFinite(dtMs) || dtMs <= 0) {
    throw new Error("A spectrum requires at least 32 samples and a positive sample interval.");
  }

  const sampleCount = Math.min(values.length, 8192);
  const start = Math.floor((values.length - sampleCount) / 2);
  const sampled = values.slice(start, start + sampleCount);
  const center = mean(sampled);
  const transformSize = Math.min(16384, nextPowerOfTwo(sampleCount));
  const real = Array(transformSize).fill(0);
  const imaginary = Array(transformSize).fill(0);
  let windowSum = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const window = sampleCount === 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (sampleCount - 1));
    real[index] = (sampled[index] - center) * window;
    windowSum += window;
  }
  fft(real, imaginary);
  const frequency: number[] = [];
  const amplitude: number[] = [];
  const maxBin = Math.floor(transformSize / 2);
  for (let k = 1; k < maxBin; k += 1) {
    frequency.push(k / (transformSize * dtMs));
    amplitude.push((2 * Math.hypot(real[k], imaginary[k])) / Math.max(windowSum, 1e-12));
  }

  return { frequency, amplitude };
}

export function dominantFrequency(result: Spectrum) {
  if (!result.amplitude.length) return 0;
  let best = 0;
  for (let index = 1; index < result.amplitude.length; index += 1) {
    if (result.amplitude[index] > result.amplitude[best]) best = index;
  }
  if (best === 0 || best === result.amplitude.length - 1) return result.frequency[best];
  const left = Math.log(Math.max(result.amplitude[best - 1], 1e-16));
  const center = Math.log(Math.max(result.amplitude[best], 1e-16));
  const right = Math.log(Math.max(result.amplitude[best + 1], 1e-16));
  const denominator = left - 2 * center + right;
  const offset = Math.abs(denominator) > 1e-12 ? 0.5 * (left - right) / denominator : 0;
  const spacing = result.frequency[1] - result.frequency[0];
  return result.frequency[best] + Math.max(-0.5, Math.min(0.5, offset)) * spacing;
}

function upwardCrossings(time: number[], values: number[], baseline = mean(values)) {
  const crossings: number[] = [];
  const indices: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const before = values[index - 1] - baseline;
    const after = values[index] - baseline;
    if (before <= 0 && after > 0) {
      const fraction = -before / Math.max(after - before, 1e-12);
      crossings.push(time[index - 1] + fraction * (time[index] - time[index - 1]));
      indices.push(index);
    }
  }
  return { crossings, indices };
}

function harmonicAmplitude(result: Spectrum, targetFrequency: number) {
  if (!result.frequency.length || targetFrequency <= 0) return 0;
  let best = 0;
  for (let index = 1; index < result.frequency.length; index += 1) {
    if (Math.abs(result.frequency[index] - targetFrequency) < Math.abs(result.frequency[best] - targetFrequency)) best = index;
  }
  return result.amplitude[best] ?? 0;
}

export function calculatePressureMetrics(
  time: number[],
  pressure: number[],
  resultSpectrum: Spectrum,
  frequencyKHz: number,
): PressureMetrics {
  const meanPressure = mean(pressure);
  const centered = pressure.map((value) => value - meanPressure);
  const { indices } = upwardCrossings(time, pressure, meanPressure);
  const cyclePeaks: number[] = [];
  const cycleRanges: number[] = [];
  const cycleImpulses: number[] = [];
  const riseTimesUs: number[] = [];

  for (let cycle = 0; cycle < indices.length - 1; cycle += 1) {
    const start = indices[cycle];
    const end = indices[cycle + 1];
    if (end - start < 4) continue;
    const values = pressure.slice(start, end + 1);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(maximum - minimum, 1e-12);
    cyclePeaks.push(maximum);
    cycleRanges.push(range);

    let impulse = 0;
    for (let index = start + 1; index <= end; index += 1) {
      const before = Math.max(pressure[index - 1] - meanPressure, 0);
      const after = Math.max(pressure[index] - meanPressure, 0);
      impulse += 0.5 * (before + after) * (time[index] - time[index - 1]);
    }
    cycleImpulses.push(impulse);

    const periodSamples = end - start;
    const riseStart = Math.max(0, start - Math.floor(periodSamples / 2));
    const riseEnd = Math.min(pressure.length - 1, start + Math.ceil(periodSamples / 2));
    const riseWindow = pressure.slice(riseStart, riseEnd + 1);
    const riseMinimum = Math.min(...riseWindow);
    const riseMaximum = Math.max(...riseWindow);
    const riseRange = Math.max(riseMaximum - riseMinimum, 1e-12);
    const low = riseMinimum + 0.1 * riseRange;
    const high = riseMinimum + 0.9 * riseRange;
    let lowTime: number | null = null;
    let highTime: number | null = null;
    for (let index = riseStart + 1; index <= riseEnd; index += 1) {
      if (lowTime === null && pressure[index - 1] <= low && pressure[index] > low) {
        const fraction = (low - pressure[index - 1]) / Math.max(pressure[index] - pressure[index - 1], 1e-12);
        lowTime = time[index - 1] + fraction * (time[index] - time[index - 1]);
      }
      if (lowTime !== null && pressure[index - 1] <= high && pressure[index] > high) {
        const fraction = (high - pressure[index - 1]) / Math.max(pressure[index] - pressure[index - 1], 1e-12);
        highTime = time[index - 1] + fraction * (time[index] - time[index - 1]);
        break;
      }
    }
    if (lowTime !== null && highTime !== null && highTime >= lowTime) riseTimesUs.push((highTime - lowTime) * 1000);
  }

  const fundamental = harmonicAmplitude(resultSpectrum, frequencyKHz);
  const secondHarmonic = harmonicAmplitude(resultSpectrum, 2 * frequencyKHz);
  const averageRange = mean(cycleRanges);

  return {
    meanPressure,
    peakPressure: cyclePeaks.length ? mean(cyclePeaks) : Math.max(...pressure),
    minimumPressure: Math.min(...pressure),
    rmsPressure: rms(pressure),
    oscillationAmplitude: Math.SQRT2 * rms(centered),
    impulsePerCycleMpaMs: cycleImpulses.length ? mean(cycleImpulses) : Number.NaN,
    riseTimeUs: riseTimesUs.length ? median(riseTimesUs) : Number.NaN,
    secondHarmonicRatio: fundamental > 0 ? secondHarmonic / fundamental : Number.NaN,
    cycleVariabilityPct: cycleRanges.length > 1 ? 100 * standardDeviation(cycleRanges) / Math.max(averageRange, 1e-12) : Number.NaN,
    cycleCount: Math.max(0, indices.length - 1),
  };
}

export function assessSignalQuality(signal: Signal, frequencyKHz?: number): DataQualityResult {
  validateSignal(signal);
  const intervals = signal.time.slice(1).map((time, index) => time - signal.time[index]);
  const dt = median(intervals);
  const durationMs = (signal.time.at(-1) ?? signal.time[0]) - signal.time[0];
  const resultSpectrum = spectrum(signal.pressure, dt);
  const inferredFrequency = frequencyKHz ?? dominantFrequency(resultSpectrum);
  const intervalJitterPct = 100 * Math.max(...intervals.map((value) => Math.abs(value - dt))) / Math.max(dt, 1e-12);
  const detectedGaps = intervals.filter((value) => value > 1.5 * dt).length;
  const pressureRange = Math.max(...signal.pressure) - Math.min(...signal.pressure);
  const tolerance = Math.max(1e-12, pressureRange * 1e-10);
  let clippedRun = 0;
  let longestClippedRun = 0;
  for (let index = 1; index < signal.pressure.length; index += 1) {
    if (Math.abs(signal.pressure[index] - signal.pressure[index - 1]) <= tolerance) {
      clippedRun += 1;
      longestClippedRun = Math.max(longestClippedRun, clippedRun);
    } else {
      clippedRun = 0;
    }
  }
  const clippingDetected = longestClippedRun >= 3;
  const sampleRateKHz = 1 / Math.max(dt, 1e-12);
  const nyquistKHz = sampleRateKHz / 2;
  const samplesPerCycle = sampleRateKHz / Math.max(inferredFrequency, 1e-12);
  const capturedCycles = durationMs * inferredFrequency;
  const droppedRows = signal.droppedRows ?? 0;
  const spacing = resultSpectrum.frequency.length > 1 ? resultSpectrum.frequency[1] - resultSpectrum.frequency[0] : 0;
  const fundamentalAmplitude = harmonicAmplitude(resultSpectrum, inferredFrequency);
  const noiseBins = resultSpectrum.amplitude.filter((_, index) => {
    const frequency = resultSpectrum.frequency[index];
    if (frequency > Math.min(nyquistKHz, 5 * inferredFrequency)) return false;
    return [1, 2, 3].every((harmonic) => Math.abs(frequency - harmonic * inferredFrequency) > Math.max(2 * spacing, 0.04 * inferredFrequency));
  });
  const noiseFloorMpa = noiseBins.length ? median(noiseBins) : 0;
  const spectralSnrDb = 20 * Math.log10(Math.max(fundamentalAmplitude, 1e-12) / Math.max(noiseFloorMpa, 1e-12));
  const aliasingRisk = samplesPerCycle < 10 || inferredFrequency >= 0.4 * nyquistKHz;
  const frequencyUsable = capturedCycles >= 5 && samplesPerCycle >= 10 && detectedGaps === 0 && !clippingDetected && spectralSnrDb >= 10;
  const phaseUsable = frequencyUsable && samplesPerCycle >= 20 && intervalJitterPct <= 1;
  const frontShapeUsable = phaseUsable && nyquistKHz >= 5 * inferredFrequency;

  const limitedOutputs: string[] = [];
  if (!frequencyUsable) limitedOutputs.push("dominant frequency and frequency drift");
  if (!phaseUsable) limitedOutputs.push("wave count, direction, propagation speed, and phase jitter");
  if (!frontShapeUsable) limitedOutputs.push("rise time, peak sharpness, and harmonic content");

  const findings: string[] = [];
  if (capturedCycles < 5) findings.push(`Only ${capturedCycles.toFixed(1)} cycles captured; at least five are required for frequency and cycle statistics.`);
  if (samplesPerCycle < 20) findings.push(`Only ${samplesPerCycle.toFixed(0)} samples per cycle; phase and front-rise conclusions are limited.`);
  if (intervalJitterPct > 1) findings.push(`Sample-interval variation reaches ${intervalJitterPct.toFixed(1)}%; resample or correct the acquisition time base before phase analysis.`);
  if (detectedGaps) findings.push(`${detectedGaps} acquisition gap${detectedGaps === 1 ? "" : "s"} detected.`);
  if (droppedRows) findings.push(`${droppedRows} non-numeric source row${droppedRows === 1 ? " was" : "s were"} omitted during import.`);
  if (clippingDetected) findings.push("Repeated plateaus suggest clipping or coarse quantization; peak and waveform-shape conclusions are limited.");
  if (spectralSnrDb < 10) findings.push(`Fundamental-to-spectral-noise ratio is ${spectralSnrDb.toFixed(1)} dB; frequency and phase estimates are not trusted below 10 dB.`);
  if (aliasingRisk) findings.push("The dominant frequency is too close to Nyquist or has fewer than 10 samples per cycle; aliasing cannot be excluded.");
  if (limitedOutputs.length) findings.push(`Not identifiable from this trace: ${limitedOutputs.join("; ")}.`);
  if (!findings.length) findings.push(`Sampling, continuity, clipping, and spectral SNR checks pass (${spectralSnrDb.toFixed(1)} dB).`);

  return {
    sampleCount: signal.time.length,
    durationMs,
    sampleRateKHz,
    nyquistKHz,
    samplesPerCycle,
    capturedCycles,
    intervalJitterPct,
    detectedGaps,
    droppedRows,
    clippingDetected,
    spectralSnrDb,
    noiseFloorMpa,
    aliasingRisk,
    frequencyUsable,
    phaseUsable,
    frontShapeUsable,
    limitedOutputs,
    status: limitedOutputs.length ? "Review" : "Ready",
    findings,
  };
}

function normalizedCorrelation(a: number[], b: number[]) {
  const aMean = mean(a);
  const bMean = mean(b);
  let numerator = 0;
  let aEnergy = 0;
  let bEnergy = 0;

  for (let index = 0; index < a.length; index += 1) {
    const aValue = a[index] - aMean;
    const bValue = b[index] - bMean;
    numerator += aValue * bValue;
    aEnergy += aValue * aValue;
    bEnergy += bValue * bValue;
  }

  return numerator / Math.max(Math.sqrt(aEnergy * bEnergy), 1e-12);
}

/**
 * Aligns a test signal and a matching CFD virtual probe, then calculates
 * deterministic comparison metrics. Both signals use milliseconds and MPa.
 */
export function compareSignals(
  testSignal: Signal,
  cfdSignal: Signal,
  options: { fixedLagUs?: number } = {},
): Comparison {
  validateSignal(testSignal);
  validateSignal(cfdSignal);

  const testDt = median(testSignal.time.slice(1).map((time, index) => time - testSignal.time[index]));
  const cfdDt = median(cfdSignal.time.slice(1).map((time, index) => time - cfdSignal.time[index]));
  const dt = Math.max(testDt, cfdDt);
  const start = Math.max(testSignal.time[0], cfdSignal.time[0]);
  const end = Math.min(testSignal.time.at(-1) ?? start, cfdSignal.time.at(-1) ?? start);
  const availableSamples = Math.floor((end - start) / dt) + 1;

  if (!Number.isFinite(dt) || dt <= 0 || end <= start || availableSamples < 32) {
    throw new Error("The two signals need at least 32 overlapping samples on a valid time base.");
  }

  // Preserve the native comparison interval and use the first bounded window.
  // This avoids aliasing that would result from naively compressing a long trace.
  const sampleCount = Math.min(2400, availableSamples);
  const time = Array.from({ length: sampleCount }, (_, index) => start + index * dt);
  const test = time.map((value) => interpolate(testSignal, value));
  const rawCfd = time.map((value) => interpolate(cfdSignal, value));

  // Periodic RDE signals have multiple correlation peaks separated by a wave
  // period. Automatic alignment is restricted to less than half a dominant
  // period; larger timing shifts require acquisition timestamps or a trigger.
  const preliminaryFrequency = dominantFrequency(spectrum(test, dt));
  const halfPeriodSamples = preliminaryFrequency > 0 ? Math.floor(0.45 / (preliminaryFrequency * dt)) : 24;
  const maxLag = Math.max(2, Math.min(160, Math.floor(sampleCount / 8), halfPeriodSamples));
  let bestLag = Number.isFinite(options.fixedLagUs)
    ? Math.max(-maxLag, Math.min(maxLag, Math.round(options.fixedLagUs! / (dt * 1000))))
    : 0;
  let bestCorrelation = -Infinity;

  const candidateLags = Number.isFinite(options.fixedLagUs)
    ? [bestLag]
    : Array.from({ length: 2 * maxLag + 1 }, (_, index) => index - maxLag);
  for (const lag of candidateLags) {
    const testWindow: number[] = [];
    const cfdWindow: number[] = [];
    for (let index = maxLag; index < sampleCount - maxLag; index += 1) {
      const cfdIndex = index + lag;
      if (cfdIndex >= 0 && cfdIndex < sampleCount) {
        testWindow.push(test[index]);
        cfdWindow.push(rawCfd[cfdIndex]);
      }
    }
    const value = normalizedCorrelation(testWindow, cfdWindow);
    if (value > bestCorrelation) {
      bestCorrelation = value;
      bestLag = lag;
    }
  }

  const alignedTime: number[] = [];
  const alignedTest: number[] = [];
  const alignedCfd: number[] = [];
  for (let index = maxLag; index < sampleCount - maxLag; index += 1) {
    const cfdIndex = index + bestLag;
    if (cfdIndex >= 0 && cfdIndex < sampleCount) {
      alignedTime.push(time[index]);
      alignedTest.push(test[index]);
      alignedCfd.push(rawCfd[cfdIndex]);
    }
  }

  const testMean = mean(alignedTest);
  const cfdMean = mean(alignedCfd);
  const testCentered = alignedTest.map((value) => value - testMean);
  const cfdCentered = alignedCfd.map((value) => value - cfdMean);
  const testAmplitude = Math.SQRT2 * rms(testCentered);
  const cfdAmplitude = Math.SQRT2 * rms(cfdCentered);
  const amplitudeError = Math.abs(cfdAmplitude - testAmplitude) / Math.max(testAmplitude, 1e-9);
  const residual = alignedTest.map((value, index) => value - alignedCfd[index]);
  const rmse = rms(residual);
  const nrmse = rmse / Math.max(rms(testCentered), 1e-9);
  const testSpectrum = spectrum(alignedTest, dt);
  const cfdSpectrum = spectrum(alignedCfd, dt);
  const testFrequency = dominantFrequency(testSpectrum);
  const cfdFrequency = dominantFrequency(cfdSpectrum);
  const frequencyError = Math.abs(cfdFrequency - testFrequency) / Math.max(testFrequency, 1e-9);
  const testMetrics = calculatePressureMetrics(alignedTime, alignedTest, testSpectrum, testFrequency);
  const cfdMetrics = calculatePressureMetrics(alignedTime, alignedCfd, cfdSpectrum, cfdFrequency);
  const testQuality = assessSignalQuality(testSignal, testFrequency);
  const cfdQuality = assessSignalQuality(cfdSignal, cfdFrequency);

  return {
    time: alignedTime,
    test: alignedTest,
    cfd: alignedCfd,
    testSpectrum,
    cfdSpectrum,
    testFrequency,
    cfdFrequency,
    frequencyError,
    testAmplitude,
    cfdAmplitude,
    amplitudeError,
    phaseLagUs: bestLag * dt * 1000,
    correlation: bestCorrelation,
    rmse,
    nrmse,
    pressureBias: cfdMean - testMean,
    testMetrics,
    cfdMetrics,
    testQuality,
    cfdQuality,
  };
}

export function makeDemoSignals() {
  const count = 1600;
  const dt = 0.0025;
  const time = Array.from({ length: count }, (_, index) => index * dt);
  const test = time.map(
    (value, index) =>
      1.6 +
      1.08 * Math.sin(2 * Math.PI * 8.42 * value) +
      0.19 * Math.sin(2 * Math.PI * 16.84 * value + 0.35) +
      0.045 * Math.sin(index * 1.731),
  );
  const cfd = time.map(
    (value) =>
      1.58 +
      1.03 * Math.sin(2 * Math.PI * 8.38 * (value + 0.006)) +
      0.14 * Math.sin(2 * Math.PI * 16.76 * value + 0.24),
  );

  return {
    test: { name: "Synthetic hot-fire test", time, pressure: test },
    cfd: { name: "Synthetic CFD probe", time, pressure: cfd },
  };
}

/**
 * Creates a complete, non-sensitive five-probe RDE case for interface and
 * numerical demonstrations. Probe angles are deliberately nonuniform so that
 * wave count and direction are not aliased by equal angular spacing.
 */
export function makeDemoProbeSignals() {
  const count = 1600;
  const dt = 0.0025;
  const time = Array.from({ length: count }, (_, index) => index * dt);
  const positionsDeg = [0, 47, 131, 226, 311];
  const makeSet = (kind: "test" | "cfd") =>
    positionsDeg.map((positionDeg, probeIndex) => {
      const angle = (positionDeg * Math.PI) / 180;
      const frequency = kind === "test" ? 8.42 : 8.35;
      const amplitude = kind === "test" ? 1.08 : 1.01;
      const shift = kind === "test" ? 0 : 0.005;
      const pressure = time.map((value, sampleIndex) =>
        (kind === "test" ? 1.6 : 1.58) +
        amplitude * Math.sin(2 * Math.PI * frequency * (value + shift) - angle) +
        (kind === "test" ? 0.18 : 0.13) * Math.sin(4 * Math.PI * frequency * value - 2 * angle + 0.3) +
        (kind === "test" ? 0.025 * Math.sin(sampleIndex * (1.41 + probeIndex * 0.13)) : 0),
      );
      return {
        name: `${kind === "test" ? "Hot-fire sensor" : "CFD virtual probe"} P${probeIndex + 1}`,
        time,
        pressure,
      };
    });

  return {
    positionsDeg,
    test: makeSet("test"),
    cfd: makeSet("cfd"),
  };
}

type ColumnDefinition = {
  aliases: string[];
  factor: number;
};

const TIME_COLUMNS: ColumnDefinition[] = [
  { aliases: ["time_ms", "t_ms", "time", "t"], factor: 1 },
  { aliases: ["time_s", "t_s"], factor: 1000 },
  { aliases: ["time_us", "t_us", "time_µs", "t_µs"], factor: 0.001 },
];

const PRESSURE_COLUMNS: ColumnDefinition[] = [
  { aliases: ["pressure_mpa", "p_mpa", "pressure", "p"], factor: 1 },
  { aliases: ["pressure_kpa", "p_kpa"], factor: 0.001 },
  { aliases: ["pressure_pa", "p_pa"], factor: 0.000001 },
];

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function findColumn(headers: string[], definitions: ColumnDefinition[]) {
  for (const definition of definitions) {
    const index = headers.findIndex((header) => definition.aliases.includes(header));
    if (index >= 0) return { index, factor: definition.factor };
  }
  return null;
}

/** Parses CSV, TSV, or semicolon-delimited data into milliseconds and MPa. */
export function parseSignalCsv(text: string, name: string): Signal {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 33) {
    throw new Error("The file needs a header and at least 32 data rows.");
  }

  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map(normalizeHeader);
  const timeColumn = findColumn(headers, TIME_COLUMNS);
  const pressureColumn = findColumn(headers, PRESSURE_COLUMNS);

  if (!timeColumn || !pressureColumn) {
    throw new Error(
      "Use named time and pressure columns with units, such as time_ms and pressure_MPa.",
    );
  }

  const sourceRows = lines.slice(1);
  const rows = sourceRows
    .map((line) => line.split(delimiter).map((value) => Number(value.trim())))
    .filter(
      (row) =>
        Number.isFinite(row[timeColumn.index]) && Number.isFinite(row[pressureColumn.index]),
    )
    .map((row) => ({
      time: row[timeColumn.index] * timeColumn.factor,
      pressure: row[pressureColumn.index] * pressureColumn.factor,
    }))
    .sort((a, b) => a.time - b.time);

  const signal = {
    name,
    time: rows.map((row) => row.time),
    pressure: rows.map((row) => row.pressure),
    sourceRows: sourceRows.length,
    droppedRows: sourceRows.length - rows.length,
  };
  validateSignal(signal);
  return signal;
}

/**
 * Parses one synchronized multi-probe export. Required columns are time plus
 * three or more contiguous pressure columns, such as p1_MPa through p5_MPa.
 */
export function parseProbeCsv(text: string, name: string): Signal[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 33) {
    throw new Error("The file needs a header and at least 32 data rows.");
  }

  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map(normalizeHeader);
  const timeColumn = findColumn(headers, TIME_COLUMNS);
  if (!timeColumn) {
    throw new Error("Use a named time column with units, such as time_ms.");
  }

  const detected = headers.flatMap((header, index) => {
    const match = header.match(/^(?:p|pressure_p|probe|sensor)(\d+)_(mpa|kpa|pa)$/);
    if (!match) return [];
    const factor = match[2] === "mpa" ? 1 : match[2] === "kpa" ? 0.001 : 0.000001;
    return [{ probe: Number(match[1]), index, factor }];
  }).sort((left, right) => left.probe - right.probe);
  const unique = detected.filter((item, index) => index === 0 || item.probe !== detected[index - 1].probe);
  if (unique.length < 3 || unique.some((item, index) => item.probe !== index + 1)) {
    throw new Error("Include at least P1, P2, and P3 as contiguous pressure columns with units, such as p1_MPa.");
  }
  const probes = unique.map(({ index, factor }) => ({ index, factor }));

  const sourceRows = lines.slice(1);
  const rows = sourceRows
    .map((line) => line.split(delimiter).map((value) => Number(value.trim())))
    .filter((row) =>
      Number.isFinite(row[timeColumn.index]) &&
      probes.every((probe) => probe && Number.isFinite(row[probe.index])),
    )
    .map((row) => ({
      time: row[timeColumn.index] * timeColumn.factor,
      pressure: probes.map((probe) => row[probe!.index] * probe!.factor),
    }))
    .sort((a, b) => a.time - b.time);

  return probes.map((_, probeIndex) => {
    const signal = {
      name: `${name} · P${probeIndex + 1}`,
      time: rows.map((row) => row.time),
      pressure: rows.map((row) => row.pressure[probeIndex]),
      sourceRows: sourceRows.length,
      droppedRows: sourceRows.length - rows.length,
    };
    validateSignal(signal);
    return signal;
  });
}

export function serializeReport(result: Comparison, sources: { test: string; cfd: string }) {
  return JSON.stringify(
    {
      schema: "caevera-rde-comparison-report",
      analysisVersion: ANALYSIS_VERSION,
      generatedAt: new Date().toISOString(),
      sources,
      units: { time: "ms", pressure: "MPa", frequency: "kHz", phaseLag: "µs" },
      metrics: {
        testFrequency: result.testFrequency,
        cfdFrequency: result.cfdFrequency,
        frequencyError: result.frequencyError,
        testAmplitude: result.testAmplitude,
        cfdAmplitude: result.cfdAmplitude,
        amplitudeError: result.amplitudeError,
        phaseLagUs: result.phaseLagUs,
        waveformCorrelation: result.correlation,
        rmse: result.rmse,
        normalizedRmse: result.nrmse,
        pressureBias: result.pressureBias,
        pressureCycleMetrics: {
          experiment: result.testMetrics,
          cfd: result.cfdMetrics,
        },
      },
      dataQuality: { experiment: result.testQuality, cfd: result.cfdQuality },
      limitations: [
        "Uncertainty statements use root-sum-square one-standard-uncertainty estimates, not certification tolerances.",
        "This report compares one pressure-signal pair and does not establish an operating envelope.",
        "Model-form uncertainty and sensor transfer-function corrections are not included.",
      ],
    },
    null,
    2,
  );
}
