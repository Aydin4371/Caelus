"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import {
  ANALYSIS_VERSION,
  Comparison,
  REVIEW_THRESHOLDS,
  Signal,
  compareSignals,
  makeDemoSignals,
  parseSignalCsv,
  recommendationFor,
  serializeReport,
} from "@/lib/rde-analysis";

const CYAN = "#28d7ff";
const BLUE = "#4c8dff";
const AMBER = "#ffb43b";

function points(values: number[], width: number, height: number, min: number, max: number) {
  const range = Math.max(max - min, 1e-9);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function SignalChart({ comparison }: { comparison: Comparison }) {
  const all = [...comparison.test, ...comparison.cfd];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const start = comparison.time[0] ?? 0;
  const end = comparison.time.at(-1) ?? 0;
  return (
    <div className="chart-shell" role="img" aria-label="Aligned experimental and CFD pressure histories">
      <svg viewBox="0 0 760 260" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pressureGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={CYAN} stopOpacity="0.18" />
            <stop offset="1" stopColor={CYAN} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`v-${i}`} x1={(i * 760) / 6} y1="0" x2={(i * 760) / 6} y2="230" className="grid-line" />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h-${i}`} x1="0" y1={(i * 230) / 5} x2="760" y2={(i * 230) / 5} className="grid-line" />
        ))}
        <polyline points={points(comparison.cfd, 760, 230, min, max)} fill="none" stroke={BLUE} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <polyline points={points(comparison.test, 760, 230, min, max)} fill="none" stroke={CYAN} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis"><span>{start.toFixed(2)} ms</span><span>Aligned time</span><span>{end.toFixed(2)} ms</span></div>
    </div>
  );
}

function SpectrumChart({ comparison }: { comparison: Comparison }) {
  const maxFrequency = Math.min(
    Math.max(comparison.testFrequency, comparison.cfdFrequency) * 2.2,
    comparison.testSpectrum.frequency.at(-1) ?? 20,
  );
  const trim = (data: { frequency: number[]; amplitude: number[] }) => {
    const values = data.amplitude.map((value) => Math.log10(Math.max(value, 1e-5)));
    const filtered = values.filter((_, index) => data.frequency[index] <= maxFrequency);
    return filtered;
  };
  const test = trim(comparison.testSpectrum);
  const cfd = trim(comparison.cfdSpectrum);
  const all = [...test, ...cfd];
  const min = Math.min(...all);
  const max = Math.max(...all);
  return (
    <div className="chart-shell" role="img" aria-label="Frequency spectra for experimental and CFD pressure signals">
      <svg viewBox="0 0 560 260" preserveAspectRatio="none">
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`v-${i}`} x1={(i * 560) / 6} y1="0" x2={(i * 560) / 6} y2="230" className="grid-line" />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h-${i}`} x1="0" y1={(i * 230) / 5} x2="560" y2={(i * 230) / 5} className="grid-line" />
        ))}
        <polyline points={points(cfd, 560, 230, min, max)} fill="none" stroke={BLUE} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <polyline points={points(test, 560, 230, min, max)} fill="none" stroke={CYAN} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis"><span>0</span><span>Frequency (kHz)</span><span>{maxFrequency.toFixed(1)}</span></div>
    </div>
  );
}

