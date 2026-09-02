import type { EngineDesign } from "./design-workspace.ts";
import type { Rde2dCondition, Rde2dResultSummary, Rde2dSettings } from "./rde-2d-workflow.ts";

export type FastRde2dField = {
  nx: number;
  ny: number;
  pressureBar: number[];
  temperatureK: number[];
  reactionProgress: number[];
  velocityMps: number[];
  pressureRangeBar: [number, number];
  temperatureRangeK: [number, number];
};

export type FastRde2dDiagnostics = {
  model: "2D reactive Euler · single-step heat release";
  scheme: "first-order finite volume · Rusanov flux";
  gamma: number;
  gasConstantJkgK: number;
  heatReleaseMJkg: number;
  cfl: number;
  steps: number;
  simulatedTimeMs: number;
  elapsedMs: number;
  massConservationErrorPct: number;
  positivityRepairPct: number;
  peakPressureBar: number;
  peakTemperatureK: number;
  meanExitPressureBar: number;
  estimatedWaveSpeedMps: number | null;
  estimatedThrustN: number;
};

export type FastRde2dResult = Rde2dResultSummary & {
  evidenceClass: "browser-screening";
  screeningDiagnostics: FastRde2dDiagnostics;
  field: FastRde2dField;
  limitation: string;
};

export type FastRde2dProgress = {
  fraction: number;
  step: number;
  simulatedTimeMs: number;
  stage: "initializing" | "solving" | "analyzing";
};

export type FastRde2dRunOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: FastRde2dProgress) => void;
  maxSteps?: number;
  yieldEverySteps?: number;
};

type ChemistryParameters = {
  heatReleaseJkg: number;
  activationTemperatureK: number;
  preExponentialPerS: number;
};

const GAMMA = 1.32;
const GAS_CONSTANT = 300;
const CFL = 0.42;
const PRESSURE_FLOOR_PA = 1_000;
const DENSITY_FLOOR = 0.01;

function chemistryFor(design: EngineDesign): ChemistryParameters {
  const pair = `${design.fuel} ${design.oxidizer}`.toLowerCase();
  if (pair.includes("hydrogen") && pair.includes("oxygen")) return { heatReleaseJkg: 3_100_000, activationTemperatureK: 8_300, preExponentialPerS: 7_000_000 };
  if (pair.includes("hydrogen")) return { heatReleaseJkg: 1_850_000, activationTemperatureK: 8_700, preExponentialPerS: 6_000_000 };
  if ((pair.includes("methane") || pair.includes("natural gas")) && pair.includes("oxygen")) return { heatReleaseJkg: 2_750_000, activationTemperatureK: 10_200, preExponentialPerS: 8_000_000 };
  if (pair.includes("oxygen")) return { heatReleaseJkg: 2_500_000, activationTemperatureK: 10_500, preExponentialPerS: 7_500_000 };
  return { heatReleaseJkg: 1_450_000, activationTemperatureK: 10_800, preExponentialPerS: 6_000_000 };
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function range(values: Float64Array): [number, number] {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return [minimum, maximum];
}

function linearSpeed(samples: Array<{ timeS: number; positionM: number }>) {
  if (samples.length < 5) return null;
  const recent = samples.slice(-Math.min(samples.length, 80));
  const meanT = recent.reduce((sum, sample) => sum + sample.timeS, 0) / recent.length;
  const meanX = recent.reduce((sum, sample) => sum + sample.positionM, 0) / recent.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of recent) {
    numerator += (sample.timeS - meanT) * (sample.positionM - meanX);
    denominator += (sample.timeS - meanT) ** 2;
  }
  if (denominator <= 0) return null;
  const value = Math.abs(numerator / denominator);
  return Number.isFinite(value) && value > 1 ? value : null;
}

function peakCount(profile: Float64Array) {
  const [minimum, maximum] = range(profile);
  const threshold = minimum + 0.55 * (maximum - minimum);
  if (maximum <= minimum * 1.08) return 0;
  let count = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const left = profile[(index - 1 + profile.length) % profile.length];
    const right = profile[(index + 1) % profile.length];
    if (profile[index] >= threshold && profile[index] > left && profile[index] >= right) count += 1;
  }
  return Math.min(8, count);
}

