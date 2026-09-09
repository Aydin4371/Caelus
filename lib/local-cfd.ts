import type { EngineDesign } from "./design-workspace.ts";
import type { Rde2dCondition } from "./rde-2d-workflow.ts";

export const LOCAL_CFD_API_VERSION = 1;

export type LocalCfdPresetId = "development" | "workstation" | "evidence";

export type LocalCfdPreset = {
  id: LocalCfdPresetId;
  label: string;
  purpose: string;
  approximateCells: number;
  minimumRamGb: number;
  recommendedGpuMemoryGb: number;
  amrLevels: number;
  maximumCfl: number;
  endTimeMs: number;
};

export const LOCAL_CFD_PRESETS: LocalCfdPreset[] = [
  {
    id: "development",
    label: "Development",
    purpose: "Check setup and initial wave development on this computer.",
    approximateCells: 3_000_000,
    minimumRamGb: 24,
    recommendedGpuMemoryGb: 8,
    amrLevels: 1,
    maximumCfl: 0.35,
    endTimeMs: 0.15,
  },
  {
    id: "workstation",
    label: "Workstation",
    purpose: "Resolve three-dimensional annulus and injector-flow structure for design iteration.",
    approximateCells: 24_000_000,
    minimumRamGb: 64,
    recommendedGpuMemoryGb: 24,
    amrLevels: 2,
    maximumCfl: 0.3,
    endTimeMs: 0.3,
  },
  {
    id: "evidence",
    label: "Evidence run",
    purpose: "Run an adjacent grid or time-step level after the workstation case is stable.",
    approximateCells: 96_000_000,
    minimumRamGb: 128,
    recommendedGpuMemoryGb: 48,
    amrLevels: 3,
    maximumCfl: 0.25,
    endTimeMs: 0.45,
  },
];

export type LocalHardwareSnapshot = {
  platform: "windows" | "linux" | "macos" | "unknown";
  architecture: string;
  logicalCpuCount: number;
  memoryGb: number | null;
  gpuName: string | null;
  gpuMemoryGb: number | null;
  cudaAvailable: boolean;
};

export type LocalRunnerStatus = {
  apiVersion: number;
  desktopVersion?: string;
  setupMessage?: string | null;
  desktop: boolean;
  runtimeInstalled: boolean;
  runtimeVersion: string | null;
  solverInstalled: boolean;
  solverName: string | null;
  solverVersion: string | null;
  solverAccelerator: "cpu-openmp" | "cuda" | "unknown" | null;
  hardware: LocalHardwareSnapshot;
  details: string[];
};

export type LocalCfdReadiness = {
  ready: boolean;
  blockingIssues: string[];
  warnings: string[];
};

export type LocalCfdRunRequest = {
  schema: "kythros-local-rde-3d-request";
  formatVersion: 1;
  runId: string;
  createdAt: string;
  caseDefinition: {
    id: "gas-fed-annular-hydrogen-v1";
    validationStatus: "development-unvalidated";
    solverFamily: "PeleC";
  };
  engine: {
    designId: string;
    designFingerprint: string | null;
    name: string;
    application: EngineDesign["application"];
    fuel: string;
    oxidizer: string;
    annulusInnerDiameterMm: number;
    annulusOuterDiameterMm: number;
    chamberLengthMm: number;
    injectorType: string;
    injectorCount: number;
    injectorDiameterMm: number;
    injectorAngleDeg: number;
    exhaustConfiguration: string;
  };
  operatingCondition: Rde2dCondition;
  numerics: {
    presetId: LocalCfdPresetId;
    approximateCells: number;
    amrLevels: number;
    maximumCfl: number;
    endTimeMs: number;
  };
  requiredOutputs: Array<"pressure" | "temperature" | "reaction-progress" | "velocity-axial" | "velocity-radial" | "velocity-circumferential">;
};

export type LocalCfdJobState = "queued" | "preparing" | "meshing" | "solving" | "post-processing" | "completed" | "failed" | "cancelled";

export type LocalCfdJobStatus = {
  runId: string;
  state: LocalCfdJobState;
  progress: number;
  message: string;
  resultPath: string | null;
  error: string | null;
  result?: Rde3dVolumeResult | null;
};

export type Rde3dFieldName = "pressure" | "temperature" | "reaction" | "velocity";

