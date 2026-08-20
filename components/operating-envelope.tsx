"use client";

import { useMemo, useState } from "react";
import type { AnalysisCase } from "@/lib/caevera-types";
import { buildScreeningPlan, selectCoverageNextPoint, type EngineDesign, type OperatingPoint, type PlannedOperatingPoint } from "@/lib/design-workspace";
import { envelopeModelDomain, fitEnvelopeModel, recommendBoundaryPoint, type EnvelopeFeatures } from "@/lib/envelope-model";
import { ENVELOPE_AXES, buildEnvelopeDataset, envelopeAxisValue, type EnvelopeAxisKey, type EnvelopeClassification, type EnvelopePoint } from "@/lib/operating-envelope";

type Props = {
  designs: EngineDesign[];
  activeDesignId: string | null;
  operatingPoints: OperatingPoint[];
  runs: AnalysisCase[];
  onSelectDesign: (id: string) => void;
  onAddOperatingPoint: (designId: string, point?: PlannedOperatingPoint) => void;
  onLoadDemo: () => void;
  onOpenRun: (runId: string) => void;
  onOpenDesign: () => void;
};

const PLOT = { left: 76, right: 674, top: 32, bottom: 364 };
const FEATURE_KEYS: EnvelopeAxisKey[] = ["inletPressureBar", "massFlowKgS", "equivalenceRatio", "backPressureBar"];

function axisDefinition(key: EnvelopeAxisKey) { return ENVELOPE_AXES.find((axis) => axis.key === key)!; }
function formatAxis(value: number, key: EnvelopeAxisKey) {
  if (key === "equivalenceRatio") return value.toFixed(2);
  if (key === "massFlowKgS") return value.toFixed(3);
  return value.toFixed(2);
}
function scale(value: number, limits: readonly [number, number], start: number, end: number) { return start + ((value - limits[0]) / Math.max(limits[1] - limits[0], 1e-12)) * (end - start); }
function classificationClass(classification: EnvelopeClassification) { return `envelope-${classification.toLowerCase()}`; }
function pointSummary(point: EnvelopePoint) {
  if (point.classification === "Unclassified") return "The experimental pressure data do not identify one rotating mode at this operating point.";
  return `${point.classification} measured response · ${point.waveCount}-wave mode · ${point.identifiability.toLowerCase()} classification`;
}
function initialFixedValues(design: EngineDesign, points: OperatingPoint[]): EnvelopeFeatures {
  const first = points.find((point) => point.source === "uploaded") ?? points[0];
  return {
    inletPressureBar: first?.inletPressureBar ?? 0.5 * (design.inletPressureBarMin + design.inletPressureBarMax),
    massFlowKgS: first?.massFlowKgS ?? 0.5 * (design.massFlowKgSMin + design.massFlowKgSMax),
    equivalenceRatio: first?.equivalenceRatio ?? 0.5 * (design.equivalenceRatioMin + design.equivalenceRatioMax),
    backPressureBar: first?.backPressureBar ?? design.backPressureBar,
  };
}
function observedValues(points: OperatingPoint[], key: EnvelopeAxisKey, fallback: number) {
  const values = [...new Set(points.map((point) => point[key]).filter(Number.isFinite))].sort((left, right) => left - right);
  return values.length ? values : [fallback];
}
function inSlice(point: EnvelopePoint, xAxis: EnvelopeAxisKey, yAxis: EnvelopeAxisKey, fixed: EnvelopeFeatures) {
  return FEATURE_KEYS.every((key) => key === xAxis || key === yAxis || Math.abs(point[key] - fixed[key]) <= Math.max(1e-9, Math.abs(fixed[key]) * 1e-6));
}

