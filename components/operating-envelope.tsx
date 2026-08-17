"use client";

import { useMemo, useState } from "react";
import type { AnalysisCase } from "@/lib/caevera-types";
import {
  ENVELOPE_AXES,
  buildEnvelopeDataset,
  envelopeAxisValue,
  type EnvelopeAxisKey,
  type EnvelopeClassification,
  type EnvelopePoint,
} from "@/lib/operating-envelope";

type Props = {
  cases: AnalysisCase[];
  onAddCase: () => void;
  onLoadDemo: () => void;
  onOpenCase: (caseId: string) => void;
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

function domain(values: number[]) {
  if (!values.length) return [0, 1] as const;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.12, 0.1);
    return [minimum - padding, maximum + padding] as const;
  }
  const padding = (maximum - minimum) * 0.12;
  return [minimum - padding, maximum + padding] as const;
}

function scale(value: number, limits: readonly [number, number], start: number, end: number) {
  return start + ((value - limits[0]) / Math.max(limits[1] - limits[0], 1e-12)) * (end - start);
}

function classificationClass(classification: EnvelopeClassification) {
  return `envelope-${classification.toLowerCase()}`;
}

function pointSummary(point: EnvelopePoint) {
  if (point.classification === "Unclassified") return "The pressure data do not identify one rotating mode at this operating point.";
  return `${point.classification} experimental response with ${point.waveCount}-wave ${point.identifiability.toLowerCase()} classification.`;
}