async function yieldToBrowser() {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  } else {
    await Promise.resolve();
  }
}

function abortIfRequested(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("The Kythros Fast 2D run was cancelled.", "AbortError");
}

export async function runFastRde2d(
  design: EngineDesign,
  condition: Rde2dCondition,
  settings: Rde2dSettings,
  options: FastRde2dRunOptions = {},
): Promise<FastRde2dResult> {
  abortIfRequested(options.signal);
  options.onProgress?.({ fraction: 0, step: 0, simulatedTimeMs: 0, stage: "initializing" });
  const started = performance.now();
  const nx = Math.max(32, Math.min(256, Math.round(settings.circumferentialCells)));
  const ny = Math.max(12, Math.min(96, Math.round(settings.axialCells)));
  const cellCount = nx * ny;
  const circumferenceM = Math.PI * 0.5 * (design.annulusInnerDiameterMm + design.annulusOuterDiameterMm) * 1e-3;
  const chamberLengthM = Math.max(0.005, design.chamberLengthMm * 1e-3);
  const gapM = Math.max(0.0005, 0.5 * (design.annulusOuterDiameterMm - design.annulusInnerDiameterMm) * 1e-3);
  const dx = circumferenceM / nx;
  const dy = chamberLengthM / ny;
  const targetTimeS = Math.max(5e-6, settings.endTimeMs * 1e-3);
  const maximumDtS = Math.max(1e-9, settings.timeStepNs * 1e-9);
  const maxSteps = options.maxSteps ?? 6_000;
  const yieldEvery = Math.max(1, options.yieldEverySteps ?? 12);
  const chemistry = chemistryFor(design);
  const equivalenceScale = Math.max(0.35, Math.min(1, condition.equivalenceRatio <= 1 ? condition.equivalenceRatio : 1 / condition.equivalenceRatio));
  const heatRelease = chemistry.heatReleaseJkg * equivalenceScale;
  const inletPressurePa = Math.max(PRESSURE_FLOOR_PA * 2, condition.inletPressureBar * 1e5);
  const backPressurePa = Math.max(PRESSURE_FLOOR_PA * 2, condition.backPressureBar * 1e5);
  const inletTemperatureK = Math.max(150, condition.inletTemperatureK);
  const inletDensity = inletPressurePa / (GAS_CONSTANT * inletTemperatureK);
  const flowAreaM2 = Math.max(1e-7, circumferenceM * gapM);
  const inletVelocity = Math.max(15, Math.min(650, condition.massFlowKgS / (inletDensity * flowAreaM2)));

  let rho = new Float64Array(cellCount);
  let mx = new Float64Array(cellCount);
  let my = new Float64Array(cellCount);
  let energy = new Float64Array(cellCount);
  let rhoFuel = new Float64Array(cellCount);
  let nextRho = new Float64Array(cellCount);
  let nextMx = new Float64Array(cellCount);
  let nextMy = new Float64Array(cellCount);
  let nextEnergy = new Float64Array(cellCount);
  let nextFuel = new Float64Array(cellCount);
  const pressure = new Float64Array(cellCount);
  const temperature = new Float64Array(cellCount);
  const velocityX = new Float64Array(cellCount);
  const velocityY = new Float64Array(cellCount);
  const soundSpeed = new Float64Array(cellCount);
  const fluxX = Array.from({ length: 5 }, () => new Float64Array(cellCount));
  const fluxY = Array.from({ length: 5 }, () => new Float64Array(nx * (ny + 1)));

  const fillPressurePa = Math.max(backPressurePa, 0.72 * inletPressurePa);
  const fillDensity = fillPressurePa / (GAS_CONSTANT * inletTemperatureK);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const index = j * nx + i;
      rho[index] = fillDensity;
      mx[index] = 0;
      my[index] = fillDensity * inletVelocity * 0.55;
      rhoFuel[index] = fillDensity;
      energy[index] = fillPressurePa / (GAMMA - 1) + 0.5 * my[index] ** 2 / fillDensity + heatRelease * rhoFuel[index];
    }
  }

  const ignitionX = Math.round(0.18 * nx);
  const ignitionY = Math.max(2, Math.round(0.16 * ny));
  const ignitionRadius = Math.max(2, Math.round(nx / 42));
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const wrappedDx = Math.min(Math.abs(i - ignitionX), nx - Math.abs(i - ignitionX));
      const distance = Math.hypot(wrappedDx / ignitionRadius, (j - ignitionY) / Math.max(2, ignitionRadius * 0.7));
      if (distance > 1) continue;
      const index = j * nx + i;
      rhoFuel[index] *= Math.max(0, distance - 0.25);
      const ignitionPressure = inletPressurePa * (5.5 - 2.5 * distance);
      energy[index] = ignitionPressure / (GAMMA - 1) + 0.5 * (mx[index] ** 2 + my[index] ** 2) / rho[index] + heatRelease * rhoFuel[index];
    }
  }

  const inletFuel = inletDensity;
  const inletMy = inletDensity * inletVelocity;
  const inletEnergy = inletPressurePa / (GAMMA - 1) + 0.5 * inletDensity * inletVelocity ** 2 + heatRelease * inletFuel;
  const initialMass = rho.reduce((sum, value) => sum + value, 0) * dx * dy * gapM;
  let expectedMass = initialMass;
  let simulatedTime = 0;
  let step = 0;
  let positivityRepairs = 0;
  let backflowSamples = 0;
  let boundarySamples = 0;
  let previousPeakIndex: number | null = null;
  let unwrappedPeakIndex = 0;
  const peakTrack: Array<{ timeS: number; positionM: number }> = [];

  const rusanov = (
    direction: "x" | "y",
    left: [number, number, number, number, number, number, number, number],
    right: [number, number, number, number, number, number, number, number],
    target: Float64Array[],
    targetIndex: number,
  ) => {
    const [lrho, lmx, lmy, le, lf, lp, lu, lv] = left;
    const [rrho, rmx, rmy, re, rf, rp, ru, rv] = right;
    const ln = direction === "x" ? lu : lv;
    const rn = direction === "x" ? ru : rv;
    const speed = Math.max(Math.abs(ln) + Math.sqrt(GAMMA * lp / lrho), Math.abs(rn) + Math.sqrt(GAMMA * rp / rrho));
    const leftFlux = direction === "x"
      ? [lmx, lmx * lu + lp, lmy * lu, (le + lp) * lu, lf * lu]
      : [lmy, lmx * lv, lmy * lv + lp, (le + lp) * lv, lf * lv];
    const rightFlux = direction === "x"
      ? [rmx, rmx * ru + rp, rmy * ru, (re + rp) * ru, rf * ru]
      : [rmy, rmx * rv, rmy * rv + rp, (re + rp) * rv, rf * rv];
    const leftState = [lrho, lmx, lmy, le, lf];
    const rightState = [rrho, rmx, rmy, re, rf];
    for (let field = 0; field < 5; field += 1) target[field][targetIndex] = 0.5 * (leftFlux[field] + rightFlux[field]) - 0.5 * speed * (rightState[field] - leftState[field]);
  };

  while (simulatedTime < targetTimeS && step < maxSteps) {
    abortIfRequested(options.signal);
    let maximumXSpeed = 1;
    let maximumYSpeed = 1;
    for (let index = 0; index < cellCount; index += 1) {
      const density = Math.max(DENSITY_FLOOR, rho[index]);
      const u = mx[index] / density;
      const v = my[index] / density;
      const sensible = energy[index] - 0.5 * (mx[index] ** 2 + my[index] ** 2) / density - heatRelease * rhoFuel[index];
      const p = Math.max(PRESSURE_FLOOR_PA, (GAMMA - 1) * sensible);
      const t = p / (density * GAS_CONSTANT);
      const a = Math.sqrt(GAMMA * p / density);
      pressure[index] = p;
      temperature[index] = t;
      velocityX[index] = u;
      velocityY[index] = v;
      soundSpeed[index] = a;
      maximumXSpeed = Math.max(maximumXSpeed, Math.abs(u) + a);
      maximumYSpeed = Math.max(maximumYSpeed, Math.abs(v) + a);
    }
    const dt = Math.min(maximumDtS, CFL * Math.min(dx / maximumXSpeed, dy / maximumYSpeed), targetTimeS - simulatedTime);
    if (!Number.isFinite(dt) || dt <= 0) break;

    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const leftIndex = j * nx + i;
        const rightIndex = j * nx + (i + 1) % nx;
        rusanov("x",
          [rho[leftIndex], mx[leftIndex], my[leftIndex], energy[leftIndex], rhoFuel[leftIndex], pressure[leftIndex], velocityX[leftIndex], velocityY[leftIndex]],
          [rho[rightIndex], mx[rightIndex], my[rightIndex], energy[rightIndex], rhoFuel[rightIndex], pressure[rightIndex], velocityX[rightIndex], velocityY[rightIndex]],
          fluxX, leftIndex);
      }
    }

    let bottomMassFlux = 0;
    let topMassFlux = 0;
    for (let i = 0; i < nx; i += 1) {
      const bottom = i;
      rusanov("y",
        [inletDensity, 0, inletMy, inletEnergy, inletFuel, inletPressurePa, 0, inletVelocity],
        [rho[bottom], mx[bottom], my[bottom], energy[bottom], rhoFuel[bottom], pressure[bottom], velocityX[bottom], velocityY[bottom]],
        fluxY, i);
      bottomMassFlux += fluxY[0][i];
      boundarySamples += 1;
      if (fluxY[0][i] < 0) backflowSamples += 1;
      for (let j = 1; j < ny; j += 1) {
        const lower = (j - 1) * nx + i;
        const upper = j * nx + i;
        rusanov("y",
          [rho[lower], mx[lower], my[lower], energy[lower], rhoFuel[lower], pressure[lower], velocityX[lower], velocityY[lower]],
          [rho[upper], mx[upper], my[upper], energy[upper], rhoFuel[upper], pressure[upper], velocityX[upper], velocityY[upper]],
          fluxY, j * nx + i);
      }
      const top = (ny - 1) * nx + i;
      const topDensity = rho[top];
      const topU = velocityX[top];
      const topV = Math.max(0, velocityY[top]);
      const topFuel = rhoFuel[top];
      const outletEnergy = backPressurePa / (GAMMA - 1) + 0.5 * topDensity * (topU ** 2 + topV ** 2) + heatRelease * topFuel;
      rusanov("y",
        [rho[top], mx[top], my[top], energy[top], rhoFuel[top], pressure[top], velocityX[top], velocityY[top]],
        [topDensity, topDensity * topU, topDensity * topV, outletEnergy, topFuel, backPressurePa, topU, topV],
        fluxY, ny * nx + i);
      topMassFlux += fluxY[0][ny * nx + i];
    }

    expectedMass += (bottomMassFlux - topMassFlux) * dx * gapM * dt;
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const index = j * nx + i;
        const leftFlux = j * nx + (i - 1 + nx) % nx;
        const rightFlux = index;
        const bottomFlux = j * nx + i;
        const topFlux = (j + 1) * nx + i;
        const current = [rho[index], mx[index], my[index], energy[index], rhoFuel[index]];
        const target = [nextRho, nextMx, nextMy, nextEnergy, nextFuel];
        for (let field = 0; field < 5; field += 1) target[field][index] = current[field] - dt / dx * (fluxX[field][rightFlux] - fluxX[field][leftFlux]) - dt / dy * (fluxY[field][topFlux] - fluxY[field][bottomFlux]);
        if (!Number.isFinite(nextRho[index]) || nextRho[index] < DENSITY_FLOOR) {
          nextRho[index] = DENSITY_FLOOR;
          positivityRepairs += 1;
        }
        nextFuel[index] = Math.max(0, Math.min(nextRho[index], finite(nextFuel[index], 0)));
        const kinetic = 0.5 * (nextMx[index] ** 2 + nextMy[index] ** 2) / nextRho[index];
        const minimumEnergy = kinetic + heatRelease * nextFuel[index] + PRESSURE_FLOOR_PA / (GAMMA - 1);
        if (!Number.isFinite(nextEnergy[index]) || nextEnergy[index] < minimumEnergy) {
          nextEnergy[index] = minimumEnergy;
          positivityRepairs += 1;
        }
        const nextPressure = (GAMMA - 1) * (nextEnergy[index] - kinetic - heatRelease * nextFuel[index]);
        const nextTemperature = nextPressure / (nextRho[index] * GAS_CONSTANT);
        const rate = chemistry.preExponentialPerS * Math.exp(-chemistry.activationTemperatureK / Math.max(180, nextTemperature));
        nextFuel[index] *= Math.exp(-Math.min(30, rate * dt));
      }
    }

    [rho, nextRho] = [nextRho, rho];
    [mx, nextMx] = [nextMx, mx];
    [my, nextMy] = [nextMy, my];
    [energy, nextEnergy] = [nextEnergy, energy];
    [rhoFuel, nextFuel] = [nextFuel, rhoFuel];
    simulatedTime += dt;
    step += 1;

    if (step % 4 === 0 || simulatedTime >= targetTimeS) {
      const probeJ = Math.min(ny - 1, Math.max(1, Math.round(0.35 * ny)));
      let peakIndex = 0;
      let peakPressure = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < nx; i += 1) {
        const index = probeJ * nx + i;
        const density = Math.max(DENSITY_FLOOR, rho[index]);
        const sensible = energy[index] - 0.5 * (mx[index] ** 2 + my[index] ** 2) / density - heatRelease * rhoFuel[index];
        const p = (GAMMA - 1) * sensible;
        if (p > peakPressure) { peakPressure = p; peakIndex = i; }
      }
      if (previousPeakIndex === null) unwrappedPeakIndex = peakIndex;
      else {
        let difference = peakIndex - previousPeakIndex;
        if (difference > nx / 2) difference -= nx;
        if (difference < -nx / 2) difference += nx;
        unwrappedPeakIndex += difference;
      }
      previousPeakIndex = peakIndex;
      peakTrack.push({ timeS: simulatedTime, positionM: unwrappedPeakIndex * dx });
    }

    if (step % yieldEvery === 0) {
      options.onProgress?.({ fraction: Math.min(0.98, simulatedTime / targetTimeS), step, simulatedTimeMs: simulatedTime * 1e3, stage: "solving" });
      await yieldToBrowser();
    }
  }

  abortIfRequested(options.signal);
  options.onProgress?.({ fraction: 0.99, step, simulatedTimeMs: simulatedTime * 1e3, stage: "analyzing" });
  const finalPressure = new Float64Array(cellCount);
  const finalTemperature = new Float64Array(cellCount);
  const finalProgress = new Float64Array(cellCount);
  const finalVelocity = new Float64Array(cellCount);
  let peakPressurePa = 0;
  let peakTemperatureK = 0;
  let maximumMach = 0;
  for (let index = 0; index < cellCount; index += 1) {
    const density = Math.max(DENSITY_FLOOR, rho[index]);
    const u = mx[index] / density;
    const v = my[index] / density;
    const sensible = energy[index] - 0.5 * (mx[index] ** 2 + my[index] ** 2) / density - heatRelease * rhoFuel[index];
    const p = Math.max(PRESSURE_FLOOR_PA, (GAMMA - 1) * sensible);
    const t = p / (density * GAS_CONSTANT);
    const velocity = Math.hypot(u, v);
    finalPressure[index] = p / 1e5;
    finalTemperature[index] = t;
    finalProgress[index] = Math.max(0, Math.min(1, 1 - rhoFuel[index] / density));
    finalVelocity[index] = velocity;
    peakPressurePa = Math.max(peakPressurePa, p);
    peakTemperatureK = Math.max(peakTemperatureK, t);
    maximumMach = Math.max(maximumMach, velocity / Math.sqrt(GAMMA * p / density));
  }
  const exitJ = ny - 1;
  let exitPressurePa = 0;
  let exitVelocity = 0;
  const probeProfile = new Float64Array(nx);
  const probeJ = Math.min(ny - 1, Math.max(1, Math.round(0.35 * ny)));
  for (let i = 0; i < nx; i += 1) {
    exitPressurePa += finalPressure[exitJ * nx + i] * 1e5;
    exitVelocity += my[exitJ * nx + i] / Math.max(DENSITY_FLOOR, rho[exitJ * nx + i]);
    probeProfile[i] = finalPressure[probeJ * nx + i];
  }
  exitPressurePa /= nx;
  exitVelocity /= nx;
  const detectedPeaks = peakCount(probeProfile);
  const estimatedWaveSpeed = linearSpeed(peakTrack);
  const pressureRatio = peakPressurePa / inletPressurePa;
  const burnedMean = finalProgress.reduce((sum, value) => sum + value, 0) / cellCount;
  const propagationMode: Rde2dResultSummary["propagationMode"] = pressureRatio > 1.8 && burnedMean > 0.08 && (estimatedWaveSpeed ?? 0) > 500
    ? "stable-detonation"
    : pressureRatio > 1.25 && burnedMean > 0.03 ? "intermittent" : burnedMean > 0.01 ? "deflagration" : "unclassified";
  const waveCount = detectedPeaks || (propagationMode === "stable-detonation" ? 1 : null);
  const frequencyKHz = waveCount && estimatedWaveSpeed ? waveCount * estimatedWaveSpeed / circumferenceM / 1e3 : null;
  const finalMass = rho.reduce((sum, value) => sum + value, 0) * dx * dy * gapM;
  const massErrorPct = Math.abs(finalMass - expectedMass) / Math.max(initialMass, Math.abs(expectedMass), 1e-12) * 100;
  const positivityRepairPct = positivityRepairs / Math.max(1, step * cellCount * 2) * 100;
  const completed = simulatedTime >= targetTimeS * 0.999;
  const numericallyStable = completed && massErrorPct < 1 && positivityRepairPct < 0.1 && Number.isFinite(maximumMach);
  const elapsedMs = performance.now() - started;
  const pressureRangeBar = range(finalPressure);
  const temperatureRangeK = range(finalTemperature);
  const result: FastRde2dResult = {
    schema: "kythros-rde-2d-result",
    formatVersion: 1,
    designId: design.id,
    designFingerprint: design.revision?.fingerprint ?? null,
    operatingConditionId: condition.id,
    solverName: "Kythros Fast 2D",
    solverConverged: numericallyStable,
    meshChangePct: null,
    timeStepChangePct: null,
    propagationMode,
    waveCount,
    dominantFrequencyKHz: frequencyKHz,
    pressureGainPct: (exitPressurePa - inletPressurePa) / inletPressurePa * 100,
    injectorBackflowPct: boundarySamples ? backflowSamples / boundarySamples * 100 : 0,
    peakWallHeatFluxMWm2: null,
    peakWallTemperatureK: null,
    evidenceClass: "browser-screening",
    screeningDiagnostics: {
      model: "2D reactive Euler · single-step heat release",
      scheme: "first-order finite volume · Rusanov flux",
      gamma: GAMMA,
      gasConstantJkgK: GAS_CONSTANT,
      heatReleaseMJkg: heatRelease / 1e6,
      cfl: CFL,
      steps: step,
      simulatedTimeMs: simulatedTime * 1e3,
      elapsedMs,
      massConservationErrorPct: massErrorPct,
      positivityRepairPct,
      peakPressureBar: peakPressurePa / 1e5,
      peakTemperatureK,
      meanExitPressureBar: exitPressurePa / 1e5,
      estimatedWaveSpeedMps: estimatedWaveSpeed,
      estimatedThrustN: Math.max(0, (exitPressurePa - backPressurePa) * flowAreaM2 + condition.massFlowKgS * Math.max(0, exitVelocity)),
    },
    field: {
      nx,
      ny,
      pressureBar: Array.from(finalPressure),
      temperatureK: Array.from(finalTemperature),
      reactionProgress: Array.from(finalProgress),
      velocityMps: Array.from(finalVelocity),
      pressureRangeBar,
      temperatureRangeK,
    },
    limitation: "Browser screening result from an inviscid 2D reactive Euler model with simplified one-step heat release. It does not resolve turbulence, viscous wall heating, detailed chemistry, injector jets, cooling life, or three-dimensional modes, and it is not experimental validation.",
  };
  options.onProgress?.({ fraction: 1, step, simulatedTimeMs: simulatedTime * 1e3, stage: "analyzing" });
  return result;
}

