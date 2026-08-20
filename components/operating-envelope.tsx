"use client";

import { useMemo, useState } from "react";
import type { AnalysisCase } from "@/lib/caevera-types";
import { buildScreeningPlan, selectCoverageNextPoint, type EngineDesign } from "@/lib/design-workspace";
import {
  ENVELOPE_AXES,
  buildEnvelopeDataset,
  envelopeAxisValue,
  type EnvelopeAxisKey,
  type EnvelopeClassification,
  type EnvelopePoint,
} from "@/lib/operating-envelope";

type Props = {
  designs: EngineDesign[];
  activeDesignId: string | null;
  cases: AnalysisCase[];
  onSelectDesign: (id: string) => void;
  onAddCase: (designId: string, point?: ReturnType<typeof buildScreeningPlan>[number]) => void;
  onLoadDemo: () => void;
  onOpenCase: (caseId: string) => void;
  onOpenDesign: () => void;
};

const PLOT = { left: 76, right: 674, top: 32, bottom: 364 };

function axisDefinition(key: EnvelopeAxisKey) {
  return ENVELOPE_AXES.find((axis) => axis.key === key)!;
}

function formatAxis(value: number, key: EnvelopeAxisKey) {
  if (key === "equivalenceRatio") return value.toFixed(2);
  if (key === "inletPressureBar") return value.toFixed(1);
  return value.toFixed(2);
}

function designDomain(design: EngineDesign, key: EnvelopeAxisKey): readonly [number, number] {
  if (key === "equivalenceRatio") return [design.equivalenceRatioMin, design.equivalenceRatioMax];
  if (key === "inletPressureBar") return [design.inletPressureBarMin, design.inletPressureBarMax];
  return [design.massFlowKgSMin, design.massFlowKgSMax];
}

function scale(value: number, limits: readonly [number, number], start: number, end: number) {
  return start + ((value - limits[0]) / Math.max(limits[1] - limits[0], 1e-12)) * (end - start);
}

function classificationClass(classification: EnvelopeClassification) {
  return `envelope-${classification.toLowerCase()}`;
}

function pointSummary(point: EnvelopePoint) {
  if (point.classification === "Unclassified") return "The pressure data do not identify one rotating mode at this operating point.";
  return `${point.classification} measured response · ${point.waveCount}-wave mode · ${point.identifiability.toLowerCase()} classification`;
}

