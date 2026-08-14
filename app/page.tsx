"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { PressureFileMapper } from "@/components/pressure-file-mapper";
import { buildCaseDelta, buildCaseHistoryEvidence, selectPlanningEvidence, summarizeCase, type CaseHistoryEvidence } from "@/lib/case-history";
import {
  EMPTY_METADATA,
  cloneMetadata,
  type AnalysisCase,
  type CaseRelationship,
  type CaseMetadata,
  type Dimensionality,
  type SensitivityVariable,
} from "@/lib/caevera-types";
import { buildCaseAssessment, type ControlledNextRun, type DiagnosticEvidence, type MetricAssessment } from "@/lib/diagnostics";
import { buildDecisionQuality, type DecisionQuality } from "@/lib/decision-quality";
import { KNOWLEDGE_BASE_VERSION, sourcesFor } from "@/lib/diagnostic-knowledge";
import { CASE_INPUT_HELP } from "@/lib/case-input-help";
import { WAVE_METHOD_SOURCES } from "@/lib/wave-method-sources";
import type { MappedProbeImport } from "@/lib/data-import";
import { PUBLISHED_VALIDATION_SOURCES, PUBLISHED_VALIDATION_SUMMARY, RAW_DATASET_VALIDATION_CASES } from "@/lib/published-benchmarks";
import { deserializeWorkspace, serializeWorkspace, workspaceFileName } from "@/lib/workspace";
import {
  ANALYSIS_VERSION,
  REVIEW_THRESHOLDS,
  makeDemoProbeSignals,
  type Comparison,
  type Signal,
} from "@/lib/rde-analysis";
import { analyzeRdeProbeSet, compareProbeSets, type RdeModeResult } from "@/lib/wave-dynamics";

const TEST_COLOR = "#2588a2";
const CFD_COLOR = "#6679bd";
const RESIDUAL_COLOR = "#c8873d";

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

