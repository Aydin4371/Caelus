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

type AnalysisCase = {
  id: string;
  source: "uploaded" | "demo";
  metadata: CaseMetadata;
  testSignals: Signal[];
  cfdSignals: Signal[];
};

const EMPTY_METADATA: CaseMetadata = {
  name: "",
  annulusMeanDiameterMm: Number.NaN,
  probePositionsDeg: [Number.NaN, Number.NaN, Number.NaN],
  inletPressureBar: Number.NaN,
  inletTemperatureK: Number.NaN,
  equivalenceRatio: Number.NaN,
  massFlowKgS: Number.NaN,
  solver: "",
  turbulenceModel: "",
  chemistryModel: "",
  meshCells: Number.NaN,
  timeStepUs: Number.NaN,
  pressureUncertaintyPct: Number.NaN,
  timingUncertaintyUs: Number.NaN,
};

function cloneMetadata(metadata: CaseMetadata): CaseMetadata {
  return { ...metadata, probePositionsDeg: [...metadata.probePositionsDeg] };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function signed(value: number, digits: number) {
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
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
      title: `Check chemistry and wall-loss assumptions`,
      detail: `${metadata.chemistryModel} with ${metadata.turbulenceModel}; pressure-amplitude error is ${(amplitudeError * 100).toFixed(1)}%.`,
    },
    {
      score: frequencyError / REVIEW_THRESHOLDS.maximumFrequencyError,
      title: "Check the inlet boundary specification",
      detail: `${metadata.inletPressureBar.toFixed(1)} bar, ${metadata.inletTemperatureK.toFixed(0)} K, φ ${metadata.equivalenceRatio.toFixed(2)}; frequency error is ${(frequencyError * 100).toFixed(1)}%.`,
    },
    {
      score: (1 - correlation) / (1 - REVIEW_THRESHOLDS.minimumCorrelation),
      title: "Check probe mapping and temporal resolution",
      detail: `Probe positions and ${metadata.timeStepUs.toFixed(2)} µs CFD time step; aligned correlation is ${correlation.toFixed(3)}.`,
    },
  ].sort((a, b) => b.score - a.score).slice(0, 2);
}

