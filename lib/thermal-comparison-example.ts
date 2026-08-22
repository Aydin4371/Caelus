import type { WallFieldImport, WallFieldQuantity, WallFieldSample } from "./spatial-field.ts";

const AXIAL_LOCATIONS_MM = [0, 15, 30, 45, 60, 75, 90, 105, 120];
const ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

function sampleGrid(valueAt: (axialMm: number, angleDeg: number) => number): WallFieldSample[] {
  return AXIAL_LOCATIONS_MM.flatMap((axialMm) => ANGLES_DEG.map((angleDeg) => ({
    axialMm,
    angleDeg,
    value: Number(valueAt(axialMm, angleDeg).toFixed(4)),
  })));
}

function field(quantity: WallFieldQuantity, samples: WallFieldSample[]) {
  return { quantity, coverage: "surface-field" as const, samples };
}

function makeImport(fileName: string, heatFlux: WallFieldSample[], temperature: WallFieldSample[]): WallFieldImport {
  const rows = heatFlux.length;
  return {
    fileName,
    sourceRows: rows,
    validRows: rows,
    droppedRows: 0,
    axialColumn: "axial_mm",
    angleColumn: "angle_deg",
    heatFluxColumn: "wall_heat_flux_MW_m2",
    temperatureColumn: "wall_temperature_K",
    fields: [field("wallHeatFluxMWm2", heatFlux), field("wallTemperatureK", temperature)],
  };
}

/**
 * Deterministic synthetic arrays used only to exercise the Comparison renderer.
 * Values are evaluated from the coordinate grid at load time; they are not
 * experimental measurements, CFD results, validation labels, or saved claims.
 */
export function makeThermalComparisonExample() {
  const experimentHeatFlux = sampleGrid((axialMm, angleDeg) => {
    const x = axialMm / 120;
    const theta = angleDeg * Math.PI / 180;
    return 0.72 + 1.42 * Math.exp(-2.35 * x) + 0.16 * Math.cos(theta - 2.4 * Math.PI * x);
  });
  const cfdHeatFlux = sampleGrid((axialMm, angleDeg) => {
    const x = axialMm / 120;
    const theta = angleDeg * Math.PI / 180;
    return 0.77 + 1.51 * Math.exp(-2.15 * x) + 0.19 * Math.cos(theta - 2.15 * Math.PI * x + 0.12);
  });
  const experimentTemperature = sampleGrid((axialMm, angleDeg) => {
    const x = axialMm / 120;
    const theta = angleDeg * Math.PI / 180;
    return 486 + 242 * (1 - Math.exp(-2.4 * x)) + 18 * Math.cos(theta - 1.6 * Math.PI * x);
  });
  const cfdTemperature = sampleGrid((axialMm, angleDeg) => {
    const x = axialMm / 120;
    const theta = angleDeg * Math.PI / 180;
    return 502 + 255 * (1 - Math.exp(-2.2 * x)) + 22 * Math.cos(theta - 1.45 * Math.PI * x + 0.08);
  });

  return {
    experiment: makeImport("synthetic-experiment-wall-grid.csv", experimentHeatFlux, experimentTemperature),
    cfd: makeImport("synthetic-cfd-wall-grid.csv", cfdHeatFlux, cfdTemperature),
  };
}
