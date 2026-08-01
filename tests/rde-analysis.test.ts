import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSignals,
  parseSignalCsv,
  recommendationFor,
  serializeReport,
  type Signal,
} from "../lib/rde-analysis.ts";

function sineSignal({
  name,
  amplitude = 1,
  bias = 0,
  frequency = 8,
  shiftMs = 0,
}: {
  name: string;
  amplitude?: number;
  bias?: number;
  frequency?: number;
  shiftMs?: number;
}): Signal {
  const count = 1600;
  const dtMs = 0.0025;
  const time = Array.from({ length: count }, (_, index) => index * dtMs);
  return {
    name,
    time,
    pressure: time.map(
      (value) => bias + amplitude * Math.sin(2 * Math.PI * frequency * (value + shiftMs)),
    ),
  };
}

function close(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, received ${actual}`,
  );
}

test("identical signals produce unit agreement and zero residual", () => {
  const testSignal = sineSignal({ name: "test" });
  const result = compareSignals(testSignal, { ...testSignal, name: "cfd" });

  // The aligned window is cropped by the lag search, so its DFT bins do not
  // land exactly on 8 kHz. The recovered value should remain within 0.625%.
  close(result.testFrequency, 8, 0.05, "test frequency");
  close(result.cfdFrequency, 8, 0.05, "CFD frequency");
  close(result.correlation, 1, 1e-12, "correlation");
  close(result.amplitudeError, 0, 1e-12, "amplitude error");
  close(result.phaseLagUs, 0, 1e-12, "phase lag");
  close(result.rmse, 0, 1e-12, "RMSE");
  close(result.score, 1, 1e-12, "agreement index");
});

test("recovers a known sub-cycle lag and amplitude mismatch", () => {
  const testSignal = sineSignal({ name: "test" });
  const cfdSignal = sineSignal({ name: "cfd", amplitude: 0.8, shiftMs: 0.01 });
  const result = compareSignals(testSignal, cfdSignal);

  close(Math.abs(result.phaseLagUs), 10, 0.01, "absolute phase lag");
  close(result.amplitudeError, 0.2, 0.005, "amplitude error");
  assert.ok(result.correlation > 0.999, "aligned waveform correlation should be near one");
  assert.equal(recommendationFor(result).title, "Test pressure-amplitude drivers");
});

test("CSV parser converts SI units to milliseconds and MPa", () => {
  const rows = ["time_s,pressure_kPa"];
  for (let index = 0; index < 40; index += 1) {
    rows.push(`${index * 0.0001},${1000 + index}`);
  }

  const signal = parseSignalCsv(rows.join("\n"), "unit-conversion.csv");
  close(signal.time[1], 0.1, 1e-12, "converted time");
  close(signal.pressure[0], 1, 1e-12, "converted pressure");
  close(signal.pressure[10], 1.01, 1e-12, "converted pressure sample");
});

test("CSV parser rejects unnamed engineering columns", () => {
  const rows = ["column_a,column_b"];
  for (let index = 0; index < 40; index += 1) rows.push(`${index},${index + 1}`);
  assert.throws(
    () => parseSignalCsv(rows.join("\n"), "ambiguous.csv"),
    /named time and pressure columns/i,
  );
});

test("serialized report exposes metrics, provenance, and limitations", () => {
  const result = compareSignals(
    sineSignal({ name: "test" }),
    sineSignal({ name: "cfd", bias: 0.05 }),
  );
  const report = JSON.parse(serializeReport(result, { test: "test.csv", cfd: "cfd.csv" }));

  assert.equal(report.schema, "caelus-rde-comparison-report");
  assert.equal(report.sources.test, "test.csv");
  assert.equal(report.units.pressure, "MPa");
  close(report.metrics.pressureBias, 0.05, 1e-12, "pressure bias");
  assert.ok(report.limitations.length >= 3);
});
