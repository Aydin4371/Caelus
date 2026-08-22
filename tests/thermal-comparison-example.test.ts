import assert from "node:assert/strict";
import test from "node:test";

import { makeThermalComparisonExample } from "../lib/thermal-comparison-example.ts";
import { wallField, wallFieldImportIsValid } from "../lib/spatial-field.ts";

test("thermal comparison example provides renderable experiment and CFD coordinate arrays", () => {
  const example = makeThermalComparisonExample();
  assert.equal(wallFieldImportIsValid(example.experiment), true);
  assert.equal(wallFieldImportIsValid(example.cfd), true);

  for (const imported of [example.experiment, example.cfd]) {
    const heatFlux = wallField(imported, "wallHeatFluxMWm2");
    const temperature = wallField(imported, "wallTemperatureK");
    assert.equal(heatFlux?.coverage, "surface-field");
    assert.equal(temperature?.coverage, "surface-field");
    assert.equal(heatFlux?.samples.length, 72);
    assert.equal(temperature?.samples.length, 72);
    assert.equal(new Set(heatFlux?.samples.map((sample) => sample.axialMm)).size, 9);
    assert.equal(new Set(heatFlux?.samples.map((sample) => sample.angleDeg)).size, 8);
  }
});

test("thermal example is deterministic and keeps experiment and CFD values distinct", () => {
  const first = makeThermalComparisonExample();
  const second = makeThermalComparisonExample();
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.experiment.fields, first.cfd.fields);
});
