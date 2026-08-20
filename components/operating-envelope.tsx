"use client";

import { useMemo, useState } from "react";
import type { AnalysisCase } from "@/lib/caevera-types";
import { buildScreeningPlan, selectCoverageNextPoint, type EngineDesign, type OperatingPoint, type PlannedOperatingPoint } from "@/lib/design-workspace";
import { envelopeModelDomain, fitEnvelopeModel, recommendBoundaryPoint, type EnvelopeFeatures } from "@/lib/envelope-model";
import { ENVELOPE_AXES, buildEnvelopeDataset, envelopeAxisValue, pointMatchesEnvelopeSlice, type EnvelopeAxisKey, type EnvelopeClassification, type EnvelopePoint } from "@/lib/operating-envelope";
import { GE_2022_CLASSIFICATION_NOTE } from "@/lib/published-envelope-data";
import { PHYSICS_EVIDENCE_SOURCES, PHYSICS_SOURCE_LIMITATION } from "@/lib/physics-evidence";

type Props = {
  designs: EngineDesign[];
  activeDesignId: string | null;
  operatingPoints: OperatingPoint[];
  runs: AnalysisCase[];
  onSelectDesign: (id: string) => void;
  onAddOperatingPoint: (designId: string, point?: PlannedOperatingPoint) => void;
  onLoadDemo: () => void;
  onLoadPublished: () => void;
  onOpenRun: (runId: string) => void;
  onAddBaselineCfd: (operatingPointId: string) => void;
  onOpenDesign: () => void;
};

const PLOT = { left: 76, right: 674, top: 32, bottom: 364 };
const FEATURE_KEYS: EnvelopeAxisKey[] = ["inletPressureBar", "massFlowKgS", "equivalenceRatio", "backPressureBar", "inletTemperatureK"];

function axisDefinition(key: EnvelopeAxisKey) { return ENVELOPE_AXES.find((axis) => axis.key === key)!; }
function formatAxis(value: number, key: EnvelopeAxisKey) {
  if (!Number.isFinite(value)) return "Not reported";
  if (key === "equivalenceRatio") return value.toFixed(2);
  if (key === "massFlowKgS") return value.toFixed(3);
  if (key === "inletTemperatureK") return value.toFixed(0);
  return value.toFixed(2);
}
function scale(value: number, limits: readonly [number, number], start: number, end: number) { return start + ((value - limits[0]) / Math.max(limits[1] - limits[0], 1e-12)) * (end - start); }
function classificationClass(classification: EnvelopeClassification) { return `envelope-${classification.toLowerCase()}`; }
function pointSummary(point: EnvelopePoint) {
  if (point.source === "published") return `The source reports “${point.reportedMode}.” The class color is Kythros's transparent wave-response grouping, not a claim about thrust, thermal limits, or whole-engine performance.`;
  if (point.classification === "Unclassified") return "The experimental pressure data do not identify one rotating mode at this operating point.";
  return `${point.classification} rotating-wave response · ${point.waveCount}-wave mode · ${point.identifiability.toLowerCase()} classification`;
}
function initialFixedValues(design: EngineDesign, points: OperatingPoint[]): EnvelopeFeatures {
  const first = points.find((point) => point.source === "uploaded")
    ?? points.find((point) => point.source === "published" && point.inletTemperatureK === design.inletTemperatureK)
    ?? points.find((point) => point.source === "published")
    ?? points[0];
  return {
    inletPressureBar: first?.inletPressureBar ?? 0.5 * (design.inletPressureBarMin + design.inletPressureBarMax),
    massFlowKgS: first?.massFlowKgS ?? 0.5 * (design.massFlowKgSMin + design.massFlowKgSMax),
    equivalenceRatio: first?.equivalenceRatio ?? 0.5 * (design.equivalenceRatioMin + design.equivalenceRatioMax),
    backPressureBar: first?.backPressureBar ?? design.backPressureBar,
    inletTemperatureK: first?.inletTemperatureK ?? design.inletTemperatureK,
  };
}
function observedValues(points: OperatingPoint[], key: EnvelopeAxisKey, fallback: number) {
  const values = [...new Set(points.map((point) => point[key]).filter(Number.isFinite))].sort((left, right) => left - right);
  return values.length ? values : Number.isFinite(fallback) ? [fallback] : [];
}
function conditionSummary(point: EnvelopePoint) {
  const inlet = Number.isFinite(point.inletPressureBar) ? `${point.inletPressureBar.toFixed(2)} bar inlet` : "inlet pressure not reported";
  return `${inlet} · ${point.massFlowKgS.toFixed(4)} kg/s total · φ ${point.equivalenceRatio.toFixed(2)} · ${point.inletTemperatureK.toFixed(0)} K · Pb ${point.backPressureBar.toFixed(3)} bar`;
}

