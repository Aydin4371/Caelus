import type { EngineBuildDefinition, EngineDesign, RdeMaterialId } from "./design-workspace.ts";

export type MaterialScreeningProperty = {
  id: RdeMaterialId;
  family: string;
  densityKgM3: number | null;
  thermalConductivityWMK: number | null;
  referenceTemperatureK: number | null;
  role: string;
  advantages: string[];
  tradeoffs: string[];
  propertyBasis: string;
  sourceUrl: string;
};

export const RDE_MATERIALS: MaterialScreeningProperty[] = [
  {
    id: "GRCop-class copper alloy",
    family: "Copper alloy",
    densityKgM3: 8900,
    thermalConductivityWMK: 300,
    referenceTemperatureK: 811,
    role: "High-conductivity liner or centerbody",
    advantages: ["Moves heat into a cooling circuit far better than the nickel and steel options", "NASA-developed balance of elevated-temperature strength, creep life, and low-cycle fatigue life"],
    tradeoffs: ["Needs an effective cooling path because copper alloys are not stand-alone thermal barriers", "Hot-gas oxidation protection and coating compatibility require separate review"],
    propertyBasis: "GRCop-84 nominal conductivity and a 538 °C screening reference, not a design allowable",
    sourceUrl: "https://ntrs.nasa.gov/citations/20070005011",
  },
  {
    id: "Inconel 718-class nickel superalloy",
    family: "Nickel superalloy",
    densityKgM3: 8190,
    thermalConductivityWMK: 11.4,
    referenceTemperatureK: 973,
    role: "Outer jacket, injector, or nozzle structure",
    advantages: ["Strong, fatigue-resistant structural option across a broad moderate-temperature range", "Mature aerospace fabrication and joining routes"],
    tradeoffs: ["Conducts heat roughly 25 times less effectively than the GRCop-class option", "Sustained service above the entered 700 °C reference needs grade, heat-treatment, and life data"],
    propertyBasis: "Annealed density, room-temperature conductivity, and 700 °C screening reference",
    sourceUrl: "https://www.specialmetals.com/documents/technical-bulletins/inconel/",
  },
  {
    id: "Haynes 230-class nickel superalloy",
    family: "Nickel superalloy",
    densityKgM3: 8970,
    thermalConductivityWMK: 8.9,
    referenceTemperatureK: 1423,
    role: "Oxidation-resistant hot-section structure",
    advantages: ["High-temperature strength and oxidation resistance for prolonged exposure", "Good thermal stability and resistance to grain growth"],
    tradeoffs: ["Lowest heat-spreading conductivity in this preliminary library", "High density makes it a poor default where a cooled copper liner can carry the heat"],
    propertyBasis: "Room-temperature physical properties and a 1150 °C oxidation screening reference",
    sourceUrl: "https://haynesintl.com/en/alloys/alloy-portfolio/high-temperature-alloys/haynes-230/",
  },
  {
    id: "316L stainless steel",
    family: "Stainless steel",
    densityKgM3: 8000,
    thermalConductivityWMK: 15,
    referenceTemperatureK: null,
    role: "Prototype manifolds and lower-temperature structure",
    advantages: ["Accessible corrosion-resistant choice for prototype plumbing and lower-temperature structure", "Common welding routes with no routine post-weld heat treatment for thin sections"],
    tradeoffs: ["Low thermal conductivity and high thermal expansion increase thermal-gradient and distortion concerns", "No generic hot-wall temperature reference is assigned in Kythros"],
    propertyBasis: "Room-temperature density and conductivity; no generic temperature limit assigned",
    sourceUrl: "https://www.thyssenkrupp-materials.co.uk/stainless-steel-316l-14404.html",
  },
  {
    id: "Not selected",
    family: "Unspecified",
    densityKgM3: null,
    thermalConductivityWMK: null,
    referenceTemperatureK: null,
    role: "Select a material before screening",
    advantages: [],
    tradeoffs: ["No screening properties or material guidance are available"],
    propertyBasis: "No screening properties",
    sourceUrl: "",
  },
];

export const RDE_MATERIAL_IDS = RDE_MATERIALS.map((material) => material.id);