export function OperatingEnvelope({ designs, activeDesignId, cases, onSelectDesign, onAddCase, onLoadDemo, onOpenCase, onOpenDesign }: Props) {
  const activeDesign = designs.find((design) => design.id === activeDesignId) ?? designs[0] ?? null;
  const designCases = useMemo(() => activeDesign ? cases.filter((item) => item.designId === activeDesign.id) : [], [activeDesign, cases]);
  const dataset = useMemo(() => buildEnvelopeDataset(designCases), [designCases]);
  const physicalPoints = dataset.points.filter((point) => point.source === "uploaded");
  const demonstrationPoints = dataset.points.filter((point) => point.source === "demo");
  const [showDemonstration, setShowDemonstration] = useState(false);
  const displayedPoints = physicalPoints.length ? physicalPoints : showDemonstration ? demonstrationPoints : [];
  const [xAxis, setXAxis] = useState<EnvelopeAxisKey>("equivalenceRatio");
  const [yAxis, setYAxis] = useState<EnvelopeAxisKey>("inletPressureBar");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = displayedPoints.find((point) => point.caseId === selectedId) ?? displayedPoints[0] ?? null;
  const plan = useMemo(() => activeDesign ? buildScreeningPlan(activeDesign, cases) : [], [activeDesign, cases]);
  const nextPoint = useMemo(() => selectCoverageNextPoint(plan), [plan]);
  const xLimits = activeDesign ? designDomain(activeDesign, xAxis) : [0, 1] as const;
  const yLimits = activeDesign ? designDomain(activeDesign, yAxis) : [0, 1] as const;
  const xDefinition = axisDefinition(xAxis);
  const yDefinition = axisDefinition(yAxis);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const identifiedPhysical = physicalPoints.filter((point) => point.identifiability === "Identified").length;
  const convergedPhysical = physicalPoints.filter((point) => point.numericalStatus === "Converged").length;

  if (!activeDesign) return <section className="envelope-empty" aria-label="Operating map workspace">
    <span className="workspace-label">Operating map</span>
    <h1>Define an engine design first</h1>
    <p>An operating map must contain conditions from one documented geometry, injector configuration, and propellant pair. Create the design before adding operating points.</p>
    <div className="empty-actions"><button className="button primary" onClick={onOpenDesign}>Create engine design</button><button className="button secondary" onClick={onLoadDemo}>Load synthetic demonstration</button></div>
  </section>;

  return <section className="envelope-workspace" aria-label="Operating map workspace">
    <div className="envelope-heading">
      <div><span className="workspace-label">Operating map</span><h1>{activeDesign.name}</h1><p>Solid markers are measured results. Hollow markers are planned conditions. Blank space has not been tested or predicted.</p></div>
      <label className="design-map-selector"><span>Engine design</span><select value={activeDesign.id} onChange={(event) => onSelectDesign(event.target.value)}>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}</select></label>
    </div>

    {!physicalPoints.length && <section className="map-empty-banner"><div><strong>No measured operating points yet</strong><span>The map below shows the screening plan only. Add experiment and CFD data to turn a hollow condition into a measured result.</span></div><button className="button primary" onClick={() => onAddCase(activeDesign.id)}>Add measured point</button></section>}

    <section className="envelope-readiness" aria-label="Operating-map data status">
      <article><span>Measured operating points</span><strong>{physicalPoints.length}</strong><small>Synthetic demonstrations never count as physical evidence</small></article>
      <article><span>Measured modes identified</span><strong>{identifiedPhysical} / {physicalPoints.length}</strong><small>Calculated from synchronized pressure-probe phase and spectral content</small></article>
      <article><span>CFD convergence complete</span><strong>{convergedPhysical} / {physicalPoints.length}</strong><small>Requires a completed mesh or time-step sequence at that point</small></article>
      <article className="readiness-missing"><span>Predictive envelope model</span><strong>Not fitted</strong><small>No interpolation, stability probability, backflow, performance, or thermal prediction</small></article>
    </section>

    <div className="envelope-layout">
      <section className="envelope-map-card">
        <div className="envelope-map-controls"><div><h2>Measured response and planned coverage</h2><p>Each solid marker is one physical operating point. Related CFD reruns support it without creating another marker.</p></div><div className="envelope-axis-controls"><label><span>Horizontal</span><select value={xAxis} onChange={(event) => setXAxis(event.target.value as EnvelopeAxisKey)}>{ENVELOPE_AXES.filter((axis) => axis.key !== yAxis).map((axis) => <option key={axis.key} value={axis.key}>{axis.label}</option>)}</select></label><label><span>Vertical</span><select value={yAxis} onChange={(event) => setYAxis(event.target.value as EnvelopeAxisKey)}>{ENVELOPE_AXES.filter((axis) => axis.key !== xAxis).map((axis) => <option key={axis.key} value={axis.key}>{axis.label}</option>)}</select></label></div></div>
        <div className="envelope-plot-wrap"><svg className="envelope-plot" viewBox="0 0 720 410" role="img" aria-label={`${yDefinition.label} versus ${xDefinition.label} operating points`}>
          {ticks.map((fraction) => {
            const x = PLOT.left + fraction * (PLOT.right - PLOT.left);
            const y = PLOT.bottom - fraction * (PLOT.bottom - PLOT.top);
            const xValue = xLimits[0] + fraction * (xLimits[1] - xLimits[0]);
            const yValue = yLimits[0] + fraction * (yLimits[1] - yLimits[0]);
            return <g key={fraction}><line x1={x} x2={x} y1={PLOT.top} y2={PLOT.bottom} className="envelope-grid-line"/><line x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} className="envelope-grid-line"/><text x={x} y={PLOT.bottom + 24} textAnchor="middle">{formatAxis(xValue, xAxis)}</text><text x={PLOT.left - 14} y={y + 4} textAnchor="end">{formatAxis(yValue, yAxis)}</text></g>;
          })}
          <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} className="envelope-axis-line"/><line x1={PLOT.left} x2={PLOT.left} y1={PLOT.top} y2={PLOT.bottom} className="envelope-axis-line"/>
          <text x={(PLOT.left + PLOT.right) / 2} y="404" textAnchor="middle" className="envelope-axis-title">{xDefinition.label}{xDefinition.unit ? ` (${xDefinition.unit})` : ""}</text>
          <text x="17" y={(PLOT.top + PLOT.bottom) / 2} textAnchor="middle" className="envelope-axis-title" transform={`rotate(-90 17 ${(PLOT.top + PLOT.bottom) / 2})`}>{yDefinition.label}{yDefinition.unit ? ` (${yDefinition.unit})` : ""}</text>
          {plan.filter((point) => !point.matchedCaseId).map((point) => {
            const x = scale(point[xAxis], xLimits, PLOT.left, PLOT.right);
            const y = scale(point[yAxis], yLimits, PLOT.bottom, PLOT.top);
            return <g key={point.id} className="planned-envelope-point"><circle cx={x} cy={y} r="6"/><title>{point.role}: planned, not tested</title></g>;
          })}
          {displayedPoints.map((point) => {
            const x = scale(envelopeAxisValue(point, xAxis), xLimits, PLOT.left, PLOT.right);
            const y = scale(envelopeAxisValue(point, yAxis), yLimits, PLOT.bottom, PLOT.top);
            return <g key={point.caseId} className={`envelope-point ${classificationClass(point.classification)} ${selected?.caseId === point.caseId ? "selected" : ""} ${point.source === "demo" ? "demonstration" : ""}`} role="button" tabIndex={0} aria-label={`${point.name}: ${point.classification}`} onClick={() => setSelectedId(point.caseId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(point.caseId); }}>
              <circle cx={x} cy={y} r={selected?.caseId === point.caseId ? 10 : 8}/><circle cx={x} cy={y} r="15" className="point-hit-area"/><title>{point.name}: {point.classification}</title>
            </g>;
          })}
        </svg></div>
        <div className="envelope-legend"><span className="envelope-stable">Stable measured</span><span className="envelope-transitional">Transitional measured</span><span className="envelope-unstable">Unstable measured</span><span className="envelope-unclassified">Unclassified</span><span className="envelope-planned">Planned, untested</span><small>Points can overlap when the third operating variable is not shown.</small></div>
      </section>

      {selected ? <aside className="envelope-point-card">
        <div><span>{selected.source === "demo" ? "Synthetic demonstration" : "Measured result"}</span><h2>{selected.classification}{selected.waveCount ? ` · ${selected.waveCount}-wave mode` : ""}</h2><p>{pointSummary(selected)}</p></div>
        <dl><div><dt>Case</dt><dd>{selected.name}</dd></div><div><dt>Operating condition</dt><dd>φ {selected.equivalenceRatio.toFixed(2)} · {selected.inletPressureBar.toFixed(1)} bar · {selected.massFlowKgS.toFixed(3)} kg/s</dd></div><div><dt>Frequency and speed</dt><dd>{selected.waveFrequencyKHz.toFixed(2)} kHz · {selected.waveSpeedMps === null ? "speed not identifiable" : `${selected.waveSpeedMps.toFixed(0)} m/s`}</dd></div><div><dt>Mode variation</dt><dd>{selected.frequencyVariationPct.toFixed(1)}% frequency variation{selected.phaseJitterDeg === null ? "" : ` · ${selected.phaseJitterDeg.toFixed(1)}° phase jitter`}</dd></div><div><dt>CFD numerical evidence</dt><dd>{selected.numericalStatus === "Sequence open" ? "Convergence sequence incomplete" : selected.numericalStatus} · {selected.cfdRerunCount} related rerun{selected.cfdRerunCount === 1 ? "" : "s"}</dd></div></dl>
        <div className={`model-use model-use-${selected.modelUse.toLowerCase().replaceAll(" ", "-")}`}><strong>{selected.modelUse}</strong><span>{selected.source === "demo" ? "This point demonstrates the interface and is excluded from physical evidence." : selected.modelUse === "Eligible observation" ? "This point is ready for a future documented model-fitting workflow." : "Resolve the stated evidence limitation before model fitting."}</span></div>
        <button className="button secondary" onClick={() => onOpenCase(selected.caseId)}>Open comparison</button>
      </aside> : <aside className="envelope-point-card planned-next-card">
        <div><span>Next planned condition</span><h2>{nextPoint?.role ?? "No untested plan point"}</h2><p>{nextPoint ? "Selected from the entered design range to improve coverage. It is not a predicted best-performing condition." : "Every planned point has a matched measured case."}</p></div>
        {nextPoint && <dl><div><dt>Equivalence ratio</dt><dd>φ {nextPoint.equivalenceRatio.toFixed(2)}</dd></div><div><dt>Mass flow</dt><dd>{nextPoint.massFlowKgS.toFixed(3)} kg/s</dd></div><div><dt>Inlet pressure</dt><dd>{nextPoint.inletPressureBar.toFixed(2)} bar</dd></div></dl>}
        {nextPoint && <button className="button primary" onClick={() => onAddCase(activeDesign.id, nextPoint)}>Add measured point</button>}
      </aside>}
    </div>

    {!physicalPoints.length && demonstrationPoints.length > 0 && <section className="demonstration-toggle"><div><strong>Synthetic demonstration available</strong><span>It is excluded from every measured count and from the coverage recommendation.</span></div><button className="button secondary" onClick={() => setShowDemonstration((current) => !current)}>{showDemonstration ? "Hide demonstration" : "Show demonstration"}</button></section>}
    <section className="envelope-method-boundary"><strong>Observed and planned, not predicted</strong><p>Caevera does not fill the space between markers, infer injector backflow from annulus pressure, or claim a stable engine-wide region. Those outputs remain unavailable until a versioned model is trained and validated for this engine design.</p></section>
  </section>;
}