export function OperatingEnvelope({ cases, onAddCase, onLoadDemo, onOpenCase }: Props) {
  const dataset = useMemo(() => buildEnvelopeDataset(cases), [cases]);
  const [xAxis, setXAxis] = useState<EnvelopeAxisKey>("equivalenceRatio");
  const [yAxis, setYAxis] = useState<EnvelopeAxisKey>("inletPressureBar");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = dataset.points.find((point) => point.caseId === selectedId) ?? dataset.points[0] ?? null;
  const xLimits = domain(dataset.points.map((point) => envelopeAxisValue(point, xAxis)));
  const yLimits = domain(dataset.points.map((point) => envelopeAxisValue(point, yAxis)));
  const xDefinition = axisDefinition(xAxis);
  const yDefinition = axisDefinition(yAxis);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  if (!dataset.points.length) return <section className="envelope-empty" aria-label="Operating envelope workspace">
    <span className="empty-kicker">OPERATING ENVELOPE WORKSPACE</span>
    <h1>Build the first observed operating map</h1>
    <p>This tab uses the cases from Compare &amp; diagnose. Add a matched experiment and CFD case first; Caevera will plot the measured operating point without filling untested regions.</p>
    <div className="empty-actions"><button className="button primary" onClick={onAddCase}>Add first operating point →</button><button className="button secondary" onClick={onLoadDemo}>Load synthetic demonstration</button></div>
    <div className="envelope-boundary"><strong>No prediction is running</strong><span>A validated envelope model has not been fitted, and injector-backflow data are not part of the current pressure-file input.</span></div>
  </section>;

  return <section className="envelope-workspace" aria-label="Operating envelope workspace">
    <div className="envelope-heading">
      <div><span className="empty-kicker">OPERATING ENVELOPE WORKSPACE</span><h1>Observed operating map</h1><p>The same cases remain available in Compare &amp; diagnose. This map shows analyzed observations only; blank space is untested, not predicted.</p></div>
      <span className={`envelope-status status-${dataset.status.toLowerCase().replaceAll(" ", "-")}`}>{dataset.status}</span>
    </div>

    <section className="envelope-readiness" aria-label="Envelope data status">
      <article><span>Physical points</span><strong>{dataset.uploadedPointCount}</strong><small>{dataset.demonstrationPointCount ? `${dataset.demonstrationPointCount} synthetic point${dataset.demonstrationPointCount === 1 ? "" : "s"} kept separate` : "User-provided experiment and CFD cases"}</small></article>
      <article><span>Modes identified</span><strong>{dataset.identifiedPointCount} / {dataset.points.length}</strong><small>Calculated from synchronized pressure-probe phase and spectral content</small></article>
      <article><span>Numerically converged</span><strong>{dataset.convergedPointCount} / {dataset.points.length}</strong><small>Requires a completed mesh or time-step sequence</small></article>
      <article className="readiness-missing"><span>Backflow measurements</span><strong>Not available</strong><small>No injector or plenum mass-flow channel is currently loaded</small></article>
    </section>

    <div className="envelope-layout">
      <section className="envelope-map-card">
        <div className="envelope-map-controls"><div><h2>Measured mode by operating point</h2><p>Each marker is one baseline case. Related CFD reruns support that point but do not create a new physical condition.</p></div><div className="envelope-axis-controls"><label><span>Horizontal</span><select value={xAxis} onChange={(event) => setXAxis(event.target.value as EnvelopeAxisKey)}>{ENVELOPE_AXES.filter((axis) => axis.key !== yAxis).map((axis) => <option key={axis.key} value={axis.key}>{axis.label}</option>)}</select></label><label><span>Vertical</span><select value={yAxis} onChange={(event) => setYAxis(event.target.value as EnvelopeAxisKey)}>{ENVELOPE_AXES.filter((axis) => axis.key !== xAxis).map((axis) => <option key={axis.key} value={axis.key}>{axis.label}</option>)}</select></label></div></div>
        <div className="envelope-plot-wrap"><svg className="envelope-plot" viewBox="0 0 720 410" role="img" aria-label={`${yDefinition.label} versus ${xDefinition.label} observed operating points`}>
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
          {dataset.points.map((point) => {
            const x = scale(envelopeAxisValue(point, xAxis), xLimits, PLOT.left, PLOT.right);
            const y = scale(envelopeAxisValue(point, yAxis), yLimits, PLOT.bottom, PLOT.top);
            return <g key={point.caseId} className={`envelope-point ${classificationClass(point.classification)} ${selected?.caseId === point.caseId ? "selected" : ""}`} role="button" tabIndex={0} aria-label={`${point.name}: ${point.classification}`} onClick={() => setSelectedId(point.caseId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(point.caseId); }}>
              <circle cx={x} cy={y} r={selected?.caseId === point.caseId ? 10 : 8}/><circle cx={x} cy={y} r="15" className="point-hit-area"/><title>{point.name}: {point.classification}</title>
            </g>;
          })}
        </svg></div>
        <div className="envelope-legend"><span className="envelope-stable">Stable</span><span className="envelope-transitional">Transitional</span><span className="envelope-unstable">Unstable</span><span className="envelope-unclassified">Unclassified</span><small>Marker colors are calculated from the experimental pressure signals.</small></div>
      </section>

      {selected && <aside className="envelope-point-card">
        <div><span>{selected.source === "demo" ? "SYNTHETIC OBSERVATION" : "USER-PROVIDED OBSERVATION"}</span><h2>{selected.name}</h2><p>{pointSummary(selected)}</p></div>
        <dl><div><dt>Operating point</dt><dd>φ {selected.equivalenceRatio.toFixed(2)} · {selected.inletPressureBar.toFixed(1)} bar · {selected.massFlowKgS.toFixed(2)} kg/s</dd></div><div><dt>Wave-passage frequency</dt><dd>{selected.waveFrequencyKHz.toFixed(2)} kHz</dd></div><div><dt>Propagation speed</dt><dd>{selected.waveSpeedMps === null ? "Not identifiable" : `${selected.waveSpeedMps.toFixed(0)} m/s`}</dd></div><div><dt>Mean measured pressure</dt><dd>{selected.meanPressureMpa.toFixed(3)} MPa</dd></div><div><dt>Mode variation</dt><dd>{selected.frequencyVariationPct.toFixed(1)}% frequency variation{selected.phaseJitterDeg === null ? "" : ` · ${selected.phaseJitterDeg.toFixed(1)}° phase jitter`}</dd></div><div><dt>CFD numerical status</dt><dd>{selected.numericalStatus} · {selected.cfdRerunCount} related rerun{selected.cfdRerunCount === 1 ? "" : "s"}</dd></div><div><dt>Backflow</dt><dd>Not assessed because no injector or plenum reverse-flow channel is loaded</dd></div></dl>
        <div className={`model-use model-use-${selected.modelUse.toLowerCase().replaceAll(" ", "-")}`}><strong>{selected.modelUse}</strong><span>{selected.source === "demo" ? "This point cannot train or validate a physical envelope." : selected.modelUse === "Eligible observation" ? "This observation meets the current signal and numerical gates, but a fitted model still requires more points and an explicit engine configuration." : "Resolve the stated data gate before using this point to fit an envelope."}</span></div>
        <button className="button secondary" onClick={() => onOpenCase(selected.caseId)}>Open full comparison</button>
      </aside>}
    </div>

    <section className="envelope-next-step"><div><span>WHAT IS NEEDED NEXT</span><h2>{dataset.nextRequirement}</h2></div><button className="button primary" onClick={onAddCase}>Add operating point</button></section>
    <section className="envelope-method-boundary"><strong>No surrogate prediction yet</strong><p>Caevera is not interpolating between markers, calculating injector backflow, or claiming an engine-wide stable region. Those outputs stay unavailable until a versioned model is trained and validated on a documented engine configuration.</p></section>
  </section>;
}
