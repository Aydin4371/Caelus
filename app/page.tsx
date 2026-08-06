"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  ANALYSIS_VERSION,
  Comparison,
  REVIEW_THRESHOLDS,
  Signal,
  analyzeRdeProbeSet,
  compareSignals,
  makeDemoProbeSignals,
  parseProbeCsv,
  recommendationFor,
} from "@/lib/rde-analysis";

const TEST_COLOR = "#54cfc1";
const CFD_COLOR = "#7188f4";
const RESIDUAL_COLOR = "#eab064";

type CaseMetadata = {
  name: string;
  annulusMeanDiameterMm: number;
  probePositionsDeg: number[];
  inletPressureBar: number;
  inletTemperatureK: number;
  equivalenceRatio: number;
  massFlowKgS: number;
  solver: string;
  turbulenceModel: string;
  chemistryModel: string;
  meshCells: number;
  timeStepUs: number;
  pressureUncertaintyPct: number;
  timingUncertaintyUs: number;
};

const DEMO_METADATA: CaseMetadata = {
  name: "Synthetic RDE operating point",
  annulusMeanDiameterMm: 82,
  probePositionsDeg: [0, 110, 245],
  inletPressureBar: 8,
  inletTemperatureK: 300,
  equivalenceRatio: 1,
  massFlowKgS: 0.62,
  solver: "Research CFD solver",
  turbulenceModel: "SST k-ω",
  chemistryModel: "Finite-rate, 9 species",
  meshCells: 2_400_000,
  timeStepUs: 0.25,
  pressureUncertaintyPct: 1.5,
  timingUncertaintyUs: 0.5,
};

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

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
        <line key={`v-${index}`} x1={left + (index * width) / 6} y1={top} x2={left + (index * width) / 6} y2={top + height} className="grid-line" />
      ))}
      {Array.from({ length: 5 }, (_, index) => (
        <line key={`h-${index}`} x1={left} y1={top + (index * height) / 4} x2={left + width} y2={top + (index * height) / 4} className="grid-line" />
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
  const left = 60;
  const top = 12;
  const width = 700;
  const height = 232;

  return (
    <div className="chart" role="img" aria-label="Aligned experimental and CFD pressure histories">
      <svg viewBox="0 0 790 286">
        <PlotGrid left={left} top={top} width={width} height={height} />
        <polyline points={polylinePoints(comparison.cfd, width, height, minimum, maximum, left, top)} fill="none" stroke={CFD_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <polyline points={polylinePoints(comparison.test, width, height, minimum, maximum, left, top)} fill="none" stroke={TEST_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text x="7" y={top + 4} className="axis-value">{maximum.toFixed(2)}</text>
        <text x="7" y={top + height / 2 + 4} className="axis-value">{middle.toFixed(2)}</text>
        <text x="7" y={top + height + 4} className="axis-value">{minimum.toFixed(2)}</text>
        <text x={left} y="276" className="axis-value">{start.toFixed(2)}</text>
        <text x={left + width} y="276" textAnchor="end" className="axis-value">{end.toFixed(2)} ms</text>
        <text x="17" y="132" transform="rotate(-90 17 132)" textAnchor="middle" className="axis-title">PRESSURE (MPa)</text>
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
  const left = 52;
  const top = 12;
  const width = 708;
  const height = 232;

  return (
    <div className="chart" role="img" aria-label="Experimental and CFD pressure spectra">
      <svg viewBox="0 0 790 286">
        <PlotGrid left={left} top={top} width={width} height={height} />
        <polyline points={polylinePoints(cfd, width, height, minimum, maximum, left, top)} fill="none" stroke={CFD_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <polyline points={polylinePoints(test, width, height, minimum, maximum, left, top)} fill="none" stroke={TEST_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text x={left} y="276" className="axis-value">0</text>
        <text x={left + width / 2} y="276" textAnchor="middle" className="axis-value">{(maximumFrequency / 2).toFixed(1)}</text>
        <text x={left + width} y="276" textAnchor="end" className="axis-value">{maximumFrequency.toFixed(1)} kHz</text>
        <text x="15" y="132" transform="rotate(-90 15 132)" textAnchor="middle" className="axis-title">LOG AMPLITUDE</text>
      </svg>
    </div>
  );
}

function ResidualChart({ comparison }: { comparison: Comparison }) {
  const residual = comparison.test.map((value, index) => value - comparison.cfd[index]);
  const bound = Math.max(...residual.map(Math.abs), 1e-4);
  const start = comparison.time[0] ?? 0;
  const end = comparison.time.at(-1) ?? 0;
  const left = 60;
  const top = 12;
  const width = 700;
  const height = 232;

  return (
    <div className="chart" role="img" aria-label="Experimental pressure minus CFD pressure residual">
      <svg viewBox="0 0 790 286">
        <PlotGrid left={left} top={top} width={width} height={height} />
        <line x1={left} y1={top + height / 2} x2={left + width} y2={top + height / 2} className="zero-line" />
        <polyline points={polylinePoints(residual, width, height, -bound, bound, left, top)} fill="none" stroke={RESIDUAL_COLOR} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text x="7" y={top + 4} className="axis-value">+{bound.toFixed(2)}</text>
        <text x="32" y={top + height / 2 + 4} className="axis-value">0</text>
        <text x="7" y={top + height + 4} className="axis-value">−{bound.toFixed(2)}</text>
        <text x={left} y="276" className="axis-value">{start.toFixed(2)}</text>
        <text x={left + width} y="276" textAnchor="end" className="axis-value">{end.toFixed(2)} ms</text>
        <text x="17" y="132" transform="rotate(-90 17 132)" textAnchor="middle" className="axis-title">TEST − CFD (MPa)</text>
      </svg>
    </div>
  );
}

function Legend({ residual = false }: { residual?: boolean }) {
  return (
    <div className="legend" aria-label="Chart legend">
      {residual ? (
        <span><i className="legend-residual" />Experiment − CFD</span>
      ) : (
        <><span><i className="legend-test" />Experiment</span><span><i className="legend-cfd" />CFD</span></>
      )}
    </div>
  );
}

function rankedCauses(comparisons: Comparison[], metadata: CaseMetadata) {
  const correlation = average(comparisons.map((item) => item.correlation));
  const frequencyError = average(comparisons.map((item) => item.frequencyError));
  const amplitudeError = average(comparisons.map((item) => item.amplitudeError));
  return [
    {
      score: amplitudeError / REVIEW_THRESHOLDS.maximumAmplitudeError,
      title: `Chemistry or wall-loss treatment`,
      detail: `${metadata.chemistryModel} with ${metadata.turbulenceModel}; pressure-amplitude error is ${(amplitudeError * 100).toFixed(1)}%.`,
    },
    {
      score: frequencyError / REVIEW_THRESHOLDS.maximumFrequencyError,
      title: "Inlet boundary specification",
      detail: `${metadata.inletPressureBar.toFixed(1)} bar, ${metadata.inletTemperatureK.toFixed(0)} K, φ ${metadata.equivalenceRatio.toFixed(2)}; frequency error is ${(frequencyError * 100).toFixed(1)}%.`,
    },
    {
      score: (1 - correlation) / (1 - REVIEW_THRESHOLDS.minimumCorrelation),
      title: "Probe mapping or temporal resolution",
      detail: `Probe positions and ${metadata.timeStepUs.toFixed(2)} µs CFD time step; aligned correlation is ${correlation.toFixed(3)}.`,
    },
  ].sort((a, b) => b.score - a.score).slice(0, 2);
}

export default function Home() {
  const demo = useMemo(() => makeDemoProbeSignals(), []);
  const [testSignals, setTestSignals] = useState<Signal[]>(demo.test);
  const [cfdSignals, setCfdSignals] = useState<Signal[]>(demo.cfd);
  const [metadata, setMetadata] = useState<CaseMetadata>(DEMO_METADATA);
  const [draft, setDraft] = useState<CaseMetadata>(DEMO_METADATA);
  const [testPending, setTestPending] = useState<Signal[] | null>(null);
  const [cfdPending, setCfdPending] = useState<Signal[] | null>(null);
  const [showLoader, setShowLoader] = useState(false);
  const [error, setError] = useState("");
  const [sourceMode, setSourceMode] = useState<"demo" | "uploaded">("demo");
  const [activeView, setActiveView] = useState<"signals" | "spectrum" | "residual">("signals");
  const [activeProbe, setActiveProbe] = useState(0);

  const comparisons = useMemo(
    () => testSignals.map((signal, index) => compareSignals(signal, cfdSignals[index])),
    [testSignals, cfdSignals],
  );
  const testMode = useMemo(
    () => analyzeRdeProbeSet(testSignals, metadata.probePositionsDeg, metadata.annulusMeanDiameterMm),
    [testSignals, metadata.probePositionsDeg, metadata.annulusMeanDiameterMm],
  );
  const cfdMode = useMemo(
    () => analyzeRdeProbeSet(cfdSignals, metadata.probePositionsDeg, metadata.annulusMeanDiameterMm),
    [cfdSignals, metadata.probePositionsDeg, metadata.annulusMeanDiameterMm],
  );
  const activeComparison = comparisons[activeProbe];
  const frequencyError = average(comparisons.map((item) => item.frequencyError));
  const amplitudeError = average(comparisons.map((item) => item.amplitudeError));
  const correlation = average(comparisons.map((item) => item.correlation));
  const rmse = average(comparisons.map((item) => item.rmse));
  const modeMatches = testMode.waveCount === cfdMode.waveCount && testMode.direction === cfdMode.direction;
  const causes = rankedCauses(comparisons, metadata);
  const worstProbe = comparisons.reduce(
    (worst, comparison, index) => comparison.nrmse > comparisons[worst].nrmse ? index : worst,
    0,
  );
  const recommendation = recommendationFor(comparisons[worstProbe]);

  const inputRows = [
    ["Annulus geometry", `Mean diameter ${metadata.annulusMeanDiameterMm.toFixed(1)} mm`],
    ["Sensor + virtual-probe positions", metadata.probePositionsDeg.map((angle, index) => `P${index + 1} ${angle}°`).join(" · ")],
    ["Experimental pressure traces", `${testSignals.length} synchronized traces · ${testSignals[0].time.length.toLocaleString()} samples each`],
    ["Matching CFD pressure traces", `${cfdSignals.length} virtual probes · ${cfdSignals[0].time.length.toLocaleString()} samples each`],
    ["Operating conditions", `${metadata.inletPressureBar.toFixed(1)} bar · ${metadata.inletTemperatureK.toFixed(0)} K · φ ${metadata.equivalenceRatio.toFixed(2)} · ${metadata.massFlowKgS.toFixed(2)} kg/s`],
    ["Basic CFD model card", `${metadata.solver} · ${metadata.turbulenceModel} · ${metadata.chemistryModel}`],
    ["Sensor uncertainties", `Pressure ±${metadata.pressureUncertaintyPct.toFixed(1)}% · timing ±${metadata.timingUncertaintyUs.toFixed(1)} µs`],
  ];

  async function readProbeFile(event: ChangeEvent<HTMLInputElement>, kind: "test" | "cfd") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setError("");
      const signals = parseProbeCsv(await file.text(), file.name);
      if (kind === "test") setTestPending(signals);
      else setCfdPending(signals);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read the pressure file.");
    }
  }

  function openLoader() {
    setDraft({ ...metadata, probePositionsDeg: [...metadata.probePositionsDeg] });
    setTestPending(null);
    setCfdPending(null);
    setError("");
    setShowLoader(true);
  }

  function applyCase() {
    if (!draft.name.trim()) return setError("Give this operating point a name.");
    if (!Number.isFinite(draft.annulusMeanDiameterMm) || draft.annulusMeanDiameterMm <= 0) return setError("Enter a positive annulus mean diameter.");
    if (draft.probePositionsDeg.length !== 3 || draft.probePositionsDeg.some((value) => !Number.isFinite(value))) return setError("Enter three valid probe angles.");
    if ((testPending && !cfdPending) || (!testPending && cfdPending)) return setError("Choose both the experimental and CFD three-probe files.");
    try {
      const nextTest = testPending ?? testSignals;
      const nextCfd = cfdPending ?? cfdSignals;
      nextTest.forEach((signal, index) => compareSignals(signal, nextCfd[index]));
      analyzeRdeProbeSet(nextTest, draft.probePositionsDeg, draft.annulusMeanDiameterMm);
      setMetadata({ ...draft, probePositionsDeg: [...draft.probePositionsDeg] });
      if (testPending && cfdPending) {
        setTestSignals(testPending);
        setCfdSignals(cfdPending);
        setSourceMode("uploaded");
      }
      setActiveProbe(0);
      setShowLoader(false);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The two datasets could not be compared.");
    }
  }

  function resetDemo() {
    setTestSignals(demo.test);
    setCfdSignals(demo.cfd);
    setMetadata(DEMO_METADATA);
    setSourceMode("demo");
    setActiveProbe(0);
  }

  function downloadExample() {
    const rows = [
      "time_ms,p1_MPa,p2_MPa,p3_MPa",
      ...demo.test[0].time.slice(0, 800).map((time, index) =>
        [time, ...demo.test.map((signal) => signal.pressure[index])].map((value) => value.toFixed(6)).join(","),
      ),
    ];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "concordia-three-probe-example.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadReport() {
    const report = {
      schema: "concordia-rde-case-report",
      analysisVersion: ANALYSIS_VERSION,
      generatedAt: new Date().toISOString(),
      inputs: {
        metadata,
        experimentalSources: testSignals.map((signal) => signal.name),
        cfdSources: cfdSignals.map((signal) => signal.name),
        units: { time: "ms", pressure: "MPa", frequency: "kHz", waveSpeed: "m/s" },
      },
      outputs: {
        experiment: testMode,
        simulation: cfdMode,
        mismatch: { frequencyError, amplitudeError, waveformCorrelation: correlation, rmseMpa: rmse },
        rankedCauses: causes,
        recommendedNextAction: recommendation,
      },
      perProbe: comparisons,
      methods: ["bounded cross-correlation", "pressure spectrum", "circumferential phase fit", "residual analysis"],
      limitations: [
        "Ranked causes are hypotheses for targeted testing, not causal proof.",
        "Mode inference assumes the three probe clocks are synchronized.",
        "This result applies to one operating point and is not an engine-wide validation.",
      ],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "concordia-rde-case-report.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  const updateNumber = (key: keyof CaseMetadata, value: string) =>
    setDraft((current) => ({ ...current, [key]: Number(value) }));

  return (
    <main className="app-shell">
      <header className="product-header">
        <a className="brand" href="#top" aria-label="Concordia by Caelus home">
          <span className="brand-mark">C</span>
          <span><strong>CONCORDIA</strong><small>BY CAELUS</small></span>
        </a>
        <p>RDE simulation-to-test analysis</p>
        <div className="header-actions">
          <span className="prototype-tag">v{ANALYSIS_VERSION}</span>
          {sourceMode === "uploaded" && <button className="button secondary" onClick={resetDemo}>Reset demo</button>}
          <button className="button primary" onClick={openLoader}>Load case</button>
        </div>
      </header>

      <section className="content" id="top">
        <div className="case-heading">
          <div>
            <span className={`source-dot ${sourceMode}`} />
            <span>{sourceMode === "demo" ? "Synthetic demonstration" : "Uploaded case"}</span>
          </div>
          <h1>{metadata.name}</h1>
          <p>One operating point · three matched circumferential probes · calculated locally</p>
        </div>

        <section className="workflow" aria-label="Concordia inputs and outputs">
          <article className="inputs-panel">
            <div className="panel-heading">
              <div><span className="step-number">01</span><div><h2>Inputs</h2><p>What Concordia used</p></div></div>
              <button className="text-button" onClick={openLoader}>Edit</button>
            </div>
            <ol className="input-list">
              {inputRows.map(([label, value]) => (
                <li key={label}>
                  <i aria-hidden="true">✓</i>
                  <div><strong>{label}</strong><span>{value}</span></div>
                </li>
              ))}
            </ol>
          </article>

          <div className="flow-arrow" aria-hidden="true"><span>ANALYZE</span><i>→</i></div>

          <article className="outputs-panel">
            <div className="panel-heading">
              <div><span className="step-number">02</span><div><h2>Results</h2><p>What Concordia found</p></div></div>
            </div>

            <dl className="primary-results">
              <div><dt>Wave frequency</dt><dd>{testMode.waveFrequencyKHz.toFixed(2)} <span>kHz</span></dd><small>CFD {cfdMode.waveFrequencyKHz.toFixed(2)} kHz</small></div>
              <div><dt>Wave speed</dt><dd>{testMode.waveSpeedMps.toFixed(0)} <span>m/s</span></dd><small>CFD {cfdMode.waveSpeedMps.toFixed(0)} m/s</small></div>
              <div><dt>Wave count + direction</dt><dd>{testMode.waveCount} <span>wave</span></dd><small>{testMode.direction}{modeMatches ? " · CFD agrees" : " · CFD differs"}</small></div>
              <div><dt>Mode stability</dt><dd className={`status-${testMode.stability.toLowerCase()}`}>{testMode.stability}</dd><small>{(testMode.frequencyDrift * 100).toFixed(1)}% frequency drift</small></div>
            </dl>

            <section className="result-block mismatch-block">
              <div><span className="result-index">05</span><h3>Pressure + waveform mismatch</h3></div>
              <div className="mismatch-values">
                <span><strong>{(frequencyError * 100).toFixed(1)}%</strong> frequency</span>
                <span><strong>{(amplitudeError * 100).toFixed(1)}%</strong> amplitude</span>
                <span><strong>{correlation.toFixed(3)}</strong> correlation</span>
                <span><strong>{rmse.toFixed(3)}</strong> MPa RMSE</span>
              </div>
            </section>

            <section className="result-block causes-block">
              <div><span className="result-index">06</span><h3>Ranked causes to investigate</h3></div>
              <ol>
                {causes.map((cause) => <li key={cause.title}><b>{cause.title}</b><span>{cause.detail}</span></li>)}
              </ol>
              <small>These are testable hypotheses, not causal proof.</small>
            </section>

            <section className="result-block action-block">
              <div><span className="result-index">07</span><h3>Recommended next simulation or measurement</h3></div>
              <strong>{recommendation.title}</strong>
              <p>{recommendation.detail}</p>
            </section>

            <button className="report-button" onClick={downloadReport}>
              <span><b>08</b><strong>Download traceable report</strong><small>Inputs, methods, results, sources, and limitations</small></span>
              <i>↓</i>
            </button>
          </article>
        </section>

        <section className="evidence-panel">
          <div className="evidence-heading">
            <div><h2>Evidence</h2><p>Inspect the calculation behind the summary.</p></div>
            <div className="control-group">
              <div className="probe-tabs" aria-label="Probe selection">
                {[0, 1, 2].map((probe) => <button key={probe} className={activeProbe === probe ? "active" : ""} onClick={() => setActiveProbe(probe)}>P{probe + 1}</button>)}
              </div>
              <div className="view-tabs" aria-label="Evidence view">
                <button className={activeView === "signals" ? "active" : ""} onClick={() => setActiveView("signals")}>Pressure</button>
                <button className={activeView === "spectrum" ? "active" : ""} onClick={() => setActiveView("spectrum")}>Frequency</button>
                <button className={activeView === "residual" ? "active" : ""} onClick={() => setActiveView("residual")}>Residual</button>
              </div>
            </div>
          </div>
          <div className="chart-heading">
            <span>Probe P{activeProbe + 1} · {metadata.probePositionsDeg[activeProbe]}°</span>
            <Legend residual={activeView === "residual"} />
          </div>
          {activeView === "signals" && <SignalChart comparison={activeComparison} />}
          {activeView === "spectrum" && <SpectrumChart comparison={activeComparison} />}
          {activeView === "residual" && <ResidualChart comparison={activeComparison} />}
        </section>

        <footer>
          <span>Concordia v{ANALYSIS_VERSION} · deterministic analysis</span>
          <span>Research prototype · one operating point · not certification evidence</span>
        </footer>
      </section>

      {showLoader && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowLoader(false)}>
          <section className="loader-modal" role="dialog" aria-modal="true" aria-labelledby="loader-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setShowLoader(false)} aria-label="Close case loader">×</button>
            <span className="modal-kicker">RDE CASE INPUTS</span>
            <h2 id="loader-title">Load one operating point</h2>
            <p>Concordia requires geometry, three matched probes, operating conditions, the CFD model card, and sensor uncertainty.</p>

            <div className="form-section">
              <h3>Case + geometry</h3>
              <div className="form-grid three">
                <label><span>Case name</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>Mean diameter (mm)</span><input type="number" value={draft.annulusMeanDiameterMm} onChange={(event) => updateNumber("annulusMeanDiameterMm", event.target.value)} /></label>
                <label><span>Probe angles (deg)</span><div className="angle-inputs">{draft.probePositionsDeg.map((angle, index) => <input key={index} type="number" aria-label={`Probe ${index + 1} angle`} value={angle} onChange={(event) => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.map((value, position) => position === index ? Number(event.target.value) : value) }))} />)}</div></label>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-heading"><h3>Three synchronized pressure traces</h3><button onClick={downloadExample}>Download example CSV</button></div>
              <div className="upload-grid">
                <label className={`upload-box ${testPending ? "loaded" : ""}`}><span>EXPERIMENT</span><strong>{testPending?.[0].name.split(" · ")[0] ?? "Choose three-probe CSV"}</strong><small>time_ms, p1_MPa, p2_MPa, p3_MPa</small><input type="file" accept=".csv,.txt" onChange={(event) => readProbeFile(event, "test")} hidden /></label>
                <label className={`upload-box ${cfdPending ? "loaded" : ""}`}><span>CFD</span><strong>{cfdPending?.[0].name.split(" · ")[0] ?? "Choose matching CFD CSV"}</strong><small>Same probes, positions, and operating point</small><input type="file" accept=".csv,.txt" onChange={(event) => readProbeFile(event, "cfd")} hidden /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Operating conditions</h3>
              <div className="form-grid four">
                <label><span>Inlet pressure (bar)</span><input type="number" value={draft.inletPressureBar} onChange={(event) => updateNumber("inletPressureBar", event.target.value)} /></label>
                <label><span>Inlet temperature (K)</span><input type="number" value={draft.inletTemperatureK} onChange={(event) => updateNumber("inletTemperatureK", event.target.value)} /></label>
                <label><span>Equivalence ratio</span><input type="number" step="0.01" value={draft.equivalenceRatio} onChange={(event) => updateNumber("equivalenceRatio", event.target.value)} /></label>
                <label><span>Mass flow (kg/s)</span><input type="number" step="0.01" value={draft.massFlowKgS} onChange={(event) => updateNumber("massFlowKgS", event.target.value)} /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>CFD model card</h3>
              <div className="form-grid three">
                <label><span>Solver</span><input value={draft.solver} onChange={(event) => setDraft((current) => ({ ...current, solver: event.target.value }))} /></label>
                <label><span>Turbulence model</span><input value={draft.turbulenceModel} onChange={(event) => setDraft((current) => ({ ...current, turbulenceModel: event.target.value }))} /></label>
                <label><span>Chemistry model</span><input value={draft.chemistryModel} onChange={(event) => setDraft((current) => ({ ...current, chemistryModel: event.target.value }))} /></label>
                <label><span>Mesh cells</span><input type="number" value={draft.meshCells} onChange={(event) => updateNumber("meshCells", event.target.value)} /></label>
                <label><span>Time step (µs)</span><input type="number" step="0.01" value={draft.timeStepUs} onChange={(event) => updateNumber("timeStepUs", event.target.value)} /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Sensor uncertainty</h3>
              <div className="form-grid four">
                <label><span>Pressure uncertainty (%)</span><input type="number" step="0.1" value={draft.pressureUncertaintyPct} onChange={(event) => updateNumber("pressureUncertaintyPct", event.target.value)} /></label>
                <label><span>Timing uncertainty (µs)</span><input type="number" step="0.1" value={draft.timingUncertaintyUs} onChange={(event) => updateNumber("timingUncertaintyUs", event.target.value)} /></label>
              </div>
            </div>

            {error && <p className="error-message">{error}</p>}
            <div className="modal-actions"><button className="button secondary" onClick={() => setShowLoader(false)}>Cancel</button><button className="button primary" onClick={applyCase}>Analyze case →</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