export type Rde3dVolumeResult = {
  schema: "kythros-rde-3d-volume";
  formatVersion: 1;
  runId: string;
  designId: string;
  designFingerprint: string | null;
  operatingConditionId: string;
  solver: {
    name: string;
    version: string;
    executableHash: string;
  };
  provenance: {
    computedAt: string;
    host: "local-desktop";
    caseDefinitionId: string;
    validationStatus: "development-unvalidated" | "benchmark-passed" | "experiment-validated";
  };
  grid: {
    coordinateSystem: "cylindrical-r-theta-x";
    storageOrder: "axial-circumferential-radial";
    radialCells: number;
    circumferentialCells: number;
    axialCells: number;
    innerRadiusM: number;
    outerRadiusM: number;
    axialLengthM: number;
  };
  fields: {
    pressurePa: number[];
    temperatureK: number[];
    reactionProgress: number[];
    velocityAxialMps: number[];
    velocityRadialMps: number[];
    velocityCircumferentialMps: number[];
  };
  summary: {
    solverConverged: boolean;
    massConservationErrorPct: number | null;
    peakPressureBar: number | null;
    peakTemperatureK: number | null;
    waveCount: number | null;
    dominantFrequencyKHz: number | null;
    injectorBackflowPct: number | null;
    estimatedThrustN: number | null;
    peakWallHeatFluxMWm2: number | null;
    adjacentGridChangePct: number | null;
    adjacentTimeStepChangePct: number | null;
  };
};

export type LocalRde3dRecommendation = {
  resultUsable: boolean;
  status: string;
  detail: string;
  engine: { title: string; action: string; reason: string; target: "engine" | "operating-condition" | "none" };
  simulation: { title: string; action: string; reason: string };
};

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function supportsInitialLocal3dCase(design: EngineDesign) {
  const fuel = normalized(design.fuel);
  const oxidizer = normalized(design.oxidizer);
  const hydrogen = fuel === "hydrogen" || fuel === "h2" || fuel.includes("gaseoushydrogen");
  const supportedOxidizer = oxidizer === "oxygen" || oxidizer === "o2" || oxidizer === "air" || oxidizer.includes("gaseousoxygen");
  return design.application === "Rocket" && hydrogen && supportedOxidizer;
}

export function availableLocalCfdPresets(status: LocalRunnerStatus | null) {
  return LOCAL_CFD_PRESETS.filter((preset) => preset.id === "development" || Boolean(
    status?.solverAccelerator === "cuda" && status.hardware.cudaAvailable &&
    status.hardware.memoryGb !== null && status.hardware.memoryGb >= preset.minimumRamGb &&
    status.hardware.gpuMemoryGb !== null && status.hardware.gpuMemoryGb >= preset.recommendedGpuMemoryGb
  ));
}

export function assessLocalCfdReadiness(status: LocalRunnerStatus, presetId: LocalCfdPresetId, design: EngineDesign): LocalCfdReadiness {
  const preset = LOCAL_CFD_PRESETS.find((item) => item.id === presetId) ?? LOCAL_CFD_PRESETS[0];
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  if (!status.desktop) blockingIssues.push("Install and open the Kythros desktop app to run Full 3D on this computer.");
  if (!["windows", "linux"].includes(status.hardware.platform)) blockingIssues.push("The first local solver release supports 64-bit Windows and Linux workstations.");
  if (!status.runtimeInstalled) blockingIssues.push("Choose Set up and run. Kythros will install the included solver first.");
  if (!status.solverInstalled) blockingIssues.push("The verified PeleC RDRE solver pack is not installed.");
  if (!supportsInitialLocal3dCase(design)) blockingIssues.push("The first Full 3D solver pack supports rocket-fed hydrogen/air and hydrogen/oxygen annular engines.");
  if (status.hardware.memoryGb !== null && status.hardware.memoryGb < preset.minimumRamGb) blockingIssues.push(`${preset.label} requires at least ${preset.minimumRamGb} GB of system memory.`);
  const cudaSolver = status.solverAccelerator === "cuda";
  if (presetId !== "development" && (!cudaSolver || !status.hardware.cudaAvailable)) blockingIssues.push(`${preset.label} requires the CUDA solver build and a compatible NVIDIA GPU.`);
  if (presetId === "development" && status.solverInstalled && !cudaSolver) warnings.push("Development can run on the packaged CPU solver, but a reacting 3D case may take hours.");
  if (cudaSolver && status.hardware.cudaAvailable && status.hardware.gpuMemoryGb !== null && status.hardware.gpuMemoryGb < preset.recommendedGpuMemoryGb) warnings.push(`${preset.label} is designed for approximately ${preset.recommendedGpuMemoryGb} GB of GPU memory; this machine reports ${status.hardware.gpuMemoryGb.toFixed(0)} GB.`);
  if (status.hardware.logicalCpuCount < 8) warnings.push("Fewer than eight logical CPU cores may make mesh preparation and result conversion slow.");
  if (status.apiVersion !== LOCAL_CFD_API_VERSION) blockingIssues.push("The desktop app and solver runtime use incompatible API versions. Update both components.");
  return { ready: blockingIssues.length === 0, blockingIssues, warnings };
}

