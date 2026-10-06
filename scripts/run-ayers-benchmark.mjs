import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AYERS_EXPERIMENT, AYERS_MODEL_LIMITATIONS, ayersBenchmarkCase, ayersRunSettings, compareAyersExperiment, runAyersBenchmark } from "../lib/ayers-rde-benchmark.ts";

const runs = {};
for (const id of ["baseline", "mesh", "time"]) {
  const result = await runAyersBenchmark(id);
  const comparison = compareAyersExperiment(result);
  runs[id] = { settings: ayersRunSettings(id), comparison, diagnostics: result.screeningDiagnostics,
    sampledProbeAxialMm: result.recording.sampledProbeAxialMm };
  if (id === "baseline") {
    const replay = { ...result, screeningDiagnostics: { ...result.screeningDiagnostics, elapsedMs: Math.round(result.screeningDiagnostics.elapsedMs) } };
    await mkdir("public/data/benchmarks", { recursive: true });
    await writeFile("public/data/benchmarks/ayers-case-i-replay.json", JSON.stringify(replay, (key, value) =>
      typeof value === "number" ? Number(value.toPrecision(8)) : value));
  }
  console.log(id, JSON.stringify(runs[id]));
}
const base = runs.baseline.comparison.calculatedMeanPressureBar;
const relative = (id) => base === null || base === 0 || runs[id].comparison.calculatedMeanPressureBar === null ? null :
  100 * Math.abs(runs[id].comparison.calculatedMeanPressureBar - base) / Math.abs(base);
const report = {
  schema: "kythros-ayers-benchmark-report-v1", generatedAt: new Date().toISOString(),
  source: AYERS_EXPERIMENT, case: ayersBenchmarkCase(), limitations: AYERS_MODEL_LIMITATIONS,
  solverSha256: createHash("sha256").update(readFileSync("lib/fast-rde-2d.ts")).digest("hex"),
  replaySha256: createHash("sha256").update(readFileSync("public/data/benchmarks/ayers-case-i-replay.json")).digest("hex"),
  runs, gridSensitivityPct: relative("mesh"), timeStepSensitivityPct: relative("time"),
  status: "not-validated", note: "These are actual Kythros Fast 2D runs. Neither a small scalar discrepancy nor small numerical sensitivity establishes experimental validation. The point probe is interpolated to the same physical location on each mesh.",
};
await writeFile("public/data/benchmarks/ayers-case-i-report.json", JSON.stringify(report, null, 2) + "\n");
