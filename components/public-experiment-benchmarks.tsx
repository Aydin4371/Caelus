"use client";

import { useState } from "react";
import { analyzePublicPressureBenchmark, parsePublicPressureBenchmark, type PublicPressureBenchmark } from "@/lib/public-pressure-benchmark";
import type { RdeModeResult } from "@/lib/wave-dynamics";

const CASES = [
  { id: "BD0041", label: "2CR", file: "/data/benchmarks/zenodo-bd0041.json" },
  { id: "BD0038", label: "2CRT", file: "/data/benchmarks/zenodo-bd0038.json" },
  { id: "CE2029", label: "DS2", file: "/data/benchmarks/zenodo-ce2029.json" },
] as const;

type Result = { benchmark: PublicPressureBenchmark; analysis: RdeModeResult; positions: number[]; excludedDuplicateProbeCount: number; evidenceRole: string };

export function PublicExperimentBenchmarks() {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  async function run(file: string, id: string) {
    setLoading(id); setError("");
    try {
      const response = await fetch(file);
      if (!response.ok) throw new Error(`The ${id} benchmark could not be loaded.`);
      const analyzed = analyzePublicPressureBenchmark(parsePublicPressureBenchmark(await response.text()));
      setResult(analyzed);
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "The public benchmark could not be analyzed.");
    } finally { setLoading(""); }
  }

  return <section className="public-benchmark-card" aria-label="Public experimental RDE analyzer checks">
    <div className="public-benchmark-heading"><div><span>REAL EXPERIMENT · NO MATCHED CFD</span><h2>Public pressure-record analyzer check</h2><p>Run Kythros on compact, checksum-locked records extracted from the TU Berlin Zenodo archive. These are real pressure measurements, but their processed amplitude unit is not MPa and the archive contains no matched CFD.</p></div><a href="https://doi.org/10.5281/zenodo.18886925" target="_blank" rel="noreferrer">Open source dataset</a></div>
    <div className="public-benchmark-actions">{CASES.map((item) => <button key={item.id} className="button secondary" disabled={Boolean(loading)} onClick={() => run(item.file, item.id)}>{loading === item.id ? "Analyzing…" : `${item.id} · ${item.label}`}</button>)}</div>
    {result && <div className="public-benchmark-result"><header><div><span>SOURCE LABEL</span><strong>{result.benchmark.modeLabel} · {result.benchmark.modeDescription}</strong></div><b>{result.analysis.identifiability === "Identified" ? "IDENTIFIED" : "WITHHELD"}</b></header><dl><div><dt>Primary passage frequency</dt><dd>{result.analysis.waveFrequencyKHz.toFixed(3)} kHz</dd></div><div><dt>Unique probe azimuths</dt><dd>{result.positions.length}{result.excludedDuplicateProbeCount ? ` · ${result.excludedDuplicateProbeCount} duplicate positions excluded` : ""}</dd></div><div><dt>Kythros mode result</dt><dd>{result.analysis.identifiability}{result.analysis.complexModeDetected ? " · multiple non-harmonic components detected" : ""}</dd></div><div><dt>Pressure amplitude</dt><dd>Not interpreted · source-processed channel unit</dd></div></dl><p>{result.evidenceRole}</p></div>}
    {error && <p className="mapper-error">{error}</p>}
  </section>;
}
