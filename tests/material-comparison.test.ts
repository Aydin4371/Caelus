import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_ENGINE_DESIGN } from "../lib/design-workspace.ts";
import { compareMaterials } from "../lib/material-comparison.ts";
import { calculateRdeBuildScreening } from "../lib/rde-build.ts";

const design = { ...EMPTY_ENGINE_DESIGN, annulusInnerDiameterMm: 78, annulusOuterDiameterMm: 86, chamberLengthMm: 120, inletPressureBarMax: 10, backPressureBar: 1, build: { ...EMPTY_ENGINE_DESIGN.build! } };

test("candidate temperatures reuse the actual cooling model without mutating the design", () => {
  const before = structuredClone(design);
  const rows = compareMaterials(design, "hotWallMaterial");
  for (const row of rows) {
    const expected = calculateRdeBuildScreening({ ...design, build: { ...design.build, hotWallMaterial: row.material.id } });
    assert.equal(row.wallTemperatureK, expected.estimatedHotWallTemperatureK);
    assert.ok(row.wallTemperatureK !== null);
  }
  assert.deepEqual(design, before);
  assert.ok(rows[0].conductionRiseK! < rows[1].conductionRiseK!);
  assert.equal(rows[0].massPerCm3G, 8.9);
});

test("comparison does not invent component temperatures or non-regenerative predictions", () => {
  assert.ok(compareMaterials(design, "injectorMaterial").every((row) => row.wallTemperatureK === null && row.conductionRiseK === null));
  const film = { ...design, build: { ...design.build, coolingMethod: "Film" as const } };
  assert.ok(compareMaterials(film, "hotWallMaterial").every((row) => row.wallTemperatureK === null));
  const invalid = { ...design, build: { ...design.build, wallThicknessMm: Number.NaN } };
  assert.ok(compareMaterials(invalid, "hotWallMaterial").every((row) => row.conductionRiseK === null && row.wallTemperatureK === null));
});
