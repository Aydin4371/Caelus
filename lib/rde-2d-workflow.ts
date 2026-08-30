import type { EngineDesign, OperatingPoint } from "./design-workspace.ts";

export type Rde2dSettings = {
  circumferentialCells: number;
  axialCells: number;
  timeStepNs: number;
  endTimeMs: number;
  solver: string;
  chemistryMechanism: string;
  probeCount: number;
};

export type Rde2dPresetId = "quick" | "balanced" | "refined" | "custom";

export type Rde2dPreset = {
  id: Exclude<Rde2dPresetId, "custom">;
  label: string;
  purpose: string;
  settings: Pick<Rde2dSettings, "circumferentialCells" | "axialCells" | "timeStepNs" | "endTimeMs" | "probeCount">;
};

export type Rde2dResultSummary = {
  schema: "kythros-rde-2d-result";
  formatVersion: 1;
  designId: string;
  designFingerprint: string | null;
  operatingConditionId: string;
  solverName: string;
  solverConverged: boolean;
  meshChangePct: number | null;
  timeStepChangePct: number | null;
  propagationMode: "stable-detonation" | "intermittent" | "deflagration" | "unclassified";
  waveCount: number | null;
  dominantFrequencyKHz: number | null;
  pressureGainPct: number | null;
  injectorBackflowPct: number | null;
  peakWallHeatFluxMWm2: number | null;
  peakWallTemperatureK: number | null;
};

export type Rde2dRecommendation = {
  resultUsable: boolean;
  pairingIssues: string[];
  numericalIssues: string[];
  engine: {
    title: string;
    action: string;
    reason: string;
    target: "feed-system" | "cooling" | "operating-condition" | "none";
  };
  simulation: {
    title: string;
    action: string;
    reason: string;
  };
};

export type Rde2dCondition = Pick<OperatingPoint, "id" | "name" | "inletPressureBar" | "inletTemperatureK" | "equivalenceRatio" | "massFlowKgS" | "backPressureBar">;

export type Rde2dPackage = {
  schema: "kythros-rde-2d-case";
  formatVersion: 1;
  generatedAt: string;
  designId: string;
  designFingerprint: string | null;
  operatingCondition: Rde2dCondition;
  geometry: {
    coordinateSystem: "x: circumferential distance; y: axial distance; z: empty thickness";
    meanDiameterMm: number;
    circumferenceMm: number;
    chamberLengthMm: number;
    annulusGapMm: number;
  };
  discretization: Rde2dSettings & {
    circumferentialCellSizeMm: number;
    axialCellSizeMm: number;
    totalCells: number;
  };
  readiness: {
    exportReady: boolean;
    solverReady: false;
    blockingIssues: string[];
    engineerReview: string[];
  };
  files: Array<{ path: string; purpose: string; content: string }>;
  limitation: string;
};

export const DEFAULT_RDE_2D_SETTINGS: Rde2dSettings = {
  circumferentialCells: 720,
  axialCells: 240,
  timeStepNs: 5,
  endTimeMs: 1,
  solver: "OpenFOAM custom reacting-flow solver",
  chemistryMechanism: "Not supplied",
  probeCount: 8,
};

export const RDE_2D_PRESETS: Rde2dPreset[] = [
  {
    id: "quick",
    label: "Quick screening",
    purpose: "Fast setup check and early wave-development inspection",
    settings: { circumferentialCells: 180, axialCells: 60, timeStepNs: 20, endTimeMs: 0.25, probeCount: 4 },
  },
  {
    id: "balanced",
    label: "Balanced development",
    purpose: "Normal design iteration before a refinement study",
    settings: { circumferentialCells: 360, axialCells: 120, timeStepNs: 10, endTimeMs: 0.5, probeCount: 8 },
  },
  {
    id: "refined",
    label: "Refined evidence",
    purpose: "Higher-cost case for an adjacent mesh or time-step check",
    settings: { circumferentialCells: 720, axialCells: 240, timeStepNs: 5, endTimeMs: 1, probeCount: 8 },
  },
];

export function settingsForPreset(id: Exclude<Rde2dPresetId, "custom">, current: Rde2dSettings = DEFAULT_RDE_2D_SETTINGS): Rde2dSettings {
  const preset = RDE_2D_PRESETS.find((item) => item.id === id) ?? RDE_2D_PRESETS[1];
  return { ...current, ...preset.settings };
}