export function createLocalCfdRunRequest(
  design: EngineDesign,
  condition: Rde2dCondition,
  presetId: LocalCfdPresetId,
  createdAt = new Date().toISOString(),
  runId = `rde3d-${Date.now().toString(36)}`,
): LocalCfdRunRequest {
  const preset = LOCAL_CFD_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error("Choose a supported Full 3D run preset.");
  if (!supportsInitialLocal3dCase(design)) throw new Error("Full 3D currently supports rocket-fed hydrogen/air and hydrogen/oxygen annular engines.");
  const geometry = [design.annulusInnerDiameterMm, design.annulusOuterDiameterMm, design.chamberLengthMm, design.injectorCount, design.injectorDiameterMm];
  if (!geometry.every(finitePositive) || design.annulusOuterDiameterMm <= design.annulusInnerDiameterMm) throw new Error("Complete a physically positive annulus, chamber, and injector definition before running Full 3D.");
  const operating = [condition.inletPressureBar, condition.inletTemperatureK, condition.equivalenceRatio, condition.massFlowKgS, condition.backPressureBar];
  if (!operating.every(finitePositive) || condition.inletPressureBar <= condition.backPressureBar) throw new Error("Complete a valid operating condition before running Full 3D.");
  return {
    schema: "kythros-local-rde-3d-request",
    formatVersion: 1,
    runId,
    createdAt,
    caseDefinition: { id: "gas-fed-annular-hydrogen-v1", validationStatus: "development-unvalidated", solverFamily: "PeleC" },
    engine: {
      designId: design.id,
      designFingerprint: design.revision?.fingerprint ?? null,
      name: design.name,
      application: design.application,
      fuel: design.fuel,
      oxidizer: design.oxidizer,
      annulusInnerDiameterMm: design.annulusInnerDiameterMm,
      annulusOuterDiameterMm: design.annulusOuterDiameterMm,
      chamberLengthMm: design.chamberLengthMm,
      injectorType: design.injectorType,
      injectorCount: Math.round(design.injectorCount),
      injectorDiameterMm: design.injectorDiameterMm,
      injectorAngleDeg: design.injectorAngleDeg,
      exhaustConfiguration: design.exhaustConfiguration,
    },
    operatingCondition: { ...condition },
    numerics: {
      presetId,
      approximateCells: preset.approximateCells,
      amrLevels: preset.amrLevels,
      maximumCfl: preset.maximumCfl,
      endTimeMs: preset.endTimeMs,
    },
    requiredOutputs: ["pressure", "temperature", "reaction-progress", "velocity-axial", "velocity-radial", "velocity-circumferential"],
  };
}

function nullableFinite(value: unknown) {
  return value === null || typeof value === "number" && Number.isFinite(value);
}