export type RdeBuildScreening = {
  method: EngineBuildDefinition["coolingMethod"];
  available: boolean;
  cooledAreaM2: number | null;
  enteredHeatLoadKW: number | null;
  channelFlowAreaMm2: number | null;
  hydraulicDiameterMm: number | null;
  coolantVelocityMS: number | null;
  reynoldsNumber: number | null;
  flowRegime: "Laminar" | "Transitional" | "Turbulent" | null;
  coolantCoefficientWM2K: number | null;
  pressureDropBar: number | null;
  coolantTemperatureRiseK: number | null;
  estimatedHotWallTemperatureK: number | null;
  materialReferenceTemperatureK: number | null;
  simpleHoopStressMPa: number | null;
  filmCoolantFractionPct: number | null;
  enteredFilmEffectivenessPct: number | null;
  screenedResidualHeatFluxMWM2: number | null;
  filmProtectedHeatLoadKW: number | null;
  heatSinkEnergyCapacityKJ: number | null;
  idealizedHeatSinkDurationS: number | null;
  ablativeVolumeCm3: number | null;
  ablativeMassKg: number | null;
  idealizedAblativeDurationS: number | null;
  messages: string[];
};

function material(id: RdeMaterialId) {
  return RDE_MATERIALS.find((item) => item.id === id) ?? RDE_MATERIALS[RDE_MATERIALS.length - 1];
}

function finitePositive(...values: number[]) {
  return values.every((value) => Number.isFinite(value) && value > 0);
}

