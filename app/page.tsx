"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { PressureFileMapper } from "@/components/pressure-file-mapper";
import { CONTROLLED_RERUN_FIELDS, buildCaseDelta, buildCaseHistoryEvidence, caseFieldLabel, selectIndependentPrecedents, selectPlanningEvidence, summarizeCase, type CaseHistoryEvidence } from "@/lib/case-history";
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
import { KNOWLEDGE_BASE_VERSION, sourcesFor, type DiagnosticResearchClaim, type DiagnosticSource } from "@/lib/diagnostic-knowledge";
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
const RERUN_ALWAYS_EDITABLE_FIELDS: (keyof CaseMetadata)[] = ["name", "solverRuntimeHours", "cfdPressureUncertaintyPct", "cfdTimingUncertaintyUs"];

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

function metadataValueEqual(left: unknown, right: unknown) {
  return Array.isArray(left) && Array.isArray(right)
    ? JSON.stringify(left) === JSON.stringify(right)
    : Object.is(left, right);
}

function signed(value: number, digits: number) {
  if (!Number.isFinite(value)) return "Not available";
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

function outcomeLabel(evidence: CaseHistoryEvidence) {
  if (evidence.sequenceStatus === "converged") return "Numerically converged";
  if (evidence.state === "supports" && ["mesh", "time-step"].includes(evidence.changedVariable)) return "Numerical sensitivity found";
  if (evidence.state === "supports") return "Supports explanation";
  if (evidence.state === "weakens") return "Does not support explanation";
  return "Inconclusive";
}

function outcomeTone(evidence: CaseHistoryEvidence): DecisionSummary["tone"] {
  if (evidence.sequenceStatus === "converged") return "converged";
  if (evidence.state === "supports") return "confirmed";
  if (evidence.state === "weakens") return "rejected";
  return "inconclusive";
}

function latestResultLabel(status: ControlledNextRun["latestControlledResult"]["status"], policy: ControlledNextRun["decisionPolicy"]) {
  if (status === "Confirmed") return policy.evaluationMode === "numerical-convergence" ? "Numerical sensitivity found" : "Supports explanation";
  if (status === "Converged") return "Numerically converged";
  if (status === "Rejected") return "Does not support explanation";
  return status;
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
  if (evidence.sequenceStatus === "converged") return `Keep ${evidence.caseName}. The numerical setting passed the convergence rule, so the next unresolved explanation can now be tested.`;
  if (evidence.state === "supports" && evidence.planDisposition === "continue") return `Keep ${evidence.caseName}. The changed numerical setting still affects the CFD result, so run the next adjacent level before changing the physics.`;
  if (evidence.state === "supports") return `Keep ${evidence.caseName}. This one-change result supports the tested explanation, so the next unresolved explanation can now be tested.`;
  if (evidence.state === "weakens") return `Do not keep the tested change. Return to ${evidence.referenceCaseName} and test the next unresolved explanation.`;
  return `Do not keep the tested change yet. Repeat from ${evidence.referenceCaseName} with a clearer one-variable difference.`;
}

function conciseOutcomeDetail(evidence: CaseHistoryEvidence) {
  if (evidence.sequenceStatus === "converged" && Number.isFinite(evidence.incrementalResponsePct)) return `Targeted CFD values changed ${evidence.incrementalResponsePct!.toFixed(1)}% between adjacent levels · convergence rule passed`;
  if (evidence.state === "supports" && Number.isFinite(evidence.errorReductionPct)) return `Mean targeted CFD-to-experiment error fell ${Math.abs(evidence.errorReductionPct!).toFixed(1)}%${evidence.newMismatchMetricIds?.length ? " · a new mismatch appeared" : " · no new mismatch appeared"}`;
  if (evidence.state === "weakens" && Number.isFinite(evidence.responseMagnitudePct)) return `Targeted CFD values changed ${evidence.responseMagnitudePct!.toFixed(1)}% · a rejection rule was met`;
  if (evidence.state === "unknown" && Number.isFinite(evidence.responseMagnitudePct)) return `Targeted CFD values changed ${evidence.responseMagnitudePct!.toFixed(1)}% · no classification rule was met`;
  return evidence.controlled ? evidence.detail.split(".")[0] : evidence.relationshipIssues[0] ?? "The one-change relationship could not be verified";
}

function comparisonOnlyMeaning(evidence: CaseHistoryEvidence) {
  const issues = evidence.relationshipIssues.length ? evidence.relationshipIssues.join(" ") : "The declared relationship could not be verified.";
  return `Caevera did not use this rerun to update the plan. ${issues}`;
}

function evidenceBasisLabel(basis: DiagnosticEvidence["basis"]) {
  if (basis === "case-history") return "Calculated from a related one-change rerun";
  if (basis === "literature") return "Supported by published research";
  if (basis === "policy") return "Result still required";
  return "Calculated from this case";
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
    {items.length > 2 && <small className="reasoning-more">+{items.length - 2} more findings in the report</small>}
  </article>;
}

function ResearchBasis({ claims, sources }: { claims: DiagnosticResearchClaim[]; sources: DiagnosticSource[] }) {
  return <details className="research-basis">
    <summary>Research supporting this test · {sources.length ? `${sources.length} published source${sources.length === 1 ? "" : "s"}` : "no directly applicable paper"}</summary>
    {claims.length ? <div className="research-claims">{claims.map((claim) => {
      const claimSources = sourcesFor(claim.sourceIds);
      return <article key={claim.statement}>
        <p>{claim.statement}</p>
        <div>{claimSources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.authors.split(";")[0]} ({source.year})</a>)}</div>
        <small>What the research does not establish: {claim.boundary}</small>
      </article>;
    })}</div> : <p className="research-unmapped">No published paper is mapped to this specific recommendation. Caevera treats it as a prototype product rule, not a research conclusion.</p>}
  </details>;
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
  publishedSources,
  researchClaims,
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
  publishedSources: DiagnosticSource[];
  researchClaims: DiagnosticResearchClaim[];
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
    <div className="decision-quality" aria-label={`Recommendation evidence: ${decisionQuality.label}`}>
      <div className="decision-quality-verdict"><span>Recommendation evidence</span><strong>{decisionQuality.label}</strong></div>
      <div className="decision-quality-copy"><small>{decisionQuality.sourceLabel}</small><p>{decisionQuality.explanation}</p></div>
      <div className="decision-quality-factors" aria-label="Evidence conditions">
        {decisionQuality.gates.map((gate) => <span key={gate.id} className={`factor-${gate.status}`}><i aria-hidden="true">{gate.status === "passed" ? "✓" : gate.status === "blocked" ? "×" : gate.status === "review" ? "!" : "○"}</i><small>{gate.label}</small><strong>{gate.statusLabel}</strong></span>)}
      </div>
    </div>
    <section className="decision-block decision-conclusion-block" aria-labelledby="decision-conclusion-heading">
      <div className="decision-block-heading"><b>1</b><h2 id="decision-conclusion-heading">{conclusionHeading}</h2></div>
      <header className="engineering-decision-heading">
        <div><span>{summary.label}</span></div>
        <h3><span>{summary.lead}</span> {summary.title}</h3>
        {summary.detail && <p className="decision-detail">{summary.detail}</p>}
        <p className="decision-meaning">{summary.meaning}</p>
      </header>
      {showLatestResult && nextRun.latestControlledResult.status !== "Awaiting result" && <div className={`decision-latest-result outcome-${nextRun.latestControlledResult.status.toLowerCase()}`}><strong>Latest case-family result: {latestResultLabel(nextRun.latestControlledResult.status, policy)}</strong><span>{nextRun.latestControlledResult.caseName}</span><p>{nextRun.latestControlledResult.detail}</p></div>}
    </section>
    <section className="decision-block decision-recommendation-block" aria-labelledby="decision-recommendation-heading">
      <div className="decision-block-heading"><b>2</b><h2 id="decision-recommendation-heading">Next CFD run for this case family</h2></div>
      {planUsesDifferentCase && <div className="decision-scope">
        <strong>Starting point</strong>
        <span>Use <b>{planningCaseName}</b>. {startingPointReason}</span>
      </div>}
      <div className="decision-next-run">
        <span>Do this next</span><h3>{nextRun.title}</h3>
      </div>
      <div className="next-run-action">
        <p><strong>Change</strong><span>{nextRun.change}</span></p>
        <p><strong>Keep unchanged</strong><span>{nextRun.holdFixed.join(" · ")}</span></p>
        <p><strong>Compare</strong><span>{nextRun.expectedOutcome}</span></p>
      </div>
      <section className="decision-reasoning" aria-label="Why Caevera recommends this run">
        <div className="decision-reasoning-heading">
          <span>Question being tested</span>
          <h3>{nextRun.question}</h3>
          <p>These findings are calculated from the analyzed cases. They are not columns or labels in the CSV files.</p>
        </div>
        <div className="reasoning-ledger">
          <EvidenceLedgerColumn title="Findings that support this explanation" emptyMessage="No analyzed finding directly supports this explanation." items={ledger.supports} tone="supports" />
          <EvidenceLedgerColumn title="Findings that contradict this explanation" emptyMessage="No finding in the analyzed cases contradicts this explanation. That does not confirm it." items={ledger.weakens} tone="weakens" />
          <EvidenceLedgerColumn title="Evidence still needed" emptyMessage="Caevera has not identified another missing result for this decision." items={ledger.unknowns} tone="unknowns" />
        </div>
        <div className="decision-priority">
          <strong>Why this is the next test</strong>
          <p>{nextRun.whyThisRunFirst}</p>
        </div>
      </section>
      <section className="decision-outcomes" aria-label="How the result changes the plan">
        <div><span>How Caevera will classify the result</span>{policy.basis === "prototype-policy" && <small>Prototype product policy {policy.version}. Caevera chose these decision limits; the cited papers did not.</small>}</div>
        {isNumericalPolicy ? <>
          <div className="outcome-rules">
            <article className="branch-converged"><strong>Numerically converged</strong><span>The targeted CFD values change by no more than {policy.convergenceResponsePct!.toFixed(1)}% between the two adjacent levels.</span><small>Keep the newer setting and move to the next unresolved explanation.</small></article>
            <article className="branch-confirmed"><strong>{changeLabel(policy.changedVariable!)} still changes the result</strong><span>The targeted CFD values change by more than {policy.convergenceResponsePct!.toFixed(1)}% between the two adjacent levels.</span><small>Keep the newer setting and test the next {testedVariable} level before changing the physics.</small></article>
            <article className="branch-inconclusive"><strong>Cannot classify</strong><span>The two levels are not a valid one-change pair, or a required targeted value cannot be calculated.</span><small>Correct the case relationship or data problem, then repeat the same comparison.</small></article>
          </div>
          <p className="decision-agreement-note"><strong>Separate question:</strong> Caevera also reports whether the newer CFD result moved closer to the experiment, moved farther away, or created a new mismatch.</p>
        </> : isModelSensitivityPolicy ? <div className="outcome-rules">
          <article className="branch-confirmed"><strong>Supports this explanation</strong><span>The mean CFD-to-experiment error in the targeted values falls by at least {policy.confirmationErrorReductionPct!.toFixed(1)}%, with no new resolved mismatch.</span><small>Keep the tested setting and move to the next unresolved explanation.</small></article>
          <article className="branch-rejected"><strong>Does not support this explanation</strong><span>The targeted CFD response is below {policy.minimumResponsePct!.toFixed(1)}%, the targeted error increases by at least {policy.rejectionErrorWorseningPct!.toFixed(1)}%, or a new resolved mismatch appears.</span><small>Return to the starting setting and test the next explanation.</small></article>
          <article className="branch-inconclusive"><strong>Inconclusive</strong><span>The result meets neither rule above.</span><small>Repeat the same one-variable test with a larger change or lower uncertainty.</small></article>
        </div> : <div className="outcome-rules">
          <article className="branch-confirmed"><strong>Passes</strong><span>{nextRun.confirmationCriterion}</span><small>{nextRun.ifConfirmed}</small></article>
          <article className="branch-rejected"><strong>Does not pass</strong><span>{nextRun.rejectionCriterion}</span><small>{nextRun.ifRejected}</small></article>
          <article className="branch-inconclusive"><strong>Cannot classify</strong><span>{nextRun.inconclusiveCriterion}</span><small>{nextRun.ifInconclusive}</small></article>
        </div>}
      </section>
      <div className="decision-precedent" aria-label="Comparable controlled reruns">
        <span>Independent evidence from other case families</span>
        {precedent.matchedCount ? <>
          <p><strong>{precedent.confirmedCount} of {precedent.matchedCount} comparable one-change reruns met the same decision rule.</strong></p>
          {isDemo && <small>These are generated demonstrations, not evidence from a physical engine.</small>}
        </> : <>
          <p><strong>No comparable rerun from another case family has been analyzed.</strong> The findings above come only from this case family.</p>
        </>}
      </div>
      <ResearchBasis claims={researchClaims} sources={publishedSources} />
      <details className="decision-evidence">
        <summary>What is this recommendation status based on?</summary>
        <p className="evidence-calculation-note">Caevera calculates this status from the loaded case and verified case-family history. Published papers and public benchmarks do not raise it.</p>
        <p className="selected-data-source"><strong>{selectedCaseName}</strong> · {selectedAnalysisInput.experimentSamples.toLocaleString()} experiment + {selectedAnalysisInput.cfdSamples.toLocaleString()} CFD values · {selectedAnalysisInput.probeCount} probes</p>
        {planUsesDifferentCase && <p className="planning-data-source"><strong>Plan reference:</strong> {planningCaseName}</p>}
        <ul>{decisionQuality.gates.map((gate) => <li key={gate.id} className={`evidence-${gate.status}`}><i>{gate.status === "passed" ? "✓" : gate.status === "blocked" ? "×" : gate.status === "review" ? "!" : "○"}</i><strong>{gate.label}</strong><b>{gate.statusLabel}</b><small>{gate.result}</small></li>)}</ul>
        <p><strong>Method support only:</strong> {publishedSources.length} published reference{publishedSources.length === 1 ? "" : "s"} support the method, and {publishedValidation.waveSpeedCases + publishedValidation.pressureFixtureCases} public validation cases test the analyzer. Neither confirms the explanation in this case.</p>
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
  const [reviewingRerun, setReviewingRerun] = useState(false);
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
    const relevantPrecedents = selectIndependentPrecedents(precedentEvidence, recommendationBaselineId, planningCase.source);
    const planningComparison = compareProbeSets(planningCase.testSignals, planningCase.cfdSignals);
    const planningTestMode = analyzeRdeProbeSet(planningCase.testSignals, planningCase.metadata.probePositionsDeg, planningCase.metadata.annulusMeanDiameterMm, { maximumWaveCount: planningCase.metadata.maximumWaveCount, synchronizationConfirmed: planningCase.metadata.probeSynchronizationConfirmed, sensorBandwidthKHz: planningCase.metadata.experimentSensorBandwidthKHz, filterCutoffKHz: planningCase.metadata.experimentFilterCutoffKHz });
    const planningCfdMode = analyzeRdeProbeSet(planningCase.cfdSignals, planningCase.metadata.probePositionsDeg, planningCase.metadata.annulusMeanDiameterMm, { maximumWaveCount: planningCase.metadata.maximumWaveCount, synchronizationConfirmed: planningCase.metadata.probeSynchronizationConfirmed });
    return buildCaseAssessment(planningCase.metadata, planningComparison.comparisons, planningTestMode, planningCfdMode, caseHistoryEvidence, relevantPrecedents);
  }, [planningCase, recommendationBaselineId, caseHistoryEvidence, precedentEvidence]);
  const activeAnalysisInput = summarizeAnalysisInput(activeCase);
  const activeCaseEvidence = activeCase?.relationship ? caseHistoryEvidence.find((item) => item.caseId === activeCase.id) ?? null : null;
  const recommendationResultEvidence = activeCaseEvidence ?? latestAcceptedEvidence;
  const decisionQuality = activeCase && assessment && planAssessment ? buildDecisionQuality({
    source: activeCase.source,
    validityStatus: assessment.validity.status,
    dataQualityStatus: assessment.dataQuality.status,
    controlledResultStatus: recommendationResultEvidence?.sequenceStatus ?? null,
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
  const controlledRerunDraft = Boolean(draftReferenceCase && draftRelationship && !editingCaseId);
  const selectedRerunFields = draftRelationship ? CONTROLLED_RERUN_FIELDS[draftRelationship.changedVariable] : [];
  const changedRerunFields = draftReferenceCase
    ? selectedRerunFields.filter((field) => !metadataValueEqual(draftReferenceCase.metadata[field], draft[field]))
    : [];
  const inheritedExperimentName = draftReferenceCase?.imports?.experiment.fileName
    ?? draftReferenceCase?.testSignals[0]?.name.split(" · ")[0]
    ?? "Experiment data";

  function rerunFieldLocked(field: keyof CaseMetadata) {
    if (!controlledRerunDraft) return false;
    if (RERUN_ALWAYS_EDITABLE_FIELDS.includes(field)) return false;
    if (field === "meshConvergencePct") return draftRelationship?.changedVariable !== "mesh";
    if (field === "timeStepConvergencePct") return draftRelationship?.changedVariable !== "time-step";
    return !selectedRerunFields.includes(field);
  }

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
    lead: `${activeCaseEvidence.controlled ? outcomeLabel(activeCaseEvidence) : "Comparison only"}:`,
    title: `${changeLabel(activeCase?.relationship?.changedVariable ?? "other")} response`,
    detail: conciseOutcomeDetail(activeCaseEvidence),
    meaning: activeCaseEvidence.controlled ? outcomeMeaning(activeCaseEvidence) : comparisonOnlyMeaning(activeCaseEvidence),
    tone: activeCaseEvidence.controlled ? outcomeTone(activeCaseEvidence) : "neutral",
  } : {
    label: "Current diagnosis",
    lead: "Likely issue:",
    title: likelyHypothesis?.title ?? "Cannot assess",
    detail: null,
    meaning: planAssessment?.nextRun.reason ?? "Caevera cannot choose a next run from the analyzed case data.",
    tone: "neutral",
  };
  const showDetailedEvidence = false;

  function openNewCase() {
    setEditingCaseId(null);
    setDraft(cloneMetadata(EMPTY_METADATA));
    setDraftRelationship(null);
    setTestPending(null); setCfdPending(null); setError(""); setReviewingRerun(false); setShowLoader(true);
  }

  function openCaseEditor() {
    if (!activeCase) return;
    setEditingCaseId(activeCase.id);
    setDraft(cloneMetadata(activeCase.metadata));
    setDraftRelationship(activeCase.relationship ?? null);
    setTestPending(null); setCfdPending(null); setError(""); setReviewingRerun(false); setShowLoader(true);
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
    setReviewingRerun(false);
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

  function chooseChangedVariable(changedVariable: SensitivityVariable) {
    setDraftRelationship((current) => current ? { ...current, changedVariable } : null);
    if (draftReferenceCase && !editingCaseId) {
      setDraft((current) => {
        const inherited = cloneMetadata(draftReferenceCase.metadata);
        inherited.name = current.name;
        inherited.solverRuntimeHours = current.solverRuntimeHours;
        inherited.cfdPressureUncertaintyPct = current.cfdPressureUncertaintyPct;
        inherited.cfdTimingUncertaintyUs = current.cfdTimingUncertaintyUs;
        return inherited;
      });
    }
    setReviewingRerun(false);
    setError("");
  }

  function reviewRerun() {
    if (!draftRelationship || editingCaseId) return applyCase();
    if (!draftReferenceCase) return setError("Choose the exact starting case for this rerun.");
    if (draftRelationship.changedVariable === "other") return setError("Choose the single CFD change being tested. Other remains comparison-only.");
    if (!changedRerunFields.length) return setError(`Change at least one ${changeLabel(draftRelationship.changedVariable).toLowerCase()} setting before reviewing this rerun.`);
    if (!cfdPending) return setError("Upload and map the new CFD result before reviewing this rerun.");
    if (cfdPending.signals.length !== draft.probePositionsDeg.length) return setError(`The CFD file contains ${cfdPending.signals.length} probes, but the starting case uses ${draft.probePositionsDeg.length}.`);
    setError("");
    setReviewingRerun(true);
  }

  function applyCase() {
    if (!draft.name.trim()) return setError("Give this operating point a name.");
    if (!draft.comparisonMatchConfirmed) return setError("Confirm that experiment and CFD use the same geometry, operating point, probe locations, and comparison window.");
    if (!draft.probeSynchronizationConfirmed) return setError("Confirm that every probe in each file uses one synchronized time base.");
    if (!Number.isFinite(draft.annulusMeanDiameterMm) || draft.annulusMeanDiameterMm <= 0) return setError("Enter a positive annulus mean diameter.");
    if (draft.probePositionsDeg.length < 3 || draft.probePositionsDeg.some((value) => !Number.isFinite(value))) return setError("Enter at least three valid probe angles.");
    if (!Number.isInteger(draft.maximumWaveCount) || draft.maximumWaveCount < 1 || draft.maximumWaveCount > 12) return setError("Maximum expected wave count must be an integer from 1 to 12.");
    const positiveInputs: Array<[string, number]> = [
      ["Experiment sensor bandwidth", draft.experimentSensorBandwidthKHz], ["Experiment filter cutoff", draft.experimentFilterCutoffKHz],
      ["Inlet pressure", draft.inletPressureBar], ["Inlet temperature", draft.inletTemperatureK], ["Equivalence ratio", draft.equivalenceRatio], ["Mass flow", draft.massFlowKgS],
      ["Spatial order", draft.spatialOrder], ["Temporal order", draft.temporalOrder], ["CFL", draft.cfl], ["Total mesh cells", draft.meshCells],
      ["Minimum front cell", draft.minimumCellSizeMm], ["Cells per induction length", draft.cellsPerInductionLength], ["Near-wall cell", draft.nearWallCellSizeMm],
      ["Time step", draft.timeStepUs], ["Chemistry species", draft.chemistrySpecies], ["Chemistry reactions", draft.chemistryReactions],
    ];
    const invalidPositive = positiveInputs.find(([, value]) => !Number.isFinite(value) || value <= 0);
    if (invalidPositive) return setError(`${invalidPositive[0]} must be a number greater than zero.`);
    const uncertaintyInputs: Array<[string, number]> = [
      ["Diameter uncertainty", draft.annulusDiameterUncertaintyMm], ["Experiment pressure uncertainty", draft.pressureUncertaintyPct],
      ["Experiment timing uncertainty", draft.timingUncertaintyUs], ["CFD pressure uncertainty", draft.cfdPressureUncertaintyPct], ["CFD timing uncertainty", draft.cfdTimingUncertaintyUs],
    ];
    const invalidUncertainty = uncertaintyInputs.find(([, value]) => !Number.isFinite(value) || value < 0);
    if (invalidUncertainty) return setError(`${invalidUncertainty[0]} must be zero or greater.`);
    if (Number.isFinite(draft.solverRuntimeHours) && draft.solverRuntimeHours <= 0) return setError("Runtime must be positive when supplied.");
    const textInputs: Array<[string, string]> = [
      ["Solver", draft.solver], ["Solver version", draft.solverVersion], ["Dimensionality", draft.dimensionality], ["Spatial scheme", draft.spatialScheme],
      ["Numerical flux", draft.numericalFlux], ["Limiter, filter, or dissipation", draft.limiterFilter], ["Temporal scheme", draft.temporalScheme],
      ["Turbulence model", draft.turbulenceModel], ["Combustion model", draft.combustionModel], ["Chemical mechanism", draft.chemistryModel],
      ["Chemistry integration", draft.chemistryIntegrator], ["Wall thermal condition", draft.wallBoundaryCondition], ["Inlet treatment", draft.inletBoundaryCondition],
      ["Outlet treatment", draft.outletBoundaryCondition], ["Ignition or initialization", draft.initializationMethod],
    ];
    const missingText = textInputs.find(([, value]) => !value.trim());
    if (missingText) return setError(`${missingText[0]} is required. Enter “None” only when that model or treatment is not used.`);
    try {
      const editingCase = cases.find((item) => item.id === editingCaseId) ?? null;
      const effectiveRelationship = editingCase?.relationship ?? draftRelationship;
      const referenceId = effectiveRelationship?.referenceCaseId ?? effectiveRelationship?.baselineCaseId;
      const referenceCase = referenceId ? cases.find((item) => item.id === referenceId) ?? null : null;
      const nextTest = testPending?.signals ?? editingCase?.testSignals ?? referenceCase?.testSignals;
      const nextCfd = cfdPending?.signals ?? editingCase?.cfdSignals;
      if (!nextTest) return setError("Upload the experimental multi-probe file for this baseline case.");
      if (!nextCfd) return setError(effectiveRelationship ? "Upload the new CFD multi-probe result for this rerun." : "Upload the CFD multi-probe file for this case.");
      if (nextTest.length !== draft.probePositionsDeg.length || nextCfd.length !== draft.probePositionsDeg.length) return setError(`The files contain ${nextTest.length} experiment and ${nextCfd.length} CFD probes, but ${draft.probePositionsDeg.length} probe angles were entered.`);
      compareProbeSets(nextTest, nextCfd);
      analyzeRdeProbeSet(nextTest, draft.probePositionsDeg, draft.annulusMeanDiameterMm, { maximumWaveCount: draft.maximumWaveCount, synchronizationConfirmed: draft.probeSynchronizationConfirmed, sensorBandwidthKHz: draft.experimentSensorBandwidthKHz, filterCutoffKHz: draft.experimentFilterCutoffKHz });
      analyzeRdeProbeSet(nextCfd, draft.probePositionsDeg, draft.annulusMeanDiameterMm, { maximumWaveCount: draft.maximumWaveCount, synchronizationConfirmed: draft.probeSynchronizationConfirmed });
      const id = editingCaseId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (effectiveRelationship?.baselineCaseId === id) return setError("A case cannot be its own baseline.");
      if (effectiveRelationship) {
        if (!referenceCase || referenceCase.id !== effectiveRelationship.baselineCaseId && referenceCase.relationship?.baselineCaseId !== effectiveRelationship.baselineCaseId) return setError("Choose a starting case from the selected case family.");
      }
      const experimentProvenance = testPending?.provenance ?? editingCase?.imports?.experiment ?? referenceCase?.imports?.experiment;
      const cfdProvenance = cfdPending?.provenance ?? editingCase?.imports?.cfd;
      const nextImports = experimentProvenance && cfdProvenance ? { experiment: experimentProvenance, cfd: cfdProvenance } : null;
      const nextRelationship = effectiveRelationship ? { ...effectiveRelationship, referenceCaseId: effectiveRelationship.referenceCaseId ?? effectiveRelationship.baselineCaseId } : null;
      const nextCase: AnalysisCase = { id, source: editingCase?.source ?? "uploaded", relationship: nextRelationship, metadata: cloneMetadata(draft), testSignals: nextTest, cfdSignals: nextCfd, imports: nextImports };
      setCases((current) => editingCaseId ? current.map((item) => item.id === editingCaseId ? nextCase : item) : [...current, nextCase]);
      if (!caseBaselineId) setCaseBaselineId(id);
      setActiveCaseId(id); setWorkspaceView("case"); setActiveProbe(0); setReviewingRerun(false); setShowLoader(false); setError("");
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
          ? "Generated demonstration pressure values, entered case settings, declared uncertainties, and verified one-change relationships determine this result. It is not evidence from a physical engine."
          : "The user-provided experiment and CFD pressure values, entered case settings, declared uncertainties, and verified one-change relationships determine the metrics and recommendation.",
        recommendationScope: {
          selectedCase: activeCase.metadata.name,
          planningReferenceCase: planningCase.metadata.name,
          sharedAcrossCaseFamily: caseHistoryEvidence.length > 0,
          explanation: "Caevera recalculates the selected case's diagnosis or rerun result from that case. A case family contains one baseline plus qualifying one-change reruns. Its next-run plan starts from the most recent rerun that passed a support or convergence rule.",
        },
        storageBoundary: "A saved workspace stores the entered settings, pressure values, file mappings, and case relationships. When the workspace is reopened, Caevera recalculates the metrics, diagnoses, rerun classifications, and recommendation.",
        diagnosticRuleSources: likelySources,
        methodSources: WAVE_METHOD_SOURCES,
        publicAnalyzerValidation: {
          summary: PUBLISHED_VALIDATION_SUMMARY,
          cases: RAW_DATASET_VALIDATION_CASES,
          role: "Software validation only. Public benchmark cases test the analyzer; they do not count as independent case-family evidence and do not choose the recommendation for this user-provided case.",
        },
      },
      perProbe: comparisons,
      methods: ["shared bounded cross-correlation", "Hann-windowed FFT pressure spectrum", "cycle-by-cycle passage tracking", "sliding-window circumferential phase-mode fit", "uncertainty resolution by RSS", "structured diagnostic rules", "adaptive controlled-rerun outcome classification"],
      limitations: ["The ranked explanations choose which one-change CFD test to run next; they do not prove causality.", "The support, rejection, and convergence limits are Caevera prototype product rules. They are not probabilities and are not taken from the cited papers.", "Caevera propagates pressure and timing uncertainty only into the scalar outputs that support that calculation.", "Wave-mode inference requires synchronized probes and assumes one dominant rotating mode. Caevera reports ambiguous or simultaneous modes as not identifiable.", "This product version does not assess thermal, performance, combustion, or flowfield agreement."],
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
        <p>Compare experimental pressure-probe data with CFD. Caevera identifies differences larger than the stated uncertainty, recommends one CFD change, and uses the rerun result to choose what happens next.</p>
        <span className="empty-status">No case has been added yet</span>
        <div className="empty-actions"><button className="button primary" onClick={openNewCase}>Add first case →</button><label className="button secondary workspace-file-button">Open saved workspace<input type="file" accept=".json" onChange={openWorkspace} hidden /></label><button className="button secondary" onClick={loadExampleCaseHistory}>Load synthetic case history</button></div>
        <div className="empty-requirements"><span><b>1</b><i><strong>Compare</strong> matched experiment and CFD pressure traces</i></span><span><b>2</b><i><strong>Diagnose</strong> pressure and rotating-wave mismatches</i></span><span><b>3</b><i><strong>Run and update</strong> the adaptive CFD plan</i></span></div>
      </section> : <>
        <section className="case-switcher" aria-label="Loaded cases">
          <div className="case-switcher-label"><span>Cases</span><b>{cases.length}</b></div>
          <div className="case-tabs-list">{cases.map((item, index) => <button key={item.id} className={workspaceView === "case" && item.id === activeCase.id ? "active" : ""} onClick={() => { setActiveCaseId(item.id); setActiveProbe(0); setWorkspaceView("case"); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.metadata.name}</strong><small>{caseTabSummary(item)}</small></button>)}</div>
          <div className="case-actions">{cases.length > 1 && <button className={`compare-cases-button ${workspaceView === "compare" ? "active" : ""}`} onClick={() => setWorkspaceView("compare")}>Case history</button>}<button className="compare-cases-button" onClick={downloadWorkspace}>Save workspace</button><button className="add-case-button" onClick={openNewCase}>+ Add case</button></div>
        </section>

        {workspaceView === "compare" && baselineSummary ? <section className="case-history-comparison" aria-label="Case history">
          <div className="case-history-heading"><div><span className="empty-kicker">CASE HISTORY</span><h1>One baseline and its related reruns</h1><p>A case family contains one baseline plus reruns that reuse its experiment and physical operating point. A rerun affects the plan only when exactly one CFD setting group changes.</p></div><label className="baseline-select"><span>Show family for baseline</span><select value={baselineSummary.item.id} onChange={(event) => setCaseBaselineId(event.target.value)}>{caseSummaries.map((summary) => <option key={summary.item.id} value={summary.item.id}>{summary.item.metadata.name}</option>)}</select></label></div>
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
                <td><span className={`comparison-status ${relationEvidence?.state === "supports" || relationEvidence?.sequenceStatus === "converged" ? "pass" : relationEvidence?.controlled ? "review" : summary.assessment.validity.status === "Blocked" || caseReviews ? "review" : "neutral"}`}>{isBaseline ? "Baseline case" : relationEvidence?.controlled ? outcomeLabel(relationEvidence) : "Comparison only"}</span></td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="case-history-note"><strong>How this works:</strong> Caevera checks the saved settings and experiment samples. A valid one-change rerun updates the plan; a case with multiple changes remains a comparison and does not update the plan.</p>
        </section> : <>
          <div className="case-heading"><div><span className={`source-dot ${activeCase.source === "demo" ? "demo" : ""}`} /><span>{activeCase.source === "demo" ? "Synthetic demonstration" : "User-provided case"}</span></div><h1>{activeCase.metadata.name}</h1><p>{activeCase.relationship ? `One-change ${changeLabel(activeCase.relationship.changedVariable).toLowerCase()} rerun starting from ${activeReferenceName ?? baselineCaseName ?? "the family baseline"}` : `Baseline for ${caseHistoryEvidence.length} related rerun${caseHistoryEvidence.length === 1 ? "" : "s"}`} · calculated from this case</p></div>

          <EngineeringDecisionPanel summary={decisionSummary} nextRun={planAssessment.nextRun} showLatestResult={!activeCaseEvidence} decisionQuality={decisionQuality} selectedCaseName={activeCase.metadata.name} selectedAnalysisInput={activeAnalysisInput} planningCaseName={planningCase.metadata.name} publishedSources={likelySources} researchClaims={likelyHypothesis?.researchClaims ?? []} publishedValidation={PUBLISHED_VALIDATION_SUMMARY} onEdit={openCaseEditor} onDownloadReport={downloadReport} onSaveWorkspace={downloadWorkspace} onViewHistory={cases.length > 1 ? () => setWorkspaceView("compare") : null} />

          {showDetailedEvidence && <>
          <section className={`assessment-banner ${totalReview ? "review" : "pass"}`} aria-label="Comparison conclusion">
            <div><span>COMPARISON CONCLUSION</span><h2>{assessment.validity.status === "Blocked" ? "Assessment blocked until case matching is confirmed" : totalReview ? `${totalReview} evidence check${totalReview === 1 ? "" : "s"} require review` : "No selected CFD-to-experiment difference exceeds current uncertainty"}</h2><p>{assessment.validity.status === "Blocked" ? "Do not change the CFD model from this pairing yet." : totalReview ? "The highlighted findings determine the ranked explanations and one-variable next-run plan below." : "This does not prove the CFD is valid for every output or operating point. It means this pressure case does not contain a resolved discrepancy."}</p></div>
            <strong>{assessment.validity.status === "Blocked" ? "BLOCKED" : totalReview ? "REVIEW" : "NO RESOLVED MISMATCH"}</strong>
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
                <thead><tr><th>Quantity</th><th>Experiment</th><th>CFD</th><th>CFD − experiment</th><th>Combined uncertainty or Caevera prototype limit</th><th>Assessment</th></tr></thead>
                <tbody>{assessment.metrics.map((metric) => <tr key={metric.id} className={metric.tone === "review" ? "comparison-row-review" : metric.tone === "neutral" ? "comparison-row-neutral" : ""}>
                  <th scope="row"><strong>{metric.label}</strong><small>{metric.purpose}</small></th>
                  <td>{formatMetricValue(metric, metric.experiment)}</td><td>{formatMetricValue(metric, metric.cfd)}</td><td className="difference-cell">{formatMetricDifference(metric)}</td>
                  <td className="uncertainty-cell">{metric.uncertainty === null || metric.assessment.status === "match" || metric.assessment.status === "mismatch" ? metric.uncertaintyLabel : `±${metric.uncertainty.toFixed(metricDigits(metric))}${metric.unit ? ` ${metric.unit}` : ""}`}<small>{metric.assessment.explanation}</small></td>
                  <td><span className={`comparison-status ${metric.tone}`}>{metric.assessment.label}</span></td>
                </tr>)}</tbody>
              </table></div>

              <section className="result-block mismatch-block"><div><span className="result-index">05</span><h3>Waveform agreement</h3></div><div className="comparison-metrics">
                <div className={waveformWithinLimit ? "metric-pass" : "metric-review"}><span>Aligned correlation</span><strong>{correlation.toFixed(3)}</strong><small>{waveformWithinLimit ? "Passes Caevera prototype limit: at least 0.700" : "Outside Caevera prototype limit: below 0.700"}</small></div>
                <div><span>Normalized RMSE</span><strong>{(nrmse * 100).toFixed(1)}<i>%</i></strong><small>Residual relative to experimental oscillation RMS</small></div>
                <div><span>Mean pressure bias</span><strong>{signed(pressureBias, 3)} <i>MPa</i></strong><small>Its significance is assessed in the mean-pressure row above</small></div>
              </div><p className="metric-note">Correlation, harmonic, and variability checks use Caevera prototype product limits. The cited papers did not set these limits. Pressure, frequency, speed, impulse, and rise-time rows use the entered experiment and CFD uncertainties. {inconclusiveMetrics ? `${inconclusiveMetrics} metric${inconclusiveMetrics === 1 ? " cannot" : "s cannot"} be classified from the available case data.` : ""}</p></section>

              <section className="result-block causes-block"><div><span className="result-index">06</span><h3>Ranked diagnostic hypotheses</h3></div><ol>{assessment.hypotheses.map((hypothesis, index) => <li key={hypothesis.title}><b>{index + 1}. {hypothesis.title}</b><span>{hypothesis.evidence.map((item) => `${item.state}: ${item.observation}`).join(" ")}</span><small>Model inputs: {hypothesis.modelInputs.filter(Boolean).join(" · ")}</small></li>)}</ol><small>These are transparent sensitivity-test priorities, not causal proof.</small></section>

              <button className="report-button" onClick={downloadReport}><span><b>08</b><strong>Download traceable report</strong><small>Inputs, validity, uncertainty, metrics, hypotheses, and recommended next CFD run</small></span><i>↓</i></button>
            </article>
          </section>

          </>}

          <section className="evidence-panel" aria-label="Calculated signal evidence"><div className="evidence-heading"><div><span className="calculated-label">CALCULATED AFTER CASE ANALYSIS</span><h2>Pressure and wave evidence</h2><p>Every trace, spectrum, propagation phase, and cycle statistic is calculated from the active case.</p></div><div className="control-group"><div className="probe-tabs" aria-label="Probe selection">{activeCase.testSignals.map((_, probe) => <button key={probe} className={activeProbe === probe ? "active" : ""} onClick={() => setActiveProbe(probe)}>P{probe + 1}</button>)}</div><div className="view-tabs" aria-label="Evidence view"><button className={activeView === "signals" ? "active" : ""} onClick={() => setActiveView("signals")}>Pressure</button><button className={activeView === "spectrum" ? "active" : ""} onClick={() => setActiveView("spectrum")}>Spectrum</button><button className={activeView === "residual" ? "active" : ""} onClick={() => setActiveView("residual")}>Residual</button><button className={activeView === "phase" ? "active" : ""} onClick={() => setActiveView("phase")}>Propagation</button><button className={activeView === "cycles" ? "active" : ""} onClick={() => setActiveView("cycles")}>Cycle stability</button></div></div></div><div className="chart-heading"><span>{activeView === "phase" ? `${activeCase.testSignals.length} probes · ${testMode.identifiability.toLowerCase()} experimental mode` : activeView === "cycles" ? `${testMode.cycleSeries.length} experiment cycles · ${cfdMode.cycleSeries.length} CFD cycles` : `Probe P${activeProbe + 1} · ${activeCase.metadata.probePositionsDeg[activeProbe]}° · ${activeComparison.time.length.toLocaleString()} aligned samples`}</span><Legend residual={activeView === "residual"} /></div>{activeView === "signals" && <SignalChart comparison={activeComparison} />}{activeView === "spectrum" && <SpectrumChart comparison={activeComparison} />}{activeView === "residual" && <ResidualChart comparison={activeComparison} />}{activeView === "phase" && <PhaseChart experiment={testMode} simulation={cfdMode} positionsDeg={activeCase.metadata.probePositionsDeg} />}{activeView === "cycles" && <CycleChart experiment={testMode} simulation={cfdMode} />}<div className="wave-summary"><span><b>{probeSetComparison?.sharedLagUs.toFixed(2)} µs</b> shared experiment–CFD alignment</span><span><b>{testMode.identifiability === "Not identifiable" ? "Not identifiable" : `${testMode.waveCount}-wave ${testMode.direction.toLowerCase()}`}</b> experiment · {testMode.identifiability}</span><span><b>{cfdMode.identifiability === "Not identifiable" ? "Not identifiable" : `${cfdMode.waveCount}-wave ${cfdMode.direction.toLowerCase()}`}</b> CFD · {cfdMode.identifiability}</span><span><b>{testMode.identifiability === "Not identifiable" || cfdMode.identifiability === "Not identifiable" ? "Not identifiable" : `${testMode.phaseJitterDeg.toFixed(1)}° / ${cfdMode.phaseJitterDeg.toFixed(1)}°`}</b> phase jitter</span></div>{[...testMode.warnings, ...cfdMode.warnings].length > 0 && <ul className="wave-warnings">{[...new Set([...testMode.warnings, ...cfdMode.warnings])].map((warning) => <li key={warning}>{warning}</li>)}</ul>}</section>
          <footer><span>Caevera v{ANALYSIS_VERSION} · calculated from the saved case data</span><span>{cases.length} case{cases.length === 1 ? "" : "s"} in this browser session · not a certification or causal proof</span></footer>
        </>}
      </>}
    </section>

    {showLoader && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowLoader(false)}><section className="loader-modal" role="dialog" aria-modal="true" aria-labelledby="loader-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={() => setShowLoader(false)} aria-label="Close case inputs">×</button><div className="loader-intro"><div><span className="modal-kicker">RDE CASE INPUTS</span><h2 id="loader-title">{reviewingRerun ? "Review one-change rerun" : editingCaseId ? "Edit case" : "Add case"}</h2></div>{!reviewingRerun && <button className="input-help-button" onClick={() => setShowHelp(true)}>What does each input mean?</button>}</div>{!reviewingRerun && <p>Required fields are used in a calculation or a check. Optional documented convergence values are entered manually and are not read from the pressure CSV files.</p>}

      {reviewingRerun && draftReferenceCase && draftRelationship && cfdPending ? <section className="rerun-review-step" aria-label="Controlled rerun review">
        <span>Ready to analyze</span>
        <h3>{draft.name}</h3>
        <div className="rerun-review-list">
          <p><strong>Starting case</strong><span>{draftReferenceCase.metadata.name}</span></p>
          <p><strong>Experiment reused</strong><span>{inheritedExperimentName}</span></p>
          <p><strong>Changed only</strong><span>{changeLabel(draftRelationship.changedVariable)} · {changedRerunFields.map(caseFieldLabel).join(", ")}</span></p>
          <p><strong>New CFD result</strong><span>{cfdPending.provenance.fileName}</span></p>
        </div>
        <div className="rerun-review-confirmation"><strong>Comparison inputs are locked.</strong><span>Caevera will compare this CFD result with the inherited experiment and starting settings.</span></div>
        <div className="modal-actions"><button className="button secondary" onClick={() => setReviewingRerun(false)}>Back to inputs</button><button className="button primary" onClick={applyCase}>Analyze rerun →</button></div>
      </section> : <>

      <div className="form-section"><h3>Case + geometry</h3><div className="form-grid four"><label><span>Case name</span><input value={draft.name} onChange={(event) => updateText("name", event.target.value)} /></label><label><span>Mean diameter (mm)</span><input disabled={rerunFieldLocked("annulusMeanDiameterMm")} type="number" value={numberValue(draft.annulusMeanDiameterMm)} onChange={(event) => updateNumber("annulusMeanDiameterMm", event.target.value)} /></label><label><span>Diameter uncertainty (mm)</span><input disabled={rerunFieldLocked("annulusDiameterUncertaintyMm")} type="number" step="0.01" value={numberValue(draft.annulusDiameterUncertaintyMm)} onChange={(event) => updateNumber("annulusDiameterUncertaintyMm", event.target.value)} /></label><label><span>Maximum expected waves</span><input disabled={rerunFieldLocked("maximumWaveCount")} type="number" min="1" max="12" value={numberValue(draft.maximumWaveCount)} onChange={(event) => updateNumber("maximumWaveCount", event.target.value)} /></label></div><label className="probe-angle-editor"><span>Probe angles (deg) · minimum 3, nonuniform preferred</span><div className="angle-inputs">{draft.probePositionsDeg.map((angle, index) => <input disabled={rerunFieldLocked("probePositionsDeg")} key={index} type="number" aria-label={`Probe ${index + 1} angle`} placeholder={`P${index + 1}`} value={numberValue(angle)} onChange={(event) => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.map((value, position) => position === index ? (event.target.value === "" ? Number.NaN : Number(event.target.value)) : value) }))} />)}<button disabled={controlledRerunDraft} type="button" onClick={() => setDraft((current) => ({ ...current, probePositionsDeg: [...current.probePositionsDeg, Number.NaN] }))}>+ probe</button>{draft.probePositionsDeg.length > 3 && <button disabled={controlledRerunDraft} type="button" onClick={() => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.slice(0, -1) }))}>Remove</button>}</div></label><label className="confirmation-check"><input disabled={rerunFieldLocked("probeSynchronizationConfirmed")} type="checkbox" checked={draft.probeSynchronizationConfirmed} onChange={(event) => setDraft((current) => ({ ...current, probeSynchronizationConfirmed: event.target.checked }))} /><span>I confirm every pressure probe in each file uses one synchronized acquisition time base.</span></label><label className="confirmation-check"><input disabled={rerunFieldLocked("comparisonMatchConfirmed")} type="checkbox" checked={draft.comparisonMatchConfirmed} onChange={(event) => setDraft((current) => ({ ...current, comparisonMatchConfirmed: event.target.checked }))} /><span>I confirm experiment and CFD use the same geometry, operating point, probe locations, and comparison window.</span></label></div>

      {cases.length > 0 && <div className="form-section"><h3>{editingCaseId ? "Case relationship" : "Related rerun · optional"}</h3><p className="form-help">{editingCaseId ? "This relationship is locked because changing it would change the meaning of the saved result. Add a new case to test a different CFD change." : "A case family is one baseline plus reruns that reuse its experiment and physical operating point. Choose the family baseline and the exact case whose CFD settings you are changing."}</p><div className="form-grid four">
        <label><span>Case family baseline</span><select disabled={Boolean(editingCaseId)} value={draftRelationship?.baselineCaseId ?? ""} onChange={(event) => chooseCaseFamily(event.target.value)}><option value="">Not a related rerun</option>{cases.filter((item) => item.id !== editingCaseId && !item.relationship).map((item) => <option key={item.id} value={item.id}>{item.metadata.name}</option>)}</select></label>
        <label><span>Starting case</span><select disabled={!draftRelationship || Boolean(editingCaseId)} value={draftRelationship?.referenceCaseId ?? draftRelationship?.baselineCaseId ?? ""} onChange={(event) => chooseStartingCase(event.target.value)}>{draftRelationship && cases.filter((item) => item.id !== editingCaseId && (item.id === draftRelationship.baselineCaseId || item.relationship?.baselineCaseId === draftRelationship.baselineCaseId)).map((item) => <option key={item.id} value={item.id}>{item.metadata.name}</option>)}</select></label>
        <label><span>Single CFD change</span><select disabled={!draftRelationship || Boolean(editingCaseId)} value={draftRelationship?.changedVariable ?? "other"} onChange={(event) => chooseChangedVariable(event.target.value as SensitivityVariable)}><option value="mesh">Mesh / spatial method</option><option value="time-step">Time step / temporal method</option><option value="chemistry">Chemistry model</option><option value="inlet">Inlet treatment</option><option value="wall">Wall treatment</option><option value="initialization">Initialization</option><option value="unsteadiness">Measured unsteady forcing</option><option value="other">Choose one</option></select></label>
        <label><span>Change description</span><input disabled={!draftRelationship || Boolean(editingCaseId)} value={draftRelationship?.description ?? ""} onChange={(event) => setDraftRelationship((current) => current ? { ...current, description: event.target.value } : null)} placeholder="e.g. 50% front-cell refinement" /></label>
      </div>{editingCaseId ? <div className="rerun-inheritance"><strong>{draftRelationship ? "Controlled-rerun definition locked" : "Baseline definition locked"}</strong><span>Create a new case to test a different starting point or CFD variable.</span></div> : draftReferenceCase && <div className="rerun-inheritance"><strong>Starting case copied: {draftReferenceCase.metadata.name}</strong><span>{draftRelationship?.changedVariable === "other" ? "Choose the one CFD change being tested." : `Only ${changeLabel(draftRelationship!.changedVariable).toLowerCase()} settings are editable. Comparison inputs are locked.`}</span></div>}</div>}

      <div className="form-section"><div className="form-section-heading"><div><h3>Synchronized pressure probes</h3><p className="form-help">{draftReferenceCase && !editingCaseId ? "The exact experiment samples are inherited from the starting case. Upload and map only the new CFD result." : "Map the actual headers in each file. Caevera converts the selected units to milliseconds and MPa before analysis."}</p></div><button onClick={downloadExample}>Download example CSV</button></div><div className="file-mapper-grid">{draftReferenceCase && !editingCaseId ? <section className="inherited-experiment"><div><span>EXPERIMENT REUSED</span><strong>{inheritedExperimentName}</strong></div><p>Exact samples inherited from <b>{draftReferenceCase.metadata.name}</b>. No experiment re-upload is needed.</p></section> : <PressureFileMapper key={`experiment-${editingCaseId ?? "new"}-${draft.probePositionsDeg.length}-${draftRelationship?.referenceCaseId ?? "standalone"}`} kind="Experiment" expectedProbeCount={draft.probePositionsDeg.length} currentFileName={editingCaseId ? cases.find((item) => item.id === editingCaseId)?.testSignals[0]?.name.split(" · ")[0] : undefined} onMapped={setTestPending} />}<PressureFileMapper key={`cfd-${editingCaseId ?? "new"}-${draft.probePositionsDeg.length}-${draftRelationship?.referenceCaseId ?? "standalone"}`} kind="CFD" expectedProbeCount={draft.probePositionsDeg.length} currentFileName={editingCaseId ? cases.find((item) => item.id === editingCaseId)?.cfdSignals[0]?.name.split(" · ")[0] : undefined} onMapped={setCfdPending} /></div><div className="form-grid two measurement-chain"><label><span>Experiment sensor bandwidth (kHz)</span><input disabled={rerunFieldLocked("experimentSensorBandwidthKHz")} type="number" step="0.1" value={numberValue(draft.experimentSensorBandwidthKHz)} onChange={(event) => updateNumber("experimentSensorBandwidthKHz", event.target.value)} /></label><label><span>Experiment low-pass / anti-alias cutoff (kHz)</span><input disabled={rerunFieldLocked("experimentFilterCutoffKHz")} type="number" step="0.1" value={numberValue(draft.experimentFilterCutoffKHz)} onChange={(event) => updateNumber("experimentFilterCutoffKHz", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Operating conditions</h3><div className="form-grid four"><label><span>Inlet pressure (bar)</span><input disabled={rerunFieldLocked("inletPressureBar")} type="number" value={numberValue(draft.inletPressureBar)} onChange={(event) => updateNumber("inletPressureBar", event.target.value)} /></label><label><span>Inlet temperature (K)</span><input disabled={rerunFieldLocked("inletTemperatureK")} type="number" value={numberValue(draft.inletTemperatureK)} onChange={(event) => updateNumber("inletTemperatureK", event.target.value)} /></label><label><span>Equivalence ratio</span><input disabled={rerunFieldLocked("equivalenceRatio")} type="number" step="0.01" value={numberValue(draft.equivalenceRatio)} onChange={(event) => updateNumber("equivalenceRatio", event.target.value)} /></label><label><span>Mass flow (kg/s)</span><input disabled={rerunFieldLocked("massFlowKgS")} type="number" step="0.01" value={numberValue(draft.massFlowKgS)} onChange={(event) => updateNumber("massFlowKgS", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Solver + numerical schemes</h3><div className="form-grid four"><label><span>Solver</span><input disabled={rerunFieldLocked("solver")} value={draft.solver} onChange={(event) => updateText("solver", event.target.value)} /></label><label><span>Version</span><input disabled={rerunFieldLocked("solverVersion")} value={draft.solverVersion} onChange={(event) => updateText("solverVersion", event.target.value)} /></label><label><span>Dimensionality</span><select disabled={rerunFieldLocked("dimensionality")} value={draft.dimensionality} onChange={(event) => setDraft((current) => ({ ...current, dimensionality: event.target.value as Dimensionality }))}><option value="">Select</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label><span>Runtime (hours) · optional</span><input disabled={rerunFieldLocked("solverRuntimeHours")} type="number" min="0" step="0.1" value={numberValue(draft.solverRuntimeHours)} onChange={(event) => updateNumber("solverRuntimeHours", event.target.value)} /></label><label><span>Spatial scheme</span><input disabled={rerunFieldLocked("spatialScheme")} value={draft.spatialScheme} onChange={(event) => updateText("spatialScheme", event.target.value)} /></label><label><span>Spatial order</span><input disabled={rerunFieldLocked("spatialOrder")} type="number" value={numberValue(draft.spatialOrder)} onChange={(event) => updateNumber("spatialOrder", event.target.value)} /></label><label><span>Numerical flux</span><input disabled={rerunFieldLocked("numericalFlux")} value={draft.numericalFlux} onChange={(event) => updateText("numericalFlux", event.target.value)} /></label><label><span>Limiter / filter / dissipation</span><input disabled={rerunFieldLocked("limiterFilter")} placeholder="Enter None if unused" value={draft.limiterFilter} onChange={(event) => updateText("limiterFilter", event.target.value)} /></label><label><span>Temporal scheme</span><input disabled={rerunFieldLocked("temporalScheme")} value={draft.temporalScheme} onChange={(event) => updateText("temporalScheme", event.target.value)} /></label><label><span>Temporal order</span><input disabled={rerunFieldLocked("temporalOrder")} type="number" value={numberValue(draft.temporalOrder)} onChange={(event) => updateNumber("temporalOrder", event.target.value)} /></label><label><span>Time step (µs)</span><input disabled={rerunFieldLocked("timeStepUs")} type="number" step="0.001" value={numberValue(draft.timeStepUs)} onChange={(event) => updateNumber("timeStepUs", event.target.value)} /></label><label><span>CFL</span><input disabled={rerunFieldLocked("cfl")} type="number" step="0.01" value={numberValue(draft.cfl)} onChange={(event) => updateNumber("cfl", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Resolution + convergence</h3><div className="form-grid four"><label><span>Total mesh cells</span><input disabled={rerunFieldLocked("meshCells")} type="number" value={numberValue(draft.meshCells)} onChange={(event) => updateNumber("meshCells", event.target.value)} /></label><label><span>Minimum front cell (mm)</span><input disabled={rerunFieldLocked("minimumCellSizeMm")} type="number" step="0.001" value={numberValue(draft.minimumCellSizeMm)} onChange={(event) => updateNumber("minimumCellSizeMm", event.target.value)} /></label><label><span>Cells / induction length</span><input disabled={rerunFieldLocked("cellsPerInductionLength")} type="number" step="0.1" value={numberValue(draft.cellsPerInductionLength)} onChange={(event) => updateNumber("cellsPerInductionLength", event.target.value)} /></label><label><span>Near-wall cell (mm)</span><input disabled={rerunFieldLocked("nearWallCellSizeMm")} type="number" step="0.001" value={numberValue(draft.nearWallCellSizeMm)} onChange={(event) => updateNumber("nearWallCellSizeMm", event.target.value)} /></label><label><span>Documented mesh-study change (%) · optional</span><input disabled={rerunFieldLocked("meshConvergencePct")} type="number" step="0.1" value={numberValue(draft.meshConvergencePct)} onChange={(event) => updateNumber("meshConvergencePct", event.target.value)} /></label><label><span>Documented time-step-study change (%) · optional</span><input disabled={rerunFieldLocked("timeStepConvergencePct")} type="number" step="0.1" value={numberValue(draft.timeStepConvergencePct)} onChange={(event) => updateNumber("timeStepConvergencePct", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Physics + boundaries</h3><div className="form-grid four"><label><span>Chemical mechanism</span><input disabled={rerunFieldLocked("chemistryModel")} value={draft.chemistryModel} onChange={(event) => updateText("chemistryModel", event.target.value)} /></label><label><span>Species</span><input disabled={rerunFieldLocked("chemistrySpecies")} type="number" value={numberValue(draft.chemistrySpecies)} onChange={(event) => updateNumber("chemistrySpecies", event.target.value)} /></label><label><span>Reactions</span><input disabled={rerunFieldLocked("chemistryReactions")} type="number" value={numberValue(draft.chemistryReactions)} onChange={(event) => updateNumber("chemistryReactions", event.target.value)} /></label><label><span>Chemistry integration</span><input disabled={rerunFieldLocked("chemistryIntegrator")} value={draft.chemistryIntegrator} onChange={(event) => updateText("chemistryIntegrator", event.target.value)} /></label><label><span>Turbulence model</span><input disabled={rerunFieldLocked("turbulenceModel")} placeholder="Enter None if unused" value={draft.turbulenceModel} onChange={(event) => updateText("turbulenceModel", event.target.value)} /></label><label><span>Combustion model</span><input disabled={rerunFieldLocked("combustionModel")} placeholder="Enter None if unused" value={draft.combustionModel} onChange={(event) => updateText("combustionModel", event.target.value)} /></label><label><span>Wall thermal condition</span><input disabled={rerunFieldLocked("wallBoundaryCondition")} value={draft.wallBoundaryCondition} onChange={(event) => updateText("wallBoundaryCondition", event.target.value)} /></label><label><span>Inlet treatment</span><input disabled={rerunFieldLocked("inletBoundaryCondition")} value={draft.inletBoundaryCondition} onChange={(event) => updateText("inletBoundaryCondition", event.target.value)} /></label><label><span>Outlet treatment</span><input disabled={rerunFieldLocked("outletBoundaryCondition")} value={draft.outletBoundaryCondition} onChange={(event) => updateText("outletBoundaryCondition", event.target.value)} /></label><label><span>Ignition / initialization</span><input disabled={rerunFieldLocked("initializationMethod")} value={draft.initializationMethod} onChange={(event) => updateText("initializationMethod", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>Experiment + CFD uncertainty</h3><div className="form-grid four"><label><span>Experiment pressure uncertainty (%)</span><input disabled={rerunFieldLocked("pressureUncertaintyPct")} type="number" step="0.1" value={numberValue(draft.pressureUncertaintyPct)} onChange={(event) => updateNumber("pressureUncertaintyPct", event.target.value)} /></label><label><span>Experiment timing uncertainty (µs)</span><input disabled={rerunFieldLocked("timingUncertaintyUs")} type="number" step="0.01" value={numberValue(draft.timingUncertaintyUs)} onChange={(event) => updateNumber("timingUncertaintyUs", event.target.value)} /></label><label><span>CFD pressure uncertainty (%)</span><input disabled={rerunFieldLocked("cfdPressureUncertaintyPct")} type="number" step="0.1" value={numberValue(draft.cfdPressureUncertaintyPct)} onChange={(event) => updateNumber("cfdPressureUncertaintyPct", event.target.value)} /></label><label><span>CFD timing uncertainty (µs)</span><input disabled={rerunFieldLocked("cfdTimingUncertaintyUs")} type="number" step="0.01" value={numberValue(draft.cfdTimingUncertaintyUs)} onChange={(event) => updateNumber("cfdTimingUncertaintyUs", event.target.value)} /></label></div></div>

      {error && <p className="error-message">{error}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setShowLoader(false)}>Cancel</button><button className="button primary" onClick={controlledRerunDraft ? reviewRerun : applyCase}>{controlledRerunDraft ? "Review rerun →" : "Analyze case →"}</button></div>
      </>}
    </section></div>}

    {showHelp && <div className="modal-backdrop help-backdrop" role="presentation" onMouseDown={() => setShowHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={() => setShowHelp(false)} aria-label="Close input guide">×</button><span className="modal-kicker">CASE INPUT GUIDE</span><h2 id="help-title">What each case input means</h2><p>Use the documented value from the experiment or CFD setup. Caevera does not infer missing model settings or uncertainty.</p>
      <div className="help-groups">{CASE_INPUT_HELP.map((group) => <section key={group.title} className="help-group"><div><h3>{group.title}</h3><p>{group.description}</p></div><dl>{group.items.map((item) => <div key={item.key} className="help-item"><dt>{item.label}<span className={`requirement-tag ${item.requirement.toLowerCase()}`}>{item.requirement}</span></dt><dd><p>{item.definition}</p><div className="help-details"><span><b>Format / units</b>{item.format}</span><span><b>Where to find it</b>{item.obtainFrom}</span><span><b>Used for</b>{item.usedFor}</span><span><b>If missing</b>{item.missingEffect}</span></div></dd></div>)}</dl></section>)}</div>
      <div className="help-actions"><button className="button primary" onClick={() => setShowHelp(false)}>{showLoader ? "Back to case inputs" : "Close guide"}</button></div>
    </section></div>}
  </main>;
}