export function validateRde3dVolumeResult(value: unknown): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== "object") return ["The Full 3D result must be a JSON object."];
  const result = value as Partial<Rde3dVolumeResult>;
  if (result.schema !== "kythros-rde-3d-volume" || result.formatVersion !== 1) issues.push("Choose a Kythros Full 3D volume result (format 1).");
  const grid = result.grid;
  if (!grid || grid.coordinateSystem !== "cylindrical-r-theta-x" || grid.storageOrder !== "axial-circumferential-radial") issues.push("The result must use the cylindrical RDE volume coordinate system and documented storage order.");
  const dimensions = grid ? [grid.radialCells, grid.circumferentialCells, grid.axialCells] : [];
  if (dimensions.length !== 3 || !dimensions.every((item) => Number.isInteger(item) && item > 1)) issues.push("The result must contain positive radial, circumferential, and axial grid dimensions.");
  if (grid && (!finitePositive(grid.innerRadiusM) || !finitePositive(grid.outerRadiusM) || !finitePositive(grid.axialLengthM) || grid.outerRadiusM <= grid.innerRadiusM)) issues.push("The result contains invalid annular volume bounds.");
  const expected = dimensions.length === 3 && dimensions.every((item) => Number.isInteger(item) && item > 1) ? dimensions.reduce((product, item) => product * item, 1) : -1;
  const fields = result.fields;
  const arrays: Array<[string, unknown]> = fields ? [
    ["pressure", fields.pressurePa],
    ["temperature", fields.temperatureK],
    ["reaction progress", fields.reactionProgress],
    ["axial velocity", fields.velocityAxialMps],
    ["radial velocity", fields.velocityRadialMps],
    ["circumferential velocity", fields.velocityCircumferentialMps],
  ] : [];
  if (!fields) issues.push("The result does not contain volumetric flow fields.");
  for (const [name, array] of arrays) {
    if (!Array.isArray(array) || array.length !== expected) issues.push(`The ${name} field must contain exactly ${expected.toLocaleString()} volume-cell values.`);
    else if (!array.every((item) => typeof item === "number" && Number.isFinite(item))) issues.push(`The ${name} field contains a non-finite value.`);
  }
  if (fields?.pressurePa?.some((item) => item <= 0)) issues.push("Pressure must remain positive in every exported volume cell.");
  if (fields?.temperatureK?.some((item) => item <= 0)) issues.push("Temperature must remain positive in every exported volume cell.");
  if (fields?.reactionProgress?.some((item) => item < 0 || item > 1)) issues.push("Reaction progress must remain between zero and one.");
  if (!result.solver?.name || !result.solver.version || !result.solver.executableHash) issues.push("The result must identify the solver, version, and executable hash.");
  if (!result.provenance?.computedAt || result.provenance.host !== "local-desktop" || !result.provenance.caseDefinitionId) issues.push("The result must retain local execution and case-definition provenance.");
  const summary = result.summary;
  if (!summary) issues.push("The result does not contain a numerical summary.");
  else {
    const optional = [summary.massConservationErrorPct, summary.peakPressureBar, summary.peakTemperatureK, summary.dominantFrequencyKHz, summary.injectorBackflowPct, summary.estimatedThrustN, summary.peakWallHeatFluxMWm2, summary.adjacentGridChangePct, summary.adjacentTimeStepChangePct];
    if (!optional.every(nullableFinite)) issues.push("The result summary contains a non-finite value.");
    if (!(summary.waveCount === null || Number.isInteger(summary.waveCount) && summary.waveCount >= 0)) issues.push("Wave count must be null or a non-negative integer.");
  }
  if (!result.designId || !result.operatingConditionId || !result.runId) issues.push("The result must retain its design, operating-condition, and run identifiers.");
  return issues;
}

export function parseRde3dVolumeResult(content: string): Rde3dVolumeResult {
  let result: unknown;
  try {
    result = JSON.parse(content);
  } catch {
    throw new Error("The Full 3D result is not valid JSON.");
  }
  const issues = validateRde3dVolumeResult(result);
  if (issues.length) throw new Error(issues[0]);
  return result as Rde3dVolumeResult;
}

