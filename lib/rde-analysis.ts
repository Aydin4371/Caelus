export type Signal = {
  name: string;
  time: number[];
  pressure: number[];
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
  score: number;
};

export type Recommendation = {
  title: string;
  detail: string;
  evidence: string;
};

export type RdeModeResult = {
  waveFrequencyKHz: number;
  waveSpeedMps: number;
  waveCount: number;
  direction: "Clockwise" | "Counter-clockwise";
  stability: "Stable" | "Transitional" | "Unstable";
  frequencyDrift: number;
  phaseFit: number;
};

export const ANALYSIS_VERSION = "0.3.0";

export const REVIEW_THRESHOLDS = {
  minimumCorrelation: 0.7,
  maximumFrequencyError: 0.05,
  maximumAmplitudeError: 0.15,
} as const;

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function rms(values: number[]) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(values.length, 1));
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

/**
 * Computes a one-sided amplitude spectrum with a direct DFT. Frequencies are
 * returned in kHz because the input time base is milliseconds.
 */
export function spectrum(values: number[], dtMs: number): Spectrum {
  if (values.length < 32 || !Number.isFinite(dtMs) || dtMs <= 0) {
    throw new Error("A spectrum requires at least 32 samples and a positive sample interval.");
  }

  const maxSamples = 768;
  const stride = Math.max(1, Math.ceil(values.length / maxSamples));
  const sampled = values.filter((_, index) => index % stride === 0);
  const centered = sampled.map((value) => value - mean(sampled));
  const n = centered.length;
  const frequency: number[] = [];
  const amplitude: number[] = [];
  const maxBin = Math.min(Math.floor(n / 2), 280);

  for (let k = 1; k < maxBin; k += 1) {
    let real = 0;
    let imaginary = 0;
    for (let i = 0; i < n; i += 1) {
      const angle = (2 * Math.PI * k * i) / n;
      real += centered[i] * Math.cos(angle);
      imaginary -= centered[i] * Math.sin(angle);
    }
    frequency.push(k / (n * dtMs * stride));
    amplitude.push((2 * Math.hypot(real, imaginary)) / n);
  }

  return { frequency, amplitude };
}

function dominantFrequency(result: Spectrum) {
  if (!result.amplitude.length) return 0;
  let best = 0;
  for (let index = 1; index < result.amplitude.length; index += 1) {
    if (result.amplitude[index] > result.amplitude[best]) best = index;
  }
  return result.frequency[best];
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
export function compareSignals(testSignal: Signal, cfdSignal: Signal): Comparison {
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
  let bestLag = 0;
  let bestCorrelation = -Infinity;

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
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

  // This transparent composite is a prototype ranking index, not a validation
  // probability. Waveform agreement receives the largest weight.
  const score = Math.max(
    0,
    Math.min(
      1,
      0.6 * Math.max(0, bestCorrelation) +
        0.2 * Math.exp(-4 * frequencyError) +
        0.2 * Math.exp(-3 * amplitudeError),
    ),
  );

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
    score,
  };
}

export function makeDemoSignals() {
  const count = 1600;
  const dt = 0.0025;
  const time = Array.from({ length: count }, (_, index) => index * dt);
  const test = time.map(
    (value, index) =>
      0.16 +
      1.08 * Math.sin(2 * Math.PI * 8.42 * value) +
      0.19 * Math.sin(2 * Math.PI * 16.84 * value + 0.35) +
      0.045 * Math.sin(index * 1.731),
  );
  const cfd = time.map(
    (value) =>
      0.12 +
      1.03 * Math.sin(2 * Math.PI * 8.38 * (value + 0.006)) +
      0.14 * Math.sin(2 * Math.PI * 16.76 * value + 0.24),
  );

  return {
    test: { name: "Synthetic hot-fire test", time, pressure: test },
    cfd: { name: "Synthetic CFD probe", time, pressure: cfd },
  };
}

/**
 * Creates a complete, non-sensitive three-probe RDE case for interface and
 * numerical demonstrations. Probe angles are deliberately nonuniform so that
 * wave count and direction are not aliased by equal angular spacing.
 */
