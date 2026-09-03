import assert from "node:assert/strict";
import test from "node:test";
import { cloneEngineDesign, EMPTY_ENGINE_DESIGN, validateEngineDesign, type EngineDesign } from "../lib/design-workspace.ts";
import { RDE_MATERIALS, calculateRdeBuildScreening } from "../lib/rde-build.ts";

const design: EngineDesign = {
  ...EMPTY_ENGINE_DESIGN,
  id: "regen-screen",
  name: "Regeneratively cooled annular concept",
  annulusInnerDiameterMm: 78,
  annulusOuterDiameterMm: 86,
  chamberLengthMm: 120,
  injectorCount: 120,
  injectorDiameterMm: 0.8,
  plenumVolumeCm3: 300,
  equivalenceRatioMin: 0.7,
  equivalenceRatioMax: 1.3,
  massFlowKgSMin: 0.4,
  massFlowKgSMax: 0.8,
  inletPressureBarMin: 6,
  inletPressureBarMax: 10,
  inletTemperatureK: 300,
  backPressureBar: 1,
  build: { ...EMPTY_ENGINE_DESIGN.build! },
};

test("maps every selectable material to nominal screening properties", () => {
  assert.ok(RDE_MATERIALS.some((material) => material.id === "GRCop-class copper alloy" && material.thermalConductivityWMK));
  assert.ok(RDE_MATERIALS.some((material) => material.id === "Inconel 718-class nickel superalloy" && material.referenceTemperatureK));
  assert.ok(RDE_MATERIALS.some((material) => material.id === "Not selected" && material.thermalConductivityWMK === null));
  assert.ok(RDE_MATERIALS.filter((material) => material.id !== "Not selected").every((material) => material.advantages.length && material.tradeoffs.length));
});

test("calculates a transparent first-order regenerative cooling screen", () => {
  assert.deepEqual(validateEngineDesign(design), []);
  const result = calculateRdeBuildScreening(design);
  assert.equal(result.available, true);
  assert.ok(Math.abs((result.cooledAreaM2 ?? 0) - Math.PI * 0.086 * 0.12) < 1e-12);
  assert.ok(Math.abs((result.channelFlowAreaMm2 ?? 0) - 90) < 1e-9);
  assert.ok((result.enteredHeatLoadKW ?? 0) > 300);
  assert.ok((result.reynoldsNumber ?? 0) > 4000);
  assert.equal(result.flowRegime, "Turbulent");
  assert.ok((result.pressureDropBar ?? 0) > 0);
  assert.ok((result.coolantTemperatureRiseK ?? 0) > 0);
  assert.ok((result.estimatedHotWallTemperatureK ?? 0) > design.build!.coolantInletTemperatureK);
  assert.match(result.messages.at(-1) ?? "", /user-entered assumptions/i);
});

test("calculates an idealized heat-sink energy screen without regenerative outputs", () => {
  const heatSinkDesign = { ...design, build: { ...design.build!, coolingMethod: "Heat sink" as const } };
  const result = calculateRdeBuildScreening(heatSinkDesign);
  assert.equal(result.available, true);
  assert.equal(result.method, "Heat sink");
  assert.equal(result.pressureDropBar, null);
  assert.equal(result.heatSinkEnergyCapacityKJ, 2400);
  assert.ok((result.idealizedHeatSinkDurationS ?? 0) > 0);
  assert.match(result.messages[0], /sensible-heat duration/i);
  assert.deepEqual(validateEngineDesign(heatSinkDesign), []);
  assert.equal(cloneEngineDesign(heatSinkDesign).build?.coolingMethod, "Heat sink");
});

test("screens film cooling from an explicitly entered effectiveness assumption", () => {
  const filmDesign = { ...design, build: { ...design.build!, coolingMethod: "Film" as const, filmMassFlowKgS: 0.03, filmEffectivenessPct: 40 } };
  const result = calculateRdeBuildScreening(filmDesign);
  assert.equal(result.available, true);
  assert.equal(result.method, "Film");
  assert.ok(Math.abs((result.filmCoolantFractionPct ?? 0) - 5) < 1e-12);
  assert.ok(Math.abs((result.screenedResidualHeatFluxMWM2 ?? 0) - 6) < 1e-12);
  assert.ok((result.filmProtectedHeatLoadKW ?? 0) > 0);
  assert.equal(result.coolantVelocityMS, null);
  assert.match(result.messages[0], /entered design assumption/i);
});

test("screens an ablative liner as material inventory without claiming recession life", () => {
  const ablativeDesign = { ...design, build: { ...design.build!, coolingMethod: "Ablative" as const, ablativeThicknessMm: 10, ablativeDensityKgM3: 1500, ablativeEffectiveHeatMJkg: 2.5 } };
  const result = calculateRdeBuildScreening(ablativeDesign);
  assert.equal(result.available, true);
  assert.equal(result.method, "Ablative");
  assert.ok((result.ablativeVolumeCm3 ?? 0) > 0);
  assert.ok((result.ablativeMassKg ?? 0) > 0);
  assert.ok((result.idealizedAblativeDurationS ?? 0) > 0);
  assert.match(result.messages[0], /not a recession-rate/i);
});

test("raises the screened wall temperature when the entered heat flux increases", () => {
  const low = calculateRdeBuildScreening({ ...design, build: { ...design.build!, designHeatFluxMWM2: 4 } });
  const high = calculateRdeBuildScreening({ ...design, build: { ...design.build!, designHeatFluxMWM2: 12 } });
  assert.ok((high.estimatedHotWallTemperatureK ?? 0) > (low.estimatedHotWallTemperatureK ?? 0));
});
