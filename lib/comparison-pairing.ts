import type { CaseMetadata } from "./caevera-types.ts";
import type { Signal } from "./rde-analysis.ts";

export type PairingCheck = { id: string; label: string; passed: boolean; detail: string };

export type PairingAudit = {
  passed: boolean;
  fingerprint: string;
  checks: PairingCheck[];
};

function stableToken(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function auditComparisonPairing(metadata: CaseMetadata, experiment: Signal[], cfd: Signal[]): PairingAudit {
  const probeCountMatches = experiment.length === cfd.length && experiment.length === metadata.probePositionsDeg.length;
  const synchronized = metadata.probeSynchronizationConfirmed;
  const experimentStart = Math.max(...experiment.map((signal) => signal.time[0] ?? Number.POSITIVE_INFINITY));
  const experimentEnd = Math.min(...experiment.map((signal) => signal.time.at(-1) ?? Number.NEGATIVE_INFINITY));
  const cfdStart = Math.max(...cfd.map((signal) => signal.time[0] ?? Number.POSITIVE_INFINITY));
  const cfdEnd = Math.min(...cfd.map((signal) => signal.time.at(-1) ?? Number.NEGATIVE_INFINITY));
  const overlapStart = Math.max(experimentStart, cfdStart);
  const overlapEnd = Math.min(experimentEnd, cfdEnd);
  const overlappingWindow = Number.isFinite(overlapStart) && Number.isFinite(overlapEnd) && overlapEnd > overlapStart;
  const operatingPointDefined = [metadata.annulusMeanDiameterMm, metadata.inletPressureBar, metadata.inletTemperatureK, metadata.equivalenceRatio, metadata.massFlowKgS, metadata.backPressureBar].every((value) => Number.isFinite(value) && value > 0);
  const checks: PairingCheck[] = [
    { id: "geometry-operating-point", label: "Geometry and operating point", passed: operatingPointDefined, detail: operatingPointDefined ? "Inherited from the saved operating point." : "A required physical condition is missing." },
    { id: "probe-map", label: "Probe mapping", passed: probeCountMatches, detail: probeCountMatches ? `${experiment.length} experiment and CFD probes match ${metadata.probePositionsDeg.length} saved angles.` : "Experiment, CFD, and saved probe counts differ." },
    { id: "synchronization", label: "Synchronized probes", passed: synchronized, detail: synchronized ? "The saved probe set uses one confirmed time base." : "Probe synchronization is not confirmed." },
    { id: "comparison-window", label: "Comparison window", passed: overlappingWindow, detail: overlappingWindow ? `${(overlapEnd - overlapStart).toFixed(4)} ms of common data is available.` : "The experiment and CFD files have no overlapping time window." },
  ];
  return {
    passed: checks.every((check) => check.passed),
    fingerprint: `pair-${stableToken(JSON.stringify({ angles: metadata.probePositionsDeg, experiment: experiment.map((signal) => [signal.time[0], signal.time.at(-1), signal.time.length]), cfd: cfd.map((signal) => [signal.time[0], signal.time.at(-1), signal.time.length]), condition: [metadata.annulusMeanDiameterMm, metadata.inletPressureBar, metadata.inletTemperatureK, metadata.equivalenceRatio, metadata.massFlowKgS, metadata.backPressureBar] }))}`,
    checks,
  };
}