export function recommendLocalRde3dChange(design: EngineDesign, condition: Rde2dCondition, result: Rde3dVolumeResult): LocalRde3dRecommendation {
  const summary = result.summary;
  if (!summary.solverConverged) return {
    resultUsable: false,
    status: "Engine advice withheld",
    detail: "The Full 3D solver did not meet its completion and residual gates.",
    engine: { title: "Do not change the engine", action: "Keep geometry and operating conditions fixed until the numerical run completes cleanly.", reason: "A failed numerical run cannot distinguish an engine problem from a solver problem.", target: "none" },
    simulation: { title: "Resolve the solver failure", action: "Open the run log, correct the first failing numerical gate, and repeat this exact case.", reason: "The same inputs must complete before the design can be assessed." },
  };
  if (summary.massConservationErrorPct === null || summary.massConservationErrorPct > 1) return {
    resultUsable: false,
    status: "Engine advice withheld",
    detail: summary.massConservationErrorPct === null ? "The result does not report mass conservation." : `Mass conservation error is ${summary.massConservationErrorPct.toFixed(2)}%, above the 1% screening gate.`,
    engine: { title: "Do not change the engine", action: "Keep the engine and operating point fixed.", reason: "Conservation must pass before interpreting flow structures as an engine response.", target: "none" },
    simulation: { title: "Reduce the maximum CFL", action: "Repeat this exact case with the next lower CFL preset; keep the mesh, chemistry, geometry, and boundaries unchanged.", reason: "This isolates temporal stability without mixing a design change into the numerical check." },
  };
  const gridChange = summary.adjacentGridChangePct;
  const timeChange = summary.adjacentTimeStepChangePct;
  if (gridChange === null && timeChange === null) return {
    resultUsable: false,
    status: "One convergence run required",
    detail: "The computed volume is inspectable, but an adjacent grid or time-step result is required before engine advice.",
    engine: { title: "Keep this engine unchanged", action: "Do not alter hardware or operating conditions for the next run.", reason: "The next run must measure whether the calculated answer still depends on numerical resolution.", target: "none" },
    simulation: { title: "Run the next adjacent grid", action: "Choose Evidence run and keep the engine, chemistry, boundary conditions, and CFL fixed.", reason: "Kythros will compare the two computed volumes before recommending a physical engine change." },
  };
  const numericalChange = Math.max(gridChange ?? 0, timeChange ?? 0);
  if (numericalChange > 2) return {
    resultUsable: false,
    status: "Numerical sensitivity found",
    detail: `The adjacent numerical result changed targeted outputs by ${numericalChange.toFixed(1)}%, above the 2% screening gate.`,
    engine: { title: "Keep this engine unchanged", action: "Do not change geometry or the operating condition yet.", reason: "The CFD result still responds to numerical resolution.", target: "none" },
    simulation: { title: "Continue numerical convergence", action: "Run one more adjacent resolution level, changing only the same numerical parameter.", reason: "Engine guidance waits until numerical changes stop materially moving the answer." },
  };
  if (summary.injectorBackflowPct !== null && summary.injectorBackflowPct > 5) {
    const nextPressure = condition.inletPressureBar * 1.05;
    return {
      resultUsable: true,
      status: "Provisional engine change ready",
      detail: "The result passed the numerical screening gates. The next change remains a testable hypothesis until experiment validation.",
      engine: { title: `Raise inlet pressure to ${nextPressure.toFixed(2)} bar`, action: `Change only inlet pressure from ${condition.inletPressureBar.toFixed(2)} to ${nextPressure.toFixed(2)} bar; keep mass flow, equivalence ratio, geometry, and cooling fixed.`, reason: `The computed injector backflow duty cycle is ${summary.injectorBackflowPct.toFixed(1)}%. Test pressure margin before changing injector hardware.`, target: "operating-condition" },
      simulation: { title: "Rerun exactly one operating change", action: `Repeat Full 3D at ${nextPressure.toFixed(2)} bar inlet pressure with every other field locked.`, reason: "This tests whether injector pressure margin reduces backflow before hardware is altered." },
    };
  }
  const heatLimit = design.build?.designHeatFluxMWM2;
  if (summary.peakWallHeatFluxMWm2 !== null && finitePositive(heatLimit ?? Number.NaN) && summary.peakWallHeatFluxMWm2 > heatLimit!) {
    return {
      resultUsable: true,
      status: "Provisional engine change ready",
      detail: "The result passed the numerical screening gates. The next change remains a testable hypothesis until experiment validation.",
      engine: { title: "Increase coolant mass flow by 10%", action: "Change only coolant mass flow by +10%; retain the hot-wall material, channel geometry, propellant condition, and chamber geometry.", reason: `Computed peak wall heat flux is ${summary.peakWallHeatFluxMWm2.toFixed(2)} MW/m² versus the entered ${heatLimit!.toFixed(2)} MW/m² design load.`, target: "engine" },
      simulation: { title: "Recalculate conjugate heat transfer", action: "Repeat the converged case with only coolant mass flow changed by +10%.", reason: "This isolates cooling response before changing wall or channel geometry." },
    };
  }
  const nextMassFlow = condition.massFlowKgS * 1.05;
  return {
    resultUsable: true,
    status: "Provisional engine change ready",
    detail: "The result passed the numerical screening gates. The next change remains a testable hypothesis until experiment validation.",
    engine: { title: `Test ${nextMassFlow.toFixed(3)} kg/s mass flow`, action: `Increase only total mass flow from ${condition.massFlowKgS.toFixed(3)} to ${nextMassFlow.toFixed(3)} kg/s; keep pressure, equivalence ratio, geometry, and cooling fixed.`, reason: "No gated backflow or thermal limit was detected, so the next lowest-risk step maps local operating sensitivity before hardware changes.", target: "operating-condition" },
    simulation: { title: "Rerun exactly one operating change", action: `Repeat the converged Full 3D case at ${nextMassFlow.toFixed(3)} kg/s with every other input locked.`, reason: "The result becomes a traceable adjacent point for the operating envelope." },
  };
}