export function calculateRdeBuildScreening(design: EngineDesign): RdeBuildScreening {
  const build = design.build;
  const empty: RdeBuildScreening = {
    method: build?.coolingMethod ?? "Not defined",
    available: false,
    cooledAreaM2: null,
    enteredHeatLoadKW: null,
    channelFlowAreaMm2: null,
    hydraulicDiameterMm: null,
    coolantVelocityMS: null,
    reynoldsNumber: null,
    flowRegime: null,
    coolantCoefficientWM2K: null,
    pressureDropBar: null,
    coolantTemperatureRiseK: null,
    estimatedHotWallTemperatureK: null,
    materialReferenceTemperatureK: null,
    simpleHoopStressMPa: null,
    filmCoolantFractionPct: null,
    enteredFilmEffectivenessPct: null,
    screenedResidualHeatFluxMWM2: null,
    filmProtectedHeatLoadKW: null,
    heatSinkEnergyCapacityKJ: null,
    idealizedHeatSinkDurationS: null,
    ablativeVolumeCm3: null,
    ablativeMassKg: null,
    idealizedAblativeDurationS: null,
    messages: [],
  };

  if (!build || build.coolingMethod === "Not defined") {
    return {
      ...empty,
      messages: [build ? "Select a thermal-management method to define its hardware and direct screening calculation." : "Add a preliminary build definition to enable thermal-management screening."],
    };
  }

  const commonRequired = [design.annulusInnerDiameterMm, design.annulusOuterDiameterMm, design.chamberLengthMm, build.designHeatFluxMWM2];
  if (!finitePositive(...commonRequired)) {
    return { ...empty, messages: ["Complete the annulus geometry, chamber length, and entered heat flux to run this direct screen."] };
  }
  const lengthM = design.chamberLengthMm * 1e-3;
  const outerDiameterM = design.annulusOuterDiameterMm * 1e-3;
  const innerDiameterM = design.annulusInnerDiameterMm * 1e-3;
  const cooledAreaM2 = Math.PI * lengthM * (build.cooledSurfaces === "Inner and outer walls" ? outerDiameterM + innerDiameterM : outerDiameterM);
  const enteredHeatLoadW = build.designHeatFluxMWM2 * 1e6 * cooledAreaM2;

  if (build.coolingMethod === "Film") {
    const mainMassFlowKgS = 0.5 * (design.massFlowKgSMin + design.massFlowKgSMax);
    if (!finitePositive(build.filmMassFlowKgS, build.filmEffectivenessPct, mainMassFlowKgS) || build.filmEffectivenessPct > 100) {
      return { ...empty, cooledAreaM2, enteredHeatLoadKW: enteredHeatLoadW / 1000, messages: ["Complete the film-coolant flow and entered effectiveness fields to run the film-allocation screen."] };
    }
    const effectiveness = build.filmEffectivenessPct / 100;
    return {
      ...empty,
      available: true,
      cooledAreaM2,
      enteredHeatLoadKW: enteredHeatLoadW / 1000,
      filmCoolantFractionPct: 100 * build.filmMassFlowKgS / mainMassFlowKgS,
      enteredFilmEffectivenessPct: build.filmEffectivenessPct,
      screenedResidualHeatFluxMWM2: build.designHeatFluxMWM2 * (1 - effectiveness),
      filmProtectedHeatLoadKW: enteredHeatLoadW * effectiveness / 1000,
      messages: ["Effectiveness is an entered design assumption, not a Kythros prediction. The screen does not model film mixing, combustion loss, wall temperature, or injector interaction."],
    };
  }

  if (build.coolingMethod === "Heat sink") {
    const deltaTemperatureK = build.heatSinkMaximumTemperatureK - build.heatSinkInitialTemperatureK;
    if (!finitePositive(build.heatSinkMassKg, build.heatSinkSpecificHeatJkgK, build.heatSinkInitialTemperatureK, deltaTemperatureK)) {
      return { ...empty, cooledAreaM2, enteredHeatLoadKW: enteredHeatLoadW / 1000, messages: ["Complete the heat-sink mass, specific heat, and temperature-window fields to run the sensible-energy screen."] };
    }
    const capacityJ = build.heatSinkMassKg * build.heatSinkSpecificHeatJkgK * deltaTemperatureK;
    return {
      ...empty,
      available: true,
      cooledAreaM2,
      enteredHeatLoadKW: enteredHeatLoadW / 1000,
      heatSinkEnergyCapacityKJ: capacityJ / 1000,
      idealizedHeatSinkDurationS: capacityJ / enteredHeatLoadW,
      messages: ["Idealized sensible-heat duration only. Kythros assumes uniform temperature and omits gradients, losses, phase change, stress, and temperature-dependent properties."],
    };
  }

  if (build.coolingMethod === "Ablative") {
    if (!finitePositive(build.ablativeThicknessMm, build.ablativeDensityKgM3, build.ablativeEffectiveHeatMJkg)) {
      return { ...empty, cooledAreaM2, enteredHeatLoadKW: enteredHeatLoadW / 1000, messages: ["Complete the ablative thickness, density, and entered effective heat-absorption fields to run the material-inventory screen."] };
    }
    const volumeM3 = cooledAreaM2 * build.ablativeThicknessMm * 1e-3;
    const massKg = volumeM3 * build.ablativeDensityKgM3;
    const effectiveEnergyJ = massKg * build.ablativeEffectiveHeatMJkg * 1e6;
    return {
      ...empty,
      available: true,
      cooledAreaM2,
      enteredHeatLoadKW: enteredHeatLoadW / 1000,
      ablativeVolumeCm3: volumeM3 * 1e6,
      ablativeMassKg: massKg,
      idealizedAblativeDurationS: effectiveEnergyJ / enteredHeatLoadW,
      messages: ["Idealized material-inventory equivalent only. The entered effective heat absorption is not a recession-rate, erosion, char, bond-line-temperature, or service-life model."],
    };
  }

  const required = [
    design.annulusInnerDiameterMm,
    design.annulusOuterDiameterMm,
    design.chamberLengthMm,
    design.inletPressureBarMax,
    build.wallThicknessMm,
    build.coolingChannelCount,
    build.coolingChannelWidthMm,
    build.coolingChannelDepthMm,
    build.coolantMassFlowKgS,
    build.coolantInletTemperatureK,
    build.coolantInletPressureBar,
    build.coolantDensityKgM3,
    build.coolantSpecificHeatJkgK,
    build.coolantViscosityPaS,
    build.coolantThermalConductivityWMK,
    build.designHeatFluxMWM2,
  ];
  if (!finitePositive(...required) || !Number.isFinite(build.coolingChannelRoughnessMm) || build.coolingChannelRoughnessMm < 0) {
    return { ...empty, messages: ["Complete the geometry, cooling-channel, coolant-property, pressure, and entered heat-flux fields to run the screen."] };
  }

  const widthM = build.coolingChannelWidthMm * 1e-3;
  const depthM = build.coolingChannelDepthMm * 1e-3;
  const channelFlowAreaM2 = build.coolingChannelCount * widthM * depthM;
  const hydraulicDiameterM = 2 * widthM * depthM / (widthM + depthM);
  const coolantVelocityMS = build.coolantMassFlowKgS / (build.coolantDensityKgM3 * channelFlowAreaM2);
  const reynoldsNumber = build.coolantDensityKgM3 * coolantVelocityMS * hydraulicDiameterM / build.coolantViscosityPaS;
  const prandtlNumber = build.coolantSpecificHeatJkgK * build.coolantViscosityPaS / build.coolantThermalConductivityWMK;
  const flowRegime = reynoldsNumber < 2300 ? "Laminar" : reynoldsNumber < 4000 ? "Transitional" : "Turbulent";
  const nusseltNumber = flowRegime === "Laminar" ? 3.66 : 0.023 * reynoldsNumber ** 0.8 * prandtlNumber ** 0.4;
  const coolantCoefficientWM2K = nusseltNumber * build.coolantThermalConductivityWMK / hydraulicDiameterM;
  const roughnessM = build.coolingChannelRoughnessMm * 1e-3;
  const relativeRoughness = roughnessM / hydraulicDiameterM;
  const darcyFactor = flowRegime === "Laminar"
    ? 64 / reynoldsNumber
    : 0.25 / Math.log10(relativeRoughness / 3.7 + 5.74 / reynoldsNumber ** 0.9) ** 2;
  const pressureDropPa = darcyFactor * (lengthM / hydraulicDiameterM) * 0.5 * build.coolantDensityKgM3 * coolantVelocityMS ** 2;
  const coolantTemperatureRiseK = enteredHeatLoadW / (build.coolantMassFlowKgS * build.coolantSpecificHeatJkgK);
  const hotWall = material(build.hotWallMaterial);
  const wallConductivity = hotWall.thermalConductivityWMK;
  const convectiveRiseK = build.designHeatFluxMWM2 * 1e6 / coolantCoefficientWM2K;
  const wallRiseK = wallConductivity ? build.designHeatFluxMWM2 * 1e6 * build.wallThicknessMm * 1e-3 / wallConductivity : Number.NaN;
  const estimatedHotWallTemperatureK = build.coolantInletTemperatureK + coolantTemperatureRiseK + convectiveRiseK + wallRiseK;
  const meanRadiusM = 0.25 * (outerDiameterM + innerDiameterM);
  const pressureDifferencePa = Math.max(0, design.inletPressureBarMax - design.backPressureBar) * 1e5;
  const simpleHoopStressMPa = pressureDifferencePa * meanRadiusM / (build.wallThicknessMm * 1e-3) / 1e6;
  const messages: string[] = [];

  if (flowRegime === "Transitional") messages.push("Channel flow is transitional, where this simple correlation is least reliable.");
  if (flowRegime === "Laminar") messages.push("Channel flow is laminar; the constant-wall-temperature correlation is used.");
  if (pressureDropPa / 1e5 > 0.2 * build.coolantInletPressureBar) messages.push("Estimated channel pressure drop exceeds 20% of the entered coolant inlet pressure.");
  if (hotWall.referenceTemperatureK && estimatedHotWallTemperatureK > hotWall.referenceTemperatureK) messages.push("The screened hot-wall temperature exceeds the source-backed material reference temperature. This is a review trigger, not a failure criterion.");
  if (!wallConductivity) messages.push("No wall-conduction estimate is available for the selected hot-wall material.");
  messages.push("Heat flux and coolant properties are user-entered assumptions; Kythros does not predict RDE heat transfer or certify hardware.");

  return {
    ...empty,
    available: true,
    cooledAreaM2,
    enteredHeatLoadKW: enteredHeatLoadW / 1000,
    channelFlowAreaMm2: channelFlowAreaM2 * 1e6,
    hydraulicDiameterMm: hydraulicDiameterM * 1000,
    coolantVelocityMS,
    reynoldsNumber,
    flowRegime,
    coolantCoefficientWM2K,
    pressureDropBar: pressureDropPa / 1e5,
    coolantTemperatureRiseK,
    estimatedHotWallTemperatureK: Number.isFinite(estimatedHotWallTemperatureK) ? estimatedHotWallTemperatureK : null,
    materialReferenceTemperatureK: hotWall.referenceTemperatureK,
    simpleHoopStressMPa,
    messages,
  };
}