export function relativeRde2dWork(settings: Rde2dSettings) {
  const reference = DEFAULT_RDE_2D_SETTINGS.circumferentialCells * DEFAULT_RDE_2D_SETTINGS.axialCells * DEFAULT_RDE_2D_SETTINGS.endTimeMs / DEFAULT_RDE_2D_SETTINGS.timeStepNs;
  const work = settings.circumferentialCells * settings.axialCells * settings.endTimeMs / settings.timeStepNs;
  return Number.isFinite(work) && work > 0 ? work / reference : Number.NaN;
}

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function midpointCondition(design: EngineDesign): Rde2dCondition {
  return {
    id: `${design.id}-midpoint`,
    name: "Design-range midpoint",
    inletPressureBar: 0.5 * (design.inletPressureBarMin + design.inletPressureBarMax),
    inletTemperatureK: design.inletTemperatureK,
    equivalenceRatio: 0.5 * (design.equivalenceRatioMin + design.equivalenceRatioMax),
    massFlowKgS: 0.5 * (design.massFlowKgSMin + design.massFlowKgSMax),
    backPressureBar: design.backPressureBar,
  };
}

function blockMeshDict(widthM: number, lengthM: number, nx: number, ny: number) {
  const thicknessM = 0.001;
  return `/* Kythros 2D unwrapped annulus geometry template.
 * x = circumferential distance, y = axial distance, z = empty thickness.
 * Review patch orientation and names against the selected solver before use. */
FoamFile
{
    format ascii;
    class dictionary;
    object blockMeshDict;
}
convertToMeters 1;
vertices
(
    (0 0 0)
    (${widthM.toExponential(12)} 0 0)
    (${widthM.toExponential(12)} ${lengthM.toExponential(12)} 0)
    (0 ${lengthM.toExponential(12)} 0)
    (0 0 ${thicknessM})
    (${widthM.toExponential(12)} 0 ${thicknessM})
    (${widthM.toExponential(12)} ${lengthM.toExponential(12)} ${thicknessM})
    (0 ${lengthM.toExponential(12)} ${thicknessM})
);
blocks
(
    hex (0 1 2 3 4 5 6 7) (${nx} ${ny} 1) simpleGrading (1 1 1)
);
boundary
(
    injector_inlet { type patch; faces ((0 1 5 4)); }
    chamber_exit { type patch; faces ((3 7 6 2)); }
    periodic_start { type cyclic; neighbourPatch periodic_end; faces ((0 4 7 3)); }
    periodic_end { type cyclic; neighbourPatch periodic_start; faces ((1 2 6 5)); }
    frontAndBack { type empty; faces ((0 3 2 1) (4 5 6 7)); }
);
`;
}

function probeFile(widthM: number, lengthM: number, count: number) {
  const y = 0.5 * lengthM;
  const points = Array.from({ length: count }, (_, index) => {
    const x = widthM * index / count;
    return `        (${x.toExponential(10)} ${y.toExponential(10)} 0.0005)`;
  }).join("\n");
  return `// Circumferential pressure probes at 50% chamber length.
// Review axial station, field name, sampling interval, and coordinate convention.
probes
{
    type probes;
    libs (sampling);
    fields (p);
    probeLocations
    (
${points}
    );
}
`;
}

function resultTemplate(design: EngineDesign, condition: Rde2dCondition, settings: Rde2dSettings): Rde2dResultSummary {
  return {
    schema: "kythros-rde-2d-result",
    formatVersion: 1,
    designId: design.id,
    designFingerprint: design.revision?.fingerprint ?? null,
    operatingConditionId: condition.id,
    solverName: settings.solver,
    solverConverged: false,
    meshChangePct: null,
    timeStepChangePct: null,
    propagationMode: "unclassified",
    waveCount: null,
    dominantFrequencyKHz: null,
    pressureGainPct: null,
    injectorBackflowPct: null,
    peakWallHeatFluxMWm2: null,
    peakWallTemperatureK: null,
  };
}

