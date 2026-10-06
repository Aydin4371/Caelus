import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { AYERS_EXPERIMENT, ayersBenchmarkCase, ayersRunSettings, compareAyersExperiment } from "../lib/ayers-rde-benchmark.ts";
import { runFastRde2d } from "../lib/fast-rde-2d.ts";
import { encodePressureGif } from "../lib/benchmark-replay.ts";

test("experiment units and mesh/time variants preserve independent source inputs", () => {
  const { design, condition, areaM2 } = ayersBenchmarkCase();
  assert.ok(Math.abs(areaM2 - Math.PI / 4 * (0.1356 ** 2 - 0.1209 ** 2)) < 1e-12);
  assert.equal(condition.massFlowKgS, 55 * areaM2);
  assert.equal(condition.inletPressureBar, 8.9);
  assert.equal(AYERS_EXPERIMENT.measuredMeanPressureBar, 1.10);
  assert.equal(design.build, undefined);
  const a = ayersRunSettings("baseline"), b = ayersRunSettings("mesh"), c = ayersRunSettings("time");
  assert.equal(a.timeStepNs, b.timeStepNs);
  assert.equal(a.endTimeMs, b.endTimeMs);
  assert.equal(a.circumferentialCells, c.circumferentialCells);
  assert.equal(a.axialCells, c.axialCells);
  assert.equal(a.timeStepNs / c.timeStepNs, 2);
});

test("recording preserves the numerical answer and physical timestamps without inventing motion", async () => {
  const { design, condition } = ayersBenchmarkCase();
  const settings = { ...ayersRunSettings("baseline"), circumferentialCells: 32, axialCells: 12, endTimeMs: 0.01 };
  const original = await runFastRde2d(design, condition, settings);
  const recorded = await runFastRde2d(design, condition, settings, { recording: { frameCount: 5, probeAxialMm: 9.1, averagingStartMs: 0.005 } });
  assert.deepEqual(original.field, recorded.field);
  assert.equal(original.screeningDiagnostics.massConservationErrorPct, recorded.screeningDiagnostics.massConservationErrorPct);
  const r = recorded.recording!;
  assert.ok(r.frames.length <= 5);
  assert.equal(r.frames[0].timeMs, 0);
  assert.ok(Math.abs(r.frames.at(-1)!.timeMs - 0.01) < 1e-12);
  assert.ok(r.frames.every((frame, index) => frame.pressureBar.length === 32 * 12 && (index === 0 || frame.timeMs > r.frames[index - 1].timeMs)));
  assert.ok(Math.abs(r.sampledProbeAxialMm - 9.1) < 1e-12);
  const last = r.frames.at(-1)!.pressureBar;
  assert.ok(last.every((p, i) => Math.abs(p - recorded.field.pressureBar[i]) < 1e-10));
  assert.ok(r.meanProbePressureBar! > 0);
  assert.equal(compareAyersExperiment(recorded).executionCompleted, false);
  const close = structuredClone(recorded); close.recording!.meanProbePressureBar = 1.10;
  assert.equal(compareAyersExperiment(close).status, "not-validated");
  assert.equal(compareAyersExperiment(close).descriptiveDifferencePct, 0);
  const foreign = { ...recorded, designId: "other" };
  assert.throws(() => compareAyersExperiment(foreign), /this case/);
  const gif = encodePressureGif(r);
  assert.equal(new TextDecoder().decode(gif.slice(0, 6)), "GIF89a");
  assert.equal(gif.at(-1), 0x3b);
});

test("committed benchmark is tied to the solver source and real replay bytes", async () => {
  const report = JSON.parse(await readFile(new URL("../public/data/benchmarks/ayers-case-i-report.json", import.meta.url), "utf8"));
  for (const [path, digest] of [["../lib/fast-rde-2d.ts", report.solverSha256], ["../public/data/benchmarks/ayers-case-i-replay.json", report.replaySha256]]) {
    assert.equal(createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex"), digest);
  }
  for (const run of Object.values(report.runs) as Array<{ comparison: { status: string; executionCompleted: boolean } }>) {
    assert.equal(run.comparison.status, "not-validated");
    assert.equal(run.comparison.executionCompleted, true);
  }
});