export function OperatingEnvelope({ designs, activeDesignId, operatingPoints, runs, onSelectDesign, onAddOperatingPoint, onLoadDemo, onOpenRun, onOpenDesign }: Props) {
  const activeDesign = designs.find((design) => design.id === activeDesignId) ?? designs[0] ?? null;
  const designPoints = useMemo(() => activeDesign ? operatingPoints.filter((point) => point.designId === activeDesign.id) : [], [activeDesign, operatingPoints]);
  const dataset = useMemo(() => buildEnvelopeDataset(designPoints, runs), [designPoints, runs]);
  const physicalPoints = dataset.points.filter((point) => point.source === "uploaded");
  const demonstrationPoints = dataset.points.filter((point) => point.source === "demo");
  const [showDemonstration, setShowDemonstration] = useState(false);
  const [xAxis, setXAxis] = useState<EnvelopeAxisKey>("inletPressureBar");
  const [yAxis, setYAxis] = useState<EnvelopeAxisKey>("massFlowKgS");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fixedSelections, setFixedSelections] = useState<EnvelopeFeatures>(() => activeDesign ? initialFixedValues(activeDesign, designPoints) : { inletPressureBar: 1, massFlowKgS: 1, equivalenceRatio: 1, backPressureBar: 1 });
  const defaultFixedValues = activeDesign ? initialFixedValues(activeDesign, designPoints) : fixedSelections;
  const fixedValues = Object.fromEntries(FEATURE_KEYS.map((key) => {
    const values = observedValues(designPoints, key, defaultFixedValues[key]);
    return [key, values.includes(fixedSelections[key]) ? fixedSelections[key] : defaultFixedValues[key]];
  })) as EnvelopeFeatures;
  const model = useMemo(() => activeDesign ? fitEnvelopeModel(dataset.points, activeDesign) : null, [activeDesign, dataset.points]);
  const domain = useMemo(() => activeDesign ? envelopeModelDomain(activeDesign, dataset.points) : null, [activeDesign, dataset.points]);
  const basePoints = physicalPoints.length ? physicalPoints : showDemonstration ? demonstrationPoints : [];
  const displayedPoints = basePoints.filter((point) => inSlice(point, xAxis, yAxis, fixedValues));
  const selected = displayedPoints.find((point) => point.caseId === selectedId) ?? displayedPoints[0] ?? null;
  const plan = useMemo(() => activeDesign ? buildScreeningPlan(activeDesign, designPoints) : [], [activeDesign, designPoints]);
  const coveragePoint = useMemo(() => selectCoverageNextPoint(plan), [plan]);
  const recommendation = model && domain ? recommendBoundaryPoint(model, domain, xAxis, yAxis, fixedValues) : null;
  const xLimits = domain?.[xAxis] ?? [0, 1] as const;
  const yLimits = domain?.[yAxis] ?? [0, 1] as const;
  const xDefinition = axisDefinition(xAxis);
  const yDefinition = axisDefinition(yAxis);
  const fixedAxes = FEATURE_KEYS.filter((key) => key !== xAxis && key !== yAxis);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  if (!activeDesign) return <section className="envelope-empty" aria-label="Operating envelope workspace"><span className="workspace-label">Operating Envelope</span><h1>Define an engine design first</h1><p>An envelope contains operating points from one documented geometry, injector configuration, and propellant pair.</p><div className="empty-actions"><button className="button primary" onClick={onOpenDesign}>Create engine design</button><button className="button secondary" onClick={onLoadDemo}>Load synthetic demonstration</button></div></section>;

  const predictionCells = model?.status === "Exploratory model ready" && domain ? Array.from({ length: 18 * 18 }, (_, index) => {
    const column = index % 18;
    const row = Math.floor(index / 18);
    const features = { ...fixedValues };
    features[xAxis] = xLimits[0] + ((column + 0.5) / 18) * (xLimits[1] - xLimits[0]);
    features[yAxis] = yLimits[0] + ((row + 0.5) / 18) * (yLimits[1] - yLimits[0]);
    const prediction = model.predict(features);
    if (!prediction.supported || !prediction.classification) return null;
    return { column, row, prediction };
  }).filter(Boolean) as { column: number; row: number; prediction: ReturnType<typeof model.predict> }[] : [];

  return <section className="envelope-workspace" aria-label="Operating envelope workspace">
    <div className="envelope-heading"><div><span className="workspace-label">Operating Envelope</span><h1>{activeDesign.name}</h1><p>The measured envelope is shown first. A predictive layer appears only after the real-data and validation gates pass. Unsupported space stays blank.</p></div><label className="design-map-selector"><span>Engine / design</span><select value={activeDesign.id} onChange={(event) => onSelectDesign(event.target.value)}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}</select></label></div>

    {!physicalPoints.length && <section className="map-empty-banner"><div><strong>No real completed operating points yet</strong><span>Add a matched experiment and baseline CFD run. Synthetic points demonstrate the workflow but never train the envelope.</span></div><button className="button primary" onClick={() => onAddOperatingPoint(activeDesign.id)}>Add operating point</button></section>}

    <section className="envelope-readiness measured-summary" aria-label="Measured envelope summary">
      <article className="measured-stable"><span>Stable points</span><strong>{dataset.stablePointCount}</strong><small>Real completed operating points only</small></article>
      <article className="measured-transitional"><span>Transitional points</span><strong>{dataset.transitionalPointCount}</strong><small>Real completed operating points only</small></article>
      <article className="measured-unstable"><span>Unstable points</span><strong>{dataset.unstablePointCount}</strong><small>Real completed operating points only</small></article>
      <article className={model?.status === "Exploratory model ready" ? "model-ready" : "readiness-missing"}><span>Predictive layer</span><strong>{model?.status ?? "Blocked"}</strong><small>{model?.reason}</small></article>
    </section>

    <div className="envelope-layout">
      <section className="envelope-map-card">
        <div className="envelope-map-controls"><div><h2>Measured mode by operating point</h2><p>Each marker is one operating point. Its CFD reruns support that point without creating another marker.</p></div><div className="envelope-axis-controls"><label><span>Horizontal</span><select value={xAxis} onChange={(event) => setXAxis(event.target.value as EnvelopeAxisKey)}>{ENVELOPE_AXES.filter((axis) => axis.key !== yAxis).map((axis) => <option key={axis.key} value={axis.key}>{axis.label}</option>)}</select></label><label><span>Vertical</span><select value={yAxis} onChange={(event) => setYAxis(event.target.value as EnvelopeAxisKey)}>{ENVELOPE_AXES.filter((axis) => axis.key !== xAxis).map((axis) => <option key={axis.key} value={axis.key}>{axis.label}</option>)}</select></label></div></div>
        <div className="envelope-slice-controls"><strong>Held fixed for this 2D slice</strong>{fixedAxes.map((key) => { const definition = axisDefinition(key); const values = observedValues(designPoints, key, fixedValues[key]); return <label key={key}><span>{definition.label}</span><select value={fixedValues[key]} onChange={(event) => setFixedSelections((current) => ({ ...current, [key]: Number(event.target.value) }))}>{values.map((value) => <option key={value} value={value}>{formatAxis(value, key)}{definition.unit ? ` ${definition.unit}` : ""}</option>)}</select></label>; })}<small>Geometry, injector, propellants, and walls are fixed by the selected engine.</small></div>
        <div className="envelope-plot-wrap"><svg className="envelope-plot" viewBox="0 0 720 410" role="img" aria-label={`${yDefinition.label} versus ${xDefinition.label} operating points`}>
          {predictionCells.map(({ column, row, prediction }) => <rect key={`prediction-${column}-${row}`} x={PLOT.left + column * (PLOT.right - PLOT.left) / 18} y={PLOT.bottom - (row + 1) * (PLOT.bottom - PLOT.top) / 18} width={(PLOT.right - PLOT.left) / 18 + 0.5} height={(PLOT.bottom - PLOT.top) / 18 + 0.5} className={`prediction-cell prediction-${prediction.classification!.toLowerCase()}`} opacity={Math.max(0.08, 0.48 * (1 - prediction.uncertainty))}><title>{prediction.classification} · uncertainty {(prediction.uncertainty * 100).toFixed(0)}%</title></rect>)}
          {ticks.map((fraction) => { const x = PLOT.left + fraction * (PLOT.right - PLOT.left); const y = PLOT.bottom - fraction * (PLOT.bottom - PLOT.top); const xValue = xLimits[0] + fraction * (xLimits[1] - xLimits[0]); const yValue = yLimits[0] + fraction * (yLimits[1] - yLimits[0]); return <g key={fraction}><line x1={x} x2={x} y1={PLOT.top} y2={PLOT.bottom} className="envelope-grid-line"/><line x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} className="envelope-grid-line"/><text x={x} y={PLOT.bottom + 24} textAnchor="middle">{formatAxis(xValue, xAxis)}</text><text x={PLOT.left - 14} y={y + 4} textAnchor="end">{formatAxis(yValue, yAxis)}</text></g>; })}
          <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} className="envelope-axis-line"/><line x1={PLOT.left} x2={PLOT.left} y1={PLOT.top} y2={PLOT.bottom} className="envelope-axis-line"/><text x={(PLOT.left + PLOT.right) / 2} y="404" textAnchor="middle" className="envelope-axis-title">{xDefinition.label}{xDefinition.unit ? ` (${xDefinition.unit})` : ""}</text><text x="17" y={(PLOT.top + PLOT.bottom) / 2} textAnchor="middle" className="envelope-axis-title" transform={`rotate(-90 17 ${(PLOT.top + PLOT.bottom) / 2})`}>{yDefinition.label}{yDefinition.unit ? ` (${yDefinition.unit})` : ""}</text>
          {displayedPoints.map((point) => { const x = scale(envelopeAxisValue(point, xAxis), xLimits, PLOT.left, PLOT.right); const y = scale(envelopeAxisValue(point, yAxis), yLimits, PLOT.bottom, PLOT.top); return <g key={point.caseId} className={`envelope-point ${classificationClass(point.classification)} ${selected?.caseId === point.caseId ? "selected" : ""} ${point.source === "demo" ? "demonstration" : ""}`} role="button" tabIndex={0} aria-label={`${point.name}: ${point.classification}`} onClick={() => setSelectedId(point.caseId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(point.caseId); }}><circle cx={x} cy={y} r={selected?.caseId === point.caseId ? 10 : 8}/><circle cx={x} cy={y} r="15" className="point-hit-area"/><title>{point.name}: {point.classification}</title></g>; })}
        </svg></div>
        <div className="envelope-legend"><span className="envelope-stable">Stable measured</span><span className="envelope-transitional">Transitional measured</span><span className="envelope-unstable">Unstable measured</span><span className="envelope-unclassified">Unclassified</span>{model?.status === "Exploratory model ready" && <span className="envelope-predicted">Exploratory prediction, fades with uncertainty</span>}<small>{displayedPoints.length} of {basePoints.length} points match this exact 2D slice.</small></div>
      </section>

      {selected ? <aside className="envelope-point-card"><div><span>{selected.source === "demo" ? "Synthetic demonstration" : "Measured operating point"}</span><h2>{selected.classification}{selected.waveCount ? ` · ${selected.waveCount}-wave mode` : ""}</h2><p>{pointSummary(selected)}</p></div><dl><div><dt>Operating point</dt><dd>{selected.name}</dd></div><div><dt>Condition</dt><dd>{selected.inletPressureBar.toFixed(2)} bar · {selected.massFlowKgS.toFixed(3)} kg/s · φ {selected.equivalenceRatio.toFixed(2)} · Pb {selected.backPressureBar.toFixed(2)} bar</dd></div><div><dt>Evidence</dt><dd>{selected.evidenceType} · {selected.evidenceQuality} quality</dd></div><div><dt>Frequency and speed</dt><dd>{selected.waveFrequencyKHz.toFixed(2)} kHz · {selected.waveSpeedMps === null ? "speed not identifiable" : `${selected.waveSpeedMps.toFixed(0)} m/s`}</dd></div><div><dt>Runs</dt><dd>{selected.runCount} total · {selected.cfdRerunCount} CFD rerun{selected.cfdRerunCount === 1 ? "" : "s"}</dd></div><div><dt>CFD numerical status</dt><dd>{selected.numericalStatus}</dd></div></dl><div className={`model-use model-use-${selected.modelUse.toLowerCase().replaceAll(" ", "-")}`}><strong>{selected.modelUse}</strong><span>{selected.source === "demo" ? "Excluded from physical evidence and model fitting." : selected.modelUse === "Eligible observation" ? "Eligible for the versioned exploratory model." : "Resolve this evidence limitation before model fitting."}</span></div><button className="button secondary" onClick={() => onOpenRun(selected.caseId)}>Open comparison</button></aside> : <aside className="envelope-point-card planned-next-card"><div><span>{recommendation ? "Most informative next test" : "Coverage-based next point"}</span><h2>{recommendation ? "Test the uncertain boundary" : coveragePoint?.role ?? "No untested plan point"}</h2><p>{recommendation ? "This supported location is close to a measured class boundary and has high model uncertainty. It is chosen to reduce uncertainty, not maximize performance." : model?.reason ?? "Add measured points before fitting a predictive envelope."}</p></div>{recommendation ? <dl><div><dt>Inlet pressure</dt><dd>{recommendation.features.inletPressureBar.toFixed(2)} bar</dd></div><div><dt>Mass flow</dt><dd>{recommendation.features.massFlowKgS.toFixed(3)} kg/s</dd></div><div><dt>Equivalence ratio</dt><dd>φ {recommendation.features.equivalenceRatio.toFixed(2)}</dd></div><div><dt>Back pressure</dt><dd>{recommendation.features.backPressureBar.toFixed(2)} bar</dd></div><div><dt>Prediction uncertainty</dt><dd>{(recommendation.prediction.uncertainty * 100).toFixed(0)}%</dd></div></dl> : coveragePoint && <dl><div><dt>Inlet pressure</dt><dd>{coveragePoint.inletPressureBar.toFixed(2)} bar</dd></div><div><dt>Mass flow</dt><dd>{coveragePoint.massFlowKgS.toFixed(3)} kg/s</dd></div><div><dt>Equivalence ratio</dt><dd>φ {coveragePoint.equivalenceRatio.toFixed(2)}</dd></div></dl>}{(recommendation || coveragePoint) && <button className="button primary" onClick={() => onAddOperatingPoint(activeDesign.id, recommendation ? { id: "uncertain-boundary", role: "Uncertain boundary", inletPressureBar: recommendation.features.inletPressureBar, massFlowKgS: recommendation.features.massFlowKgS, equivalenceRatio: recommendation.features.equivalenceRatio, matchedOperatingPointId: null, nearestDistance: recommendation.prediction.nearestDistance } : coveragePoint!)}>Add this operating point</button>}</aside>}
    </div>

    {!physicalPoints.length && demonstrationPoints.length > 0 && <section className="demonstration-toggle"><div><strong>Synthetic demonstration available</strong><span>It is excluded from every measured count, model gate, and recommendation.</span></div><button className="button secondary" onClick={() => setShowDemonstration((current) => !current)}>{showDemonstration ? "Hide demonstration" : "Show demonstration"}</button></section>}
    <section className="envelope-method-boundary"><strong>{model?.status === "Exploratory model ready" ? "Prediction is local and uncertainty-aware" : "Measured, not predicted"}</strong><p>{model?.status === "Exploratory model ready" ? "The model estimates stability-class and wave-mode probabilities. Colored stability cells appear only where at least three nearby real observations support a local estimate, and areas without nearby data remain blank. It does not predict backflow, pressure gain, thrust, or thermal loading." : `Kythros does not draw a boundary between measured markers. ${dataset.nextRequirement}`}</p></section>
  </section>;
}