function signed(value: number, digits: number) {
  if (!Number.isFinite(value)) return "Not available";
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

function outcomeLabel(state: "supports" | "weakens" | "unknown", sequenceStatus?: CaseHistoryEvidence["sequenceStatus"]) {
  if (sequenceStatus === "converged") return "Converged";
  return state === "supports" ? "Confirmed" : state === "weakens" ? "Rejected" : "Inconclusive";
}

function changeLabel(variable: SensitivityVariable) {
  return variable === "time-step" ? "Time-step" : variable.charAt(0).toUpperCase() + variable.slice(1);
}

function caseTabSummary(item: AnalysisCase) {
  if (!item.relationship) return `Baseline · φ ${item.metadata.equivalenceRatio.toFixed(2)} · ${item.metadata.inletPressureBar.toFixed(1)} bar`;
  if (item.relationship.changedVariable === "mesh") return `Mesh rerun · ${item.metadata.minimumCellSizeMm.toFixed(3)} mm minimum cell`;
  if (item.relationship.changedVariable === "time-step") return `Time-step rerun · ${item.metadata.timeStepUs.toFixed(3)} µs`;
  if (item.relationship.changedVariable === "chemistry") return `Chemistry rerun · ${item.metadata.chemistryModel}`;
  if (item.relationship.changedVariable === "wall") return `Wall rerun · ${item.metadata.wallBoundaryCondition}`;
  if (item.relationship.changedVariable === "inlet") return `Inlet rerun · ${item.metadata.inletBoundaryCondition}`;
  if (item.relationship.changedVariable === "initialization") return `Initialization rerun · ${item.metadata.initializationMethod}`;
  if (item.relationship.changedVariable === "unsteadiness") return "Measured unsteadiness rerun";
  return "Related comparison";
}

function outcomeMeaning(evidence: CaseHistoryEvidence) {
  if (evidence.sequenceStatus === "converged") return `Carry forward ${evidence.caseName}; the numerical sequence can now advance.`;
  if (evidence.state === "supports" && evidence.planDisposition === "continue") return `Carry forward ${evidence.caseName}; one adjacent numerical level is still required.`;
  if (evidence.state === "supports") return `Carry forward ${evidence.caseName}; the next unresolved cause can now be tested.`;
  if (evidence.state === "weakens") return `Do not carry forward ${evidence.caseName}; resume from ${evidence.referenceCaseName}.`;
  return `Do not carry forward ${evidence.caseName} yet; repeat from ${evidence.referenceCaseName} with a stronger one-variable contrast.`;
}

function conciseOutcomeDetail(evidence: CaseHistoryEvidence) {
  if (evidence.sequenceStatus === "converged" && Number.isFinite(evidence.incrementalResponsePct)) return `Adjacent-level response ${evidence.incrementalResponsePct!.toFixed(1)}% · converged`;
  if (evidence.state === "supports" && Number.isFinite(evidence.errorReductionPct)) return `Targeted error ↓ ${Math.abs(evidence.errorReductionPct!).toFixed(1)}%${evidence.newMismatchMetricIds?.length ? " · new mismatch found" : " · no new mismatch"}`;
  if (evidence.state === "weakens" && Number.isFinite(evidence.responseMagnitudePct)) return `Targeted response ${evidence.responseMagnitudePct!.toFixed(1)}% · rejected`;
  if (evidence.state === "unknown" && Number.isFinite(evidence.responseMagnitudePct)) return `Targeted response ${evidence.responseMagnitudePct!.toFixed(1)}% · inconclusive`;
  return evidence.controlled ? evidence.detail.split(".")[0] : evidence.relationshipIssues[0] ?? "The one-change relationship could not be verified";
}

function comparisonOnlyMeaning(evidence: CaseHistoryEvidence) {
  const issues = evidence.relationshipIssues.length ? evidence.relationshipIssues.join(" ") : "The declared relationship could not be verified.";
  return `Caevera did not use this rerun to update the plan. ${issues}`;
}

function evidenceBasisLabel(basis: DiagnosticEvidence["basis"]) {
  if (basis === "case-history") return "Controlled rerun";
  if (basis === "literature") return "Engineering rule";
  if (basis === "policy") return "Required next evidence";
  return "Current case";
}

function EvidenceLedgerColumn({
  title,
  emptyMessage,
  items,
  tone,
}: {
  title: string;
  emptyMessage: string;
  items: DiagnosticEvidence[];
  tone: "supports" | "weakens" | "unknowns";
}) {
  return <article className={`reasoning-column reasoning-${tone}`}>
    <header><span>{title}</span><b>{items.length}</b></header>
    {items.length ? <ul>{items.slice(0, 2).map((item, index) => <li key={`${item.basis}-${item.observation}-${index}`}>
      <small>{evidenceBasisLabel(item.basis)}</small>
      <strong>{item.observation}</strong>
    </li>)}</ul> : <div className="reasoning-empty">{emptyMessage}</div>}
    {items.length > 2 && <small className="reasoning-more">+{items.length - 2} more in report</small>}
  </article>;
}

type AnalysisInputSummary = {
  source: AnalysisCase["source"];
  experimentSamples: number;
  cfdSamples: number;
  probeCount: number;
  experimentName: string;
  cfdName: string;
};

function summarizeAnalysisInput(item: AnalysisCase | null): AnalysisInputSummary {
  return {
    source: item?.source ?? "uploaded",
    experimentSamples: item?.testSignals.reduce((sum, signal) => sum + signal.pressure.length, 0) ?? 0,
    cfdSamples: item?.cfdSignals.reduce((sum, signal) => sum + signal.pressure.length, 0) ?? 0,
    probeCount: item?.testSignals.length ?? 0,
    experimentName: item?.imports?.experiment.fileName ?? item?.testSignals[0]?.name.split(" · ")[0] ?? "Experiment data",
    cfdName: item?.imports?.cfd.fileName ?? item?.cfdSignals[0]?.name.split(" · ")[0] ?? "CFD data",
  };
}

type DecisionSummary = {
  label: string;
  lead: string;
  title: string;
  meaning: string;
  detail: string | null;
  tone: "neutral" | "confirmed" | "converged" | "rejected" | "inconclusive";
};

function metricDigits(metric: MetricAssessment) {
  if (["frequency", "amplitude", "peak-pressure", "mean-pressure", "impulse"].includes(metric.id)) return metric.id === "frequency" ? 2 : 3;
  if (metric.id === "speed") return 0;
  if (metric.id === "rise-time") return 1;
  if (metric.id === "harmonics") return 3;
  if (["cycle-variability", "phase-pattern", "frequency-drift", "phase-jitter"].includes(metric.id)) return 1;
  return 0;
}

function formatMetricValue(metric: MetricAssessment, value: number | string) {
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "Not assessed";
  const digits = metricDigits(metric);
  if (metric.id === "cycle-variability") return `${value.toFixed(digits)} %`;
  return `${value.toFixed(digits)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function formatMetricDifference(metric: MetricAssessment) {
  if (typeof metric.difference === "string") return metric.difference;
  const absolute = metric.id === "cycle-variability"
    ? `${signed(metric.difference, metricDigits(metric))} pt`
    : `${signed(metric.difference, metricDigits(metric))}${metric.unit ? ` ${metric.unit}` : ""}`;
  return metric.percentDifference === null || !Number.isFinite(metric.percentDifference)
    ? absolute
    : `${absolute} (${signed(metric.percentDifference, 1)}%)`;
}

function polylinePoints(values: number[], width: number, height: number, min: number, max: number, left = 0, top = 0) {
  const range = Math.max(max - min, 1e-9);
  return values.map((value, index) => {
    const x = left + (index / Math.max(values.length - 1, 1)) * width;
    const y = top + height - ((value - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function PlotGrid({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return <>
    {Array.from({ length: 7 }, (_, index) => <line key={`v-${index}`} x1={left + index * width / 6} y1={top} x2={left + index * width / 6} y2={top + height} className="grid-line" />)}
    {Array.from({ length: 5 }, (_, index) => <line key={`h-${index}`} x1={left} y1={top + index * height / 4} x2={left + width} y2={top + index * height / 4} className="grid-line" />)}
  </>;
}

function SignalChart({ comparison }: { comparison: Comparison }) {
  const all = [...comparison.test, ...comparison.cfd];
  const minimum = Math.min(...all);
  const maximum = Math.max(...all);
  const middle = (minimum + maximum) / 2;
  const start = comparison.time[0] ?? 0;
  const end = comparison.time.at(-1) ?? 0;
  const left = 96; const top = 16; const width = 734; const height = 236;
  return <div className="chart" role="img" aria-label="Aligned experimental and CFD pressure histories">
    <svg viewBox="0 0 860 324">
      <PlotGrid left={left} top={top} width={width} height={height} />
      <polyline className="series-cfd" points={polylinePoints(comparison.cfd, width, height, minimum, maximum, left, top)} fill="none" stroke={CFD_COLOR} vectorEffect="non-scaling-stroke" />
      <polyline className="series-experiment" points={polylinePoints(comparison.test, width, height, minimum, maximum, left, top)} fill="none" stroke={TEST_COLOR} vectorEffect="non-scaling-stroke" />
      <text x="82" y={top + 4} textAnchor="end" className="axis-value">{maximum.toFixed(2)}</text>
      <text x="82" y={top + height / 2 + 4} textAnchor="end" className="axis-value">{middle.toFixed(2)}</text>
      <text x="82" y={top + height + 4} textAnchor="end" className="axis-value">{minimum.toFixed(2)}</text>
      <text x={left} y="278" className="axis-value">{start.toFixed(2)}</text>
      <text x={left + width} y="278" textAnchor="end" className="axis-value">{end.toFixed(2)}</text>
      <text x={left + width / 2} y="313" textAnchor="middle" className="axis-title">TIME (ms)</text>
      <text x="22" y={top + height / 2} transform={`rotate(-90 22 ${top + height / 2})`} textAnchor="middle" className="axis-title">PRESSURE (MPa)</text>
    </svg>
  </div>;
}

function SpectrumChart({ comparison }: { comparison: Comparison }) {
  const maximumFrequency = Math.min(Math.max(comparison.testFrequency, comparison.cfdFrequency) * 2.2, comparison.testSpectrum.frequency.at(-1) ?? 20);
  const trim = (data: { frequency: number[]; amplitude: number[] }) => data.amplitude
    .map((value, index) => ({ frequency: data.frequency[index], value: Math.log10(Math.max(value, 1e-5)) }))
    .filter((point) => point.frequency <= maximumFrequency);
  const test = trim(comparison.testSpectrum).map((point) => point.value);
  const cfd = trim(comparison.cfdSpectrum).map((point) => point.value);
  const all = [...test, ...cfd];
  const minimum = Math.min(...all); const maximum = Math.max(...all);
  const middle = (minimum + maximum) / 2;
  const left = 96; const top = 16; const width = 734; const height = 236;
  return <div className="chart" role="img" aria-label="Experimental and CFD pressure spectra">
    <svg viewBox="0 0 860 324">
      <PlotGrid left={left} top={top} width={width} height={height} />
      <polyline className="series-cfd" points={polylinePoints(cfd, width, height, minimum, maximum, left, top)} fill="none" stroke={CFD_COLOR} vectorEffect="non-scaling-stroke" />
      <polyline className="series-experiment" points={polylinePoints(test, width, height, minimum, maximum, left, top)} fill="none" stroke={TEST_COLOR} vectorEffect="non-scaling-stroke" />
      <text x="82" y={top + 4} textAnchor="end" className="axis-value">{maximum.toFixed(2)}</text>
      <text x="82" y={top + height / 2 + 4} textAnchor="end" className="axis-value">{middle.toFixed(2)}</text>
      <text x="82" y={top + height + 4} textAnchor="end" className="axis-value">{minimum.toFixed(2)}</text>
      <text x={left} y="278" className="axis-value">0</text>
      <text x={left + width / 2} y="278" textAnchor="middle" className="axis-value">{(maximumFrequency / 2).toFixed(1)}</text>
      <text x={left + width} y="278" textAnchor="end" className="axis-value">{maximumFrequency.toFixed(1)}</text>
      <text x={left + width / 2} y="313" textAnchor="middle" className="axis-title">FREQUENCY (kHz)</text>
      <text x="22" y={top + height / 2} transform={`rotate(-90 22 ${top + height / 2})`} textAnchor="middle" className="axis-title">LOG AMPLITUDE</text>
    </svg>
  </div>;
}

function ResidualChart({ comparison }: { comparison: Comparison }) {
  const residual = comparison.test.map((value, index) => value - comparison.cfd[index]);
  const bound = Math.max(...residual.map(Math.abs), 1e-4);
  const start = comparison.time[0] ?? 0; const end = comparison.time.at(-1) ?? 0;
  const left = 96; const top = 16; const width = 734; const height = 236;
  return <div className="chart" role="img" aria-label="Experimental pressure minus CFD pressure residual">
    <svg viewBox="0 0 860 324">
      <PlotGrid left={left} top={top} width={width} height={height} />
      <line x1={left} y1={top + height / 2} x2={left + width} y2={top + height / 2} className="zero-line" />
      <polyline className="series-residual" points={polylinePoints(residual, width, height, -bound, bound, left, top)} fill="none" stroke={RESIDUAL_COLOR} vectorEffect="non-scaling-stroke" />
      <text x="82" y={top + 4} textAnchor="end" className="axis-value">+{bound.toFixed(2)}</text>
      <text x="82" y={top + height / 2 + 4} textAnchor="end" className="axis-value">0</text>
      <text x="82" y={top + height + 4} textAnchor="end" className="axis-value">−{bound.toFixed(2)}</text>
      <text x={left} y="278" className="axis-value">{start.toFixed(2)}</text>
      <text x={left + width} y="278" textAnchor="end" className="axis-value">{end.toFixed(2)}</text>
      <text x={left + width / 2} y="313" textAnchor="middle" className="axis-title">TIME (ms)</text>
      <text x="22" y={top + height / 2} transform={`rotate(-90 22 ${top + height / 2})`} textAnchor="middle" className="axis-title">PRESSURE DIFFERENCE (MPa)</text>
    </svg>
  </div>;
}

function PhaseChart({ experiment, simulation, positionsDeg }: { experiment: RdeModeResult; simulation: RdeModeResult; positionsDeg: number[] }) {
  const left = 96; const top = 16; const width = 734; const height = 236;
  const order = positionsDeg.map((position, index) => ({ position: ((position % 360) + 360) % 360, index })).sort((a, b) => a.position - b.position);
  const points = (values: number[]) => positionsDeg.map((position, index) => {
    const ordered = order[index];
    const x = left + ordered.position / 360 * width;
    const y = top + height - (values[ordered.index] + 180) / 360 * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return <div className="chart" role="img" aria-label="Circumferential phase pattern at the dominant passage frequency">
    <svg viewBox="0 0 860 324">
      <PlotGrid left={left} top={top} width={width} height={height} />
      <line x1={left} y1={top + height / 2} x2={left + width} y2={top + height / 2} className="zero-line" />
      <polyline className="series-cfd" points={points(simulation.probePhasesDeg)} fill="none" stroke={CFD_COLOR} vectorEffect="non-scaling-stroke" />
      <polyline className="series-experiment" points={points(experiment.probePhasesDeg)} fill="none" stroke={TEST_COLOR} vectorEffect="non-scaling-stroke" />
      {positionsDeg.map((position, index) => <g key={index}><circle cx={left + (((position % 360) + 360) % 360) / 360 * width} cy={top + height - (experiment.probePhasesDeg[index] + 180) / 360 * height} r="4" fill={TEST_COLOR} /><circle cx={left + (((position % 360) + 360) % 360) / 360 * width} cy={top + height - (simulation.probePhasesDeg[index] + 180) / 360 * height} r="4" fill={CFD_COLOR} /></g>)}
      <text x="82" y={top + 4} textAnchor="end" className="axis-value">+180</text><text x="82" y={top + height / 2 + 4} textAnchor="end" className="axis-value">0</text><text x="82" y={top + height + 4} textAnchor="end" className="axis-value">−180</text>
      <text x={left} y="278" className="axis-value">0</text><text x={left + width / 2} y="278" textAnchor="middle" className="axis-value">180</text><text x={left + width} y="278" textAnchor="end" className="axis-value">360</text>
      <text x={left + width / 2} y="313" textAnchor="middle" className="axis-title">PROBE POSITION (deg)</text>
      <text x="22" y={top + height / 2} transform={`rotate(-90 22 ${top + height / 2})`} textAnchor="middle" className="axis-title">RELATIVE PHASE (deg)</text>
    </svg>
  </div>;
}

function CycleChart({ experiment, simulation }: { experiment: RdeModeResult; simulation: RdeModeResult }) {
  const all = [...experiment.cycleSeries, ...simulation.cycleSeries];
  const start = Math.min(...all.map((point) => point.timeMs));
  const end = Math.max(...all.map((point) => point.timeMs));
  const render = (key: "frequencyKHz" | "peakPressureMpa", label: string, digits: number) => {
    const left = 96; const top = 12; const width = 734; const height = 124;
    const minimum = Math.min(...all.map((point) => point[key]));
    const maximum = Math.max(...all.map((point) => point[key]));
    const points = (mode: RdeModeResult) => mode.cycleSeries.map((point) => {
      const x = left + (point.timeMs - start) / Math.max(end - start, 1e-12) * width;
      const y = top + height - (point[key] - minimum) / Math.max(maximum - minimum, 1e-12) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
    return <svg key={key} viewBox="0 0 860 210" aria-label={label}>
      <PlotGrid left={left} top={top} width={width} height={height} />
      <polyline className="series-cfd" points={points(simulation)} fill="none" stroke={CFD_COLOR} vectorEffect="non-scaling-stroke" />
      <polyline className="series-experiment" points={points(experiment)} fill="none" stroke={TEST_COLOR} vectorEffect="non-scaling-stroke" />
      <text x="82" y={top + 4} textAnchor="end" className="axis-value">{maximum.toFixed(digits)}</text><text x="82" y={top + height + 4} textAnchor="end" className="axis-value">{minimum.toFixed(digits)}</text>
      <text x={left} y="162" className="axis-value">{start.toFixed(2)}</text><text x={left + width} y="162" textAnchor="end" className="axis-value">{end.toFixed(2)}</text>
      <text x={left + width / 2} y="197" textAnchor="middle" className="axis-title">TIME (ms)</text>
      <text x="22" y={top + height / 2} transform={`rotate(-90 22 ${top + height / 2})`} textAnchor="middle" className="axis-title">{label}</text>
    </svg>;
  };
  return <div className="chart cycle-chart-stack" role="img" aria-label="Cycle-by-cycle passage frequency and peak pressure">
    {render("frequencyKHz", "FREQUENCY (kHz)", 2)}
    {render("peakPressureMpa", "PEAK PRESSURE (MPa)", 2)}
  </div>;
}

function Legend({ residual = false }: { residual?: boolean }) {
  return <div className="legend" aria-label="Chart legend">{residual
    ? <div className="legend-item"><i className="legend-residual" /><span><strong>Pressure difference</strong><small>Measured experiment minus CFD simulation</small></span></div>
    : <><div className="legend-item"><i className="legend-test" /><span><strong>Measured experiment</strong><small>Solid teal line</small></span></div><div className="legend-item"><i className="legend-cfd" /><span><strong>CFD simulation</strong><small>Dashed blue line</small></span></div></>
  }</div>;
}

function EngineeringDecisionPanel({
  summary,
  nextRun,
  showLatestResult,
  decisionQuality,
  selectedCaseName,
  selectedAnalysisInput,
  planningCaseName,
  publishedSourceCount,
  publishedValidation,
  onEdit,
  onDownloadReport,
  onSaveWorkspace,
  onViewHistory,
}: {
  summary: DecisionSummary;
  nextRun: ControlledNextRun;
  showLatestResult: boolean;
  decisionQuality: DecisionQuality;
  selectedCaseName: string;
  selectedAnalysisInput: AnalysisInputSummary;
  planningCaseName: string;
  publishedSourceCount: number;
  publishedValidation: typeof PUBLISHED_VALIDATION_SUMMARY;
  onEdit: () => void;
  onDownloadReport: () => void;
  onSaveWorkspace: () => void;
  onViewHistory: (() => void) | null;
}) {
  const precedent = nextRun.precedent;
  const isDemo = selectedAnalysisInput.source === "demo";
  const planUsesDifferentCase = selectedCaseName !== planningCaseName;
  const ledger = nextRun.reasoningLedger;
  const policy = nextRun.decisionPolicy;
  const isNumericalPolicy = policy.evaluationMode === "numerical-convergence" && policy.changedVariable != null && policy.convergenceResponsePct != null;
  const isModelSensitivityPolicy = policy.evaluationMode === "model-sensitivity" && policy.changedVariable != null;
  const testedVariable = policy.changedVariable ? changeLabel(policy.changedVariable).toLowerCase() : "selected";
  const conclusionHeading = summary.label === "Result of this rerun" ? "What this rerun concluded" : "What this case shows";
  const startingPointReason = summary.tone === "rejected"
    ? "The selected change was rejected and is not carried forward."
    : summary.tone === "inconclusive"
      ? "The selected change was inconclusive and is not carried forward."
      : summary.label === "Current diagnosis"
        ? "This is the latest accepted setting in the case family."
        : "This accepted setting is carried forward.";
  return <section className={`engineering-decision-card decision-${summary.tone}${isDemo ? " decision-demo" : ""}`} aria-label="Engineering decision">
    <div className="decision-quality" aria-label={`Decision quality ${decisionQuality.score} out of ${decisionQuality.maximumScore}`}>
      <div className="decision-quality-score"><span>Decision quality</span><strong>{decisionQuality.score}<small>/{decisionQuality.maximumScore}</small></strong></div>
      <div className="decision-quality-copy"><strong>{decisionQuality.label}</strong><small>{isDemo ? "Generated data; not real-engine evidence." : decisionQuality.score >= 4 ? "Enough evidence to act; engineering review still required." : "Useful next test; evidence is incomplete."}</small></div>
      <div className="decision-quality-scale" aria-hidden="true">{Array.from({ length: decisionQuality.maximumScore }, (_, index) => <i key={index} className={index < decisionQuality.score ? "filled" : ""} />)}</div>
    </div>
    <section className="decision-block decision-conclusion-block" aria-labelledby="decision-conclusion-heading">
      <div className="decision-block-heading"><b>1</b><h2 id="decision-conclusion-heading">{conclusionHeading}</h2></div>
      <header className="engineering-decision-heading">
        <div><span>{summary.label}</span></div>
        <h3><span>{summary.lead}</span> {summary.title}</h3>
        {summary.detail && <p className="decision-detail">{summary.detail}</p>}
        <p className="decision-meaning">{summary.meaning}</p>
      </header>
      {showLatestResult && nextRun.latestControlledResult.status !== "Awaiting result" && <div className={`decision-latest-result outcome-${nextRun.latestControlledResult.status.toLowerCase()}`}><strong>Latest family result: {nextRun.latestControlledResult.status}</strong><span>{nextRun.latestControlledResult.caseName}</span><p>{nextRun.latestControlledResult.detail}</p></div>}
    </section>
    <section className="decision-block decision-recommendation-block" aria-labelledby="decision-recommendation-heading">
      <div className="decision-block-heading"><b>2</b><h2 id="decision-recommendation-heading">Shared next run for this case family</h2></div>
      {planUsesDifferentCase && <div className="decision-scope">
        <strong>Starting point</strong>
        <span>Use <b>{planningCaseName}</b>. {startingPointReason}</span>
      </div>}
      <div className="decision-next-run">
        <span>Do this next</span><h3>{nextRun.title}</h3>
      </div>
      <div className="next-run-action">
        <p><strong>Change only this</strong><span>{nextRun.change}</span></p>
        <p><strong>Keep fixed</strong><span>{nextRun.holdFixed.join(" · ")}</span></p>
        <p><strong>Success looks like</strong><span>{nextRun.expectedOutcome}</span></p>
      </div>
      <section className="decision-reasoning" aria-label="Why Caevera recommends this run">
        <div className="decision-reasoning-heading">
          <span>Question being tested</span>
          <h3>{nextRun.question}</h3>
        </div>
        <div className="reasoning-ledger">
          <EvidenceLedgerColumn title="Evidence for it" emptyMessage="No direct supporting evidence." items={ledger.supports} tone="supports" />
          <EvidenceLedgerColumn title="Evidence against it" emptyMessage="None loaded. That does not prove the cause." items={ledger.weakens} tone="weakens" />
          <EvidenceLedgerColumn title="Still unknown" emptyMessage="No unresolved evidence item." items={ledger.unknowns} tone="unknowns" />
        </div>
        <div className="decision-priority">
          <strong>Why it comes first</strong>
          <p>{nextRun.whyThisRunFirst}</p>
        </div>
      </section>
      <section className="decision-outcomes" aria-label="How the result changes the plan">
        <div><span>How this run will be judged</span></div>
        {isNumericalPolicy ? <>
          <div className="outcome-rules">
            <article className="branch-converged"><strong>Converged</strong><span>Targeted CFD outputs change by ≤{policy.convergenceResponsePct!.toFixed(1)}% from the starting level.</span><small>Keep the new setting; continue the plan.</small></article>
            <article className="branch-confirmed"><strong>{changeLabel(policy.changedVariable!)} still matters</strong><span>Targeted CFD outputs change by &gt;{policy.convergenceResponsePct!.toFixed(1)}% from the starting level.</span><small>Keep the new setting; run the next {testedVariable} level.</small></article>
            <article className="branch-inconclusive"><strong>Cannot judge</strong><span>The levels cannot be compared or the targeted outputs are unavailable.</span><small>Fix the comparison and repeat this one-variable run.</small></article>
          </div>
          <p className="decision-agreement-note"><strong>Reported separately:</strong> whether agreement with the experiment improved, worsened, or created a new mismatch.</p>
        </> : isModelSensitivityPolicy ? <div className="outcome-rules">
          <article className="branch-confirmed"><strong>Supports the cause</strong><span>Mean targeted error falls by ≥{policy.confirmationErrorReductionPct!.toFixed(1)}% and no new mismatch appears.</span><small>Carry the change forward; continue the plan.</small></article>
          <article className="branch-rejected"><strong>Does not support it</strong><span>Response is &lt;{policy.minimumResponsePct!.toFixed(1)}%, error worsens by ≥{policy.rejectionErrorWorseningPct!.toFixed(1)}%, or a new mismatch appears.</span><small>Return to the starting settings; test the next cause.</small></article>
          <article className="branch-inconclusive"><strong>Unclear</strong><span>None of the rules above is met.</span><small>Repeat with a larger one-variable change or lower uncertainty.</small></article>
        </div> : <div className="outcome-rules">
          <article className="branch-confirmed"><strong>Passes</strong><span>{nextRun.confirmationCriterion}</span><small>{nextRun.ifConfirmed}</small></article>
          <article className="branch-rejected"><strong>Does not pass</strong><span>{nextRun.rejectionCriterion}</span><small>{nextRun.ifRejected}</small></article>
          <article className="branch-inconclusive"><strong>Unclear</strong><span>{nextRun.inconclusiveCriterion}</span><small>{nextRun.ifInconclusive}</small></article>
        </div>}
      </section>
      <div className="decision-precedent" aria-label="Comparable controlled reruns">
        <span>What prior cases tell you</span>
        {precedent.matchedCount ? <>
          <p><strong>{precedent.confirmedCount} of {precedent.matchedCount} similar {precedent.level === "Demonstration" ? "synthetic" : "company"} reruns showed the same response.</strong></p>
          {isDemo && <small>Synthetic only. Do not treat this as engine evidence.</small>}
        </> : <>
          <p><strong>No comparable company rerun.</strong> Current-case evidence only.</p>
        </>}
      </div>
      <details className="decision-evidence">
        <summary>Why {decisionQuality.score}/{decisionQuality.maximumScore}?</summary>
        <p className="selected-data-source"><strong>{selectedCaseName}</strong> · {selectedAnalysisInput.experimentSamples.toLocaleString()} experiment + {selectedAnalysisInput.cfdSamples.toLocaleString()} CFD values · {selectedAnalysisInput.probeCount} probes</p>
        {planUsesDifferentCase && <p className="planning-data-source"><strong>Plan reference:</strong> {planningCaseName}</p>}
        <ul>{decisionQuality.gates.map((gate) => <li key={gate.id} className={gate.satisfied ? "" : "evidence-missing"}><i>{gate.satisfied ? "✓" : "–"}</i><strong>{gate.label}</strong><small>{gate.result}</small></li>)}</ul>
        <p>{publishedSourceCount} engineering sources · {publishedValidation.waveSpeedCases + publishedValidation.pressureFixtureCases} analyzer checks · method support only</p>
      </details>
      {precedent.matchedCount > 0 && <div className="decision-details"><details><summary>Show analyzed prior-case counts</summary><div className="precedent-outcomes"><span><b>{precedent.confirmedCount}</b> confirmed</span><span><b>{precedent.convergedCount}</b> converged</span><span><b>{precedent.rejectedCount}</b> rejected</span><span><b>{precedent.inconclusiveCount}</b> inconclusive</span></div><p>{precedent.matchedCount} comparable controlled rerun{precedent.matchedCount === 1 ? "" : "s"} analyzed. Metric means use confirmed cases only{precedent.runtimeCaseCount ? `; runtime uses ${precedent.runtimeCaseCount} confirmed case${precedent.runtimeCaseCount === 1 ? "" : "s"} with entered solver hours` : ""}.</p></details></div>}
    </section>
    <div className="decision-actions"><button className="button secondary" onClick={onEdit}>Edit case</button><button className="button secondary" onClick={onDownloadReport}>Download evidence report</button><button className="button secondary" onClick={onSaveWorkspace}>Save complete workspace</button>{onViewHistory && <button className="button secondary" onClick={onViewHistory}>View case history</button>}</div>
  </section>;
}
export default function Home() {
  const [cases, setCases] = useState<AnalysisCase[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [caseBaselineId, setCaseBaselineId] = useState<string | null>(null);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaseMetadata>(() => cloneMetadata(EMPTY_METADATA));
  const [draftRelationship, setDraftRelationship] = useState<CaseRelationship | null>(null);
  const [testPending, setTestPending] = useState<MappedProbeImport | null>(null);
  const [cfdPending, setCfdPending] = useState<MappedProbeImport | null>(null);
  const [showLoader, setShowLoader] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [activeView, setActiveView] = useState<"signals" | "spectrum" | "residual" | "phase" | "cycles">("signals");
  const [activeProbe, setActiveProbe] = useState(0);
  const [workspaceView, setWorkspaceView] = useState<"case" | "compare">("case");

  const activeCase = cases.find((item) => item.id === activeCaseId) ?? null;
  const probeSetComparison = useMemo(() => activeCase ? compareProbeSets(activeCase.testSignals, activeCase.cfdSignals) : null, [activeCase]);
  const comparisons = useMemo(() => probeSetComparison?.comparisons ?? [], [probeSetComparison]);
  const testMode = useMemo(() => activeCase ? analyzeRdeProbeSet(activeCase.testSignals, activeCase.metadata.probePositionsDeg, activeCase.metadata.annulusMeanDiameterMm, { maximumWaveCount: activeCase.metadata.maximumWaveCount, synchronizationConfirmed: activeCase.metadata.probeSynchronizationConfirmed, sensorBandwidthKHz: activeCase.metadata.experimentSensorBandwidthKHz, filterCutoffKHz: activeCase.metadata.experimentFilterCutoffKHz }) : null, [activeCase]);
  const cfdMode = useMemo(() => activeCase ? analyzeRdeProbeSet(activeCase.cfdSignals, activeCase.metadata.probePositionsDeg, activeCase.metadata.annulusMeanDiameterMm, { maximumWaveCount: activeCase.metadata.maximumWaveCount, synchronizationConfirmed: activeCase.metadata.probeSynchronizationConfirmed }) : null, [activeCase]);
  const recommendationBaselineId = activeCase?.relationship?.baselineCaseId ?? activeCase?.id ?? null;
  const caseHistoryEvidence = useMemo(() => recommendationBaselineId ? buildCaseHistoryEvidence(cases, recommendationBaselineId) : [], [cases, recommendationBaselineId]);
  const precedentEvidence = useMemo(() => cases
    .filter((item) => !item.relationship)
    .flatMap((item) => buildCaseHistoryEvidence(cases, item.id)), [cases]);
  const assessment = useMemo(() => activeCase && testMode && cfdMode ? buildCaseAssessment(activeCase.metadata, comparisons, testMode, cfdMode) : null, [activeCase, comparisons, testMode, cfdMode]);
  const latestAcceptedEvidence = recommendationBaselineId ? selectPlanningEvidence(caseHistoryEvidence, recommendationBaselineId) : null;
  const planningCase = cases.find((item) => item.id === latestAcceptedEvidence?.caseId)
    ?? cases.find((item) => item.id === recommendationBaselineId)
    ?? activeCase;
  const planAssessment = useMemo(() => {
    if (!planningCase) return null;
    const relevantPrecedents = precedentEvidence.filter((item) => planningCase.source === "demo" ? item.caseSource === "demo" : item.caseSource !== "demo");
    const planningComparison = compareProbeSets(planningCase.testSignals, planningCase.cfdSignals);
    const planningTestMode = analyzeRdeProbeSet(planningCase.testSignals, planningCase.metadata.probePositionsDeg, planningCase.metadata.annulusMeanDiameterMm, { maximumWaveCount: planningCase.metadata.maximumWaveCount, synchronizationConfirmed: planningCase.metadata.probeSynchronizationConfirmed, sensorBandwidthKHz: planningCase.metadata.experimentSensorBandwidthKHz, filterCutoffKHz: planningCase.metadata.experimentFilterCutoffKHz });
    const planningCfdMode = analyzeRdeProbeSet(planningCase.cfdSignals, planningCase.metadata.probePositionsDeg, planningCase.metadata.annulusMeanDiameterMm, { maximumWaveCount: planningCase.metadata.maximumWaveCount, synchronizationConfirmed: planningCase.metadata.probeSynchronizationConfirmed });
    return buildCaseAssessment(planningCase.metadata, planningComparison.comparisons, planningTestMode, planningCfdMode, caseHistoryEvidence, relevantPrecedents);
  }, [planningCase, caseHistoryEvidence, precedentEvidence]);
  const activeAnalysisInput = summarizeAnalysisInput(activeCase);
  const activeCaseEvidence = activeCase?.relationship ? caseHistoryEvidence.find((item) => item.caseId === activeCase.id) ?? null : null;
  const decisionQuality = activeCase && assessment && planAssessment ? buildDecisionQuality({
    source: activeCase.source,
    validityStatus: assessment.validity.status,
    dataQualityStatus: assessment.dataQuality.status,
    controlledResultStatus: activeCaseEvidence?.sequenceStatus ?? null,
    uploadedPrecedentCount: planAssessment.nextRun.precedent.uploadedCount,
  }) : null;
  const baselineCaseName = activeCase?.relationship ? cases.find((item) => item.id === activeCase.relationship?.baselineCaseId)?.metadata.name : null;
  const activeReferenceName = activeCase?.relationship ? cases.find((item) => item.id === (activeCase.relationship?.referenceCaseId ?? activeCase.relationship?.baselineCaseId))?.metadata.name : null;
  const activeComparison = comparisons[activeProbe];
  const correlation = comparisons.length ? average(comparisons.map((item) => item.correlation)) : Number.NaN;
  const nrmse = comparisons.length ? average(comparisons.map((item) => item.nrmse)) : Number.NaN;
  const pressureBias = comparisons.length ? average(comparisons.map((item) => item.pressureBias)) : Number.NaN;
  const waveformWithinLimit = correlation >= REVIEW_THRESHOLDS.minimumCorrelation;
  const caseSummaries = useMemo(() => cases.map(summarizeCase), [cases]);
  const baselineSummary = caseSummaries.find((summary) => summary.item.id === caseBaselineId) ?? caseSummaries[0] ?? null;
  const draftReferenceCase = draftRelationship
    ? cases.find((item) => item.id === (draftRelationship.referenceCaseId ?? draftRelationship.baselineCaseId)) ?? null
    : null;

  const inputRows = activeCase ? [
    ["Geometry + probes", `${activeCase.metadata.annulusMeanDiameterMm.toFixed(1)} mm mean diameter · ${activeCase.metadata.probePositionsDeg.length} probes · modes 1–${activeCase.metadata.maximumWaveCount}`],
    ["Pressure evidence", `${activeCase.testSignals.length} experiment + ${activeCase.cfdSignals.length} CFD traces · ${activeCase.testSignals[0].time.length.toLocaleString()} samples each`],
    ["Measurement chain", `${activeCase.metadata.experimentSensorBandwidthKHz.toFixed(1)} kHz sensor bandwidth · ${activeCase.metadata.experimentFilterCutoffKHz.toFixed(1)} kHz filter cutoff · synchronized probes`],
    ["Operating point", `${activeCase.metadata.inletPressureBar.toFixed(1)} bar · ${activeCase.metadata.inletTemperatureK.toFixed(0)} K · φ ${activeCase.metadata.equivalenceRatio.toFixed(2)} · ${activeCase.metadata.massFlowKgS.toFixed(2)} kg/s`],
    ["Solver + discretization", `${activeCase.metadata.solver} ${activeCase.metadata.solverVersion} · ${activeCase.metadata.dimensionality} · ${activeCase.metadata.spatialScheme} O${activeCase.metadata.spatialOrder} · ${activeCase.metadata.numericalFlux}`],
    ["Computational cost", Number.isFinite(activeCase.metadata.solverRuntimeHours) ? `${activeCase.metadata.solverRuntimeHours.toFixed(1)} solver hours` : "Runtime not supplied"],
    ["Time integration", `${activeCase.metadata.temporalScheme} O${activeCase.metadata.temporalOrder} · ${activeCase.metadata.timeStepUs.toFixed(3)} µs · CFL ${activeCase.metadata.cfl.toFixed(2)}`],
    ["Resolution", `${activeCase.metadata.meshCells.toLocaleString()} cells · ${activeCase.metadata.minimumCellSizeMm.toFixed(3)} mm minimum · ${activeCase.metadata.cellsPerInductionLength.toFixed(1)} cells/induction length`],
    ["Physics + boundaries", `${activeCase.metadata.chemistryModel} · ${activeCase.metadata.turbulenceModel} · ${activeCase.metadata.wallBoundaryCondition}`],
    ["Uncertainty", `Experiment ±${activeCase.metadata.pressureUncertaintyPct.toFixed(1)}%, ±${activeCase.metadata.timingUncertaintyUs.toFixed(2)} µs · CFD ±${activeCase.metadata.cfdPressureUncertaintyPct.toFixed(1)}%, ±${activeCase.metadata.cfdTimingUncertaintyUs.toFixed(2)} µs`],
  ] : [];

  const reviewMetrics = assessment?.metrics.filter((metric) => metric.tone === "review").length ?? 0;
  const inconclusiveMetrics = assessment?.metrics.filter((metric) => metric.tone === "neutral").length ?? 0;
  const totalReview = reviewMetrics + (waveformWithinLimit ? 0 : 1) + (assessment?.validity.status === "Valid" ? 0 : 1);

  const likelyHypothesis = planAssessment?.hypotheses.find((item) => item.id === planAssessment.nextRun.reasoningLedger.hypothesisId) ?? null;
  const likelySources = likelyHypothesis ? sourcesFor(likelyHypothesis.sourceIds) : [];
  const decisionSummary: DecisionSummary = activeCaseEvidence ? {
    label: "Result of this rerun",
    lead: `${activeCaseEvidence.controlled ? outcomeLabel(activeCaseEvidence.state, activeCaseEvidence.sequenceStatus) : "Comparison only"}:`,
    title: `${changeLabel(activeCase?.relationship?.changedVariable ?? "other")} response`,
    detail: conciseOutcomeDetail(activeCaseEvidence),
    meaning: activeCaseEvidence.controlled ? outcomeMeaning(activeCaseEvidence) : comparisonOnlyMeaning(activeCaseEvidence),
    tone: activeCaseEvidence.controlled ? outcomeLabel(activeCaseEvidence.state, activeCaseEvidence.sequenceStatus).toLowerCase() as DecisionSummary["tone"] : "neutral",
  } : {
    label: "Current diagnosis",
    lead: "Likely issue:",
    title: likelyHypothesis?.title ?? "Cannot assess",
    detail: null,
    meaning: planAssessment?.nextRun.reason ?? "The loaded evidence does not support a next-run decision.",
    tone: "neutral",
  };
  const showDetailedEvidence = false;

  function openNewCase() {
    setEditingCaseId(null);
    setDraft(cloneMetadata(EMPTY_METADATA));
    setDraftRelationship(null);
    setTestPending(null); setCfdPending(null); setError(""); setShowLoader(true);
  }

  function openCaseEditor() {
    if (!activeCase) return;
    setEditingCaseId(activeCase.id);
    setDraft(cloneMetadata(activeCase.metadata));
    setDraftRelationship(activeCase.relationship ?? null);
    setTestPending(null); setCfdPending(null); setError(""); setShowLoader(true);
  }

  function inheritStartingCase(referenceCaseId: string, previousReferenceCaseId?: string) {
    const reference = cases.find((item) => item.id === referenceCaseId);
    if (!reference) return;
    if (!editingCaseId) {
      setDraft((current) => {
        const inherited = cloneMetadata(reference.metadata);
        const previousReference = cases.find((item) => item.id === previousReferenceCaseId);
        const currentName = current.name.trim();
        const previousDefaultName = previousReference ? `${previousReference.metadata.name} rerun` : "";
        inherited.name = !currentName || currentName === previousDefaultName
          ? `${reference.metadata.name} rerun`
          : current.name;
        return inherited;
      });
    }
    setTestPending(null);
    setCfdPending(null);
    setError("");
  }

  function chooseCaseFamily(baselineCaseId: string) {
    if (!baselineCaseId) {
      setDraftRelationship(null);
      setTestPending(null);
      setCfdPending(null);
      return;
    }
    setDraftRelationship({
      baselineCaseId,
      referenceCaseId: baselineCaseId,
      changedVariable: draftRelationship?.changedVariable ?? "other",
      description: draftRelationship?.description ?? "",
    });
    inheritStartingCase(baselineCaseId);
  }

  function chooseStartingCase(referenceCaseId: string) {
    setDraftRelationship((current) => current ? { ...current, referenceCaseId } : null);
    inheritStartingCase(referenceCaseId, draftRelationship?.referenceCaseId);
  }

  function applyCase() {
    if (!draft.name.trim()) return setError("Give this operating point a name.");
    if (!draft.comparisonMatchConfirmed) return setError("Confirm that experiment and CFD use the same geometry, operating point, probe locations, and comparison window.");
    if (!draft.probeSynchronizationConfirmed) return setError("Confirm that every probe in each file uses one synchronized time base.");
    if (!Number.isFinite(draft.annulusMeanDiameterMm) || draft.annulusMeanDiameterMm <= 0) return setError("Enter a positive annulus mean diameter.");
    if (draft.probePositionsDeg.length < 3 || draft.probePositionsDeg.some((value) => !Number.isFinite(value))) return setError("Enter at least three valid probe angles.");
    if (!Number.isInteger(draft.maximumWaveCount) || draft.maximumWaveCount < 1 || draft.maximumWaveCount > 12) return setError("Maximum expected wave count must be an integer from 1 to 12.");
    const positive = [draft.experimentSensorBandwidthKHz, draft.experimentFilterCutoffKHz, draft.inletPressureBar, draft.inletTemperatureK, draft.equivalenceRatio, draft.massFlowKgS, draft.spatialOrder, draft.temporalOrder, draft.cfl, draft.meshCells, draft.minimumCellSizeMm, draft.cellsPerInductionLength, draft.nearWallCellSizeMm, draft.timeStepUs, draft.chemistrySpecies, draft.chemistryReactions];
    if (positive.some((value) => !Number.isFinite(value) || value <= 0)) return setError("Complete every required operating-condition, resolution, chemistry, and numerical field with a positive value.");
    const uncertainties = [draft.annulusDiameterUncertaintyMm, draft.pressureUncertaintyPct, draft.timingUncertaintyUs, draft.cfdPressureUncertaintyPct, draft.cfdTimingUncertaintyUs];
    if (uncertainties.some((value) => !Number.isFinite(value) || value < 0)) return setError("Enter non-negative experiment and CFD uncertainty values.");
    if (Number.isFinite(draft.solverRuntimeHours) && draft.solverRuntimeHours <= 0) return setError("Runtime must be positive when supplied.");
    const textFields = [draft.solver, draft.solverVersion, draft.dimensionality, draft.spatialScheme, draft.numericalFlux, draft.limiterFilter, draft.temporalScheme, draft.turbulenceModel, draft.combustionModel, draft.chemistryModel, draft.chemistryIntegrator, draft.wallBoundaryCondition, draft.inletBoundaryCondition, draft.outletBoundaryCondition, draft.initializationMethod];
    if (textFields.some((value) => !value.trim())) return setError("Complete every required CFD model-card field. Enter “None” where a limiter, turbulence model, or combustion model is not used.");
    try {
      const editingCase = cases.find((item) => item.id === editingCaseId) ?? null;
      const referenceId = draftRelationship?.referenceCaseId ?? draftRelationship?.baselineCaseId;
      const referenceCase = referenceId ? cases.find((item) => item.id === referenceId) ?? null : null;
      const nextTest = testPending?.signals ?? editingCase?.testSignals ?? referenceCase?.testSignals;
      const nextCfd = cfdPending?.signals ?? editingCase?.cfdSignals;
      if (!nextTest) return setError("Upload the experimental multi-probe file for this baseline case.");
      if (!nextCfd) return setError(draftRelationship ? "Upload the new CFD multi-probe result for this rerun." : "Upload the CFD multi-probe file for this case.");
      if (nextTest.length !== draft.probePositionsDeg.length || nextCfd.length !== draft.probePositionsDeg.length) return setError(`The files contain ${nextTest.length} experiment and ${nextCfd.length} CFD probes, but ${draft.probePositionsDeg.length} probe angles were entered.`);
      compareProbeSets(nextTest, nextCfd);
      analyzeRdeProbeSet(nextTest, draft.probePositionsDeg, draft.annulusMeanDiameterMm, { maximumWaveCount: draft.maximumWaveCount, synchronizationConfirmed: draft.probeSynchronizationConfirmed, sensorBandwidthKHz: draft.experimentSensorBandwidthKHz, filterCutoffKHz: draft.experimentFilterCutoffKHz });
      analyzeRdeProbeSet(nextCfd, draft.probePositionsDeg, draft.annulusMeanDiameterMm, { maximumWaveCount: draft.maximumWaveCount, synchronizationConfirmed: draft.probeSynchronizationConfirmed });
      const id = editingCaseId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (draftRelationship?.baselineCaseId === id) return setError("A case cannot be its own baseline.");
      if (draftRelationship) {
        if (!referenceCase || referenceCase.id !== draftRelationship.baselineCaseId && referenceCase.relationship?.baselineCaseId !== draftRelationship.baselineCaseId) return setError("Choose a starting case from the selected case family.");
      }
      const experimentProvenance = testPending?.provenance ?? editingCase?.imports?.experiment ?? referenceCase?.imports?.experiment;
      const cfdProvenance = cfdPending?.provenance ?? editingCase?.imports?.cfd;
      const nextImports = experimentProvenance && cfdProvenance ? { experiment: experimentProvenance, cfd: cfdProvenance } : null;
      const nextRelationship = draftRelationship ? { ...draftRelationship, referenceCaseId: draftRelationship.referenceCaseId ?? draftRelationship.baselineCaseId } : null;
      const nextCase: AnalysisCase = { id, source: editingCase?.source ?? "uploaded", relationship: nextRelationship, metadata: cloneMetadata(draft), testSignals: nextTest, cfdSignals: nextCfd, imports: nextImports };
      setCases((current) => editingCaseId ? current.map((item) => item.id === editingCaseId ? nextCase : item) : [...current, nextCase]);
      if (!caseBaselineId) setCaseBaselineId(id);
      setActiveCaseId(id); setWorkspaceView("case"); setActiveProbe(0); setShowLoader(false); setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The two datasets could not be compared.");
    }
  }

  function loadExampleCaseHistory() {
    const demo = makeDemoProbeSignals();
    const stamp = Date.now().toString(36);
    const baselineId = `demo-${stamp}-baseline`;
    const meshId = `demo-${stamp}-mesh`;
    const wallId = `demo-${stamp}-wall`;
    const baseMetadata: CaseMetadata = {
        name: "Synthetic baseline",
        annulusMeanDiameterMm: 82,
        annulusDiameterUncertaintyMm: 0.1,
        probePositionsDeg: [...demo.positionsDeg],
        maximumWaveCount: 4,
        probeSynchronizationConfirmed: true,
        experimentSensorBandwidthKHz: 100,
        experimentFilterCutoffKHz: 80,
        inletPressureBar: 8,
        inletTemperatureK: 300,
        equivalenceRatio: 1,
        massFlowKgS: 0.62,
        comparisonMatchConfirmed: true,
        solver: "Research CFD solver",
        solverVersion: "2026.1",
        dimensionality: "3D",
        spatialScheme: "MUSCL",
        spatialOrder: 2,
        numericalFlux: "HLLC",
        limiterFilter: "Venkatakrishnan limiter",
        temporalScheme: "SSPRK3",
        temporalOrder: 3,
        cfl: 0.35,
        turbulenceModel: "SST k-ω",
        combustionModel: "Finite-rate",
        chemistryModel: "Hydrogen reduced mechanism",
        chemistrySpecies: 9,
        chemistryReactions: 19,
        chemistryIntegrator: "Implicit BDF",
        meshCells: 2_500_000,
        minimumCellSizeMm: 0.25,
        cellsPerInductionLength: 8,
        nearWallCellSizeMm: 0.1,
        timeStepUs: 0.25,
        solverRuntimeHours: 10,
        wallBoundaryCondition: "Isothermal 450 K",
        inletBoundaryCondition: "Measured total state + mass flow",
        outletBoundaryCondition: "Non-reflecting pressure outlet",
        initializationMethod: "Single-point ignition kernel",
        meshConvergencePct: Number.NaN,
        timeStepConvergencePct: Number.NaN,
        pressureUncertaintyPct: 1.5,
        timingUncertaintyUs: 0.5,
        cfdPressureUncertaintyPct: 2,
        cfdTimingUncertaintyUs: 0.25,
    };
    const cloneSignals = (signals: Signal[]) => signals.map((signal) => ({ ...signal, time: [...signal.time], pressure: [...signal.pressure] }));
    const blendTowardExperiment = (factor: number) => demo.cfd.map((signal, probe) => ({ ...signal, pressure: signal.pressure.map((value, index) => value + factor * (demo.test[probe].pressure[index] - value)) }));
    const fineMetadata = { ...cloneMetadata(baseMetadata), name: "Synthetic mesh refinement", meshCells: 5_000_000, minimumCellSizeMm: 0.125, cellsPerInductionLength: 16, nearWallCellSizeMm: 0.05, solverRuntimeHours: 18 };
    const fineSignals = blendTowardExperiment(0.95);
    const wallSignals = fineSignals.map((signal, probe) => ({ ...signal, pressure: signal.pressure.map((value, index) => value + 0.001 * (demo.test[probe].pressure[index] - value)) }));
    const examples: AnalysisCase[] = [
      { id: baselineId, source: "demo", relationship: null, metadata: baseMetadata, testSignals: cloneSignals(demo.test), cfdSignals: cloneSignals(demo.cfd) },
      {
        id: meshId, source: "demo",
        relationship: { baselineCaseId: baselineId, referenceCaseId: baselineId, changedVariable: "mesh", description: "50% front-region cell-size refinement" },
        metadata: fineMetadata,
        testSignals: cloneSignals(demo.test), cfdSignals: fineSignals,
      },
      {
        id: wallId, source: "demo",
        relationship: { baselineCaseId: baselineId, referenceCaseId: meshId, changedVariable: "wall", description: "Adjacent wall thermal boundary" },
        metadata: { ...cloneMetadata(fineMetadata), name: "Synthetic wall sensitivity", wallBoundaryCondition: "Adiabatic", solverRuntimeHours: 18.5 },
        testSignals: cloneSignals(demo.test), cfdSignals: wallSignals,
      },
    ];
    setCases((current) => [...current, ...examples]);
    setCaseBaselineId(examples[0].id);
    setActiveCaseId(examples[0].id); setWorkspaceView("case"); setActiveProbe(0);
  }

  function downloadExample() {
    const demo = makeDemoProbeSignals();
    const header = ["time_ms", ...demo.test.map((_, index) => `p${index + 1}_MPa`)].join(",");
    const rows = [header, ...demo.test[0].time.slice(0, 800).map((time, index) => [time, ...demo.test.map((signal) => signal.pressure[index])].map((value) => value.toFixed(6)).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = "caevera-multi-probe-example.csv"; link.click(); URL.revokeObjectURL(url);
  }

  function downloadReport() {
    if (!activeCase || !testMode || !cfdMode || !assessment || !decisionQuality || !planningCase) return;
    const report = {
      schema: "caevera-rde-case-report",
      analysisVersion: ANALYSIS_VERSION,
      knowledgeBaseVersion: KNOWLEDGE_BASE_VERSION,
      generatedAt: new Date().toISOString(),
      inputs: { metadata: activeCase.metadata, relationship: activeCase.relationship ?? null, fileMappings: activeCase.imports ?? null, experimentalSources: activeCase.testSignals.map((signal) => signal.name), cfdSources: activeCase.cfdSignals.map((signal) => signal.name), units: { time: "ms", pressure: "MPa", frequency: "kHz", waveSpeed: "m/s" } },
      outputs: { experimentMode: testMode, cfdMode, validity: assessment.validity, dataQuality: assessment.dataQuality, coverage: assessment.coverage, metrics: assessment.metrics, hypotheses: assessment.hypotheses, activeCaseOutcome: activeCaseEvidence, decisionQuality, controlledNextRun: planAssessment?.nextRun ?? assessment.nextRun, caseHistoryEvidence, waveform: { correlation, normalizedRmse: nrmse, pressureBiasMpa: pressureBias, sharedAlignmentLagUs: probeSetComparison?.sharedLagUs, individualLagUs: probeSetComparison?.individualLagUs, alignmentSpreadUs: probeSetComparison?.alignmentSpreadUs } },
      citedSources: sourcesFor([...new Set(assessment.hypotheses.flatMap((hypothesis) => hypothesis.sourceIds))]),
      methodSources: WAVE_METHOD_SOURCES,
      publishedValidationSources: PUBLISHED_VALIDATION_SOURCES,
      evidenceRoles: {
        directCaseEvidence: activeCase.source === "demo"
          ? "Generated demonstration arrays, entered metadata, declared uncertainties, and verified controlled relationships determine this calculated result. It is not engine evidence."
          : "Uploaded experiment and CFD arrays, entered metadata, declared uncertainties, and verified controlled relationships determine the calculated metrics and recommendation.",
        recommendationScope: {
          selectedCase: activeCase.metadata.name,
          planningReferenceCase: planningCase.metadata.name,
          sharedAcrossCaseFamily: caseHistoryEvidence.length > 0,
          explanation: "The selected-case diagnosis or rerun outcome is recalculated from that case. The next-run plan is shared across the case family and starts from the latest accepted case on the declared rerun branch.",
        },
        storageBoundary: "Saved workspaces contain inputs, pressure arrays, metadata, file mappings, and case relationships only. They do not contain cached metrics, diagnoses, outcomes, or recommendations.",
        diagnosticRuleSources: likelySources,
        methodSources: WAVE_METHOD_SOURCES,
        publicAnalyzerValidation: {
          summary: PUBLISHED_VALIDATION_SUMMARY,
          cases: RAW_DATASET_VALIDATION_CASES,
          role: "Regression validation only. Public cases do not count as company precedent and do not determine the recommendation for this uploaded case.",
        },
      },
      perProbe: comparisons,
      methods: ["shared bounded cross-correlation", "Hann-windowed FFT pressure spectrum", "cycle-by-cycle passage tracking", "sliding-window circumferential phase-mode fit", "uncertainty resolution by RSS", "structured diagnostic rules", "adaptive controlled-rerun outcome classification"],
      limitations: ["Hypotheses prioritize controlled sensitivity runs; they do not prove causality.", "Adaptive confirmation and rejection limits are explicit prototype rules and are not calibrated probabilities.", "Pressure and timing uncertainty are propagated only into supported scalar outputs.", "Mode inference assumes synchronized probes and one dominant rotating mode; ambiguous and simultaneous modes are reported as not identifiable.", "Thermal, performance, combustion, and flowfield agreement are outside this pressure-and-wave product scope."],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "caevera-rde-case-report.json"; link.click(); URL.revokeObjectURL(url);
  }

  function downloadWorkspace() {
    if (!cases.length) return;
    const content = serializeWorkspace({ cases, activeCaseId, baselineCaseId: caseBaselineId });
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = workspaceFileName();
    link.click();
    URL.revokeObjectURL(url);
  }

  async function openWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const restored = deserializeWorkspace(await file.text());
      if (cases.length && !window.confirm("Replace the current browser-session cases with this saved workspace?")) return;
      setCases(restored.cases);
      setActiveCaseId(restored.activeCaseId);
      setCaseBaselineId(restored.baselineCaseId);
      setEditingCaseId(null);
      setDraft(cloneMetadata(EMPTY_METADATA));
      setDraftRelationship(null);
      setTestPending(null);
      setCfdPending(null);
      setShowLoader(false);
      setShowHelp(false);
      setError("");
      setWorkspaceError("");
      setActiveProbe(0);
      setActiveView("signals");
      setWorkspaceView("case");
    } catch (reason) {
      setWorkspaceError(reason instanceof Error ? reason.message : "The workspace could not be opened.");
    }
  }

  const updateNumber = (key: keyof CaseMetadata, value: string) => setDraft((current) => ({ ...current, [key]: value === "" ? Number.NaN : Number(value) }));
  const updateText = (key: keyof CaseMetadata, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const numberValue = (value: number) => Number.isFinite(value) ? value : "";

  function returnToEmptyWorkspace() {
    setCases([]);
    setActiveCaseId(null);
    setCaseBaselineId(null);
    setEditingCaseId(null);
    setDraft(cloneMetadata(EMPTY_METADATA));
    setDraftRelationship(null);
    setTestPending(null);
    setCfdPending(null);
    setShowLoader(false);
    setShowHelp(false);
    setError("");
    setWorkspaceError("");
    setActiveProbe(0);
    setActiveView("signals");
    setWorkspaceView("case");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    requestAnimationFrame(() => document.getElementById("top")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return <main className="app-shell">
    <header className="product-header">
      <a className="brand" href="#top" aria-label="Return to empty home workspace" onClick={(event) => { event.preventDefault(); returnToEmptyWorkspace(); }}><span className="brand-mark">C</span><span><strong>CAEVERA</strong><small>BY CAELUS</small></span></a>
      <p>RDE simulation-to-test intelligence</p>
      <div className="header-actions"><span className="prototype-tag">v{ANALYSIS_VERSION}</span><PwaInstallButton /><label className="button secondary workspace-file-button">Open workspace<input type="file" accept=".json" onChange={openWorkspace} hidden /></label><button className="button secondary help-button" onClick={() => setShowHelp(true)}>Help</button><button className="button primary" onClick={openNewCase}>+ Add case</button></div>
    </header>
    {workspaceError && <p className="workspace-error-banner" role="alert">{workspaceError}</p>}

    <section className="content" id="top">
      {!activeCase || !testMode || !cfdMode || !activeComparison || !assessment || !planAssessment || !decisionQuality || !planningCase ? <section className="empty-workspace">
        <span className="empty-kicker">RDE PRESSURE + WAVE VALIDATION</span><h1>Welcome to Caevera</h1>
        <p>Compare experimental pressure-probe data with CFD to see where the simulated pressure and rotating-wave behavior disagree with measurements. Caevera recommends the next controlled CFD run, evaluates its result, and updates the plan through confirmed, rejected, or inconclusive branches.</p>
        <span className="empty-status">No cases loaded</span>
        <div className="empty-actions"><button className="button primary" onClick={openNewCase}>Add first case →</button><label className="button secondary workspace-file-button">Open saved workspace<input type="file" accept=".json" onChange={openWorkspace} hidden /></label><button className="button secondary" onClick={loadExampleCaseHistory}>Load synthetic case history</button></div>
        <div className="empty-requirements"><span><b>1</b><i><strong>Compare</strong> matched experiment and CFD pressure traces</i></span><span><b>2</b><i><strong>Diagnose</strong> pressure and rotating-wave mismatches</i></span><span><b>3</b><i><strong>Run and update</strong> the adaptive CFD plan</i></span></div>
      </section> : <>
        <section className="case-switcher" aria-label="Loaded cases">
          <div className="case-switcher-label"><span>Cases</span><b>{cases.length}</b></div>
          <div className="case-tabs-list">{cases.map((item, index) => <button key={item.id} className={workspaceView === "case" && item.id === activeCase.id ? "active" : ""} onClick={() => { setActiveCaseId(item.id); setActiveProbe(0); setWorkspaceView("case"); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.metadata.name}</strong><small>{caseTabSummary(item)}</small></button>)}</div>
          <div className="case-actions">{cases.length > 1 && <button className={`compare-cases-button ${workspaceView === "compare" ? "active" : ""}`} onClick={() => setWorkspaceView("compare")}>Case history</button>}<button className="compare-cases-button" onClick={downloadWorkspace}>Save workspace</button><button className="add-case-button" onClick={openNewCase}>+ Add case</button></div>
        </section>

        {workspaceView === "compare" && baselineSummary ? <section className="case-history-comparison" aria-label="Case history">
          <div className="case-history-heading"><div><span className="empty-kicker">CASE HISTORY</span><h1>Related reruns for one case</h1><p>A rerun becomes diagnostic evidence only when the experiment and operating point are unchanged and exactly one recorded CFD variable group changes.</p></div><label className="baseline-select"><span>Baseline case</span><select value={baselineSummary.item.id} onChange={(event) => setCaseBaselineId(event.target.value)}>{caseSummaries.map((summary) => <option key={summary.item.id} value={summary.item.id}>{summary.item.metadata.name}</option>)}</select></label></div>
          <div className="case-history-table-wrap"><table className="case-history-table direct-delta-table">
            <thead><tr><th>Case</th><th>Operating change vs baseline</th><th>Experimental change</th><th>CFD error change</th><th>Case status</th></tr></thead>
            <tbody>{caseSummaries.map((summary) => {
              const delta = buildCaseDelta(baselineSummary, summary);
              const isBaseline = summary.item.id === baselineSummary.item.id;
              const relationEvidence = buildCaseHistoryEvidence(cases, baselineSummary.item.id).find((item) => item.caseId === summary.item.id);
              const caseReviews = summary.assessment.metrics.filter((metric) => metric.tone === "review").length;
              return <tr key={summary.item.id} className={isBaseline ? "baseline-row" : ""}>
                <th scope="row"><button onClick={() => { setActiveCaseId(summary.item.id); setActiveProbe(0); setWorkspaceView("case"); }}>{summary.item.metadata.name}<span>{isBaseline ? "Selected baseline" : "Open analysis →"}</span></button></th>
                <td>{isBaseline ? <strong>Reference condition</strong> : <><strong>φ {signed(delta.condition.equivalenceRatio, 2)} · pressure {signed(delta.condition.inletPressureBar, 1)} bar</strong><span>Temperature {signed(delta.condition.inletTemperatureK, 0)} K</span><span>Mass flow {signed(delta.condition.massFlowKgS, 2)} kg/s</span></>}</td>
                <td>{isBaseline ? <strong>Reference behavior</strong> : <><strong>Frequency {signed(delta.experiment.frequencyKHz, 2)} kHz</strong><span>Peak pressure {signed(delta.experiment.peakPressureMpa, 3)} MPa</span><span>Amplitude {signed(delta.experiment.pressureAmplitudeMpa, 3)} MPa · variability {signed(delta.experiment.cycleVariabilityPoints, 1)} pt</span></>}</td>
                <td>{isBaseline ? <strong>Reference error</strong> : <><strong>Frequency error {signed(delta.cfdAgreement.frequencyErrorPointChange, 1)} pt</strong><span>Peak error {signed(delta.cfdAgreement.peakPressureErrorPointChange, 1)} pt</span><span>Amplitude error {signed(delta.cfdAgreement.amplitudeErrorPointChange, 1)} pt</span></>}</td>
                <td><span className={`comparison-status ${relationEvidence?.state === "supports" || relationEvidence?.sequenceStatus === "converged" ? "pass" : relationEvidence?.controlled ? "review" : summary.assessment.validity.status === "Blocked" || caseReviews ? "review" : "neutral"}`}>{isBaseline ? "Baseline case" : relationEvidence?.controlled ? outcomeLabel(relationEvidence.state, relationEvidence.sequenceStatus) : "Comparison only"}</span></td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="case-history-note"><strong>How this works:</strong> this view keeps a baseline and its related controlled reruns together. A controlled result confirms, rejects, or leaves the predicted response inconclusive, then updates the adaptive plan. Unrelated operating points remain comparisons.</p>
        </section> : <>
          <div className="case-heading"><div><span className={`source-dot ${activeCase.source === "demo" ? "demo" : ""}`} /><span>{activeCase.source === "demo" ? "Synthetic demonstration" : "Uploaded case"}</span></div><h1>{activeCase.metadata.name}</h1><p>{activeCase.relationship ? `Controlled ${changeLabel(activeCase.relationship.changedVariable).toLowerCase()} rerun starting from ${activeReferenceName ?? baselineCaseName ?? "the family baseline"}` : `Baseline for ${caseHistoryEvidence.length} controlled rerun${caseHistoryEvidence.length === 1 ? "" : "s"}`} · deterministic local analysis</p></div>

          <EngineeringDecisionPanel summary={decisionSummary} nextRun={planAssessment.nextRun} showLatestResult={!activeCaseEvidence} decisionQuality={decisionQuality} selectedCaseName={activeCase.metadata.name} selectedAnalysisInput={activeAnalysisInput} planningCaseName={planningCase.metadata.name} publishedSourceCount={likelySources.length} publishedValidation={PUBLISHED_VALIDATION_SUMMARY} onEdit={openCaseEditor} onDownloadReport={downloadReport} onSaveWorkspace={downloadWorkspace} onViewHistory={cases.length > 1 ? () => setWorkspaceView("compare") : null} />

          {showDetailedEvidence && <>
          <section className={`assessment-banner ${totalReview ? "review" : "pass"}`} aria-label="Comparison conclusion">
            <div><span>COMPARISON CONCLUSION</span><h2>{assessment.validity.status === "Blocked" ? "Assessment blocked until case matching is confirmed" : totalReview ? `${totalReview} evidence check${totalReview === 1 ? "" : "s"} require review` : "No selected mismatch is resolved beyond current uncertainty"}</h2><p>{assessment.validity.status === "Blocked" ? "Do not tune the CFD from this pairing yet." : totalReview ? "The highlighted evidence drives the ranked hypotheses and one-variable next-run plan below." : "This does not prove the CFD is universally valid; it means this pressure case does not expose a resolved discrepancy."}</p></div>
            <strong>{assessment.validity.status === "Blocked" ? "BLOCKED" : totalReview ? "REVIEW" : "UNRESOLVED"}</strong>
          </section>

          <section className="coverage-grid" aria-label="Validation coverage">
            {assessment.coverage.map((item) => <article key={item.module} className={item.status === "Assessed" ? "coverage-assessed" : item.status === "Inconclusive" ? "coverage-inconclusive" : "coverage-missing"}><span>{item.module}</span><strong>{item.status}</strong><small>{item.detail}</small></article>)}
          </section>

          <section className="quality-validity-grid">
            <article className="validity-panel"><div className="section-heading"><span>01</span><div><h2>Comparison validity</h2><p>Can this pairing support a CFD conclusion?</p></div></div><ul>{assessment.validity.checks.map((check) => <li key={check.label}><span className={`check-dot ${check.status.toLowerCase()}`} /> <div><strong>{check.label}<i>{check.status}</i></strong><small>{check.detail}</small></div></li>)}</ul></article>
            <article className="data-quality-panel"><div className="section-heading"><span>02</span><div><h2>Data quality</h2><p>Sampling, duration, continuity, and clipping</p></div></div><div className="quality-stats"><span><b>{average(assessment.dataQuality.experiment.map((result) => result.capturedCycles)).toFixed(1)}</b> experiment cycles</span><span><b>{average(assessment.dataQuality.cfd.map((result) => result.capturedCycles)).toFixed(1)}</b> CFD cycles</span><span><b>{average(assessment.dataQuality.experiment.map((result) => result.samplesPerCycle)).toFixed(0)}</b> samples/cycle</span></div><ul>{assessment.dataQuality.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></article>
          </section>

          <section className="workflow" aria-label="Caevera inputs and outputs">
            <article className="inputs-panel"><div className="panel-heading"><div><span className="step-number">03</span><div><h2>Inputs used</h2><p>Every required field affects validity, calculation, or diagnosis</p></div></div><button className="text-button" onClick={openCaseEditor}>Edit case</button></div><ol className="input-list">{inputRows.map(([label, value]) => <li key={label}><i aria-hidden="true">✓</i><div><strong>{label}</strong><span>{value}</span></div></li>)}</ol></article>
            <div className="flow-arrow" aria-hidden="true"><span>ANALYZE</span><i>→</i></div>
            <article className="outputs-panel"><div className="panel-heading"><div><span className="step-number">04</span><div><h2>Experiment vs CFD</h2><p>CFD minus experiment, resolved against uncertainty where supported</p></div></div></div>
              <div className="comparison-table-wrap"><table className="comparison-table uncertainty-table">
                <thead><tr><th>Quantity</th><th>Experiment</th><th>CFD</th><th>CFD − experiment</th><th>Combined uncertainty / method limit</th><th>Assessment</th></tr></thead>
                <tbody>{assessment.metrics.map((metric) => <tr key={metric.id} className={metric.tone === "review" ? "comparison-row-review" : metric.tone === "neutral" ? "comparison-row-neutral" : ""}>
                  <th scope="row"><strong>{metric.label}</strong><small>{metric.purpose}</small></th>
                  <td>{formatMetricValue(metric, metric.experiment)}</td><td>{formatMetricValue(metric, metric.cfd)}</td><td className="difference-cell">{formatMetricDifference(metric)}</td>
                  <td className="uncertainty-cell">{metric.uncertainty === null || metric.assessment.status === "match" || metric.assessment.status === "mismatch" ? metric.uncertaintyLabel : `±${metric.uncertainty.toFixed(metricDigits(metric))}${metric.unit ? ` ${metric.unit}` : ""}`}<small>{metric.assessment.explanation}</small></td>
                  <td><span className={`comparison-status ${metric.tone}`}>{metric.assessment.label}</span></td>
                </tr>)}</tbody>
              </table></div>

              <section className="result-block mismatch-block"><div><span className="result-index">05</span><h3>Waveform agreement</h3></div><div className="comparison-metrics">
                <div className={waveformWithinLimit ? "metric-pass" : "metric-review"}><span>Aligned correlation</span><strong>{correlation.toFixed(3)}</strong><small>{waveformWithinLimit ? "Within method limit · target ≥ 0.700" : "Review · target ≥ 0.700"}</small></div>
                <div><span>Normalized RMSE</span><strong>{(nrmse * 100).toFixed(1)}<i>%</i></strong><small>Residual relative to experimental oscillation RMS</small></div>
                <div><span>Mean pressure bias</span><strong>{signed(pressureBias, 3)} <i>MPa</i></strong><small>Its significance is assessed in the mean-pressure row above</small></div>
              </div><p className="metric-note">Correlation and harmonic/variability checks use explicit prototype method limits. Pressure, frequency, speed, impulse, and rise-time rows use the supplied experiment/CFD uncertainties. {inconclusiveMetrics ? `${inconclusiveMetrics} metric${inconclusiveMetrics === 1 ? " is" : "s are"} inconclusive.` : ""}</p></section>

              <section className="result-block causes-block"><div><span className="result-index">06</span><h3>Ranked diagnostic hypotheses</h3></div><ol>{assessment.hypotheses.map((hypothesis, index) => <li key={hypothesis.title}><b>{index + 1}. {hypothesis.title}</b><span>{hypothesis.evidence.map((item) => `${item.state}: ${item.observation}`).join(" ")}</span><small>Model inputs: {hypothesis.modelInputs.filter(Boolean).join(" · ")}</small></li>)}</ol><small>These are transparent sensitivity-test priorities, not causal proof.</small></section>

              <button className="report-button" onClick={downloadReport}><span><b>08</b><strong>Download traceable report</strong><small>Inputs, validity, uncertainty, metrics, hypotheses, and recommended next CFD run</small></span><i>↓</i></button>
            </article>
          </section>

          </>}

          <section className="evidence-panel" aria-label="Calculated signal evidence"><div className="evidence-heading"><div><span className="calculated-label">CALCULATED AFTER CASE ANALYSIS</span><h2>Pressure and wave evidence</h2><p>Every trace, spectrum, propagation phase, and cycle statistic is calculated from the active case.</p></div><div className="control-group"><div className="probe-tabs" aria-label="Probe selection">{activeCase.testSignals.map((_, probe) => <button key={probe} className={activeProbe === probe ? "active" : ""} onClick={() => setActiveProbe(probe)}>P{probe + 1}</button>)}</div><div className="view-tabs" aria-label="Evidence view"><button className={activeView === "signals" ? "active" : ""} onClick={() => setActiveView("signals")}>Pressure</button><button className={activeView === "spectrum" ? "active" : ""} onClick={() => setActiveView("spectrum")}>Spectrum</button><button className={activeView === "residual" ? "active" : ""} onClick={() => setActiveView("residual")}>Residual</button><button className={activeView === "phase" ? "active" : ""} onClick={() => setActiveView("phase")}>Propagation</button><button className={activeView === "cycles" ? "active" : ""} onClick={() => setActiveView("cycles")}>Cycle stability</button></div></div></div><div className="chart-heading"><span>{activeView === "phase" ? `${activeCase.testSignals.length} probes · ${testMode.identifiability.toLowerCase()} experimental mode` : activeView === "cycles" ? `${testMode.cycleSeries.length} experiment cycles · ${cfdMode.cycleSeries.length} CFD cycles` : `Probe P${activeProbe + 1} · ${activeCase.metadata.probePositionsDeg[activeProbe]}° · ${activeComparison.time.length.toLocaleString()} aligned samples`}</span><Legend residual={activeView === "residual"} /></div>{activeView === "signals" && <SignalChart comparison={activeComparison} />}{activeView === "spectrum" && <SpectrumChart comparison={activeComparison} />}{activeView === "residual" && <ResidualChart comparison={activeComparison} />}{activeView === "phase" && <PhaseChart experiment={testMode} simulation={cfdMode} positionsDeg={activeCase.metadata.probePositionsDeg} />}{activeView === "cycles" && <CycleChart experiment={testMode} simulation={cfdMode} />}<div className="wave-summary"><span><b>{probeSetComparison?.sharedLagUs.toFixed(2)} µs</b> shared experiment–CFD alignment</span><span><b>{testMode.identifiability === "Not identifiable" ? "Not identifiable" : `${testMode.waveCount}-wave ${testMode.direction.toLowerCase()}`}</b> experiment · {testMode.identifiability}</span><span><b>{cfdMode.identifiability === "Not identifiable" ? "Not identifiable" : `${cfdMode.waveCount}-wave ${cfdMode.direction.toLowerCase()}`}</b> CFD · {cfdMode.identifiability}</span><span><b>{testMode.identifiability === "Not identifiable" || cfdMode.identifiability === "Not identifiable" ? "Not identifiable" : `${testMode.phaseJitterDeg.toFixed(1)}° / ${cfdMode.phaseJitterDeg.toFixed(1)}°`}</b> phase jitter</span></div>{[...testMode.warnings, ...cfdMode.warnings].length > 0 && <ul className="wave-warnings">{[...new Set([...testMode.warnings, ...cfdMode.warnings])].map((warning) => <li key={warning}>{warning}</li>)}</ul>}</section>
          <footer><span>Caevera v{ANALYSIS_VERSION} · deterministic analysis</span><span>{cases.length} case{cases.length === 1 ? "" : "s"} in this browser session · not certification evidence</span></footer>
        </>}
      </>}
    </section>

    {showLoader && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowLoader(false)}><section className="loader-modal" role="dialog" aria-modal="true" aria-labelledby="loader-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={() => setShowLoader(false)} aria-label="Close case loader">×</button><div className="loader-intro"><div><span className="modal-kicker">RDE CASE INPUTS</span><h2 id="loader-title">{editingCaseId ? "Edit operating point" : "Add operating point"}</h2></div><button className="input-help-button" onClick={() => setShowHelp(true)}>What does each input mean?</button></div><p>Required fields feed a calculation, validity check, uncertainty assessment, or diagnostic rule. Optional convergence results strengthen the recommendation when available.</p>

      <div className="form-section"><h3>Case + geometry</h3><div className="form-grid four"><label><span>Case name</span><input value={draft.name} onChange={(event) => updateText("name", event.target.value)} /></label><label><span>Mean diameter (mm)</span><input type="number" value={numberValue(draft.annulusMeanDiameterMm)} onChange={(event) => updateNumber("annulusMeanDiameterMm", event.target.value)} /></label><label><span>Diameter uncertainty (mm)</span><input type="number" step="0.01" value={numberValue(draft.annulusDiameterUncertaintyMm)} onChange={(event) => updateNumber("annulusDiameterUncertaintyMm", event.target.value)} /></label><label><span>Maximum expected waves</span><input type="number" min="1" max="12" value={numberValue(draft.maximumWaveCount)} onChange={(event) => updateNumber("maximumWaveCount", event.target.value)} /></label></div><label className="probe-angle-editor"><span>Probe angles (deg) · minimum 3, nonuniform preferred</span><div className="angle-inputs">{draft.probePositionsDeg.map((angle, index) => <input key={index} type="number" aria-label={`Probe ${index + 1} angle`} placeholder={`P${index + 1}`} value={numberValue(angle)} onChange={(event) => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.map((value, position) => position === index ? (event.target.value === "" ? Number.NaN : Number(event.target.value)) : value) }))} />)}<button type="button" onClick={() => setDraft((current) => ({ ...current, probePositionsDeg: [...current.probePositionsDeg, Number.NaN] }))}>+ probe</button>{draft.probePositionsDeg.length > 3 && <button type="button" onClick={() => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.slice(0, -1) }))}>Remove</button>}</div></label><label className="confirmation-check"><input type="checkbox" checked={draft.probeSynchronizationConfirmed} onChange={(event) => setDraft((current) => ({ ...current, probeSynchronizationConfirmed: event.target.checked }))} /><span>I confirm every pressure probe in each file uses one synchronized acquisition time base.</span></label><label className="confirmation-check"><input type="checkbox" checked={draft.comparisonMatchConfirmed} onChange={(event) => setDraft((current) => ({ ...current, comparisonMatchConfirmed: event.target.checked }))} /><span>I confirm experiment and CFD use the same geometry, operating point, probe locations, and comparison window.</span></label></div>

      {cases.length > 0 && <div className="form-section"><h3>Related rerun · optional</h3><p className="form-help">Choose the family baseline and exact starting case. Caevera copies its settings and experiment samples so you only enter the declared CFD change and new CFD result.</p><div className="form-grid four">
        <label><span>Case family baseline</span><select value={draftRelationship?.baselineCaseId ?? ""} onChange={(event) => chooseCaseFamily(event.target.value)}><option value="">Not a related rerun</option>{cases.filter((item) => item.id !== editingCaseId && !item.relationship).map((item) => <option key={item.id} value={item.id}>{item.metadata.name}</option>)}</select></label>
        <label><span>Starting settings</span><select disabled={!draftRelationship} value={draftRelationship?.referenceCaseId ?? draftRelationship?.baselineCaseId ?? ""} onChange={(event) => chooseStartingCase(event.target.value)}>{draftRelationship && cases.filter((item) => item.id !== editingCaseId && (item.id === draftRelationship.baselineCaseId || item.relationship?.baselineCaseId === draftRelationship.baselineCaseId)).map((item) => <option key={item.id} value={item.id}>{item.metadata.name}</option>)}</select></label>
        <label><span>Single CFD change</span><select disabled={!draftRelationship} value={draftRelationship?.changedVariable ?? "other"} onChange={(event) => setDraftRelationship((current) => current ? { ...current, changedVariable: event.target.value as SensitivityVariable } : null)}><option value="mesh">Mesh / spatial method</option><option value="time-step">Time step / temporal method</option><option value="chemistry">Chemistry model</option><option value="inlet">Inlet treatment</option><option value="wall">Wall treatment</option><option value="initialization">Initialization</option><option value="unsteadiness">Measured unsteady forcing</option><option value="other">Other / comparison only</option></select></label>
        <label><span>Change description</span><input disabled={!draftRelationship} value={draftRelationship?.description ?? ""} onChange={(event) => setDraftRelationship((current) => current ? { ...current, description: event.target.value } : null)} placeholder="e.g. 50% front-cell refinement" /></label>
      </div>{draftReferenceCase && !editingCaseId && <div className="rerun-inheritance"><strong>Starting case copied: {draftReferenceCase.metadata.name}</strong><span>Keep inherited inputs unchanged except the selected CFD group. Extra differences will be named and the case will remain comparison-only.</span></div>}</div>}

      <div className="form-section"><div className="form-section-heading"><div><h3>Synchronized pressure probes</h3><p className="form-help">{draftReferenceCase && !editingCaseId ? "The exact experiment samples are inherited from the starting case. Upload and map only the new CFD result." : "Map the actual headers in each file. Caevera converts the selected units to milliseconds and MPa before analysis."}</p></div><button onClick={downloadExample}>Download example CSV</button></div><div className="file-mapper-grid">{draftReferenceCase && !editingCaseId ? <section className="inherited-experiment"><div><span>EXPERIMENT REUSED</span><strong>{draftReferenceCase.imports?.experiment.fileName ?? draftReferenceCase.testSignals[0]?.name.split(" · ")[0] ?? "Experiment data"}</strong></div><p>Exact samples inherited from <b>{draftReferenceCase.metadata.name}</b>. No experiment re-upload is needed.</p></section> : <PressureFileMapper key={`experiment-${editingCaseId ?? "new"}-${draft.probePositionsDeg.length}-${draftRelationship?.referenceCaseId ?? "standalone"}`} kind="Experiment" expectedProbeCount={draft.probePositionsDeg.length} currentFileName={editingCaseId ? cases.find((item) => item.id === editingCaseId)?.testSignals[0]?.name.split(" · ")[0] : undefined} onMapped={setTestPending} />}<PressureFileMapper key={`cfd-${editingCaseId ?? "new"}-${draft.probePositionsDeg.length}-${draftRelationship?.referenceCaseId ?? "standalone"}`} kind="CFD" expectedProbeCount={draft.probePositionsDeg.length} currentFileName={editingCaseId ? cases.find((item) => item.id === editingCaseId)?.cfdSignals[0]?.name.split(" · ")[0] : undefined} onMapped={setCfdPending} /></div><div className="form-grid two measurement-chain"><label><span>Experiment sensor bandwidth (kHz)</span><input type="number" step="0.1" value={numberValue(draft.experimentSensorBandwidthKHz)} onChange={(event) => updateNumber("experimentSensorBandwidthKHz", event.target.value)} /></label><label><span>Experiment low-pass / anti-alias cutoff (kHz)</span><input type="number" step="0.1" value={numberValue(draft.experimentFilterCutoffKHz)} onChange={(event) => updateNumber("experimentFilterCutoffKHz", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Operating conditions</h3><div className="form-grid four"><label><span>Inlet pressure (bar)</span><input type="number" value={numberValue(draft.inletPressureBar)} onChange={(event) => updateNumber("inletPressureBar", event.target.value)} /></label><label><span>Inlet temperature (K)</span><input type="number" value={numberValue(draft.inletTemperatureK)} onChange={(event) => updateNumber("inletTemperatureK", event.target.value)} /></label><label><span>Equivalence ratio</span><input type="number" step="0.01" value={numberValue(draft.equivalenceRatio)} onChange={(event) => updateNumber("equivalenceRatio", event.target.value)} /></label><label><span>Mass flow (kg/s)</span><input type="number" step="0.01" value={numberValue(draft.massFlowKgS)} onChange={(event) => updateNumber("massFlowKgS", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Solver + numerical schemes</h3><div className="form-grid four"><label><span>Solver</span><input value={draft.solver} onChange={(event) => updateText("solver", event.target.value)} /></label><label><span>Version</span><input value={draft.solverVersion} onChange={(event) => updateText("solverVersion", event.target.value)} /></label><label><span>Dimensionality</span><select value={draft.dimensionality} onChange={(event) => setDraft((current) => ({ ...current, dimensionality: event.target.value as Dimensionality }))}><option value="">Select</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label><span>Runtime (hours) · optional</span><input type="number" min="0" step="0.1" value={numberValue(draft.solverRuntimeHours)} onChange={(event) => updateNumber("solverRuntimeHours", event.target.value)} /></label><label><span>Spatial scheme</span><input value={draft.spatialScheme} onChange={(event) => updateText("spatialScheme", event.target.value)} /></label><label><span>Spatial order</span><input type="number" value={numberValue(draft.spatialOrder)} onChange={(event) => updateNumber("spatialOrder", event.target.value)} /></label><label><span>Numerical flux</span><input value={draft.numericalFlux} onChange={(event) => updateText("numericalFlux", event.target.value)} /></label><label><span>Limiter / filter / dissipation</span><input placeholder="Enter None if unused" value={draft.limiterFilter} onChange={(event) => updateText("limiterFilter", event.target.value)} /></label><label><span>Temporal scheme</span><input value={draft.temporalScheme} onChange={(event) => updateText("temporalScheme", event.target.value)} /></label><label><span>Temporal order</span><input type="number" value={numberValue(draft.temporalOrder)} onChange={(event) => updateNumber("temporalOrder", event.target.value)} /></label><label><span>Time step (µs)</span><input type="number" step="0.001" value={numberValue(draft.timeStepUs)} onChange={(event) => updateNumber("timeStepUs", event.target.value)} /></label><label><span>CFL</span><input type="number" step="0.01" value={numberValue(draft.cfl)} onChange={(event) => updateNumber("cfl", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Resolution + convergence</h3><div className="form-grid four"><label><span>Total mesh cells</span><input type="number" value={numberValue(draft.meshCells)} onChange={(event) => updateNumber("meshCells", event.target.value)} /></label><label><span>Minimum front cell (mm)</span><input type="number" step="0.001" value={numberValue(draft.minimumCellSizeMm)} onChange={(event) => updateNumber("minimumCellSizeMm", event.target.value)} /></label><label><span>Cells / induction length</span><input type="number" step="0.1" value={numberValue(draft.cellsPerInductionLength)} onChange={(event) => updateNumber("cellsPerInductionLength", event.target.value)} /></label><label><span>Near-wall cell (mm)</span><input type="number" step="0.001" value={numberValue(draft.nearWallCellSizeMm)} onChange={(event) => updateNumber("nearWallCellSizeMm", event.target.value)} /></label><label><span>Mesh-change result (%) · optional</span><input type="number" step="0.1" value={numberValue(draft.meshConvergencePct)} onChange={(event) => updateNumber("meshConvergencePct", event.target.value)} /></label><label><span>Time-step-change result (%) · optional</span><input type="number" step="0.1" value={numberValue(draft.timeStepConvergencePct)} onChange={(event) => updateNumber("timeStepConvergencePct", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Physics + boundaries</h3><div className="form-grid four"><label><span>Chemical mechanism</span><input value={draft.chemistryModel} onChange={(event) => updateText("chemistryModel", event.target.value)} /></label><label><span>Species</span><input type="number" value={numberValue(draft.chemistrySpecies)} onChange={(event) => updateNumber("chemistrySpecies", event.target.value)} /></label><label><span>Reactions</span><input type="number" value={numberValue(draft.chemistryReactions)} onChange={(event) => updateNumber("chemistryReactions", event.target.value)} /></label><label><span>Chemistry integration</span><input value={draft.chemistryIntegrator} onChange={(event) => updateText("chemistryIntegrator", event.target.value)} /></label><label><span>Turbulence model</span><input placeholder="Enter None if unused" value={draft.turbulenceModel} onChange={(event) => updateText("turbulenceModel", event.target.value)} /></label><label><span>Combustion model</span><input placeholder="Enter None if unused" value={draft.combustionModel} onChange={(event) => updateText("combustionModel", event.target.value)} /></label><label><span>Wall thermal condition</span><input value={draft.wallBoundaryCondition} onChange={(event) => updateText("wallBoundaryCondition", event.target.value)} /></label><label><span>Inlet treatment</span><input value={draft.inletBoundaryCondition} onChange={(event) => updateText("inletBoundaryCondition", event.target.value)} /></label><label><span>Outlet treatment</span><input value={draft.outletBoundaryCondition} onChange={(event) => updateText("outletBoundaryCondition", event.target.value)} /></label><label><span>Ignition / initialization</span><input value={draft.initializationMethod} onChange={(event) => updateText("initializationMethod", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Experiment + CFD uncertainty</h3><div className="form-grid four"><label><span>Experiment pressure uncertainty (%)</span><input type="number" step="0.1" value={numberValue(draft.pressureUncertaintyPct)} onChange={(event) => updateNumber("pressureUncertaintyPct", event.target.value)} /></label><label><span>Experiment timing uncertainty (µs)</span><input type="number" step="0.01" value={numberValue(draft.timingUncertaintyUs)} onChange={(event) => updateNumber("timingUncertaintyUs", event.target.value)} /></label><label><span>CFD pressure uncertainty (%)</span><input type="number" step="0.1" value={numberValue(draft.cfdPressureUncertaintyPct)} onChange={(event) => updateNumber("cfdPressureUncertaintyPct", event.target.value)} /></label><label><span>CFD timing uncertainty (µs)</span><input type="number" step="0.01" value={numberValue(draft.cfdTimingUncertaintyUs)} onChange={(event) => updateNumber("cfdTimingUncertaintyUs", event.target.value)} /></label></div></div>

      {error && <p className="error-message">{error}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setShowLoader(false)}>Cancel</button><button className="button primary" onClick={applyCase}>Analyze case →</button></div>
    </section></div>}

    {showHelp && <div className="modal-backdrop help-backdrop" role="presentation" onMouseDown={() => setShowHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={() => setShowHelp(false)} aria-label="Close input guide">×</button><span className="modal-kicker">CASE INPUT GUIDE</span><h2 id="help-title">What each case input means</h2><p>Use the documented value from the experiment or CFD setup. Caevera does not infer missing model settings or uncertainty.</p>
      <div className="help-groups">{CASE_INPUT_HELP.map((group) => <section key={group.title} className="help-group"><div><h3>{group.title}</h3><p>{group.description}</p></div><dl>{group.items.map((item) => <div key={item.key} className="help-item"><dt>{item.label}<span className={`requirement-tag ${item.requirement.toLowerCase()}`}>{item.requirement}</span></dt><dd><p>{item.definition}</p><div className="help-details"><span><b>Format / units</b>{item.format}</span><span><b>Where to find it</b>{item.obtainFrom}</span><span><b>Used for</b>{item.usedFor}</span><span><b>If missing</b>{item.missingEffect}</span></div></dd></div>)}</dl></section>)}</div>
      <div className="help-actions"><button className="button primary" onClick={() => setShowHelp(false)}>{showLoader ? "Back to case inputs" : "Close guide"}</button></div>
    </section></div>}
  </main>;
}
