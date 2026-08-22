import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  STRAKEY_COMBUSTION_INPUT,
  STRAKEY_COMBUSTION_RESULT,
  TOBIAS_CASE_A_INPUT,
  TOBIAS_CASE_A_RESULT,
  evaluatePublishedControlledRerun,
  evaluatePublishedPairedComparison,
} from "../lib/published-paired-validation.ts";

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, received ${actual}`);
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(value); value = ""; }
    else value += character;
  }
  cells.push(value);
  return cells;
}

test("published Tobias values calculate paired experiment-CFD differences at runtime", () => {
  const result = evaluatePublishedPairedComparison(TOBIAS_CASE_A_INPUT.measurements);
  assert.deepEqual(result, TOBIAS_CASE_A_RESULT);
  close(result.metrics[0].percentDifference, 3.125);
  close(result.metrics[1].percentDifference, -100 / 17);
  close(result.metrics[2].percentDifference, 0);
  close(result.maximumAbsolutePercentDifference, 100 / 17);
  assert.doesNotMatch(JSON.stringify(TOBIAS_CASE_A_INPUT), /percentDifference|classification|outcome/i);
});

test("published Strakey one-factor rerun is classified as a mixed result", () => {
  const result = evaluatePublishedControlledRerun(STRAKEY_COMBUSTION_INPUT);
  assert.deepEqual(result, STRAKEY_COMBUSTION_RESULT);
  assert.equal(result.waveCountImproved, true);
  assert.equal(result.waveSpeedImproved, false);
  assert.equal(result.classification, "Mixed result");
  close(result.baselineWaveSpeedErrorPct, 100 * 50 / 1740);
  close(result.rerunWaveSpeedErrorPct, 100 * 104 / 1740);
  assert.ok(result.waveSpeedErrorChangePctPoints > 3);
  assert.doesNotMatch(JSON.stringify(STRAKEY_COMBUSTION_INPUT), /classification|outcome/i);
});

test("downloadable public-data ledger preserves every paired source value", () => {
  const csv = readFileSync(new URL("../public/data/published-paired-validation.csv", import.meta.url), "utf8").trim().split(/\r?\n/);
  const header = splitCsvLine(csv[0]);
  const rows = csv.slice(1).map((line) => Object.fromEntries(splitCsvLine(line).map((value, index) => [header[index], value])));
  assert.equal(rows.length, 12);

  for (const measurement of TOBIAS_CASE_A_INPUT.measurements) {
    const key = measurement.id === "wave-frequency" ? "wave_frequency" : "static_pressure";
    for (const run of ["experiment", "cfd"] as const) {
      const row = rows.find((item) => item.source_id === TOBIAS_CASE_A_INPUT.sourceId && item.run === run && item.measurement === key && item.location === measurement.location);
      assert.ok(row, `missing Tobias CSV row for ${measurement.id} ${run}`);
      close(Number(row.value), measurement[run]);
      assert.equal(row.unit, measurement.unit);
    }
  }

  const strakeyRows = rows.filter((item) => item.source_id === STRAKEY_COMBUSTION_INPUT.sourceId);
  assert.equal(strakeyRows.length, 6);
  assert.equal(Number(strakeyRows.find((item) => item.run === "experiment" && item.measurement === "wave_count")?.value), STRAKEY_COMBUSTION_INPUT.experiment.waveCount);
  assert.equal(Number(strakeyRows.find((item) => item.run === "baseline_cfd" && item.measurement === "wave_speed")?.value), STRAKEY_COMBUSTION_INPUT.baselineCfd.waveSpeedMps);
  assert.equal(Number(strakeyRows.find((item) => item.run === "pasr_cfd" && item.measurement === "wave_speed")?.value), STRAKEY_COMBUSTION_INPUT.rerunCfd.waveSpeedMps);
});

