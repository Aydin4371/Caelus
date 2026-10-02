import type { EngineBuildDefinition, EngineDesign } from "./design-workspace.ts";
import { RDE_MATERIALS, calculateRdeBuildScreening } from "./rde-build.ts";

export const MATERIAL_COMPONENTS = [
  ["hotWallMaterial", "Hot-wall liner"],
  ["outerWallMaterial", "Pressure jacket"],
  ["injectorMaterial", "Injector face"],
  ["centerbodyMaterial", "Centerbody"],
  ["nozzleMaterial", "Nozzle / exhaust"],
] as const;
export type MaterialComponent = typeof MATERIAL_COMPONENTS[number][0];

/** Change only the candidate material; preserve all entered geometry and cooling assumptions. */
export function compareMaterials(design: EngineDesign, component: MaterialComponent) {
  return RDE_MATERIALS.filter((item) => item.id !== "Not selected").map((item) => {
    const build = design.build;
    const candidate = build ? { ...design, build: { ...build, [component]: item.id } as EngineBuildDefinition } : design;
    const screen = calculateRdeBuildScreening(candidate);
    const wallTemperatureK = component === "hotWallMaterial" && build?.coolingMethod === "Regenerative"
      ? screen.estimatedHotWallTemperatureK : null;
    const conductionRiseK = component === "hotWallMaterial" && build &&
      Number.isFinite(build.designHeatFluxMWM2) && build.designHeatFluxMWM2 > 0 &&
      Number.isFinite(build.wallThicknessMm) && build.wallThicknessMm > 0 && item.thermalConductivityWMK
      ? build.designHeatFluxMWM2 * 1e6 * build.wallThicknessMm * 1e-3 / item.thermalConductivityWMK : null;
    return {
      material: item,
      selected: build?.[component] === item.id,
      wallTemperatureK,
      conductionRiseK,
      // Compare equal volumes without inventing a component's missing solid geometry.
      massPerCm3G: item.densityKgM3 === null ? null : item.densityKgM3 / 1000,
      aboveReference: wallTemperatureK !== null && item.referenceTemperatureK !== null
        ? wallTemperatureK > item.referenceTemperatureK : null,
    };
  });
}