export function buildRde2dPackage(design: EngineDesign, condition: Rde2dCondition, settings: Rde2dSettings, generatedAt = new Date().toISOString()): Rde2dPackage {
  const meanDiameterMm = 0.5 * (design.annulusInnerDiameterMm + design.annulusOuterDiameterMm);
  const circumferenceMm = Math.PI * meanDiameterMm;
  const annulusGapMm = 0.5 * (design.annulusOuterDiameterMm - design.annulusInnerDiameterMm);
  const blockingIssues: string[] = [];
  if (![meanDiameterMm, circumferenceMm, annulusGapMm, design.chamberLengthMm].every(finitePositive)) blockingIssues.push("Complete a physically positive annulus and chamber geometry.");
  if (![condition.inletPressureBar, condition.inletTemperatureK, condition.equivalenceRatio, condition.massFlowKgS, condition.backPressureBar].every(finitePositive)) blockingIssues.push("Complete the selected operating condition.");
  if (![settings.circumferentialCells, settings.axialCells, settings.timeStepNs, settings.endTimeMs, settings.probeCount].every(finitePositive)) blockingIssues.push("Enter positive mesh, time, and probe settings.");
  const nx = Math.max(1, Math.round(settings.circumferentialCells));
  const ny = Math.max(1, Math.round(settings.axialCells));
  const probes = Math.max(1, Math.round(settings.probeCount));
  const dx = circumferenceMm / nx;
  const dy = design.chamberLengthMm / ny;
  const engineerReview = [
    "Select and verify a compressible reacting-flow solver and OpenFOAM version.",
    "Supply a validated thermochemistry mechanism, transport data, and reaction integrator.",
    "Translate total feed conditions into solver-native species and injector boundary conditions.",
    "Perform mesh- and time-step-convergence studies; these entered values are not Kythros recommendations.",
    "Verify ignition, outlet, wall, numerical-flux, limiter, and positivity treatment.",
  ];
  if (settings.chemistryMechanism.trim() && settings.chemistryMechanism !== "Not supplied") engineerReview[1] = `Verify the supplied chemistry reference: ${settings.chemistryMechanism}.`;
  const conditionJson = JSON.stringify({ design: { id: design.id, revision: design.revision ?? null, fuel: design.fuel, oxidizer: design.oxidizer, injectorType: design.injectorType, injectorCount: design.injectorCount, injectorDiameterMm: design.injectorDiameterMm }, operatingCondition: condition, settings }, null, 2);
  const readme = `# Kythros 2D unwrapped RDE starter\n\nThis package defines a periodic rectangular representation of the annular chamber. It is geometry and traceability infrastructure, not a validated RDE CFD model.\n\n- Circumferential width: ${circumferenceMm.toFixed(4)} mm\n- Axial length: ${design.chamberLengthMm.toFixed(4)} mm\n- Grid: ${nx} × ${ny} = ${(nx * ny).toLocaleString()} cells\n- Nominal spacing: ${dx.toFixed(5)} × ${dy.toFixed(5)} mm\n- Entered time step: ${settings.timeStepNs} ns\n- Entered duration: ${settings.endTimeMs} ms\n\nThe engineer must complete and review the solver, thermochemistry, fields, boundary conditions, ignition, numerics, and convergence plan before execution.\n`;
  return {
    schema: "kythros-rde-2d-case",
    formatVersion: 1,
    generatedAt,
    designId: design.id,
    designFingerprint: design.revision?.fingerprint ?? null,
    operatingCondition: condition,
    geometry: { coordinateSystem: "x: circumferential distance; y: axial distance; z: empty thickness", meanDiameterMm, circumferenceMm, chamberLengthMm: design.chamberLengthMm, annulusGapMm },
    discretization: { ...settings, circumferentialCells: nx, axialCells: ny, probeCount: probes, circumferentialCellSizeMm: dx, axialCellSizeMm: dy, totalCells: nx * ny },
    readiness: { exportReady: blockingIssues.length === 0, solverReady: false, blockingIssues, engineerReview },
    files: [
      { path: "README.md", purpose: "Scope, geometry, and mandatory review boundary", content: readme },
      { path: "kythros-case.json", purpose: "Traceable engine, operating-condition, and setup record", content: conditionJson },
      { path: "system/blockMeshDict", purpose: "Periodic 2D unwrapped mesh template", content: blockMeshDict(circumferenceMm * 1e-3, design.chamberLengthMm * 1e-3, nx, ny) },
      { path: "system/probes.template", purpose: "Circumferential pressure-probe template", content: probeFile(circumferenceMm * 1e-3, design.chamberLengthMm * 1e-3, probes) },
      { path: "kythros-result.template.json", purpose: "Solver-result summary to return to Kythros", content: JSON.stringify(resultTemplate(design, condition, settings), null, 2) },
    ],
    limitation: "Kythros has generated a reviewable 2D unwrapped geometry and case specification. It has not solved the reacting flow, selected validated physical models, or certified that this setup predicts an RDE.",
  };
}

