import assert from "node:assert/strict";
import test from "node:test";
import { mapWallFieldTable, parseSpatialTable, suggestWallFieldMapping, wallField, wallFieldImportIsValid } from "../lib/spatial-field.ts";

test("maps wall heat flux and temperature from documented spatial coordinates", () => {
  const text = [
    "axial_cm,theta_rad,wall_heat_flux_kw_m2,wall_temperature_c",
    "0,0,1000,200",
    "1,1.5707963268,1500,250",
    "2,3.1415926536,2000,300",
    "3,4.7123889804,2500,350",
  ].join("\n");
  const table = parseSpatialTable(text, "wall.csv");
  const mapped = mapWallFieldTable(table, suggestWallFieldMapping(table));
  assert.equal(mapped.validRows, 4);
  assert.equal(wallField(mapped, "wallHeatFluxMWm2")?.coverage, "surface-field");
  assert.equal(wallField(mapped, "wallHeatFluxMWm2")?.samples[1].axialMm, 10);
  assert.ok(Math.abs((wallField(mapped, "wallHeatFluxMWm2")?.samples[1].angleDeg ?? 0) - 90) < 1e-6);
  assert.equal(wallField(mapped, "wallHeatFluxMWm2")?.samples[2].value, 2);
  assert.equal(wallField(mapped, "wallTemperatureK")?.samples[0].value, 473.15);
  assert.equal(wallFieldImportIsValid(mapped), true);
});

test("keeps an axial-only thermal profile one-dimensional", () => {
  const text = [
    "axial_mm,wall_heat_flux_mw_m2",
    "0,8.2",
    "10,6.8",
    "30,4.1",
    "60,3.3",
  ].join("\n");
  const table = parseSpatialTable(text, "axial-profile.csv");
  const mapping = suggestWallFieldMapping(table);
  assert.equal(mapping.angleColumnIndex, -1);
  const mapped = mapWallFieldTable(table, mapping);
  const field = wallField(mapped, "wallHeatFluxMWm2");
  assert.equal(mapped.angleColumn, null);
  assert.equal(field?.coverage, "axial-profile");
  assert.deepEqual(field?.samples.map((sample) => sample.angleDeg), [null, null, null, null]);
  assert.equal(wallFieldImportIsValid(mapped), true);
});

test("requires real spatial coordinates instead of making a field from one peak value", () => {
  assert.throws(() => parseSpatialTable("peak_heat_flux_mw_m2\n2.4", "peak.csv"), /at least four spatial samples/i);
});