export default function Home() {
  const demo = useMemo(() => makeDemoProbeSignals(), []);
  const [cases, setCases] = useState<AnalysisCase[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaseMetadata>(() => cloneMetadata(EMPTY_METADATA));
  const [testPending, setTestPending] = useState<Signal[] | null>(null);
  const [cfdPending, setCfdPending] = useState<Signal[] | null>(null);
  const [showLoader, setShowLoader] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState<"signals" | "spectrum" | "residual">("signals");
  const [activeProbe, setActiveProbe] = useState(0);

  const activeCase = cases.find((item) => item.id === activeCaseId) ?? null;

  const comparisons = useMemo(
    () => activeCase
      ? activeCase.testSignals.map((signal, index) => compareSignals(signal, activeCase.cfdSignals[index]))
      : [],
    [activeCase],
  );
  const testMode = useMemo(
    () => activeCase
      ? analyzeRdeProbeSet(activeCase.testSignals, activeCase.metadata.probePositionsDeg, activeCase.metadata.annulusMeanDiameterMm)
      : null,
    [activeCase],
  );
  const cfdMode = useMemo(
    () => activeCase
      ? analyzeRdeProbeSet(activeCase.cfdSignals, activeCase.metadata.probePositionsDeg, activeCase.metadata.annulusMeanDiameterMm)
      : null,
    [activeCase],
  );
  const activeComparison = comparisons[activeProbe];
  const frequencyError = comparisons.length ? average(comparisons.map((item) => item.frequencyError)) : 0;
  const amplitudeError = comparisons.length ? average(comparisons.map((item) => item.amplitudeError)) : 0;
  const correlation = comparisons.length ? average(comparisons.map((item) => item.correlation)) : 0;
  const rmse = comparisons.length ? average(comparisons.map((item) => item.rmse)) : 0;
  const nrmse = comparisons.length ? average(comparisons.map((item) => item.nrmse)) : 0;
  const pressureBias = comparisons.length ? average(comparisons.map((item) => item.pressureBias)) : 0;
  const testAmplitude = comparisons.length ? average(comparisons.map((item) => item.testAmplitude)) : 0;
  const cfdAmplitude = comparisons.length ? average(comparisons.map((item) => item.cfdAmplitude)) : 0;
  const causes = activeCase ? rankedCauses(comparisons, activeCase.metadata) : [];
  const worstProbe = comparisons.length
    ? comparisons.reduce((worst, comparison, index) => comparison.nrmse > comparisons[worst].nrmse ? index : worst, 0)
    : 0;
  const recommendation = comparisons.length ? recommendationFor(comparisons[worstProbe]) : null;

  const inputRows = activeCase ? [
    ["Annulus geometry", `Mean diameter ${activeCase.metadata.annulusMeanDiameterMm.toFixed(1)} mm`],
    ["Sensor + virtual-probe positions", activeCase.metadata.probePositionsDeg.map((angle, index) => `P${index + 1} ${angle}°`).join(" · ")],
    ["Experimental pressure traces", `${activeCase.testSignals.length} synchronized traces · ${activeCase.testSignals[0].time.length.toLocaleString()} samples each`],
    ["Matching CFD pressure traces", `${activeCase.cfdSignals.length} virtual probes · ${activeCase.cfdSignals[0].time.length.toLocaleString()} samples each`],
    ["Operating conditions", `${activeCase.metadata.inletPressureBar.toFixed(1)} bar · ${activeCase.metadata.inletTemperatureK.toFixed(0)} K · φ ${activeCase.metadata.equivalenceRatio.toFixed(2)} · ${activeCase.metadata.massFlowKgS.toFixed(2)} kg/s`],
    ["Basic CFD model card", `${activeCase.metadata.solver} · ${activeCase.metadata.turbulenceModel} · ${activeCase.metadata.chemistryModel}`],
    ["Sensor uncertainties", `Pressure ±${activeCase.metadata.pressureUncertaintyPct.toFixed(1)}% · timing ±${activeCase.metadata.timingUncertaintyUs.toFixed(1)} µs`],
  ] : [];

  const waveSpeedError = testMode && cfdMode
    ? Math.abs(cfdMode.waveSpeedMps - testMode.waveSpeedMps) / Math.max(testMode.waveSpeedMps, 1e-12)
    : 0;

  const frequencyDelta = testMode && cfdMode ? cfdMode.waveFrequencyKHz - testMode.waveFrequencyKHz : 0;
  const frequencyDeltaPct = testMode && cfdMode ? 100 * frequencyDelta / Math.max(testMode.waveFrequencyKHz, 1e-12) : 0;
  const speedDelta = testMode && cfdMode ? cfdMode.waveSpeedMps - testMode.waveSpeedMps : 0;
  const speedDeltaPct = testMode && cfdMode ? 100 * speedDelta / Math.max(testMode.waveSpeedMps, 1e-12) : 0;
  const amplitudeDelta = cfdAmplitude - testAmplitude;
  const amplitudeDeltaPct = testAmplitude ? 100 * amplitudeDelta / testAmplitude : 0;

  const comparisonRows = testMode && cfdMode ? [
    {
      metric: "Wave frequency",
      purpose: "Rotational event rate",
      experiment: `${testMode.waveFrequencyKHz.toFixed(2)} kHz`,
      cfd: `${cfdMode.waveFrequencyKHz.toFixed(2)} kHz`,
      difference: `${signed(frequencyDelta, 2)} kHz (${signed(frequencyDeltaPct, 1)}%)`,
      criterion: "Within ±5%",
      tone: frequencyError <= REVIEW_THRESHOLDS.maximumFrequencyError ? "pass" : "review",
      status: frequencyError <= REVIEW_THRESHOLDS.maximumFrequencyError ? "Within limit" : "Review",
    },
    {
      metric: "Wave speed",
      purpose: "Circumferential propagation",
      experiment: `${testMode.waveSpeedMps.toFixed(0)} m/s`,
      cfd: `${cfdMode.waveSpeedMps.toFixed(0)} m/s`,
      difference: `${signed(speedDelta, 0)} m/s (${signed(speedDeltaPct, 1)}%)`,
      criterion: "Within ±5%",
      tone: waveSpeedError <= REVIEW_THRESHOLDS.maximumFrequencyError ? "pass" : "review",
      status: waveSpeedError <= REVIEW_THRESHOLDS.maximumFrequencyError ? "Within limit" : "Review",
    },
    {
      metric: "Wave count",
      purpose: "Number of rotating waves",
      experiment: `${testMode.waveCount} wave${testMode.waveCount === 1 ? "" : "s"}`,
      cfd: `${cfdMode.waveCount} wave${cfdMode.waveCount === 1 ? "" : "s"}`,
      difference: testMode.waveCount === cfdMode.waveCount ? "No difference" : `${signed(cfdMode.waveCount - testMode.waveCount, 0)} wave`,
      criterion: "Exact match",
      tone: testMode.waveCount === cfdMode.waveCount ? "pass" : "review",
      status: testMode.waveCount === cfdMode.waveCount ? "Match" : "Review",
    },
    {
      metric: "Direction",
      purpose: "Direction of rotation",
      experiment: testMode.direction,
      cfd: cfdMode.direction,
      difference: testMode.direction === cfdMode.direction ? "Same direction" : "Opposite direction",
      criterion: "Exact match",
      tone: testMode.direction === cfdMode.direction ? "pass" : "review",
      status: testMode.direction === cfdMode.direction ? "Match" : "Review",
    },
    {
      metric: "Mode stability",
      purpose: "Classification over the sample window",
      experiment: testMode.stability,
      cfd: cfdMode.stability,
      difference: testMode.stability === cfdMode.stability ? "Same classification" : "Different classification",
      criterion: "Exact match",
      tone: testMode.stability === cfdMode.stability ? "pass" : "review",
      status: testMode.stability === cfdMode.stability ? "Match" : "Review",
    },
    {
      metric: "Pressure amplitude",
      purpose: "Mean oscillation amplitude across probes",
      experiment: `${testAmplitude.toFixed(3)} MPa`,
      cfd: `${cfdAmplitude.toFixed(3)} MPa`,
      difference: `${signed(amplitudeDelta, 3)} MPa (${signed(amplitudeDeltaPct, 1)}%)`,
      criterion: "Within ±15%",
      tone: amplitudeError <= REVIEW_THRESHOLDS.maximumAmplitudeError ? "pass" : "review",
      status: amplitudeError <= REVIEW_THRESHOLDS.maximumAmplitudeError ? "Within limit" : "Review",
    },
  ] : [];

  const waveformWithinLimit = correlation >= REVIEW_THRESHOLDS.minimumCorrelation;
  const reviewCount = comparisonRows.filter((row) => row.tone === "review").length + (waveformWithinLimit ? 0 : 1);
  const assessedCount = comparisonRows.length + 1;

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

  function openNewCase() {
    setEditingCaseId(null);
    setDraft(cloneMetadata(EMPTY_METADATA));
    setTestPending(null);
    setCfdPending(null);
    setError("");
    setShowLoader(true);
  }

  function openCaseEditor() {
    if (!activeCase) return;
    setEditingCaseId(activeCase.id);
    setDraft(cloneMetadata(activeCase.metadata));
    setTestPending(null);
    setCfdPending(null);
    setError("");
    setShowLoader(true);
  }

  function applyCase() {
    if (!draft.name.trim()) return setError("Give this operating point a name.");
    if (!Number.isFinite(draft.annulusMeanDiameterMm) || draft.annulusMeanDiameterMm <= 0) return setError("Enter a positive annulus mean diameter.");
    if (draft.probePositionsDeg.length !== 3 || draft.probePositionsDeg.some((value) => !Number.isFinite(value))) return setError("Enter three valid probe angles.");
    const positiveValues = [draft.inletPressureBar, draft.inletTemperatureK, draft.equivalenceRatio, draft.massFlowKgS, draft.meshCells, draft.timeStepUs];
    if (positiveValues.some((value) => !Number.isFinite(value) || value <= 0)) return setError("Complete every operating-condition and CFD numeric field with a positive value.");
    if (![draft.pressureUncertaintyPct, draft.timingUncertaintyUs].every((value) => Number.isFinite(value) && value >= 0)) return setError("Enter non-negative sensor uncertainties.");
    if (![draft.solver, draft.turbulenceModel, draft.chemistryModel].every((value) => value.trim())) return setError("Complete the solver, turbulence, and chemistry model fields.");
    if ((testPending && !cfdPending) || (!testPending && cfdPending)) return setError("Choose both the experimental and CFD three-probe files.");
    try {
      const editingCase = cases.find((item) => item.id === editingCaseId) ?? null;
      const nextTest = testPending ?? editingCase?.testSignals;
      const nextCfd = cfdPending ?? editingCase?.cfdSignals;
      if (!nextTest || !nextCfd) return setError("Choose both the experimental and CFD three-probe files.");
      nextTest.forEach((signal, index) => compareSignals(signal, nextCfd[index]));
      analyzeRdeProbeSet(nextTest, draft.probePositionsDeg, draft.annulusMeanDiameterMm);
      analyzeRdeProbeSet(nextCfd, draft.probePositionsDeg, draft.annulusMeanDiameterMm);
      const id = editingCaseId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const nextCase: AnalysisCase = {
        id,
        source: editingCase?.source ?? "uploaded",
        metadata: cloneMetadata(draft),
        testSignals: nextTest,
        cfdSignals: nextCfd,
      };
      setCases((current) => editingCaseId
        ? current.map((item) => item.id === editingCaseId ? nextCase : item)
        : [...current, nextCase]);
      setActiveCaseId(id);
      setActiveProbe(0);
      setShowLoader(false);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The two datasets could not be compared.");
    }
  }

  function loadExampleCase() {
    const id = `demo-${Date.now().toString(36)}`;
    const example: AnalysisCase = {
      id,
      source: "demo",
      metadata: {
        name: "Synthetic RDE example",
        annulusMeanDiameterMm: 82,
        probePositionsDeg: [...demo.positionsDeg],
        inletPressureBar: 8,
        inletTemperatureK: 300,
        equivalenceRatio: 1,
        massFlowKgS: 0.62,
        solver: "Research CFD solver",
        turbulenceModel: "SST k-ω",
        chemistryModel: "Finite-rate, 9 species",
        meshCells: 2_500_000,
        timeStepUs: 0.25,
        pressureUncertaintyPct: 1.5,
        timingUncertaintyUs: 0.5,
      },
      testSignals: demo.test,
      cfdSignals: demo.cfd,
    };
    setCases((current) => [...current, example]);
    setActiveCaseId(id);
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
    if (!activeCase || !testMode || !cfdMode || !recommendation) return;
    const report = {
      schema: "concordia-rde-case-report",
      analysisVersion: ANALYSIS_VERSION,
      generatedAt: new Date().toISOString(),
      inputs: {
        metadata: activeCase.metadata,
        experimentalSources: activeCase.testSignals.map((signal) => signal.name),
        cfdSources: activeCase.cfdSignals.map((signal) => signal.name),
        units: { time: "ms", pressure: "MPa", frequency: "kHz", waveSpeed: "m/s" },
      },
      outputs: {
        experiment: testMode,
        simulation: cfdMode,
        mismatch: { frequencyError, amplitudeError, waveformCorrelation: correlation, rmseMpa: rmse, normalizedRmse: nrmse, pressureBiasMpa: pressureBias },
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
    setDraft((current) => ({ ...current, [key]: value === "" ? Number.NaN : Number(value) }));
  const numberValue = (value: number) => Number.isFinite(value) ? value : "";

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
          <button className="button primary" onClick={openNewCase}>+ Add case</button>
        </div>
      </header>

      <section className="content" id="top">
        {!activeCase || !testMode || !cfdMode || !activeComparison || !recommendation ? (
          <section className="empty-workspace">
            <span className="empty-kicker">CASE WORKSPACE</span>
            <h1>No cases loaded</h1>
            <p>Add an RDE operating point to compare three experimental pressure traces with the matching CFD virtual probes.</p>
            <div className="empty-actions">
              <button className="button primary" onClick={openNewCase}>Add first case →</button>
              <button className="button secondary" onClick={loadExampleCase}>Load synthetic example</button>
            </div>
            <div className="empty-requirements">
              <span><b>1</b> Experiment + CFD pressure files</span>
              <span><b>2</b> Geometry, conditions, model card, uncertainty</span>
              <span><b>3</b> Concordia calculates and compares the results</span>
            </div>
          </section>
        ) : (
          <>
            <section className="case-switcher" aria-label="Loaded cases">
              <div className="case-switcher-label"><span>Cases</span><b>{cases.length}</b></div>
              <div className="case-tabs-list">
                {cases.map((item, index) => (
                  <button key={item.id} className={item.id === activeCase.id ? "active" : ""} onClick={() => { setActiveCaseId(item.id); setActiveProbe(0); }}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{item.metadata.name}</strong>
                    <small>φ {item.metadata.equivalenceRatio.toFixed(2)} · {item.metadata.inletPressureBar.toFixed(1)} bar</small>
                  </button>
                ))}
              </div>
              <button className="add-case-button" onClick={openNewCase}>+ Add case</button>
            </section>

            <div className="case-heading">
              <div><span className={`source-dot ${activeCase.source === "demo" ? "demo" : ""}`} /><span>{activeCase.source === "demo" ? "Synthetic demonstration" : "Uploaded case"}</span></div>
              <h1>{activeCase.metadata.name}</h1>
              <p>Operating point {cases.findIndex((item) => item.id === activeCase.id) + 1} of {cases.length} · calculated locally</p>
            </div>

            <section className={`assessment-banner ${reviewCount ? "review" : "pass"}`} aria-label="Comparison conclusion">
              <div>
                <span>COMPARISON CONCLUSION</span>
                <h2>{reviewCount ? `${reviewCount} of ${assessedCount} checks require review` : `All ${assessedCount} checks are within the current limits`}</h2>
                <p>{reviewCount ? "The CFD does not reproduce every selected experimental quantity within the prototype limits. Start with the highlighted rows below." : "For this operating point, the CFD reproduces the selected wave and pressure quantities within the prototype limits."}</p>
              </div>
              <strong>{reviewCount ? "REVIEW" : "WITHIN LIMITS"}</strong>
            </section>

            <section className="workflow" aria-label="Concordia inputs and outputs">
          <article className="inputs-panel">
            <div className="panel-heading">
              <div><span className="step-number">01</span><div><h2>Inputs</h2><p>What Concordia used</p></div></div>
              <button className="text-button" onClick={openCaseEditor}>Edit case</button>
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
              <div><span className="step-number">02</span><div><h2>Experiment vs CFD</h2><p>CFD minus experiment, evaluated against explicit prototype limits</p></div></div>
            </div>

            <div className="comparison-table-wrap">
              <table className="comparison-table">
                <thead><tr><th>Quantity</th><th>Experiment</th><th>CFD</th><th>CFD − experiment</th><th>Current limit</th></tr></thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row.metric} className={row.tone === "review" ? "comparison-row-review" : ""}>
                      <th scope="row"><strong>{row.metric}</strong><small>{row.purpose}</small></th>
                      <td>{row.experiment}</td>
                      <td>{row.cfd}</td>
                      <td className="difference-cell">{row.difference}</td>
                      <td><span className={`comparison-status ${row.tone}`}>{row.status}</span><small className="criterion">{row.criterion}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section className="result-block mismatch-block">
              <div><span className="result-index">07</span><h3>Waveform agreement</h3></div>
              <div className="comparison-metrics">
                <div className={waveformWithinLimit ? "metric-pass" : "metric-review"}><span>Aligned correlation</span><strong>{correlation.toFixed(3)}</strong><small>{waveformWithinLimit ? "Within limit · target ≥ 0.700" : "Review · target ≥ 0.700"}</small></div>
                <div><span>Normalized RMSE</span><strong>{(nrmse * 100).toFixed(1)}<i>%</i></strong><small>Residual size relative to experimental oscillation RMS</small></div>
                <div><span>Mean pressure bias</span><strong>{signed(pressureBias, 3)} <i>MPa</i></strong><small>Positive means CFD predicts higher mean pressure</small></div>
              </div>
              <p className="metric-note">Only correlation has a current review limit. NRMSE and pressure bias are reported without a pass/fail claim until uncertainty propagation is implemented.</p>
            </section>

            <section className="result-block causes-block">
              <div><span className="result-index">08</span><h3>Investigation priorities</h3></div>
              {reviewCount ? <>
                <ol>{causes.map((cause) => <li key={cause.title}><b>{cause.title}</b><span>{cause.detail}</span></li>)}</ol>
                <small>Ranked from the observed mismatch. These are testable hypotheses, not causal proof.</small>
              </> : <p className="no-causes">No discrepancy is large enough to rank a cause under the current limits.</p>}
            </section>

            <section className="result-block action-block">
              <div><span className="result-index">09</span><h3>Recommended next simulation or measurement</h3></div>
              <strong>{recommendation.title}</strong>
              <p>{recommendation.detail}</p>
            </section>

            <button className="report-button" onClick={downloadReport}>
              <span><b>10</b><strong>Download traceable report</strong><small>Inputs, methods, results, sources, and limitations</small></span>
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
            <span>Probe P{activeProbe + 1} · {activeCase.metadata.probePositionsDeg[activeProbe]}°</span>
            <Legend residual={activeView === "residual"} />
          </div>
          {activeView === "signals" && <SignalChart comparison={activeComparison} />}
          {activeView === "spectrum" && <SpectrumChart comparison={activeComparison} />}
          {activeView === "residual" && <ResidualChart comparison={activeComparison} />}
            </section>

            <footer>
              <span>Concordia v{ANALYSIS_VERSION} · deterministic analysis</span>
              <span>{cases.length} case{cases.length === 1 ? "" : "s"} in this browser session · not certification evidence</span>
            </footer>
          </>
        )}
      </section>

      {showLoader && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowLoader(false)}>
          <section className="loader-modal" role="dialog" aria-modal="true" aria-labelledby="loader-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setShowLoader(false)} aria-label="Close case loader">×</button>
            <span className="modal-kicker">RDE CASE INPUTS</span>
            <h2 id="loader-title">{editingCaseId ? "Edit operating point" : "Add operating point"}</h2>
            <p>Concordia requires geometry, three matched probes, operating conditions, the CFD model card, and sensor uncertainty.</p>

            <div className="form-section">
              <h3>Case + geometry</h3>
              <div className="form-grid three">
                <label><span>Case name</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>Mean diameter (mm)</span><input type="number" value={numberValue(draft.annulusMeanDiameterMm)} onChange={(event) => updateNumber("annulusMeanDiameterMm", event.target.value)} /></label>
                <label><span>Probe angles (deg)</span><div className="angle-inputs">{draft.probePositionsDeg.map((angle, index) => <input key={index} type="number" aria-label={`Probe ${index + 1} angle`} value={numberValue(angle)} onChange={(event) => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.map((value, position) => position === index ? (event.target.value === "" ? Number.NaN : Number(event.target.value)) : value) }))} />)}</div></label>
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
                <label><span>Inlet pressure (bar)</span><input type="number" value={numberValue(draft.inletPressureBar)} onChange={(event) => updateNumber("inletPressureBar", event.target.value)} /></label>
                <label><span>Inlet temperature (K)</span><input type="number" value={numberValue(draft.inletTemperatureK)} onChange={(event) => updateNumber("inletTemperatureK", event.target.value)} /></label>
                <label><span>Equivalence ratio</span><input type="number" step="0.01" value={numberValue(draft.equivalenceRatio)} onChange={(event) => updateNumber("equivalenceRatio", event.target.value)} /></label>
                <label><span>Mass flow (kg/s)</span><input type="number" step="0.01" value={numberValue(draft.massFlowKgS)} onChange={(event) => updateNumber("massFlowKgS", event.target.value)} /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>CFD model card</h3>
              <div className="form-grid three">
                <label><span>Solver</span><input value={draft.solver} onChange={(event) => setDraft((current) => ({ ...current, solver: event.target.value }))} /></label>
                <label><span>Turbulence model</span><input value={draft.turbulenceModel} onChange={(event) => setDraft((current) => ({ ...current, turbulenceModel: event.target.value }))} /></label>
                <label><span>Chemistry model</span><input value={draft.chemistryModel} onChange={(event) => setDraft((current) => ({ ...current, chemistryModel: event.target.value }))} /></label>
                <label><span>Mesh cells</span><input type="number" value={numberValue(draft.meshCells)} onChange={(event) => updateNumber("meshCells", event.target.value)} /></label>
                <label><span>Time step (µs)</span><input type="number" step="0.01" value={numberValue(draft.timeStepUs)} onChange={(event) => updateNumber("timeStepUs", event.target.value)} /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Sensor uncertainty</h3>
              <div className="form-grid four">
                <label><span>Pressure uncertainty (%)</span><input type="number" step="0.1" value={numberValue(draft.pressureUncertaintyPct)} onChange={(event) => updateNumber("pressureUncertaintyPct", event.target.value)} /></label>
                <label><span>Timing uncertainty (µs)</span><input type="number" step="0.1" value={numberValue(draft.timingUncertaintyUs)} onChange={(event) => updateNumber("timingUncertaintyUs", event.target.value)} /></label>
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