function nullableNumber(value: unknown) {
  return value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

export function parseRde2dResult(content: string): Rde2dResultSummary {
  const raw = JSON.parse(content) as Record<string, unknown>;
  if (raw.schema !== "kythros-rde-2d-result" || raw.formatVersion !== 1) throw new Error("Choose a Kythros 2D result-summary JSON file.");
  const modes = ["stable-detonation", "intermittent", "deflagration", "unclassified"];
  if (!modes.includes(String(raw.propagationMode))) throw new Error("The result has an unsupported propagation mode.");
  if (typeof raw.designId !== "string" || typeof raw.operatingConditionId !== "string" || typeof raw.solverName !== "string" || typeof raw.solverConverged !== "boolean") throw new Error("The result is missing its case identity or solver status.");
  const result: Rde2dResultSummary = {
    schema: "kythros-rde-2d-result",
    formatVersion: 1,
    designId: raw.designId,
    designFingerprint: raw.designFingerprint === null ? null : String(raw.designFingerprint ?? ""),
    operatingConditionId: raw.operatingConditionId,
    solverName: raw.solverName,
    solverConverged: raw.solverConverged,
    meshChangePct: nullableNumber(raw.meshChangePct),
    timeStepChangePct: nullableNumber(raw.timeStepChangePct),
    propagationMode: raw.propagationMode as Rde2dResultSummary["propagationMode"],
    waveCount: nullableNumber(raw.waveCount),
    dominantFrequencyKHz: nullableNumber(raw.dominantFrequencyKHz),
    pressureGainPct: nullableNumber(raw.pressureGainPct),
    injectorBackflowPct: nullableNumber(raw.injectorBackflowPct),
    peakWallHeatFluxMWm2: nullableNumber(raw.peakWallHeatFluxMWm2),
    peakWallTemperatureK: nullableNumber(raw.peakWallTemperatureK),
  };
  const invalid = Object.entries(result).find(([key, value]) => key !== "designFingerprint" && typeof value === "number" && !Number.isFinite(value) && value !== null);
  if (invalid) throw new Error(`The result field ${invalid[0]} must contain a number or null.`);
  return result;
}

function available(value: number | null) {
  return value !== null && Number.isFinite(value);
}

export function analyzeRde2dResult(design: EngineDesign, condition: Rde2dCondition, result: Rde2dResultSummary): Rde2dRecommendation {
  const pairingIssues: string[] = [];
  if (result.designId !== design.id) pairingIssues.push("The result belongs to a different engine revision.");
  if (design.revision?.fingerprint && result.designFingerprint !== design.revision.fingerprint) pairingIssues.push("The engine fingerprint does not match the selected revision.");
  if (result.operatingConditionId !== condition.id) pairingIssues.push("The result belongs to a different operating condition.");

  const numericalIssues: string[] = [];
  if (!result.solverConverged) numericalIssues.push("The solver did not report convergence.");
  if (!available(result.meshChangePct)) numericalIssues.push("A mesh-refinement change is not reported.");
  else if (Math.abs(result.meshChangePct!) > 2) numericalIssues.push(`The monitored result still changes ${Math.abs(result.meshChangePct!).toFixed(1)}% with mesh refinement.`);
  if (!available(result.timeStepChangePct)) numericalIssues.push("A time-step refinement change is not reported.");
  else if (Math.abs(result.timeStepChangePct!) > 2) numericalIssues.push(`The monitored result still changes ${Math.abs(result.timeStepChangePct!).toFixed(1)}% with time-step refinement.`);

  if (pairingIssues.length) return {
    resultUsable: false,
    pairingIssues,
    numericalIssues,
    engine: { title: "No engine change", action: "Import the result for this exact engine revision and operating condition.", reason: "Kythros blocks design advice when case identity does not match.", target: "none" },
    simulation: { title: "Correct the result pairing", action: "Return the solver summary with the exported design ID, fingerprint, and operating-condition ID.", reason: pairingIssues[0] },
  };

  if (numericalIssues.length) return {
    resultUsable: false,
    pairingIssues,
    numericalIssues,
    engine: { title: "Do not change the engine yet", action: "Keep the physical design fixed until the 2D result is numerically trustworthy.", reason: "A numerical change could otherwise be mistaken for an engine-design effect.", target: "none" },
    simulation: {
      title: !result.solverConverged ? "Fix solver convergence" : available(result.meshChangePct) && Math.abs(result.meshChangePct!) > 2 ? "Run the next finer mesh" : available(result.timeStepChangePct) && Math.abs(result.timeStepChangePct!) > 2 ? "Run the next smaller time step" : "Complete the convergence checks",
      action: !result.solverConverged ? "Keep the engine fixed and correct the residual, conservation, or stability failure." : available(result.meshChangePct) && Math.abs(result.meshChangePct!) > 2 ? "Keep every other setting fixed and select the next adjacent mesh level." : available(result.timeStepChangePct) && Math.abs(result.timeStepChangePct!) > 2 ? "Keep every other setting fixed and select the next adjacent time-step level." : "Return adjacent mesh and time-step results using the same monitored quantities.",
      reason: numericalIssues[0],
    },
  };

  const designHeatFlux = design.build?.designHeatFluxMWM2;
  if (available(result.injectorBackflowPct) && result.injectorBackflowPct! > 5) return {
    resultUsable: true,
    pairingIssues,
    numericalIssues,
    engine: { title: "Increase injector isolation", action: "Test one feed-system change: raise injector pressure-drop margin by changing either feed pressure or total injector area, not both.", reason: `The converged 2D case reports ${result.injectorBackflowPct!.toFixed(1)}% injector backflow duty cycle.`, target: "feed-system" },
    simulation: { title: "Rerun one injector change", action: "Copy this case, change only the selected feed-pressure or injector-area variable, and compare backflow and wave stability.", reason: "This isolates whether injector coupling is driving the result." },
  };

  if (available(result.peakWallHeatFluxMWm2) && Number.isFinite(designHeatFlux) && result.peakWallHeatFluxMWm2! > designHeatFlux!) {
    const method = design.build?.coolingMethod ?? "cooling system";
    const action = method === "Regenerative" ? "Increase coolant mass-flow allocation as the single design change." : method === "Film" ? "Increase film-coolant allocation as the single design change." : method === "Heat sink" ? "Increase heat-sink thermal inventory as the single design change." : method === "Ablative" ? "Increase ablative thickness as the single design change." : "Define a cooling method sized for the imported wall load.";
    return {
      resultUsable: true,
      pairingIssues,
      numericalIssues,
      engine: { title: `Increase ${method.toLowerCase()} cooling margin`, action, reason: `The imported peak wall heat flux is ${result.peakWallHeatFluxMWm2!.toFixed(2)} MW/m², above the ${designHeatFlux!.toFixed(2)} MW/m² load used in the saved design screen.`, target: "cooling" },
      simulation: { title: "Rerun the cooling change", action: "Keep geometry, operating condition, numerics, and every other cooling variable fixed.", reason: "The next case should measure the effect of one cooling-design change." },
    };
  }

  if (["intermittent", "deflagration"].includes(result.propagationMode)) return {
    resultUsable: true,
    pairingIssues,
    numericalIssues,
    engine: { title: "Keep the hardware fixed", action: "Test one adjacent operating condition before changing chamber or injector geometry.", reason: `The numerically screened result is classified as ${result.propagationMode.replace("-", " ")}; one case does not identify a hardware defect.`, target: "operating-condition" },
    simulation: { title: "Bracket the operating condition", action: "Change only equivalence ratio or mass flow to the next saved condition and rerun.", reason: "This tests whether the mode is an operating-point effect before altering the engine." },
  };

  return {
    resultUsable: true,
    pairingIssues,
    numericalIssues,
    engine: { title: "No engine change supported", action: "Keep this revision and extend the simulated operating envelope.", reason: "The supplied numerical checks passed and no imported feed, thermal, or propagation result crossed a screening rule.", target: "none" },
    simulation: { title: "Run the next operating point", action: "Keep the engine and numerical method fixed; change only one operating variable.", reason: "The next case should expand coverage rather than introduce an unsupported hardware change." },
  };
}

export function rde2dPackageFileName(design: EngineDesign) {
  const safe = design.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rde";
  return `kythros-${safe}-2d-case.json`;
}
