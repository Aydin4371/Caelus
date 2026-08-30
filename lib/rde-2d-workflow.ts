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
  solver: "Engineer-selected compressible reacting-flow solver",
  chemistryMechanism: "Not supplied",
  probeCount: 8,
};

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
    ],
    limitation: "Kythros has generated a reviewable 2D unwrapped geometry and case specification. It has not solved the reacting flow, selected validated physical models, or certified that this setup predicts an RDE.",
  };
}

export function rde2dPackageFileName(design: EngineDesign) {
  const safe = design.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rde";
  return `kythros-${safe}-2d-case.json`;
}