function ResidualChart({ comparison }: { comparison: Comparison }) {
  const residual = comparison.test.map((value, index) => value - comparison.cfd[index]);
  const bound = Math.max(...residual.map(Math.abs), 1e-4);
  const start = comparison.time[0] ?? 0;
  const end = comparison.time.at(-1) ?? 0;
  return (
    <div className="chart-shell residual-chart" role="img" aria-label="Experimental pressure minus CFD pressure after alignment">
      <svg viewBox="0 0 680 250" preserveAspectRatio="none">
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`v-${i}`} x1={(i * 680) / 6} y1="0" x2={(i * 680) / 6} y2="220" className="grid-line" />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h-${i}`} x1="0" y1={(i * 220) / 4} x2="680" y2={(i * 220) / 4} className="grid-line" />
        ))}
        <line x1="0" y1="110" x2="680" y2="110" className="zero-line" />
        <polyline points={points(residual, 680, 220, -bound, bound)} fill="none" stroke={AMBER} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis"><span>{start.toFixed(2)} ms</span><span>Residual: test − CFD (MPa)</span><span>{end.toFixed(2)} ms</span></div>
    </div>
  );
}

export default function Home() {
  const demo = useMemo(() => makeDemoSignals(), []);
  const [testSignal, setTestSignal] = useState<Signal>(demo.test);
  const [cfdSignal, setCfdSignal] = useState<Signal>(demo.cfd);
  const [testPending, setTestPending] = useState<Signal | null>(null);
  const [cfdPending, setCfdPending] = useState<Signal | null>(null);
  const [showLoader, setShowLoader] = useState(false);
  const [error, setError] = useState("");
  const [sourceMode, setSourceMode] = useState<"demo" | "uploaded">("demo");
  const testInput = useRef<HTMLInputElement>(null);
  const cfdInput = useRef<HTMLInputElement>(null);

  const comparison = useMemo(() => compareSignals(testSignal, cfdSignal), [testSignal, cfdSignal]);
  const recommendation = recommendationFor(comparison);
  const status = comparison.score >= 0.72 ? "HIGH AGREEMENT" : comparison.score >= 0.45 ? "REVIEW" : "LOW AGREEMENT";

  async function readFile(event: ChangeEvent<HTMLInputElement>, kind: "test" | "cfd") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setError("");
      const signal = parseSignalCsv(await file.text(), file.name);
      if (kind === "test") setTestPending(signal);
      else setCfdPending(signal);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read the CSV file.");
    }
  }

  function applyFiles() {
    if (!testPending || !cfdPending) {
      setError("Choose both a hot-fire test file and a CFD probe file.");
      return;
    }
    const overlapStart = Math.max(testPending.time[0], cfdPending.time[0]);
    const overlapEnd = Math.min(testPending.time.at(-1) ?? 0, cfdPending.time.at(-1) ?? 0);
    if (overlapEnd <= overlapStart) {
      setError("The two files do not have an overlapping time range.");
      return;
    }
    setTestSignal(testPending);
    setCfdSignal(cfdPending);
    setSourceMode("uploaded");
    setShowLoader(false);
    setError("");
  }

  function resetDemo() {
    setTestSignal(demo.test);
    setCfdSignal(demo.cfd);
    setTestPending(null);
    setCfdPending(null);
    setSourceMode("demo");
  }

  function downloadExample() {
    const rows = ["time_ms,pressure_MPa", ...demo.test.time.slice(0, 600).map((time, i) => `${time.toFixed(6)},${demo.test.pressure[i].toFixed(6)}`)];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "caelus-example-test.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadReport() {
    const report = serializeReport(comparison, {
      test: testSignal.name,
      cfd: cfdSignal.name,
    });
    const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "caelus-rde-comparison-report.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="console">
      <aside className="rail" aria-label="Application navigation">
        <div className="mark" aria-label="Caelus">C</div>
        <nav>
          <button className="rail-button active" aria-label="Validation dashboard">⌁</button>
          <button className="rail-button" aria-label="Datasets" onClick={() => setShowLoader(true)}>▦</button>
          <button className="rail-button" aria-label="Operating envelope">◎</button>
          <button className="rail-button" aria-label="Reports">▤</button>
        </nav>
        <button className="rail-button rail-bottom" aria-label="About this prototype">?</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>CAELUS <span>/ RDE ENVELOPE</span></h1>
            <p>Simulation-to-test validation console</p>
          </div>
          <div className="top-actions">
            <span className="prototype-label">RESEARCH PROTOTYPE v{ANALYSIS_VERSION} · {sourceMode === "demo" ? "SYNTHETIC DATA" : "LOCAL DATA"}</span>
            {sourceMode === "uploaded" && <button className="ghost-button" onClick={resetDemo}>Reset demo</button>}
            <button className="load-button" onClick={() => setShowLoader(true)}>↑ Load dataset</button>
          </div>
        </header>

        <div className="runbar">
          <span className={`status-pill ${status === "HIGH AGREEMENT" ? "good" : status === "REVIEW" ? "warn" : "bad"}`}>{status}</span>
          <span>Test: {testSignal.name}</span>
          <i />
          <span>CFD: {cfdSignal.name}</span>
          <i />
          <span>{comparison.time.length.toLocaleString()} aligned samples</span>
          <span className="local-note">Computed locally in browser</span>
        </div>

        <section className="metrics" aria-label="Validation metrics">
          <article className="metric-card">
            <div className="metric-icon">⌁</div>
            <div><span>Agreement score</span><strong>{comparison.score.toFixed(2)}</strong><small>Prototype composite</small></div>
          </article>
          <article className="metric-card">
            <div className="metric-icon">∿</div>
            <div><span>Dominant frequency</span><strong>{comparison.testFrequency.toFixed(2)} <b>kHz</b></strong><small>CFD {comparison.cfdFrequency.toFixed(2)} kHz</small></div>
          </article>
          <article className="metric-card">
            <div className="metric-icon">⊙</div>
            <div><span>Amplitude error</span><strong>{(comparison.amplitudeError * 100).toFixed(1)}<b>%</b></strong><small>Pressure RMS basis</small></div>
          </article>
          <article className="metric-card amber-card">
            <div className="metric-icon">Δt</div>
            <div><span>Alignment lag</span><strong>{Math.abs(comparison.phaseLagUs).toFixed(1)} <b>µs</b></strong><small>Cross-correlation</small></div>
          </article>
          <article className="score-gauge">
            <div className="gauge" style={{ "--score": `${comparison.score * 270}deg` } as React.CSSProperties}><span>{comparison.score.toFixed(2)}</span></div>
            <small>Agreement index</small>
          </article>
        </section>

        <section className="chart-grid">
          <article className="panel pressure-panel">
            <div className="panel-heading"><div><h2>Pressure history</h2><p>Phase-aligned probe comparison</p></div><div className="legend"><span className="test-key">Test</span><span className="cfd-key">CFD</span></div></div>
            <SignalChart comparison={comparison} />
          </article>
          <article className="panel spectrum-panel">
            <div className="panel-heading"><div><h2>Frequency comparison</h2><p>Detrended pressure spectrum</p></div><div className="legend"><span className="test-key">Test</span><span className="cfd-key">CFD</span></div></div>
            <SpectrumChart comparison={comparison} />
          </article>
        </section>

        <section className="bottom-grid">
          <article className="panel residual-panel">
            <div className="panel-heading"><div><h2>Pressure residual</h2><p>What the CFD still misses after phase alignment</p></div><div className="legend"><span className="residual-key">Test − CFD</span></div></div>
            <ResidualChart comparison={comparison} />
            <div className="campaign-lock"><span>OPERATING ENVELOPE LOCKED</span><p>One signal pair validates one operating point. An envelope requires at least five paired runs plus inlet temperature, pressure, equivalence ratio, and stability metadata.</p></div>
          </article>
          <article className="panel recommendation-panel">
            <div className="recommendation-title"><span>⌬</span><div><small>RECOMMENDATION</small><h2>{recommendation.title}</h2></div></div>
            <p>{recommendation.detail}</p>
            <div className="evidence-table" aria-label="Evidence used for the recommendation">
              <div><span>Evidence</span><span>Test</span><span>CFD</span><span>Flag</span></div>
              <div><b>Peak frequency</b><span>{comparison.testFrequency.toFixed(2)}</span><span>{comparison.cfdFrequency.toFixed(2)} kHz</span><em className={comparison.frequencyError <= REVIEW_THRESHOLDS.maximumFrequencyError ? "pass" : "review"}>{comparison.frequencyError <= REVIEW_THRESHOLDS.maximumFrequencyError ? "PASS" : "REVIEW"}</em></div>
              <div><b>Amplitude</b><span>{comparison.testAmplitude.toFixed(3)} MPa</span><span>{comparison.cfdAmplitude.toFixed(3)} MPa</span><em className={comparison.amplitudeError <= REVIEW_THRESHOLDS.maximumAmplitudeError ? "pass" : "review"}>{comparison.amplitudeError <= REVIEW_THRESHOLDS.maximumAmplitudeError ? "PASS" : "REVIEW"}</em></div>
              <div><b>Waveform</b><span>correlation</span><span>{comparison.correlation.toFixed(3)}</span><em className={comparison.correlation >= REVIEW_THRESHOLDS.minimumCorrelation ? "pass" : "review"}>{comparison.correlation >= REVIEW_THRESHOLDS.minimumCorrelation ? "PASS" : "REVIEW"}</em></div>
            </div>
            <p className="recommendation-evidence">Basis: {recommendation.evidence}</p>
            <div className="next-step"><div><small>NEXT STEP</small><strong>{sourceMode === "demo" ? "Upload paired pressure histories." : "Review the ranked discrepancy evidence."}</strong></div><button className="ghost-button" onClick={downloadReport}>Download report</button></div>
          </article>
        </section>
      </section>

      {showLoader && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowLoader(false)}>
          <section className="loader-modal" role="dialog" aria-modal="true" aria-labelledby="loader-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setShowLoader(false)} aria-label="Close dataset loader">×</button>
            <p className="eyebrow">LOCAL ANALYSIS</p>
            <h2 id="loader-title">Load paired pressure histories</h2>
            <p className="modal-copy">Choose one hot-fire test export and one matching CFD virtual-probe export. Files are analyzed in this browser session and are not stored by the prototype.</p>
            <div className="upload-grid">
              <button className={`upload-box ${testPending ? "loaded" : ""}`} onClick={() => testInput.current?.click()}>
                <span>01 / TEST</span><strong>{testPending?.name ?? "Choose hot-fire CSV"}</strong><small>time_ms, pressure_MPa</small>
              </button>
              <button className={`upload-box ${cfdPending ? "loaded" : ""}`} onClick={() => cfdInput.current?.click()}>
                <span>02 / CFD</span><strong>{cfdPending?.name ?? "Choose virtual-probe CSV"}</strong><small>time_ms, pressure_MPa</small>
              </button>
              <input ref={testInput} type="file" accept=".csv,.txt" onChange={(event) => readFile(event, "test")} hidden />
              <input ref={cfdInput} type="file" accept=".csv,.txt" onChange={(event) => readFile(event, "cfd")} hidden />
            </div>
            {error && <p className="error-message">{error}</p>}
            <div className="modal-actions"><button className="text-button" onClick={downloadExample}>Download format example</button><button className="load-button" onClick={applyFiles}>Analyze pair →</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
