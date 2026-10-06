"use client";

import { useEffect, useRef, useState } from "react";
import { AYERS_EXPERIMENT as experiment, AYERS_MODEL_LIMITATIONS, AYERS_RUNS, ayersBenchmarkCase, ayersRunSettings, compareAyersExperiment, runAyersBenchmark, type AyersRunId } from "@/lib/ayers-rde-benchmark";
import { encodePressureGif, pressureColor, recordingPressureRange } from "@/lib/benchmark-replay";
import type { FastRde2dResult } from "@/lib/fast-rde-2d";

type Report = { gridSensitivityPct: number | null; timeStepSensitivityPct: number | null; generatedAt: string; solverSha256: string; runs: Record<AyersRunId, { comparison: ReturnType<typeof compareAyersExperiment> }> };
const formatted = (value: number | null | undefined, digits = 2) => value == null ? "Not available" : value.toFixed(digits);
function download(value: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExperimentBenchmark() {
  const [result, setResult] = useState<FastRde2dResult | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [runId, setRunId] = useState<AyersRunId>("baseline");
  const [shownId, setShownId] = useState<AyersRunId>("baseline");
  const [busy, setBusy] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([fetch("/data/benchmarks/ayers-case-i-replay.json", { signal: abort.signal }), fetch("/data/benchmarks/ayers-case-i-report.json", { signal: abort.signal })])
      .then(async ([replay, savedReport]) => {
        if (!replay.ok || !savedReport.ok) throw new Error("The saved benchmark could not be loaded. You can run it below.");
        const value = await replay.json() as FastRde2dResult;
        compareAyersExperiment(value);
        const summary = await savedReport.json() as Report;
        if (!abort.signal.aborted) { setResult(value); setReport(summary); }
      }).catch((reason: Error) => { if (!abort.signal.aborted) setError(reason.message); })
      .finally(() => { if (!abort.signal.aborted) setLoadingSaved(false); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  const recording = result?.recording;
  const frame = recording?.frames[frameIndex];
  const comparison = result ? compareAyersExperiment(result) : null;
  const [low, high] = recording ? recordingPressureRange(recording) : [0, 1];
  useEffect(() => {
    if (!canvas.current || !recording || !frame) return;
    const context = canvas.current.getContext("2d"); if (!context) return;
    const pixels = context.createImageData(recording.nx, recording.ny);
    for (let y = 0; y < recording.ny; y++) for (let x = 0; x < recording.nx; x++) {
      const source = (recording.ny - 1 - y) * recording.nx + x;
      const color = pressureColor((frame.pressureBar[source] - low) / (high - low || 1));
      const target = (y * recording.nx + x) * 4;
      pixels.data.set([...color, 255], target);
    }
    context.putImageData(pixels, 0, 0);
  }, [recording, frame, low, high]);
  useEffect(() => {
    if (!playing || !recording || !frame) return;
    if (frameIndex >= recording.frames.length - 1) return;
    const duration = recording.frames.at(-1)!.timeMs - recording.frames[0].timeMs || 1;
    const delay = 6000 * (recording.frames[frameIndex + 1].timeMs - frame.timeMs) / duration;
    const timer = setTimeout(() => {
      setFrameIndex(frameIndex + 1);
      if (frameIndex + 1 === recording.frames.length - 1) setPlaying(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [playing, recording, frame, frameIndex]);
  async function run() {
    setBusy(true); setProgress(0); setError(""); setPlaying(false);
    const abort = new AbortController(); controller.current = abort;
    try {
      const calculated = await runAyersBenchmark(runId, { signal: abort.signal, onProgress: (p) => setProgress(p.fraction) });
      if (!abort.signal.aborted) { setResult(calculated); setShownId(runId); setFrameIndex(0); }
    } catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Benchmark failed."); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  const caseDefinition = ayersBenchmarkCase();
  return <section className="experiment-benchmark" aria-labelledby="experiment-benchmark-title">
    <header><span className="workspace-label">PUBLISHED EXPERIMENT → MODEL CHECK</span><h1 id="experiment-benchmark-title">Test the model against a real RDE</h1><p>{experiment.title} · Configuration A, case (i)</p><a href={experiment.url} target="_blank" rel="noreferrer">Read the experiment ↗</a></header>
    <div className="benchmark-context"><article><h2>Measured in the experiment</h2><strong>1.10 bar</strong><p>Reported mean chamber pressure, 9.1 mm from the inlet.</p><p>{experiment.observedMode}. Fully premixed hydrogen–air at φ = 1.03.</p></article><article><h2>What this comparison tests</h2><p>Run our existing 2D model using the reported case inputs. Inspect the calculated pressure frames and compare its mean with the measurement.</p><p><b>Development benchmark · not validated.</b> The inlet model and sampling interval do not yet match the experiment.</p></article></div>
    <details className="benchmark-source"><summary>Geometry, inputs, and known differences</summary><dl><div><dt>Annulus diameters / length</dt><dd>120.9 / 135.6 mm · 138.1 mm</dd></div><div><dt>Mass flux / derived total flow</dt><dd>55 kg/(m²·s) · {caseDefinition.condition.massFlowKgS.toFixed(6)} kg/s</dd></div><div><dt>Manifold conditions</dt><dd>8.9 bar · 295 K</dd></div><div><dt>Reference</dt><dd>{experiment.sourceLocator}</dd></div></dl><p>{experiment.geometryNote}</p><ul>{AYERS_MODEL_LIMITATIONS.map((note) => <li key={note}>{note}</li>)}</ul><p>Measurement uncertainty was not supplied for this scalar in Table 1; no acceptance tolerance is invented.</p></details>
    <div className="benchmark-run-controls"><label>Run configuration<select disabled={busy} value={runId} onChange={(e) => setRunId(e.target.value as AyersRunId)}>{Object.entries(AYERS_RUNS).map(([id, run]) => <option key={id} value={id}>{run.label} · {run.circumferentialCells} × {run.axialCells} · max Δt {run.timeStepNs} ns</option>)}</select></label><button className="button primary" disabled={busy || loadingSaved} onClick={() => void run()}>{loadingSaved ? "Loading recorded run…" : busy ? `Calculating ${Math.round(progress * 100)}%` : "Run benchmark"}</button>{busy && <button className="button secondary" onClick={() => controller.current?.abort()}>Cancel</button>}</div>
    {error && <p role="alert">{error}</p>}
    {result && recording && frame && comparison && <>
      <div className="benchmark-playback"><header><div><h2>Calculated firing · {AYERS_RUNS[shownId].label}</h2><p>Unwrapped 2D pressure field · saved solver frames · slowed playback</p></div><strong>{frame.timeMs.toFixed(4)} ms</strong></header><div className="benchmark-canvas-wrap"><span>Outlet · 138.1 mm</span><canvas ref={canvas} width={recording.nx} height={recording.ny} aria-label={`Calculated pressure at ${frame.timeMs.toFixed(4)} milliseconds; not experimental footage`} /><span>Inlet · 0 mm &nbsp; | &nbsp; Circumference: 0° → 360°</span></div><div className="benchmark-colorbar"><span>{low.toFixed(2)} bar</span><i style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((fraction) => `rgb(${pressureColor(fraction).join(",")})`).join(",")})` }} /><span>{high.toFixed(2)} bar</span></div><div className="benchmark-player-controls"><button className="button secondary" onClick={() => { if (frameIndex === recording.frames.length - 1) setFrameIndex(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</button><input aria-label="Simulation time" type="range" min={0} max={recording.frames.length - 1} value={frameIndex} onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} /><button className="button secondary" onClick={() => download(encodePressureGif(recording) as BlobPart, "ayers-calculated-pressure.gif", "image/gif")}>Download GIF</button></div><p>This is our calculated flow, not a camera recording or a reproduced experimental firing. The color scale is fixed across frames.</p></div>
      <div className="benchmark-comparison"><h2>Measurement vs current model</h2><table><thead><tr><th>Quantity</th><th>Experiment</th><th>Current calculation</th></tr></thead><tbody><tr><th>Mean pressure</th><td>1.10 bar</td><td>{formatted(comparison.calculatedMeanPressureBar)} bar</td></tr><tr><th>Difference from reported mean</th><td>Reference</td><td>{formatted(comparison.descriptiveDifferencePct, 1)}%</td></tr><tr><th>Time interval</th><td>Established experimental firing</td><td>{recording.averagingStartMs.toFixed(2)}–{recording.averagingEndMs.toFixed(2)} ms after numerical initialization</td></tr><tr><th>Wave behaviour</th><td>Counterpropagating pair</td><td>Direction agreement not established</td></tr><tr><th>Numerical mass balance</th><td>—</td><td>{result.screeningDiagnostics.massConservationErrorPct.toExponential(2)}% error</td></tr></tbody></table><p>{comparison.interpretation}</p><p><b>Next modelling task:</b> represent the porous injector boundary before interpreting pressure agreement. Passing conservation does not repair a boundary-condition mismatch.</p><button className="button secondary" onClick={() => download(JSON.stringify({ experiment, settings: ayersRunSettings(shownId), comparison, limitations: AYERS_MODEL_LIMITATIONS, result }, null, 2), "ayers-benchmark-result.json", "application/json")}>Download this run</button></div>
    </>}
    {report && <details className="benchmark-source"><summary>Recorded numerical sensitivity study</summary><p>Three independently executed cases; geometry, chemistry, and 0.5–1 ms averaging interval held fixed. These values describe the bundled study, not any new run above.</p><table><thead><tr><th>Run</th><th>Mean pressure (bar)</th><th>Difference from experiment</th></tr></thead><tbody>{Object.entries(report.runs).map(([id, run]) => <tr key={id}><th>{AYERS_RUNS[id as AyersRunId].label}</th><td>{formatted(run.comparison.calculatedMeanPressureBar)}</td><td>{formatted(run.comparison.descriptiveDifferencePct, 1)}%</td></tr>)}</tbody></table><p>Grid change: {formatted(report.gridSensitivityPct)}% · time-step change: {formatted(report.timeStepSensitivityPct)}%. Two levels do not demonstrate asymptotic convergence.</p><a href="/data/benchmarks/ayers-case-i-report.json" download>Download study and source record</a></details>}
  </section>;
}