export function OperatingEnvelope({ designs, activeDesignId, operatingPoints, runs, onSelectDesign, onAddOperatingPoint, onLoadDemo, onLoadPublished, onOpenRun, onAddBaselineCfd, onOpenDesign }: Props) {
  const activeDesign = designs.find((design) => design.id === activeDesignId) ?? designs[0] ?? null;
  const designPoints = useMemo(() => activeDesign ? operatingPoints.filter((point) => point.designId === activeDesign.id) : [], [activeDesign, operatingPoints]);
  const dataset = useMemo(() => buildEnvelopeDataset(designPoints, runs), [designPoints, runs]);
  const physicalPoints = dataset.points.filter((point) => point.source !== "demo");
  const demonstrationPoints = dataset.points.filter((point) => point.source === "demo");
  const [showDemonstration, setShowDemonstration] = useState(false);
  const [xAxis, setXAxis] = useState<EnvelopeAxisKey>("equivalenceRatio");
  const [yAxis, setYAxis] = useState<EnvelopeAxisKey>("inletTemperatureK");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fixedSelections, setFixedSelections] = useState<EnvelopeFeatures>(() => activeDesign ? initialFixedValues(activeDesign, designPoints) : { inletPressureBar: 1, massFlowKgS: 1, equivalenceRatio: 1, backPressureBar: 1, inletTemperatureK: 300 });
  const defaultFixedValues = activeDesign ? initialFixedValues(activeDesign, designPoints) : fixedSelections;
  const fixedValues = Object.fromEntries(FEATURE_KEYS.map((key) => {
    const values = observedValues(designPoints, key, defaultFixedValues[key]);
    return [key, values.includes(fixedSelections[key]) ? fixedSelections[key] : defaultFixedValues[key]];
  })) as EnvelopeFeatures;
  const availableAxes = ENVELOPE_AXES.filter((axis) => physicalPoints.length === 0 || physicalPoints.some((point) => Number.isFinite(point[axis.key])));
  const effectiveXAxis = availableAxes.some((axis) => axis.key === xAxis) ? xAxis : availableAxes[0]?.key ?? xAxis;
  const effectiveYAxis = availableAxes.some((axis) => axis.key === yAxis) && yAxis !== effectiveXAxis ? yAxis : availableAxes.find((axis) => axis.key !== effectiveXAxis)?.key ?? yAxis;
  const model = useMemo(() => activeDesign ? fitEnvelopeModel(dataset.points, activeDesign) : null, [activeDesign, dataset.points]);
  const domain = useMemo(() => activeDesign ? envelopeModelDomain(activeDesign, dataset.points) : null, [activeDesign, dataset.points]);
  const basePoints = physicalPoints.length ? physicalPoints : showDemonstration ? demonstrationPoints : [];
  const displayedPoints = basePoints.filter((point) => pointMatchesEnvelopeSlice(point, effectiveXAxis, effectiveYAxis, fixedValues));
  const selected = displayedPoints.find((point) => point.caseId === selectedId) ?? displayedPoints[0] ?? null;
  const plan = useMemo(() => activeDesign && activeDesign.source !== "published" ? buildScreeningPlan(activeDesign, designPoints) : [], [activeDesign, designPoints]);
  const coveragePoint = useMemo(() => selectCoverageNextPoint(plan), [plan]);
  const recommendation = model && domain ? recommendBoundaryPoint(model, domain, effectiveXAxis, effectiveYAxis, fixedValues) : null;
  const xLimits = domain?.[effectiveXAxis] ?? [0, 1] as const;
  const yLimits = domain?.[effectiveYAxis] ?? [0, 1] as const;
  const xDefinition = axisDefinition(effectiveXAxis);
  const yDefinition = axisDefinition(effectiveYAxis);
  const publishedPhiTemperatureSweep = activeDesign.source === "published" && [effectiveXAxis, effectiveYAxis].includes("equivalenceRatio") && [effectiveXAxis, effectiveYAxis].includes("inletTemperatureK");
  const fixedAxes = FEATURE_KEYS.filter((key) => key !== effectiveXAxis && key !== effectiveYAxis && !(publishedPhiTemperatureSweep && key === "massFlowKgS") && observedValues(designPoints, key, fixedValues[key]).length > 0);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  if (!activeDesign) return <section className="envelope-empty" aria-label="Operating envelope workspace"><span className="workspace-label">Operating Envelope</span><h1>Define an engine design or load published observations</h1><p>An envelope contains operating points from one documented geometry, injector configuration, and propellant pair.</p><div className="empty-actions"><button className="button primary" onClick={onOpenDesign}>Create engine design</button><button className="button secondary" onClick={onLoadPublished}>Load published test data</button><button className="button secondary" onClick={onLoadDemo}>Load synthetic demonstration</button></div></section>;

  const predictionCells = model?.status === "Exploratory model ready" && domain ? Array.from({ length: 18 * 18 }, (_, index) => {
    const column = index % 18;
    const row = Math.floor(index / 18);
    const features = { ...fixedValues };
    features[effectiveXAxis] = xLimits[0] + ((column + 0.5) / 18) * (xLimits[1] - xLimits[0]);
    features[effectiveYAxis] = yLimits[0] + ((row + 0.5) / 18) * (yLimits[1] - yLimits[0]);
    const prediction = model.predict(features);
    if (!prediction.supported || !prediction.classification) return null;
    return { column, row, prediction };
  }).filter(Boolean) as { column: number; row: number; prediction: ReturnType<typeof model.predict> }[] : [];

  return <section className="envelope-workspace" aria-label="Operating envelope workspace">
    <div className="envelope-heading"><div><span className="workspace-label">Operating Envelope</span><h1>{activeDesign.name}</h1><p>This is an observed propagation-mode map first. It becomes a predictive envelope only after raw-data and validation gates pass. Blank space is untested.</p></div><label className="design-map-selector"><span>Engine / design</span><select value={activeDesign.id} onChange={(event) => onSelectDesign(event.target.value)}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}</select></label></div>

    {activeDesign.source === "published" && <section className="published-data-banner"><div><strong>Two intersecting published sweeps · not a filled 2D envelope</strong><span>Thirteen unique Table 1 conditions vary inlet temperature at φ 1.19 or vary φ at 713 K while air flow stays 1.110 kg/s. Case 14 repeats Case 10 for a 3.13146 s duration check and is attached as repeatability evidence, not a duplicate marker. Blank regions were not tested; synchronized pressure files and tabulated plenum pressures were not published.</span></div><a href={physicalPoints[0]?.sourceUrl ?? "#"} target="_blank" rel="noreferrer">Open source paper</a></section>}
    {!physicalPoints.length && <section className="map-empty-banner"><div><strong>No real observed operating points yet</strong><span>Add synchronized experimental pressure data, or load the published example to test the observed-envelope workflow. CFD stays separate in Comparison.</span></div><div className="banner-actions"><button className="button secondary" onClick={onLoadPublished}>Load published test data</button><button className="button primary" onClick={() => onAddOperatingPoint(activeDesign.id)}>Add measured operating point</button></div></section>}

    <section className="envelope-readiness measured-summary" aria-label="Observed envelope summary">
      <article className="measured-stable"><span>{activeDesign.source === "published" ? "Single-wave observations" : "Stable rotating-wave points"}</span><strong>{dataset.stablePointCount}</strong><small>{activeDesign.source === "published" ? "Author reported a sustained single-wave mode" : "Uploaded measurements; synthetic data excluded"}</small></article>
      <article className="measured-transitional"><span>{activeDesign.source === "published" ? "Mixed / intermittent observations" : "Transitional points"}</span><strong>{dataset.transitionalPointCount}</strong><small>Intermittent, sporadic, or mode-changing observations</small></article>
      <article className="measured-unstable"><span>{activeDesign.source === "published" ? "Failed observations" : "Unstable / failed points"}</span><strong>{dataset.unstablePointCount}</strong><small>No sustained rotating-wave response was reported</small></article>
      <article className={model?.status === "Exploratory model ready" ? "model-ready" : "readiness-missing"}><span>Predictive layer</span><strong>{model?.status ?? "Not ready yet"}</strong><ul className="model-gate-list">{model?.gates.map((gate) => <li key={gate.id} className={gate.passed ? "passed" : "pending"}><i>{gate.passed ? "✓" : "○"}</i><span>{gate.label}</span><b>{gate.value}</b><small>{gate.detail}</small></li>)}</ul></article>
    </section>

    <details className="classification-method"><summary>How Kythros decides Stable, Transitional, and Unstable</summary><div><p><strong>Uploaded raw signals:</strong> Stable requires an identified mode, no mode transitions, frequency drift ≤3%, frequency variation ≤2%, and phase jitter ≤15°. Transitional permits at most one transition, drift ≤8%, variation ≤5%, and jitter ≤30°. Other identifiable responses are Unstable; non-identifiable signals stay Unclassified. These are explicit Kythros prototype thresholds.</p>{dataset.publishedPointCount > 0 && <p><strong>Published summaries:</strong> {GE_2022_CLASSIFICATION_NOTE}</p>}</div></details>

    <div className="envelope-layout">
      <section className="envelope-map-card">
        <div className="envelope-map-controls"><div><h2>Observed propagation mode by operating point</h2><p>Each marker is one physical test condition. Uploaded raw signals are classified by Kythros; published markers preserve the authors&apos; reported mode. A point does not by itself prove pressure gain, thrust, thermal acceptability, or repeatable operation.</p></div><div className="envelope-axis-controls"><label><span>Horizontal</span><select value={effectiveXAxis} onChange={(event) => setXAxis(event.target.value as EnvelopeAxisKey)}>{availableAxes.filter((axis) => axis.key !== effectiveYAxis).map((axis) => <option key={axis.key} value={axis.key}>{axis.label}</option>)}</select></label><label><span>Vertical</span><select value={effectiveYAxis} onChange={(event) => setYAxis(event.target.value as EnvelopeAxisKey)}>{availableAxes.filter((axis) => axis.key !== effectiveXAxis).map((axis) => <option key={axis.key} value={axis.key}>{axis.label}</option>)}</select></label></div></div>
        <div className="envelope-slice-controls"><strong>Held fixed for this 2D slice</strong>{fixedAxes.map((key) => { const definition = axisDefinition(key); const values = observedValues(designPoints, key, fixedValues[key]); return <label key={key}><span>{definition.label}</span><select value={fixedValues[key]} onChange={(event) => setFixedSelections((current) => ({ ...current, [key]: Number(event.target.value) }))}>{values.map((value) => <option key={value} value={value}>{formatAxis(value, key)}{definition.unit ? ` ${definition.unit}` : ""}</option>)}</select></label>; })}<small>{publishedPhiTemperatureSweep ? "Air flow is fixed at 1.110 kg/s; gasoline flow changes with φ, so total mass flow is coupled rather than held independently." : "Geometry, injector, propellants, and walls are fixed by the selected engine."}</small></div>
        <div className="envelope-plot-wrap"><svg className="envelope-plot" viewBox="0 0 720 410" role="img" aria-label={`${yDefinition.label} versus ${xDefinition.label} operating points`}>
          {predictionCells.map(({ column, row, prediction }) => <rect key={`prediction-${column}-${row}`} x={PLOT.left + column * (PLOT.right - PLOT.left) / 18} y={PLOT.bottom - (row + 1) * (PLOT.bottom - PLOT.top) / 18} width={(PLOT.right - PLOT.left) / 18 + 0.5} height={(PLOT.bottom - PLOT.top) / 18 + 0.5} className={`prediction-cell prediction-${prediction.classification!.toLowerCase()}`} opacity={Math.max(0.08, 0.48 * (1 - prediction.uncertainty))}><title>{prediction.classification} · uncertainty {(prediction.uncertainty * 100).toFixed(0)}%</title></rect>)}
          {ticks.map((fraction) => { const x = PLOT.left + fraction * (PLOT.right - PLOT.left); const y = PLOT.bottom - fraction * (PLOT.bottom - PLOT.top); const xValue = xLimits[0] + fraction * (xLimits[1] - xLimits[0]); const yValue = yLimits[0] + fraction * (yLimits[1] - yLimits[0]); return <g key={fraction}><line x1={x} x2={x} y1={PLOT.top} y2={PLOT.bottom} className="envelope-grid-line"/><line x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} className="envelope-grid-line"/><text x={x} y={PLOT.bottom + 24} textAnchor="middle">{formatAxis(xValue, effectiveXAxis)}</text><text x={PLOT.left - 14} y={y + 4} textAnchor="end">{formatAxis(yValue, effectiveYAxis)}</text></g>; })}
          <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} className="envelope-axis-line"/><line x1={PLOT.left} x2={PLOT.left} y1={PLOT.top} y2={PLOT.bottom} className="envelope-axis-line"/><text x={(PLOT.left + PLOT.right) / 2} y="404" textAnchor="middle" className="envelope-axis-title">{xDefinition.label}{xDefinition.unit ? ` (${xDefinition.unit})` : ""}</text><text x="17" y={(PLOT.top + PLOT.bottom) / 2} textAnchor="middle" className="envelope-axis-title" transform={`rotate(-90 17 ${(PLOT.top + PLOT.bottom) / 2})`}>{yDefinition.label}{yDefinition.unit ? ` (${yDefinition.unit})` : ""}</text>
          {displayedPoints.map((point) => { const x = scale(envelopeAxisValue(point, effectiveXAxis), xLimits, PLOT.left, PLOT.right); const y = scale(envelopeAxisValue(point, effectiveYAxis), yLimits, PLOT.bottom, PLOT.top); return <g key={point.caseId} className={`envelope-point ${classificationClass(point.classification)} ${selected?.caseId === point.caseId ? "selected" : ""} ${point.source === "demo" ? "demonstration" : ""}`} role="button" tabIndex={0} aria-label={`${point.name}: ${point.classification}`} onClick={() => setSelectedId(point.caseId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(point.caseId); }}><circle cx={x} cy={y} r={selected?.caseId === point.caseId ? 10 : 8}/><circle cx={x} cy={y} r="15" className="point-hit-area"/><title>{point.name}: {point.classification}</title></g>; })}
        </svg></div>
        <div className="envelope-legend"><span className="envelope-stable">Stable rotating-wave response</span><span className="envelope-transitional">Transitional response</span><span className="envelope-unstable">Unstable / failed response</span><span className="envelope-unclassified">Unclassified</span>{model?.status === "Exploratory model ready" && <span className="envelope-predicted">Exploratory prediction, fades with uncertainty</span>}<small>{displayedPoints.length} of {basePoints.length} points match this exact 2D slice.</small></div>
      </section>

      <div className="envelope-side-rail">
        {selected && <aside className="envelope-point-card"><div><span>{selected.source === "demo" ? "Synthetic demonstration" : selected.source === "published" ? "Published experimental observation" : "Uploaded measured operating point"}</span><h2>{selected.source === "published" ? selected.reportedMode : selected.classification}{selected.source !== "published" && selected.waveCount ? ` · ${selected.waveCount}-wave mode` : ""}</h2><p>{pointSummary(selected)}</p></div><dl><div><dt>Operating point</dt><dd>{selected.name}</dd></div><div><dt>Condition</dt><dd>{conditionSummary(selected)}</dd></div>{selected.reportedMode && <div><dt>Kythros wave-response class</dt><dd>{selected.classification} · display grouping only</dd></div>}<div><dt>Frequency and speed</dt><dd>{Number.isFinite(selected.waveFrequencyKHz) ? `${selected.waveFrequencyKHz.toFixed(4)} kHz` : "frequency not reported"} · {selected.waveSpeedMps === null ? "speed unavailable" : `${selected.waveSpeedMps.toFixed(0)} m/s from mean diameter, frequency, and wave count`}</dd></div>{selected.sourceLocator && <div><dt>Source location</dt><dd>{selected.sourceLocator}</dd></div>}<div><dt>CFD comparisons</dt><dd>{selected.runCount ? `${selected.runCount} run${selected.runCount === 1 ? "" : "s"} · ${selected.numericalStatus.toLowerCase()}` : "None added"}</dd></div></dl><div className="physics-layer-list"><strong>Evidence layers at this point</strong>{selected.physicsLayers.map((layer) => <span key={layer.id} className={`physics-layer-${layer.status}`}><i>{layer.status === "supported" ? "✓" : layer.status === "partial" ? "!" : "—"}</i><b>{layer.label}</b><small>{layer.summary}</small></span>)}</div><div className="evidence-factor-list"><strong>What this evidence status is based on</strong>{selected.evidenceFactors.map((factor) => <span key={factor.label} className={`factor-${factor.status}`}><i>{factor.status === "passed" ? "✓" : factor.status === "review" ? "!" : "—"}</i><b>{factor.label}</b><small>{factor.result}</small></span>)}</div><div className={`model-use model-use-${selected.modelUse.toLowerCase().replaceAll(" ", "-")}`}><strong>{selected.modelUse}</strong><span>{selected.source === "published" ? "Useful for testing the observed map and provenance display; excluded from signal-validation and predictive-model gates." : selected.source === "demo" ? "Excluded from physical evidence and model fitting." : selected.modelUse === "Eligible observation" ? "This raw experimental observation can inform the exploratory model once every gate passes." : "Resolve the listed experimental evidence limitation before model fitting."}</span></div>{selected.sourceUrl && <a className="button secondary envelope-source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">Open published source</a>}{selected.source === "uploaded" && (selected.runCount ? <button className="button secondary" onClick={() => onOpenRun(selected.caseId)}>Open comparison</button> : <button className="button secondary" onClick={() => onAddBaselineCfd(selected.operatingPointId)}>Add CFD comparison</button>)}</aside>}

        <aside className="envelope-point-card planned-next-card"><div><span>Next-test recommendation</span><h2>{recommendation ? "Test the uncertain boundary" : coveragePoint ? coveragePoint.role : "Not calculated yet"}</h2><p>{recommendation ? "This supported location is close to a measured class boundary and has high model uncertainty. It is chosen to reduce uncertainty, not maximize performance." : coveragePoint ? "This is the uncovered screening-plan condition farthest from the loaded raw measurements. It improves coverage; it is not a learned boundary recommendation." : activeDesign.source === "published" ? "The published summary can test the observed-envelope display, but it cannot support a new test coordinate without raw signals and a fully specified design range." : model?.reason ?? "Add raw measured points before fitting a predictive envelope."}</p></div>{recommendation ? <dl><div><dt>Inlet pressure</dt><dd>{recommendation.features.inletPressureBar.toFixed(2)} bar</dd></div><div><dt>Mass flow</dt><dd>{recommendation.features.massFlowKgS.toFixed(3)} kg/s</dd></div><div><dt>Equivalence ratio</dt><dd>φ {recommendation.features.equivalenceRatio.toFixed(2)}</dd></div><div><dt>Inlet temperature</dt><dd>{recommendation.features.inletTemperatureK.toFixed(0)} K</dd></div><div><dt>Back pressure</dt><dd>{recommendation.features.backPressureBar.toFixed(2)} bar</dd></div><div><dt>Prediction uncertainty</dt><dd>{(recommendation.prediction.uncertainty * 100).toFixed(0)}%</dd></div></dl> : coveragePoint && <dl><div><dt>Inlet pressure</dt><dd>{coveragePoint.inletPressureBar.toFixed(2)} bar</dd></div><div><dt>Mass flow</dt><dd>{coveragePoint.massFlowKgS.toFixed(3)} kg/s</dd></div><div><dt>Equivalence ratio</dt><dd>φ {coveragePoint.equivalenceRatio.toFixed(2)}</dd></div><div><dt>Inlet temperature</dt><dd>{coveragePoint.inletTemperatureK.toFixed(0)} K</dd></div></dl>}{(recommendation || coveragePoint) && <button className="button primary" onClick={() => onAddOperatingPoint(activeDesign.id, recommendation ? { id: "uncertain-boundary", role: "Uncertain boundary", inletPressureBar: recommendation.features.inletPressureBar, massFlowKgS: recommendation.features.massFlowKgS, equivalenceRatio: recommendation.features.equivalenceRatio, inletTemperatureK: recommendation.features.inletTemperatureK, matchedOperatingPointId: null, nearestDistance: recommendation.prediction.nearestDistance } : coveragePoint!)}>Add this operating point</button>}</aside>
      </div>
    </div>

    {!physicalPoints.length && demonstrationPoints.length > 0 && <section className="demonstration-toggle"><div><strong>Synthetic demonstration available</strong><span>It is excluded from every measured count, model gate, and recommendation.</span></div><button className="button secondary" onClick={() => setShowDemonstration((current) => !current)}>{showDemonstration ? "Hide demonstration" : "Show demonstration"}</button></section>}
    <section className="envelope-method-boundary"><strong>{model?.status === "Exploratory model ready" ? "Prediction is local and uncertainty-aware" : "Observed, not predicted"}</strong><p>{model?.status === "Exploratory model ready" ? "The model estimates stability-class and wave-mode probabilities. Colored cells appear only where at least three nearby eligible raw observations support a local estimate, and areas without nearby data remain blank. It does not predict backflow, pressure gain, thrust, or thermal loading." : `Kythros does not draw a boundary between observed markers. ${dataset.nextRequirement}`}</p></section>
    <details className="classification-method physics-sources"><summary>Why Kythros tracks performance, feed-system, thermal, and repeatability evidence</summary><div><p>{PHYSICS_SOURCE_LIMITATION}</p><ul>{PHYSICS_EVIDENCE_SOURCES.map((source) => <li key={source.title}><a href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}</strong></a><span>{source.authors} ({source.year}) · {source.contribution}</span></li>)}</ul></div></details>
  </section>;
}
