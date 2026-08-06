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

const TEST_COLOR = "#57d7c8";
const CFD_COLOR = "#6e8cff";
const RESIDUAL_COLOR = "#f3b45b";

function polylinePoints(
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number,
  left = 0,
  top = 0,
) {
  const range = Math.max(max - min, 1e-9);
  return values
    .map((value, index) => {
      const x = left + (index / Math.max(values.length - 1, 1)) * width;
      const y = top + height - ((value - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function PlotGrid({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return (
    <>
      {Array.from({ length: 7 }, (_, index) => (
        <line
          key={`vertical-${index}`}
          x1={left + (index * width) / 6}
          y1={top}
          x2={left + (index * width) / 6}
          y2={top + height}
          className="grid-line"
        />
      ))}
      {Array.from({ length: 5 }, (_, index) => (
        <line
          key={`horizontal-${index}`}
          x1={left}
          y1={top + (index * height) / 4}
          x2={left + width}
          y2={top + (index * height) / 4}
          className="grid-line"
        />
      ))}
    </>
  );
}

function SignalChart({ comparison }: { comparison: Comparison }) {
  const all = [...comparison.test, ...comparison.cfd];
  const minimum = Math.min(...all);
  const maximum = Math.max(...all);
  const middle = (minimum + maximum) / 2;
  const start = comparison.time[0] ?? 0;
  const end = comparison.time.at(-1) ?? 0;
  const midpoint = (start + end) / 2;
  const left = 58;
  const top = 12;
  const width = 690;
  const height = 222;

  return (
    <div className="chart" role="img" aria-label="Aligned test and CFD pressure histories in megapascals">
      <svg viewBox="0 0 770 278">
        <PlotGrid left={left} top={top} width={width} height={height} />
        <polyline
          points={polylinePoints(comparison.cfd, width, height, minimum, maximum, left, top)}
          fill="none"
          stroke={CFD_COLOR}
          strokeWidth="2.1"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={polylinePoints(comparison.test, width, height, minimum, maximum, left, top)}
          fill="none"
          stroke={TEST_COLOR}
          strokeWidth="2.1"
          vectorEffect="non-scaling-stroke"
        />
        <text x="5" y={top + 4} className="axis-value">{maximum.toFixed(2)}</text>
        <text x="5" y={top + height / 2 + 4} className="axis-value">{middle.toFixed(2)}</text>
        <text x="5" y={top + height + 4} className="axis-value">{minimum.toFixed(2)}</text>
        <text x={left} y="266" className="axis-value">{start.toFixed(2)}</text>
        <text x={left + width / 2} y="266" textAnchor="middle" className="axis-value">{midpoint.toFixed(2)}</text>
        <text x={left + width} y="266" textAnchor="end" className="axis-value">{end.toFixed(2)} ms</text>
        <text x="16" y="132" transform="rotate(-90 16 132)" textAnchor="middle" className="axis-title">PRESSURE (MPa)</text>
      </svg>
    </div>
  );
}

function SpectrumChart({ comparison }: { comparison: Comparison }) {
  const maximumFrequency = Math.min(
    Math.max(comparison.testFrequency, comparison.cfdFrequency) * 2.2,
    comparison.testSpectrum.frequency.at(-1) ?? 20,
  );
  const trim = (data: { frequency: number[]; amplitude: number[] }) =>
    data.amplitude
      .map((value, index) => ({ frequency: data.frequency[index], value: Math.log10(Math.max(value, 1e-5)) }))
      .filter((point) => point.frequency <= maximumFrequency);

  const testPoints = trim(comparison.testSpectrum);
  const cfdPoints = trim(comparison.cfdSpectrum);
  const test = testPoints.map((point) => point.value);
  const cfd = cfdPoints.map((point) => point.value);
  const all = [...test, ...cfd];
  const minimum = Math.min(...all);
  const maximum = Math.max(...all);
  const left = 46;
  const top = 12;
  const width = 514;
  const height = 222;
  const testPeakX = left + (comparison.testFrequency / maximumFrequency) * width;
  const cfdPeakX = left + (comparison.cfdFrequency / maximumFrequency) * width;

  return (
    <div className="chart" role="img" aria-label="Test and CFD pressure frequency spectra in kilohertz">
      <svg viewBox="0 0 580 278">
        <PlotGrid left={left} top={top} width={width} height={height} />
        <line x1={testPeakX} y1={top} x2={testPeakX} y2={top + height} className="test-peak" />
        <line x1={cfdPeakX} y1={top} x2={cfdPeakX} y2={top + height} className="cfd-peak" />
        <polyline points={polylinePoints(cfd, width, height, minimum, maximum, left, top)} fill="none" stroke={CFD_COLOR} strokeWidth="2.1" vectorEffect="non-scaling-stroke" />
        <polyline points={polylinePoints(test, width, height, minimum, maximum, left, top)} fill="none" stroke={TEST_COLOR} strokeWidth="2.1" vectorEffect="non-scaling-stroke" />
        <text x={left} y="266" className="axis-value">0</text>
        <text x={left + width / 2} y="266" textAnchor="middle" className="axis-value">{(maximumFrequency / 2).toFixed(1)}</text>
        <text x={left + width} y="266" textAnchor="end" className="axis-value">{maximumFrequency.toFixed(1)} kHz</text>
        <text x="14" y="132" transform="rotate(-90 14 132)" textAnchor="middle" className="axis-title">LOG AMPLITUDE</text>
      </svg>
    </div>
  );
}

function ResidualChart({ comparison }: { comparison: Comparison }) {
  const residual = comparison.test.map((value, index) => value - comparison.cfd[index]);
  const bound = Math.max(...residual.map(Math.abs), 1e-4);
  const start = comparison.time[0] ?? 0;
  const end = comparison.time.at(-1) ?? 0;
  const left = 58;
  const top = 12;
  const width = 690;
  const height = 190;

  return (
    <div className="chart residual-chart" role="img" aria-label="Test pressure minus CFD pressure residual in megapascals">
      <svg viewBox="0 0 770 244">
        <PlotGrid left={left} top={top} width={width} height={height} />
        <line x1={left} y1={top + height / 2} x2={left + width} y2={top + height / 2} className="zero-line" />
        <polyline points={polylinePoints(residual, width, height, -bound, bound, left, top)} fill="none" stroke={RESIDUAL_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text x="5" y={top + 4} className="axis-value">+{bound.toFixed(2)}</text>
        <text x="30" y={top + height / 2 + 4} className="axis-value">0</text>
        <text x="5" y={top + height + 4} className="axis-value">−{bound.toFixed(2)}</text>
        <text x={left} y="232" className="axis-value">{start.toFixed(2)}</text>
        <text x={left + width} y="232" textAnchor="end" className="axis-value">{end.toFixed(2)} ms</text>
        <text x="16" y="110" transform="rotate(-90 16 110)" textAnchor="middle" className="axis-title">TEST − CFD (MPa)</text>
      </svg>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Chart legend">
      <span><i className="legend-test" />Hot-fire test</span>
      <span><i className="legend-cfd" />CFD probe</span>
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
  const checks = [
    {
      id: "waveform",
      question: "Does CFD reproduce the wave shape?",
      label: "Waveform agreement",
      value: comparison.correlation.toFixed(3),
      detail: `Correlation · pass ≥ ${REVIEW_THRESHOLDS.minimumCorrelation.toFixed(2)}`,
      pass: comparison.correlation >= REVIEW_THRESHOLDS.minimumCorrelation,
    },
    {
      id: "frequency",
      question: "Does CFD predict the wave frequency?",
      label: "Dominant frequency error",
      value: `${(comparison.frequencyError * 100).toFixed(1)}%`,
      detail: `${comparison.testFrequency.toFixed(2)} test · ${comparison.cfdFrequency.toFixed(2)} CFD kHz`,
      pass: comparison.frequencyError <= REVIEW_THRESHOLDS.maximumFrequencyError,
    },
    {
      id: "amplitude",
      question: "Does CFD predict pressure magnitude?",
      label: "Pressure amplitude error",
      value: `${(comparison.amplitudeError * 100).toFixed(1)}%`,
      detail: `${comparison.testAmplitude.toFixed(3)} test · ${comparison.cfdAmplitude.toFixed(3)} CFD MPa`,
      pass: comparison.amplitudeError <= REVIEW_THRESHOLDS.maximumAmplitudeError,
    },
  ];
  const passCount = checks.filter((check) => check.pass).length;
  const assessmentClass = passCount === 3 ? "supported" : passCount === 2 ? "partial" : "disagreement";
  const assessmentLabel = passCount === 3 ? "SUPPORTED AT THIS POINT" : passCount === 2 ? "PARTIAL AGREEMENT" : "DISAGREEMENT";
  const assessmentTitle = !checks[0].pass
    ? "The simulated waveform does not reproduce the measured pressure behavior."
    : !checks[1].pass
      ? "The simulation misses the measured detonation frequency."
      : !checks[2].pass
        ? "Wave timing agrees, but the simulated pressure magnitude needs review."
        : "The simulation reproduces the measured pressure behavior at this operating point.";

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
    const rows = [
      "time_ms,pressure_MPa",
      ...demo.test.time.slice(0, 600).map((time, index) => `${time.toFixed(6)},${demo.test.pressure[index].toFixed(6)}`),
    ];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "concordia-example-test.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadReport() {
    const report = serializeReport(comparison, { test: testSignal.name, cfd: cfdSignal.name });
    const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "concordia-rde-validation-report.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <header className="product-header">
        <a className="brand" href="#top" aria-label="Concordia by Caelus home">
          <span className="brand-mark">C</span>
          <span><strong>CONCORDIA</strong><small>BY CAELUS</small></span>
        </a>
        <p>Simulation-to-test assurance for advanced propulsion</p>
        <div className="header-actions">
          <span className="prototype-tag">RESEARCH PROTOTYPE v{ANALYSIS_VERSION}</span>
          {sourceMode === "uploaded" && <button className="button secondary" onClick={resetDemo}>Reset demo</button>}
          <button className="button primary" onClick={() => setShowLoader(true)}>Compare data</button>
        </div>
      </header>

      <section className="content" id="top">
        <div className="context-row">
          <div>
            <span className={`data-dot ${sourceMode}`} />
            <strong>{sourceMode === "demo" ? "Synthetic demonstration" : "Local dataset"}</strong>
            <span>RDE pressure validation · one operating point</span>
          </div>
          <span>All calculations run locally in this browser</span>
        </div>

        <ol className="analysis-flow" aria-label="Analysis workflow">
          <li className="complete"><b>1</b><span><strong>Pair data</strong><small>Test + CFD probes</small></span></li>
          <li className="complete"><b>2</b><span><strong>Align signals</strong><small>{Math.abs(comparison.phaseLagUs).toFixed(1)} µs correction</small></span></li>
          <li className="complete"><b>3</b><span><strong>Test agreement</strong><small>3 quantitative checks</small></span></li>
          <li className="active"><b>4</b><span><strong>Decide next action</strong><small>{passCount}/3 checks pass</small></span></li>
        </ol>

        <section className="assessment-grid">
          <article className={`assessment-card ${assessmentClass}`}>
            <div className="section-kicker">CURRENT ASSESSMENT</div>
            <span className="assessment-status"><i />{assessmentLabel}</span>
            <h1>{assessmentTitle}</h1>
            <p>
              Concordia aligned {comparison.time.length.toLocaleString()} samples and compared wave shape,
              dominant frequency, and pressure amplitude. This result applies only to the loaded signal pair.
            </p>
            <div className="assessment-meta">
              <span><small>Checks passed</small><strong>{passCount} / 3</strong></span>
              <span><small>Prototype index</small><strong>{comparison.score.toFixed(2)}</strong></span>
              <span><small>Normalized RMSE</small><strong>{comparison.nrmse.toFixed(3)}</strong></span>
            </div>
          </article>

          <article className="action-card">
            <div className="section-kicker">RECOMMENDED NEXT ACTION</div>
            <span className="action-number">01</span>
            <h2>{recommendation.title}</h2>
            <p>{recommendation.detail}</p>
            <div className="evidence-basis"><small>WHY</small>{recommendation.evidence}</div>
            <button className="report-button" onClick={downloadReport}>Download evidence report <span>↓</span></button>
          </article>
        </section>

        <section className="dataset-strip" aria-label="Loaded dataset pair">
          <div className="dataset-label"><span>INPUT PAIR</span><strong>Matched pressure probes</strong></div>
          <div className="dataset-item test-source"><i /> <span><small>HOT-FIRE TEST</small><strong>{testSignal.name}</strong></span></div>
          <div className="pair-arrow" aria-hidden="true">↔</div>
          <div className="dataset-item cfd-source"><i /> <span><small>CFD VIRTUAL PROBE</small><strong>{cfdSignal.name}</strong></span></div>
          <button className="change-data" onClick={() => setShowLoader(true)}>Change pair</button>
        </section>

        <section className="evidence-section">
          <div className="section-heading">
            <div><span className="section-kicker">VALIDATION EVIDENCE</span><h2>What agrees—and what does not</h2></div>
            <p>Each check answers a distinct engineering question. Thresholds are transparent prototype review rules.</p>
          </div>
          <div className="check-grid">
            {checks.map((check, index) => (
              <article className="check-card" key={check.id}>
                <header><span>0{index + 1}</span><em className={check.pass ? "pass" : "review"}>{check.pass ? "PASS" : "REVIEW"}</em></header>
                <p>{check.question}</p>
                <strong>{check.value}</strong>
                <h3>{check.label}</h3>
                <small>{check.detail}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="charts-section">
          <article className="panel pressure-panel">
            <div className="panel-heading">
              <div><span className="section-kicker">ALIGNED SIGNALS</span><h2>Does the CFD reproduce the measured pressure trace?</h2><p>Cross-correlation shifts the CFD trace by less than half a dominant-wave period before comparison.</p></div>
              <Legend />
            </div>
            <SignalChart comparison={comparison} />
            <div className="chart-insight"><span>READOUT</span><p>After a <strong>{Math.abs(comparison.phaseLagUs).toFixed(1)} µs</strong> timing correction, waveform correlation is <strong>{comparison.correlation.toFixed(3)}</strong>.</p></div>
          </article>

          <article className="panel spectrum-panel">
            <div className="panel-heading">
              <div><span className="section-kicker">FREQUENCY CONTENT</span><h2>Does the CFD capture the dominant wave rate?</h2><p>Peak locations compare the measured and simulated detonation-cycle frequency.</p></div>
              <Legend />
            </div>
            <SpectrumChart comparison={comparison} />
            <div className="peak-readout">
              <span><i className="legend-test" /><small>Test peak</small><strong>{comparison.testFrequency.toFixed(2)} kHz</strong></span>
              <span><i className="legend-cfd" /><small>CFD peak</small><strong>{comparison.cfdFrequency.toFixed(2)} kHz</strong></span>
              <span><small>Difference</small><strong>{(comparison.frequencyError * 100).toFixed(1)}%</strong></span>
            </div>
          </article>

          <article className="panel residual-panel">
            <div className="panel-heading">
              <div><span className="section-kicker">MODEL DISCREPANCY</span><h2>Where does the simulation still miss the experiment?</h2><p>The residual is experimental pressure minus CFD pressure after timing alignment. Zero means exact local agreement.</p></div>
              <div className="residual-key"><i /> Test − CFD</div>
            </div>
            <SignalResidualLayout comparison={comparison} />
          </article>
        </section>

        <section className="envelope-lock">
          <div className="lock-icon">×</div>
          <div><span className="section-kicker">OPERATING ENVELOPE · NOT YET AVAILABLE</span><h2>One comparison validates one point—not an engine envelope.</h2><p>Add at least five matched runs with inlet temperature, pressure, equivalence ratio, mass flow, and observed stability before mapping operability.</p></div>
          <div className="envelope-progress"><strong>1 / 5</strong><span>minimum paired runs</span><i><b /></i></div>
        </section>

        <footer>
          <span>CONCORDIA v{ANALYSIS_VERSION} · deterministic analysis engine</span>
          <span>Research use only · not a validation probability or certification result</span>
        </footer>
      </section>

      {showLoader && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowLoader(false)}>
          <section className="loader-modal" role="dialog" aria-modal="true" aria-labelledby="loader-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setShowLoader(false)} aria-label="Close dataset loader">×</button>
            <span className="section-kicker">NEW COMPARISON</span>
            <h2 id="loader-title">Load a matched pressure-signal pair</h2>
            <p>Choose a hot-fire sensor export and the CFD virtual probe from the same location, operating condition, and time window.</p>
            <div className="upload-grid">
              <button className={`upload-box ${testPending ? "loaded" : ""}`} onClick={() => testInput.current?.click()}>
                <span>01 · EXPERIMENT</span><strong>{testPending?.name ?? "Choose hot-fire CSV"}</strong><small>Required columns: time + pressure</small>
              </button>
              <button className={`upload-box ${cfdPending ? "loaded" : ""}`} onClick={() => cfdInput.current?.click()}>
                <span>02 · SIMULATION</span><strong>{cfdPending?.name ?? "Choose CFD probe CSV"}</strong><small>Required columns: time + pressure</small>
              </button>
              <input ref={testInput} type="file" accept=".csv,.txt" onChange={(event) => readFile(event, "test")} hidden />
              <input ref={cfdInput} type="file" accept=".csv,.txt" onChange={(event) => readFile(event, "cfd")} hidden />
            </div>
            <div className="format-note"><strong>Preferred format</strong><code>time_ms, pressure_MPa</code><button onClick={downloadExample}>Download example</button></div>
            {error && <p className="error-message">{error}</p>}
            <div className="modal-actions"><button className="button secondary" onClick={() => setShowLoader(false)}>Cancel</button><button className="button primary" onClick={applyFiles}>Run comparison →</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

function SignalResidualLayout({ comparison }: { comparison: Comparison }) {
  return (
    <div className="residual-layout">
      <ResidualChart comparison={comparison} />
      <div className="residual-stats">
        <div><small>RMSE</small><strong>{comparison.rmse.toFixed(3)} <span>MPa</span></strong><p>Average residual magnitude</p></div>
        <div><small>PRESSURE BIAS</small><strong>{comparison.pressureBias >= 0 ? "+" : ""}{comparison.pressureBias.toFixed(3)} <span>MPa</span></strong><p>CFD mean minus test mean</p></div>
        <div><small>ALIGNMENT LAG</small><strong>{Math.abs(comparison.phaseLagUs).toFixed(1)} <span>µs</span></strong><p>Applied timing correction</p></div>
      </div>
    </div>
  );
}