export function makeDemoProbeSignals() {
  const count = 1600;
  const dt = 0.0025;
  const time = Array.from({ length: count }, (_, index) => index * dt);
  const positionsDeg = [0, 110, 245];
  const makeSet = (kind: "test" | "cfd") =>
    positionsDeg.map((positionDeg, probeIndex) => {
      const angle = (positionDeg * Math.PI) / 180;
      const frequency = kind === "test" ? 8.42 : 8.35;
      const amplitude = kind === "test" ? 1.08 : 1.01;
      const shift = kind === "test" ? 0 : 0.005;
      const pressure = time.map((value, sampleIndex) =>
        0.16 +
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

function wrapAngle(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function phaseAtFrequency(signal: Signal, frequencyKHz: number) {
  const signalMean = mean(signal.pressure);
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < signal.time.length; index += 1) {
    const angle = 2 * Math.PI * frequencyKHz * signal.time[index];
    const value = signal.pressure[index] - signalMean;
    real += value * Math.cos(angle);
    imaginary -= value * Math.sin(angle);
  }
  return Math.atan2(imaginary, real);
}

function crossingFrequency(signal: Signal, startIndex: number, endIndex: number) {
  const values = signal.pressure.slice(startIndex, endIndex);
  const baseline = mean(values);
  const crossings: number[] = [];
  for (let index = Math.max(1, startIndex); index < endIndex; index += 1) {
    const before = signal.pressure[index - 1] - baseline;
    const after = signal.pressure[index] - baseline;
    if (before <= 0 && after > 0) {
      const fraction = -before / Math.max(after - before, 1e-12);
      crossings.push(
        signal.time[index - 1] + fraction * (signal.time[index] - signal.time[index - 1]),
      );
    }
  }
  if (crossings.length < 2) return 0;
  const periods = crossings.slice(1).map((time, index) => time - crossings[index]);
  return 1 / Math.max(median(periods), 1e-12);
}

/**
 * Infers a dominant rotating mode from three or more circumferential probes.
 * Frequency is in kHz, geometry in mm, and the returned wave speed is m/s.
 */
export function analyzeRdeProbeSet(
  signals: Signal[],
  positionsDeg: number[],
  annulusMeanDiameterMm: number,
): RdeModeResult {
  if (signals.length < 3 || signals.length !== positionsDeg.length) {
    throw new Error("Wave mode analysis requires at least three signals with matching probe positions.");
  }
  if (!Number.isFinite(annulusMeanDiameterMm) || annulusMeanDiameterMm <= 0) {
    throw new Error("Annulus mean diameter must be a positive number in millimetres.");
  }
  signals.forEach(validateSignal);
  if (positionsDeg.some((value) => !Number.isFinite(value))) {
    throw new Error("Every probe position must be a finite angle in degrees.");
  }

  const frequencies = signals.map((signal) =>
    crossingFrequency(signal, 0, signal.time.length),
  );
  const waveFrequencyKHz = median(frequencies);
  const phases = signals.map((signal) => phaseAtFrequency(signal, waveFrequencyKHz));
  const relativePhases = phases.map((phase) => wrapAngle(phase - phases[0]));
  const relativePositions = positionsDeg.map(
    (position) => ((position - positionsDeg[0]) * Math.PI) / 180,
  );

  let best: { waveCount: number; direction: RdeModeResult["direction"]; error: number } = {
    waveCount: 1,
    direction: "Counter-clockwise",
    error: Infinity,
  };
  for (let waveCount = 1; waveCount <= 4; waveCount += 1) {
    for (const direction of ["Counter-clockwise", "Clockwise"] as const) {
      const sign = direction === "Counter-clockwise" ? -1 : 1;
      const error = relativePhases
        .slice(1)
        .reduce(
          (sum, phase, index) =>
            sum + Math.abs(wrapAngle(phase - sign * waveCount * relativePositions[index + 1])),
          0,
        ) / (signals.length - 1);
      if (error < best.error) best = { waveCount, direction, error };
    }
  }

  const halfFrequencies = signals.flatMap((signal) => {
    const half = Math.floor(signal.time.length / 2);
    return [crossingFrequency(signal, 0, half), crossingFrequency(signal, half, signal.time.length)];
  }).filter((value) => value > 0);
  const minimumFrequency = Math.min(...halfFrequencies);
  const maximumFrequency = Math.max(...halfFrequencies);
  const frequencyDrift = (maximumFrequency - minimumFrequency) / Math.max(waveFrequencyKHz, 1e-12);
  const phaseFit = Math.max(0, 1 - best.error / Math.PI);
  const stability = frequencyDrift <= 0.03 && phaseFit >= 0.9
    ? "Stable"
    : frequencyDrift <= 0.08 && phaseFit >= 0.75
      ? "Transitional"
      : "Unstable";
  const circumferenceMm = Math.PI * annulusMeanDiameterMm;
  const waveSpeedMps = (circumferenceMm * waveFrequencyKHz) / best.waveCount;

  return {
    waveFrequencyKHz,
    waveSpeedMps,
    waveCount: best.waveCount,
    direction: best.direction,
    stability,
    frequencyDrift,
    phaseFit,
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

  const rows = lines
    .slice(1)
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
  };
  validateSignal(signal);
  return signal;
}

/**
 * Parses one three-probe export. Required columns are time plus P1, P2, and P3
 * pressure columns with units, for example time_ms, p1_MPa, p2_MPa, p3_MPa.
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

  const probes = [1, 2, 3].map((probe) => {
    const unitOptions = [
      { suffix: "mpa", factor: 1 },
      { suffix: "kpa", factor: 0.001 },
      { suffix: "pa", factor: 0.000001 },
    ];
    for (const option of unitOptions) {
      const aliases = [
        `p${probe}_${option.suffix}`,
        `pressure_p${probe}_${option.suffix}`,
        `probe${probe}_${option.suffix}`,
        `sensor${probe}_${option.suffix}`,
      ];
      const index = headers.findIndex((header) => aliases.includes(header));
      if (index >= 0) return { index, factor: option.factor };
    }
    return null;
  });

  if (probes.some((probe) => !probe)) {
    throw new Error("Include P1, P2, and P3 pressure columns with units, such as p1_MPa.");
  }

  const rows = lines
    .slice(1)
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

  return [0, 1, 2].map((probeIndex) => {
    const signal = {
      name: `${name} · P${probeIndex + 1}`,
      time: rows.map((row) => row.time),
      pressure: rows.map((row) => row.pressure[probeIndex]),
    };
    validateSignal(signal);
    return signal;
  });
}

export function recommendationFor(result: Comparison): Recommendation {
  if (result.correlation < REVIEW_THRESHOLDS.minimumCorrelation) {
    return {
      title: "Verify acquisition timing",
      detail:
        "The signals remain weakly correlated after alignment. Check timestamps, sensor location, and whether the same operating window was exported.",
      evidence: `Aligned waveform correlation ${result.correlation.toFixed(3)} is below ${REVIEW_THRESHOLDS.minimumCorrelation.toFixed(2)}.`,
    };
  }
  if (result.frequencyError > REVIEW_THRESHOLDS.maximumFrequencyError) {
    return {
      title: "Vary inlet boundary conditions",
      detail:
        "Wave frequency disagrees by more than 5%. Run a small inlet temperature and mass-flow sweep before changing the physical model.",
      evidence: `Dominant-frequency error is ${(result.frequencyError * 100).toFixed(1)}%.`,
    };
  }
  if (result.amplitudeError > REVIEW_THRESHOLDS.maximumAmplitudeError) {
    return {
      title: "Test pressure-amplitude drivers",
      detail:
        "Frequency agrees, but pressure amplitude does not. Prioritize chemistry, wall-loss, and sensor-response sensitivity runs.",
      evidence: `Pressure-amplitude error is ${(result.amplitudeError * 100).toFixed(1)}%.`,
    };
  }
  return {
    title: "Add a nearby operating point",
    detail:
      "The pressure signals agree within the prototype thresholds. Test the nearest unvalidated condition to expand the demonstrated envelope.",
    evidence: "Frequency, amplitude, and waveform metrics pass the prototype review thresholds.",
  };
}

export function serializeReport(result: Comparison, sources: { test: string; cfd: string }) {
  return JSON.stringify(
    {
      schema: "caelus-rde-comparison-report",
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
        prototypeAgreementIndex: result.score,
      },
      recommendation: recommendationFor(result),
      limitations: [
        "The agreement index is not a validation probability.",
        "This report compares one pressure-signal pair and does not establish an operating envelope.",
        "Measurement and model-form uncertainty are not yet propagated.",
      ],
    },
    null,
    2,
  );
}
