"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { DesktopDownload } from "@/components/desktop-download";
import { PressureFileMapper } from "@/components/pressure-file-mapper";
import { SolverManifestImporter } from "@/components/solver-manifest-importer";
import { SpatialFieldMapper } from "@/components/spatial-field-mapper";
import { RdePhysicsVisual } from "@/components/rde-physics-visual";
import { DesignPlanner } from "@/components/design-planner";
import { OperatingEnvelope } from "@/components/operating-envelope";
import { ComparisonHierarchy } from "@/components/comparison-hierarchy";
import { ProspectiveValidationLedger } from "@/components/prospective-validation-ledger";
import { ExperimentBenchmark } from "@/components/experiment-benchmark";
import { PublicExperimentBenchmarks } from "@/components/public-experiment-benchmarks";
import { Rde2dWorkspace } from "@/components/rde-2d-workspace";
import { buildCaseDelta, buildCaseHistoryEvidence, caseFieldLabel, selectIndependentPrecedents, selectPlanningEvidence, summarizeCase, type CaseHistoryEvidence } from "@/lib/case-history";
import {
  EMPTY_METADATA,
  cloneMetadata,
  type AnalysisCase,
  type CaseRelationship,
  type CaseMetadata,
  type Dimensionality,
  type SensitivityVariable,
} from "@/lib/caevera-types";
import { CONTROLLED_PARAMETER_DEFINITIONS, CONTROLLED_PARAMETERS, parameterLabel, type ControlledParameter } from "@/lib/controlled-parameters";
import { completeRunPlan, createNextRunWorkOrder, freezeRunPlan, nextRunWorkOrderFileName, recommendationSnapshot, sameWorkOrderDefinition, type FrozenRunPlan } from "@/lib/next-run-work-order";
import { auditComparisonPairing } from "@/lib/comparison-pairing";
import { buildCaseAssessment, type ControlledNextRun, type DiagnosticEvidence, type MetricAssessment } from "@/lib/diagnostics";
import { buildDecisionQuality, type DecisionQuality } from "@/lib/decision-quality";
import { KNOWLEDGE_BASE_VERSION, sourcesFor, type DiagnosticResearchClaim, type DiagnosticSource } from "@/lib/diagnostic-knowledge";
import { CASE_INPUT_HELP } from "@/lib/case-input-help";
import { WAVE_METHOD_SOURCES } from "@/lib/wave-method-sources";
import { calculateDesign, operatingPointLabel, type EngineDesign, type OperatingPoint, type PlannedOperatingPoint } from "@/lib/design-workspace";
import { createEngineRevision, normalizeEngineDesign } from "@/lib/engine-manifest";
import { buildOpenFoamNextRunHandoff } from "@/lib/cfd-run-manifest";
import { GE_2022_DESIGN, GE_2022_DESIGN_ID, buildGe2022OperatingPoints } from "@/lib/published-envelope-data";
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
import { buildPhysicsComparison, cfdPhysicsFromMetadata, experimentPhysicsFromMetadata, PHYSICS_EVIDENCE_SOURCES, PHYSICS_MEASUREMENT_DEFINITIONS, PHYSICS_SOURCE_LIMITATION, physicsMetadataValues } from "@/lib/physics-evidence";
import type { WallFieldImport } from "@/lib/spatial-field";

const TEST_COLOR = "#2588a2";
const CFD_COLOR = "#6679bd";
const RESIDUAL_COLOR = "#c8873d";
const RERUN_ALWAYS_EDITABLE_FIELDS: (keyof CaseMetadata)[] = [
  "name", "solverRuntimeHours", "cfdPressureUncertaintyPct", "cfdTimingUncertaintyUs",
  "cfdNetThrustN", "cfdSpecificImpulseS", "cfdPressureGainPct", "cfdInjectorPressureRatio",
  "cfdBackflowFractionPct", "cfdWallHeatFluxMWm2", "cfdPeakWallTemperatureK", "cfdSustainedDurationS",
];
const EXPERIMENT_OWNED_FIELDS: (keyof CaseMetadata)[] = [
  "annulusMeanDiameterMm", "annulusDiameterUncertaintyMm", "probePositionsDeg", "maximumWaveCount", "probeSynchronizationConfirmed",
  "experimentSensorBandwidthKHz", "experimentFilterCutoffKHz", "inletPressureBar", "inletTemperatureK", "equivalenceRatio", "massFlowKgS",
  "backPressureBar", "pressureUncertaintyPct", "timingUncertaintyUs",
  "experimentNetThrustN", "experimentSpecificImpulseS", "experimentPressureGainPct", "experimentInjectorPressureRatio",
  "experimentBackflowFractionPct", "experimentWallHeatFluxMWm2", "experimentPeakWallTemperatureK", "experimentSustainedDurationS",
];

function formatPhysicsValue(value: number | null, unit: string) {
  if (value === null) return "Not provided";
  const digits = Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function clearCfdPhysics(metadata: CaseMetadata) {
  for (const item of PHYSICS_MEASUREMENT_DEFINITIONS) metadata[item.cfdKey] = Number.NaN as never;
}

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
  return `Kythros did not use this rerun to update the plan. ${issues}`;
}

function evidenceBasisLabel(basis: DiagnosticEvidence["basis"]) {
  if (basis === "case-history") return "Calculated from a related one-change rerun";
  if (basis === "literature") return "Supported by published research";
  if (basis === "policy") return "Result still required";
  return "Calculated from this run";
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
    })}</div> : <p className="research-unmapped">No published paper is mapped to this specific recommendation. Kythros treats it as a prototype product rule, not a research conclusion.</p>}
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
  onDownloadNextRun,
  onDownloadOpenFoam,
  onStartNextRun,
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
  onDownloadNextRun: (() => void) | null;
  onDownloadOpenFoam: (() => void) | null;
  onStartNextRun: (() => void) | null;
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
  const testedVariable = policy.changedParameter ? parameterLabel(policy.changedParameter).toLowerCase() : policy.changedVariable ? changeLabel(policy.changedVariable).toLowerCase() : "selected";
  const conclusionHeading = summary.label === "Result of this rerun" ? "What this rerun concluded" : "What this operating point shows";
  const startingPointReason = summary.tone === "rejected"
    ? "The selected change was rejected and is not carried forward."
    : summary.tone === "inconclusive"
      ? "The selected change was inconclusive and is not carried forward."
      : summary.label === "Current diagnosis"
        ? "This is the latest accepted setting at this operating point."
        : "This accepted setting is carried forward.";
  return <section className={`engineering-decision-card decision-${summary.tone}${isDemo ? " decision-demo" : ""}`} aria-label="Engineering decision">
    <div className="decision-quality" aria-label={`Recommendation evidence: ${decisionQuality.label}`}>
      <div className="decision-quality-verdict"><span>Recommendation evidence</span><strong>{decisionQuality.label}</strong></div>
      <div className="decision-quality-copy"><small>{decisionQuality.sourceLabel}</small><p>{decisionQuality.explanation}</p></div>

    </div>
    <section className="decision-block decision-conclusion-block" aria-labelledby="decision-conclusion-heading">
      <div className="decision-block-heading"><b>1</b><h2 id="decision-conclusion-heading">{conclusionHeading}</h2></div>
      <header className="engineering-decision-heading">
        <h3><span>{summary.lead}</span> {summary.title}</h3>
        {summary.detail && <details className="decision-detail"><summary>See comparison numbers</summary><p>{summary.detail}</p></details>}
        <p className="decision-meaning">{summary.meaning}</p>
      </header>

    </section>
    <section className="decision-block decision-recommendation-block" aria-labelledby="decision-recommendation-heading">
      <div className="decision-block-heading"><b>2</b><h2 id="decision-recommendation-heading">Next step</h2></div>
      {planUsesDifferentCase && <div className="decision-scope">
        <strong>Starting point</strong>
        <span>Use <b>{planningCaseName}</b>. {startingPointReason}</span>
      </div>}
      <div className="decision-next-run">
        <h3>{nextRun.title}</h3>
      </div>
      <div className="next-run-action">
        <p><strong>Change</strong><span>{nextRun.change}</span></p>
      </div>
      {onStartNextRun && <div className="next-run-buttons"><button className="button primary" onClick={onStartNextRun}>Start recommended rerun</button></div>}
      <details className="validation-setup"><summary>Run setup and downloads</summary>
      <div className="next-run-action">
        <p><strong>Keep unchanged</strong><span>{nextRun.holdFixed.join(" · ")}</span></p>
        <p><strong>Compare</strong><span>{nextRun.expectedOutcome}</span></p>
      </div>
      {(onStartNextRun || onDownloadNextRun || onDownloadOpenFoam) && <div className="next-run-buttons">{onDownloadNextRun && <button className="button secondary" onClick={onDownloadNextRun}>Download frozen run spec</button>}{onDownloadOpenFoam && <button className="button secondary" onClick={onDownloadOpenFoam}>Download OpenFOAM handoff</button>}</div>}
      </details>
      <details className="validation-support"><summary>Evidence and decision rules</summary>
      {showLatestResult && nextRun.latestControlledResult.status !== "Awaiting result" && <div className={`decision-latest-result outcome-${nextRun.latestControlledResult.status.toLowerCase()}`}><strong>Latest result at this operating point: {latestResultLabel(nextRun.latestControlledResult.status, policy)}</strong><span>{nextRun.latestControlledResult.caseName}</span></div>}
      <details className="decision-reasoning" aria-label="Why Kythros recommends this run">
        <summary>Why Kythros recommends this run</summary>
        <div className="decision-reasoning-heading">
          <span>Question being tested</span>
          <h3>{nextRun.question}</h3>
          <p>These findings are calculated from the analyzed cases. They are not columns or labels in the CSV files.</p>
        </div>
        <div className="reasoning-ledger">
          <EvidenceLedgerColumn title="Findings that support this explanation" emptyMessage="No analyzed finding directly supports this explanation." items={ledger.supports} tone="supports" />
          <EvidenceLedgerColumn title="Findings that contradict this explanation" emptyMessage="No finding in the analyzed cases contradicts this explanation. That does not confirm it." items={ledger.weakens} tone="weakens" />
          <EvidenceLedgerColumn title="Evidence still needed" emptyMessage="Kythros has not identified another missing result for this decision." items={ledger.unknowns} tone="unknowns" />
        </div>
        <div className="decision-priority">
          <strong>Why this is the next test</strong>
          <p>{nextRun.whyThisRunFirst}</p>
        </div>
      </details>
      <details className="decision-outcomes" aria-label="How the result changes the plan">
        <summary><span>Decision rule</span><strong>How Kythros will classify the rerun result</strong></summary>
        <div className="decision-outcomes-content">
        <div><span>How Kythros will classify the result</span>{policy.basis === "prototype-policy" && <small>Prototype product policy {policy.version}. Kythros chose these decision limits; the cited papers did not.</small>}</div>
        {isNumericalPolicy ? <>
          <div className="outcome-rules">
            <article className="branch-converged"><strong>Numerically converged</strong><span>The targeted CFD values change by no more than {policy.convergenceResponsePct!.toFixed(1)}% between the two adjacent levels.</span><small>Keep the newer setting and move to the next unresolved explanation.</small></article>
            <article className="branch-confirmed"><strong>{policy.changedParameter ? parameterLabel(policy.changedParameter) : changeLabel(policy.changedVariable!)} still changes the result</strong><span>The targeted CFD values change by more than {policy.convergenceResponsePct!.toFixed(1)}% between the two adjacent levels.</span><small>Keep the newer setting and test the next {testedVariable} level before changing the physics.</small></article>
            <article className="branch-inconclusive"><strong>Cannot classify</strong><span>The two runs are not a valid one-change pair, or a required targeted value cannot be calculated.</span><small>Correct the run relationship or data problem, then repeat the same comparison.</small></article>
          </div>
          <p className="decision-agreement-note"><strong>Separate question:</strong> Kythros also reports whether the newer CFD result moved closer to the experiment, moved farther away, or created a new mismatch.</p>
        </> : isModelSensitivityPolicy ? <div className="outcome-rules">
          <article className="branch-confirmed"><strong>Supports this explanation</strong><span>The mean CFD-to-experiment error in the targeted values falls by at least {policy.confirmationErrorReductionPct!.toFixed(1)}%, with no new resolved mismatch.</span><small>Keep the tested setting and move to the next unresolved explanation.</small></article>
          <article className="branch-rejected"><strong>Does not support this explanation</strong><span>The targeted CFD response is below {policy.minimumResponsePct!.toFixed(1)}%, the targeted error increases by at least {policy.rejectionErrorWorseningPct!.toFixed(1)}%, or a new resolved mismatch appears.</span><small>Return to the starting setting and test the next explanation.</small></article>
          <article className="branch-inconclusive"><strong>Inconclusive</strong><span>The result meets neither rule above.</span><small>Repeat the same one-variable test with a larger change or lower uncertainty.</small></article>
        </div> : <div className="outcome-rules">
          <article className="branch-confirmed"><strong>Passes</strong><span>{nextRun.confirmationCriterion}</span><small>{nextRun.ifConfirmed}</small></article>
          <article className="branch-rejected"><strong>Does not pass</strong><span>{nextRun.rejectionCriterion}</span><small>{nextRun.ifRejected}</small></article>
          <article className="branch-inconclusive"><strong>Cannot classify</strong><span>{nextRun.inconclusiveCriterion}</span><small>{nextRun.ifInconclusive}</small></article>
        </div>}
        </div>
      </details>
      <div className="decision-precedent" aria-label="Comparable controlled reruns">
        <span>Independent evidence from other operating points</span>
        {precedent.matchedCount ? <>
          <p><strong>{precedent.confirmedCount} of {precedent.matchedCount} comparable one-change reruns met the same decision rule.</strong></p>
          {isDemo && <small>These are generated demonstrations, not evidence from a physical engine.</small>}
        </> : <>
          <p><strong>No comparable rerun from another operating point has been analyzed.</strong> The findings above come only from this operating point.</p>
        </>}
      </div>
      <ResearchBasis claims={researchClaims} sources={publishedSources} />
      <details className="decision-evidence">
        <summary>What is this recommendation status based on?</summary>
        <p className="evidence-calculation-note">Kythros calculates this status from the selected run and verified rerun history at this operating point. Published papers and public benchmarks do not raise it.</p>
        <p className="selected-data-source"><strong>{selectedCaseName}</strong> · {selectedAnalysisInput.experimentSamples.toLocaleString()} experiment + {selectedAnalysisInput.cfdSamples.toLocaleString()} CFD values · {selectedAnalysisInput.probeCount} probes</p>
        {planUsesDifferentCase && <p className="planning-data-source"><strong>Plan reference:</strong> {planningCaseName}</p>}
        <ul>{decisionQuality.gates.map((gate) => <li key={gate.id} className={`evidence-${gate.status}`}><i>{gate.status === "passed" ? "✓" : gate.status === "blocked" ? "×" : gate.status === "review" ? "!" : "○"}</i><strong>{gate.label}</strong><b>{gate.statusLabel}</b><small>{gate.result}</small></li>)}</ul>
        <p><strong>Method support only:</strong> {publishedSources.length} published reference{publishedSources.length === 1 ? "" : "s"} support the method, and {publishedValidation.waveSpeedCases + publishedValidation.pressureFixtureCases} public validation cases test the analyzer. Neither confirms the explanation for this operating point.</p>
      </details>
      {precedent.matchedCount > 0 && <div className="decision-details"><details><summary>Show analyzed prior-case counts</summary><div className="precedent-outcomes"><span><b>{precedent.confirmedCount}</b> confirmed</span><span><b>{precedent.convergedCount}</b> converged</span><span><b>{precedent.rejectedCount}</b> rejected</span><span><b>{precedent.inconclusiveCount}</b> inconclusive</span></div><p>{precedent.matchedCount} comparable controlled rerun{precedent.matchedCount === 1 ? "" : "s"} analyzed. Metric means use confirmed cases only{precedent.runtimeCaseCount ? `; runtime uses ${precedent.runtimeCaseCount} confirmed case${precedent.runtimeCaseCount === 1 ? "" : "s"} with entered solver hours` : ""}.</p></details></div>}
      </details>
    </section>
    <details className="validation-files"><summary>Reports, history and editing</summary><div className="decision-actions"><button className="button secondary" onClick={onEdit}>Edit run</button><button className="button secondary" onClick={onDownloadReport}>Download evidence report</button><button className="button secondary" onClick={onSaveWorkspace}>Save complete workspace</button>{onViewHistory && <button className="button secondary" onClick={onViewHistory}>View run history</button>}</div></details>
  </section>;
}
export default function Home() {
  const [cases, setCases] = useState<AnalysisCase[]>([]);
  const [designs, setDesigns] = useState<EngineDesign[]>([]);
  const [operatingPoints, setOperatingPoints] = useState<OperatingPoint[]>([]);
  const [frozenRunPlans, setFrozenRunPlans] = useState<FrozenRunPlan[]>([]);
  const [activeDesignId, setActiveDesignId] = useState<string | null>(null);
  const [activeOperatingPointId, setActiveOperatingPointId] = useState<string | null>(null);
  const [draftDesignId, setDraftDesignId] = useState<string | null>(null);
  const [draftOperatingPointId, setDraftOperatingPointId] = useState<string | null>(null);
  const [draftNewOperatingPoint, setDraftNewOperatingPoint] = useState<OperatingPoint | null>(null);
  const [loaderMode, setLoaderMode] = useState<"measured-point" | "comparison-run">("comparison-run");
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [caseBaselineId, setCaseBaselineId] = useState<string | null>(null);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaseMetadata>(() => cloneMetadata(EMPTY_METADATA));
  const [draftRelationship, setDraftRelationship] = useState<CaseRelationship | null>(null);
  const [draftFrozenPlanId, setDraftFrozenPlanId] = useState<string | null>(null);
  const [testPending, setTestPending] = useState<MappedProbeImport | null>(null);
  const [cfdPending, setCfdPending] = useState<MappedProbeImport | null>(null);
  const [testWallPending, setTestWallPending] = useState<WallFieldImport | null>(null);
  const [cfdWallPending, setCfdWallPending] = useState<WallFieldImport | null>(null);
  const [showLoader, setShowLoader] = useState(false);
  const [reviewingRerun, setReviewingRerun] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [activeView, setActiveView] = useState<"signals" | "spectrum" | "residual" | "phase" | "cycles">("signals");
  const [activeProbe, setActiveProbe] = useState(0);
  const [workspaceView, setWorkspaceView] = useState<"case" | "compare">("case");
  const [productView, setProductView] = useState<"home" | "design" | "simulation" | "envelope" | "comparison" | "benchmark">("home");

  const activeCase = cases.find((item) => item.id === activeCaseId) ?? null;
  const activeOperatingPoint = operatingPoints.find((item) => item.id === activeOperatingPointId) ?? null;
  const activeDesign = designs.find((item) => item.id === activeCase?.designId) ?? null;
  const operatingPointRuns = useMemo(() => cases.filter((item) => item.operatingPointId === activeOperatingPointId), [cases, activeOperatingPointId]);
  const draftOperatingPointRuns = useMemo(() => cases.filter((item) => item.operatingPointId === draftOperatingPointId), [cases, draftOperatingPointId]);
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
  const physicsComparisons = activeCase ? buildPhysicsComparison(activeCase.metadata) : [];
  const physicsProvidedCount = physicsComparisons.filter((row) => row.experiment !== null || row.cfd !== null).length;
  const waveformWithinLimit = correlation >= REVIEW_THRESHOLDS.minimumCorrelation;
  const caseSummaries = useMemo(() => operatingPointRuns.map(summarizeCase), [operatingPointRuns]);
  const baselineSummary = caseSummaries.find((summary) => summary.item.id === caseBaselineId) ?? caseSummaries[0] ?? null;
  const draftReferenceCase = draftRelationship
    ? draftOperatingPointRuns.find((item) => item.id === (draftRelationship.referenceCaseId ?? draftRelationship.baselineCaseId)) ?? cases.find((item) => item.id === (draftRelationship.referenceCaseId ?? draftRelationship.baselineCaseId)) ?? null
    : null;
  const controlledRerunDraft = Boolean(draftReferenceCase && draftRelationship && !editingCaseId);
  const measuredPointDraft = loaderMode === "measured-point";
  const draftOperatingPoint = operatingPoints.find((item) => item.id === draftOperatingPointId) ?? null;
  const selectedRerunFields = draftRelationship?.changedParameter ? CONTROLLED_PARAMETERS[draftRelationship.changedParameter].fields : [];
  const changedRerunFields = draftReferenceCase
    ? selectedRerunFields.filter((field) => !metadataValueEqual(draftReferenceCase.metadata[field], draft[field]))
    : [];
  const inheritedExperimentName = draftReferenceCase?.imports?.experiment.fileName
    ?? draftReferenceCase?.testSignals[0]?.name.split(" · ")[0]
    ?? "Experiment data";

  function rerunFieldLocked(field: keyof CaseMetadata) {
    if (!measuredPointDraft && EXPERIMENT_OWNED_FIELDS.includes(field)) return true;
    if (!controlledRerunDraft) return false;
    if (RERUN_ALWAYS_EDITABLE_FIELDS.includes(field)) return false;
    if (field === "meshConvergencePct") return draftRelationship?.changedParameter !== "mesh-resolution";
    if (field === "timeStepConvergencePct") return draftRelationship?.changedParameter !== "flow-time-step";
    return !selectedRerunFields.includes(field);
  }

  const inputRows = activeCase ? [
    ["Geometry + probes", `${activeCase.metadata.annulusMeanDiameterMm.toFixed(1)} mm mean diameter · ${activeCase.metadata.probePositionsDeg.length} probes · modes 1–${activeCase.metadata.maximumWaveCount}`],
    ["Pressure evidence", `${activeCase.testSignals.length} experiment + ${activeCase.cfdSignals.length} CFD traces · ${activeCase.testSignals[0].time.length.toLocaleString()} samples each`],
    ["Measurement chain", `${activeCase.metadata.experimentSensorBandwidthKHz.toFixed(1)} kHz sensor bandwidth · ${activeCase.metadata.experimentFilterCutoffKHz.toFixed(1)} kHz filter cutoff · synchronized probes`],
    ["Operating point", `${activeCase.metadata.inletPressureBar.toFixed(1)} bar inlet · ${activeCase.metadata.massFlowKgS.toFixed(3)} kg/s · φ ${activeCase.metadata.equivalenceRatio.toFixed(2)} · ${activeCase.metadata.backPressureBar.toFixed(2)} bar back pressure · ${activeCase.metadata.inletTemperatureK.toFixed(0)} K`],
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
    title: `${activeCase?.relationship?.changedParameter ? parameterLabel(activeCase.relationship.changedParameter) : changeLabel(activeCase?.relationship?.changedVariable ?? "other")} response`,
    detail: conciseOutcomeDetail(activeCaseEvidence),
    meaning: activeCaseEvidence.controlled ? outcomeMeaning(activeCaseEvidence) : comparisonOnlyMeaning(activeCaseEvidence),
    tone: activeCaseEvidence.controlled ? outcomeTone(activeCaseEvidence) : "neutral",
  } : {
    label: "Current diagnosis",
    lead: "Likely issue:",
    title: likelyHypothesis?.title ?? "Cannot assess",
    detail: null,
    meaning: planAssessment?.nextRun.reason ?? "Kythros cannot choose a next run from the analyzed evidence.",
    tone: "neutral",
  };
  const showDetailedEvidence = false;

  function openNewCase() {
    if (activeDesignId) return openOperatingPoint(activeDesignId);
    setProductView("design");
  }

  function openOperatingPoint(designId: string, point?: PlannedOperatingPoint) {
    const design = designs.find((item) => item.id === designId);
    const nextDraft = cloneMetadata(EMPTY_METADATA);
    const operatingPointId = `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (design) {
      const calculated = calculateDesign(design);
      nextDraft.annulusMeanDiameterMm = calculated.meanDiameterMm;
      nextDraft.inletTemperatureK = design.inletTemperatureK;
      nextDraft.backPressureBar = design.backPressureBar;
      if (point) {
        nextDraft.name = `${design.name} · φ ${point.equivalenceRatio.toFixed(2)} · ${point.massFlowKgS.toFixed(3)} kg/s`;
        nextDraft.equivalenceRatio = point.equivalenceRatio;
        nextDraft.massFlowKgS = point.massFlowKgS;
        nextDraft.inletPressureBar = point.inletPressureBar;
        nextDraft.inletTemperatureK = point.inletTemperatureK;
      }
    }
    const nextPoint: OperatingPoint = {
      id: operatingPointId,
      designId,
      name: nextDraft.name || `${design?.name ?? "Engine"} operating point`,
      source: "uploaded",
      inletPressureBar: nextDraft.inletPressureBar,
      inletTemperatureK: nextDraft.inletTemperatureK,
      equivalenceRatio: nextDraft.equivalenceRatio,
      massFlowKgS: nextDraft.massFlowKgS,
      backPressureBar: nextDraft.backPressureBar,
      recommendation: point?.recommendation ?? null,
    };
    setActiveDesignId(designId);
    setDraftDesignId(designId);
    setDraftOperatingPointId(operatingPointId);
    setDraftNewOperatingPoint(nextPoint);
    setLoaderMode("measured-point");
    setEditingCaseId(null);
    setDraft(nextDraft);
    setDraftRelationship(null);
    setDraftFrozenPlanId(null);
    setTestPending(null); setCfdPending(null); setTestWallPending(null); setCfdWallPending(null); setError(""); setReviewingRerun(false); setShowLoader(true);
  }

  function openCaseEditor() {
    if (!activeCase) return;
    setEditingCaseId(activeCase.id);
    setDraft(cloneMetadata(activeCase.metadata));
    setDraftDesignId(activeCase.designId ?? null);
    setDraftOperatingPointId(activeCase.operatingPointId ?? null);
    setDraftNewOperatingPoint(null);
    setLoaderMode("comparison-run");
    setDraftRelationship(activeCase.relationship ?? null);
    setDraftFrozenPlanId(null);
    setTestPending(null); setCfdPending(null); setTestWallPending(null); setCfdWallPending(null); setError(""); setReviewingRerun(false); setShowLoader(true);
  }

  function openNewRunForOperatingPoint() {
    if (!activeOperatingPointId) return;
    const baseline = operatingPointRuns.find((item) => !item.relationship) ?? operatingPointRuns[0];
    if (!baseline) return openBaselineCfdForOperatingPoint(activeOperatingPointId);
    setEditingCaseId(null);
    setDraftOperatingPointId(activeOperatingPointId);
    setDraftNewOperatingPoint(null);
    setLoaderMode("comparison-run");
    setDraftDesignId(baseline.designId ?? activeDesignId);
    setDraftRelationship({ baselineCaseId: baseline.id, referenceCaseId: baseline.id, changedVariable: "other", changedParameter: null, description: "" });
    setDraftFrozenPlanId(null);
    const inherited = cloneMetadata(baseline.metadata);
    inherited.name = `${baseline.metadata.name} rerun`;
    clearCfdPhysics(inherited);
    setDraft(inherited);
    setTestPending(null); setCfdPending(null); setTestWallPending(null); setCfdWallPending(null); setError(""); setReviewingRerun(false); setShowLoader(true);
  }

  function openBaselineCfdForOperatingPoint(operatingPointId: string) {
    const point = operatingPoints.find((item) => item.id === operatingPointId);
    if (!point?.experiment) return;
    const nextDraft = cloneMetadata(EMPTY_METADATA);
    nextDraft.name = `${point.name} baseline CFD`;
    nextDraft.annulusMeanDiameterMm = point.experiment.annulusMeanDiameterMm;
    nextDraft.annulusDiameterUncertaintyMm = point.experiment.annulusDiameterUncertaintyMm;
    nextDraft.probePositionsDeg = [...point.experiment.probePositionsDeg];
    nextDraft.maximumWaveCount = point.experiment.maximumWaveCount;
    nextDraft.probeSynchronizationConfirmed = point.experiment.probeSynchronizationConfirmed;
    nextDraft.experimentSensorBandwidthKHz = point.experiment.experimentSensorBandwidthKHz;
    nextDraft.experimentFilterCutoffKHz = point.experiment.experimentFilterCutoffKHz;
    nextDraft.inletPressureBar = point.inletPressureBar;
    nextDraft.inletTemperatureK = point.inletTemperatureK;
    nextDraft.equivalenceRatio = point.equivalenceRatio;
    nextDraft.massFlowKgS = point.massFlowKgS;
    nextDraft.backPressureBar = point.backPressureBar;
    nextDraft.pressureUncertaintyPct = point.experiment.pressureUncertaintyPct;
    nextDraft.timingUncertaintyUs = point.experiment.timingUncertaintyUs;
    Object.assign(nextDraft, physicsMetadataValues(point.experiment.physics));
    setActiveDesignId(point.designId);
    setActiveOperatingPointId(point.id);
    setDraftDesignId(point.designId);
    setDraftOperatingPointId(point.id);
    setDraftNewOperatingPoint(null);
    setLoaderMode("comparison-run");
    setEditingCaseId(null);
    setDraft(nextDraft);
    setDraftRelationship(null);
    setDraftFrozenPlanId(null);
    setTestPending(null); setCfdPending(null); setTestWallPending(null); setCfdWallPending(null); setError(""); setReviewingRerun(false); setShowLoader(true);
  }

  function selectDesign(designId: string) {
    setActiveDesignId(designId);
    const point = operatingPoints.find((item) => item.designId === designId) ?? null;
    setActiveOperatingPointId(point?.id ?? null);
    const run = point ? cases.find((item) => item.operatingPointId === point.id) ?? null : null;
    setActiveCaseId(run?.id ?? null);
    setWorkspaceView("case");
  }

  function selectOperatingPoint(operatingPointId: string) {
    setActiveOperatingPointId(operatingPointId);
    const run = cases.find((item) => item.operatingPointId === operatingPointId) ?? null;
    setActiveCaseId(run?.id ?? null);
    setCaseBaselineId(run?.relationship?.baselineCaseId ?? run?.id ?? null);
    setWorkspaceView("case");
    setActiveProbe(0);
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
        clearCfdPhysics(inherited);
        return inherited;
      });
      setDraftDesignId(reference.designId ?? null);
      setDraftOperatingPointId(reference.operatingPointId ?? null);
      setDraftNewOperatingPoint(null);
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
      changedParameter: draftRelationship?.changedParameter ?? null,
      description: draftRelationship?.description ?? "",
    });
    inheritStartingCase(baselineCaseId);
  }

  function chooseStartingCase(referenceCaseId: string) {
    setDraftRelationship((current) => current ? { ...current, referenceCaseId } : null);
    inheritStartingCase(referenceCaseId, draftRelationship?.referenceCaseId);
  }

  function chooseChangedParameter(changedParameter: ControlledParameter | null) {
    setDraftRelationship((current) => current ? {
      ...current,
      changedParameter,
      changedVariable: changedParameter ? CONTROLLED_PARAMETERS[changedParameter].variable : "other",
    } : null);
    if (draftReferenceCase && !editingCaseId) {
      setDraft((current) => {
        const inherited = cloneMetadata(draftReferenceCase.metadata);
        inherited.name = current.name;
        inherited.solverRuntimeHours = current.solverRuntimeHours;
        inherited.cfdPressureUncertaintyPct = current.cfdPressureUncertaintyPct;
        inherited.cfdTimingUncertaintyUs = current.cfdTimingUncertaintyUs;
        for (const item of PHYSICS_MEASUREMENT_DEFINITIONS) inherited[item.cfdKey] = current[item.cfdKey] as never;
        return inherited;
      });
    }
    setReviewingRerun(false);
    setError("");
  }

  function reviewRerun() {
    if (!draftRelationship || editingCaseId) return applyCase();
    if (!draftReferenceCase) return setError("Choose the exact starting run for this rerun.");
    if (!draftRelationship.changedParameter) return setError("Choose the single CFD parameter being tested.");
    if (draftFrozenPlanId) {
      const frozenPlan = frozenRunPlans.find((plan) => plan.workOrder.id === draftFrozenPlanId && plan.status === "pending");
      if (!frozenPlan) return setError("This frozen run plan is no longer pending. Start or resume the current recommendation instead.");
      if (frozenPlan.workOrder.startingCase.id !== draftReferenceCase.id || frozenPlan.workOrder.change.parameter !== draftRelationship.changedParameter) return setError("The rerun no longer matches its frozen starting case and one-parameter recommendation.");
      const target = frozenPlan.workOrder.change.suggestedTargetValue;
      const primaryField = CONTROLLED_PARAMETERS[draftRelationship.changedParameter].primaryField;
      if (target !== null && !metadataValueEqual(draft[primaryField], target)) return setError(`The frozen run requires ${parameterLabel(draftRelationship.changedParameter).toLowerCase()} = ${String(target)}. Create a new plan to use a different target.`);
    }
    if (!changedRerunFields.length) return setError(`Change at least one ${parameterLabel(draftRelationship.changedParameter).toLowerCase()} field before reviewing this rerun.`);
    if (!cfdPending) return setError("Upload and map the new CFD result before reviewing this rerun.");
    if (cfdPending.signals.length !== draft.probePositionsDeg.length) return setError(`The CFD file contains ${cfdPending.signals.length} probes, but the starting run uses ${draft.probePositionsDeg.length}.`);
    setError("");
    setReviewingRerun(true);
  }

  function applyMeasuredOperatingPoint() {
    if (!draft.name.trim()) return setError("Give this measured operating point a name.");
    if (!draft.probeSynchronizationConfirmed) return setError("Confirm that every experimental probe uses one synchronized time base.");
    if (!Number.isFinite(draft.annulusMeanDiameterMm) || draft.annulusMeanDiameterMm <= 0) return setError("Enter a positive annulus mean diameter.");
    if (!Number.isFinite(draft.annulusDiameterUncertaintyMm) || draft.annulusDiameterUncertaintyMm < 0) return setError("Diameter uncertainty must be zero or greater.");
    if (draft.probePositionsDeg.length < 3 || draft.probePositionsDeg.some((value) => !Number.isFinite(value))) return setError("Enter at least three valid probe angles.");
    if (!Number.isInteger(draft.maximumWaveCount) || draft.maximumWaveCount < 1 || draft.maximumWaveCount > 12) return setError("Maximum expected wave count must be an integer from 1 to 12.");
    const positiveInputs: Array<[string, number]> = [
      ["Experiment sensor bandwidth", draft.experimentSensorBandwidthKHz], ["Experiment filter cutoff", draft.experimentFilterCutoffKHz],
      ["Inlet pressure", draft.inletPressureBar], ["Back pressure", draft.backPressureBar], ["Inlet temperature", draft.inletTemperatureK], ["Equivalence ratio", draft.equivalenceRatio], ["Mass flow", draft.massFlowKgS],
    ];
    const invalidPositive = positiveInputs.find(([, value]) => !Number.isFinite(value) || value <= 0);
    if (invalidPositive) return setError(`${invalidPositive[0]} must be a number greater than zero.`);
    if (draft.inletPressureBar <= draft.backPressureBar) return setError("Inlet pressure must exceed back pressure.");
    const uncertainties: Array<[string, number]> = [
      ["Experiment pressure uncertainty", draft.pressureUncertaintyPct], ["Experiment timing uncertainty", draft.timingUncertaintyUs],
    ];
    const invalidUncertainty = uncertainties.find(([, value]) => !Number.isFinite(value) || value < 0);
    if (invalidUncertainty) return setError(`${invalidUncertainty[0]} must be zero or greater.`);
    const invalidOptionalPhysics = PHYSICS_MEASUREMENT_DEFINITIONS.find((item) => {
      const value = draft[item.experimentKey];
      return typeof value === "number" && Number.isFinite(value) && !item.signed && value < 0;
    });
    if (invalidOptionalPhysics) return setError(`${invalidOptionalPhysics.label} must be zero or greater when supplied.`);
    if (!testPending) return setError("Upload and map the synchronized experimental pressure file.");
    if (testPending.signals.length !== draft.probePositionsDeg.length) return setError(`The experiment file contains ${testPending.signals.length} probes, but ${draft.probePositionsDeg.length} probe angles were entered.`);
    if (!draftOperatingPointId || !draftDesignId) return setError("Choose an engine design before adding an operating point.");
    try {
      analyzeRdeProbeSet(testPending.signals, draft.probePositionsDeg, draft.annulusMeanDiameterMm, { maximumWaveCount: draft.maximumWaveCount, synchronizationConfirmed: true, sensorBandwidthKHz: draft.experimentSensorBandwidthKHz, filterCutoffKHz: draft.experimentFilterCutoffKHz });
      const nextPoint: OperatingPoint = {
        id: draftOperatingPointId,
        designId: draftDesignId,
        name: draft.name,
        source: draftNewOperatingPoint?.source ?? "uploaded",
        inletPressureBar: draft.inletPressureBar,
        inletTemperatureK: draft.inletTemperatureK,
        equivalenceRatio: draft.equivalenceRatio,
        massFlowKgS: draft.massFlowKgS,
        backPressureBar: draft.backPressureBar,
        experiment: {
          signals: testPending.signals,
          importProvenance: testPending.provenance,
          annulusMeanDiameterMm: draft.annulusMeanDiameterMm,
          annulusDiameterUncertaintyMm: draft.annulusDiameterUncertaintyMm,
          probePositionsDeg: [...draft.probePositionsDeg],
          maximumWaveCount: draft.maximumWaveCount,
          probeSynchronizationConfirmed: true,
          experimentSensorBandwidthKHz: draft.experimentSensorBandwidthKHz,
          experimentFilterCutoffKHz: draft.experimentFilterCutoffKHz,
          pressureUncertaintyPct: draft.pressureUncertaintyPct,
          timingUncertaintyUs: draft.timingUncertaintyUs,
          physics: experimentPhysicsFromMetadata(draft),
          wallField: testWallPending,
        },
        recommendation: draftNewOperatingPoint?.recommendation ?? null,
      };
      setOperatingPoints((current) => [...current, nextPoint]);
      setActiveDesignId(draftDesignId);
      setActiveOperatingPointId(nextPoint.id);
      setActiveCaseId(null);
      setProductView("envelope");
      setShowLoader(false);
      setDraftNewOperatingPoint(null);
      setTestPending(null);
      setTestWallPending(null);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The experimental pressure data could not be analyzed.");
    }
  }

  function applyCase() {
    if (!draft.name.trim()) return setError("Give this operating point a name.");
    if (!draft.probeSynchronizationConfirmed) return setError("Confirm that every probe in each file uses one synchronized time base.");
    if (!Number.isFinite(draft.annulusMeanDiameterMm) || draft.annulusMeanDiameterMm <= 0) return setError("Enter a positive annulus mean diameter.");
    if (draft.probePositionsDeg.length < 3 || draft.probePositionsDeg.some((value) => !Number.isFinite(value))) return setError("Enter at least three valid probe angles.");
    if (!Number.isInteger(draft.maximumWaveCount) || draft.maximumWaveCount < 1 || draft.maximumWaveCount > 12) return setError("Maximum expected wave count must be an integer from 1 to 12.");
    const positiveInputs: Array<[string, number]> = [
      ["Experiment sensor bandwidth", draft.experimentSensorBandwidthKHz], ["Experiment filter cutoff", draft.experimentFilterCutoffKHz],
      ["Inlet pressure", draft.inletPressureBar], ["Back pressure", draft.backPressureBar], ["Inlet temperature", draft.inletTemperatureK], ["Equivalence ratio", draft.equivalenceRatio], ["Mass flow", draft.massFlowKgS],
      ["Spatial order", draft.spatialOrder], ["Temporal order", draft.temporalOrder], ["CFL", draft.cfl], ["Total mesh cells", draft.meshCells],
      ["Minimum front cell", draft.minimumCellSizeMm], ["Cells per induction length", draft.cellsPerInductionLength], ["Near-wall cell", draft.nearWallCellSizeMm],
      ["Time step", draft.timeStepUs], ["Chemistry species", draft.chemistrySpecies], ["Chemistry reactions", draft.chemistryReactions],
    ];
    const invalidPositive = positiveInputs.find(([, value]) => !Number.isFinite(value) || value <= 0);
    if (invalidPositive) return setError(`${invalidPositive[0]} must be a number greater than zero.`);
    if (draft.inletPressureBar <= draft.backPressureBar) return setError("Inlet pressure must exceed back pressure.");
    const uncertaintyInputs: Array<[string, number]> = [
      ["Diameter uncertainty", draft.annulusDiameterUncertaintyMm], ["Experiment pressure uncertainty", draft.pressureUncertaintyPct],
      ["Experiment timing uncertainty", draft.timingUncertaintyUs], ["CFD pressure uncertainty", draft.cfdPressureUncertaintyPct], ["CFD timing uncertainty", draft.cfdTimingUncertaintyUs],
    ];
    const invalidUncertainty = uncertaintyInputs.find(([, value]) => !Number.isFinite(value) || value < 0);
    if (invalidUncertainty) return setError(`${invalidUncertainty[0]} must be zero or greater.`);
    if (Number.isFinite(draft.solverRuntimeHours) && draft.solverRuntimeHours <= 0) return setError("Runtime must be positive when supplied.");
    const invalidOptionalPhysics = PHYSICS_MEASUREMENT_DEFINITIONS.find((item) => {
      const values = [draft[item.experimentKey], draft[item.cfdKey]];
      return values.some((value) => typeof value === "number" && Number.isFinite(value) && !item.signed && value < 0);
    });
    if (invalidOptionalPhysics) return setError(`${invalidOptionalPhysics.label} must be zero or greater when supplied.`);
    const textInputs: Array<[string, string]> = [
      ["Solver", draft.solver], ["Solver version", draft.solverVersion], ["Dimensionality", draft.dimensionality], ["Spatial scheme", draft.spatialScheme],
      ["Numerical flux", draft.numericalFlux], ["Limiter, filter, or dissipation", draft.limiterFilter], ["Temporal scheme", draft.temporalScheme],
      ["Turbulence model", draft.turbulenceModel], ["Combustion model", draft.combustionModel], ["Chemical mechanism", draft.chemistryModel],
      ["Chemistry integration", draft.chemistryIntegrator], ["Wall thermal condition", draft.wallBoundaryCondition], ["Inlet treatment", draft.inletBoundaryCondition], ["Inlet forcing method", draft.inletForcingMethod],
      ["Outlet treatment", draft.outletBoundaryCondition], ["Ignition or initialization", draft.initializationMethod],
    ];
    const missingText = textInputs.find(([, value]) => !value.trim());
    if (missingText) return setError(`${missingText[0]} is required. Enter “None” only when that model or treatment is not used.`);
    try {
      const editingCase = cases.find((item) => item.id === editingCaseId) ?? null;
      const effectiveRelationship = editingCase?.relationship ?? draftRelationship;
      const referenceId = effectiveRelationship?.referenceCaseId ?? effectiveRelationship?.baselineCaseId;
      const referenceCase = referenceId ? cases.find((item) => item.id === referenceId) ?? null : null;
      const nextTest = testPending?.signals ?? editingCase?.testSignals ?? referenceCase?.testSignals ?? draftOperatingPoint?.experiment?.signals;
      const nextCfd = cfdPending?.signals ?? editingCase?.cfdSignals;
      if (!nextTest) return setError("Upload the experimental multi-probe file for this operating point.");
      if (!nextCfd) return setError(effectiveRelationship ? "Upload the new CFD multi-probe result for this rerun." : "Upload the CFD multi-probe file for this baseline run.");
      if (nextTest.length !== draft.probePositionsDeg.length || nextCfd.length !== draft.probePositionsDeg.length) return setError(`The files contain ${nextTest.length} experiment and ${nextCfd.length} CFD probes, but ${draft.probePositionsDeg.length} probe angles were entered.`);
      const id = editingCaseId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (effectiveRelationship?.baselineCaseId === id) return setError("A run cannot be its own baseline.");
      if (effectiveRelationship) {
        if (!referenceCase || referenceCase.id !== effectiveRelationship.baselineCaseId && referenceCase.relationship?.baselineCaseId !== effectiveRelationship.baselineCaseId) return setError("Choose a starting run from the selected operating point.");
      }
      const experimentProvenance = testPending?.provenance ?? editingCase?.imports?.experiment ?? referenceCase?.imports?.experiment ?? draftOperatingPoint?.experiment?.importProvenance;
      const cfdProvenance = cfdPending?.provenance ?? editingCase?.imports?.cfd;
      const nextImports = experimentProvenance && cfdProvenance ? { experiment: experimentProvenance, cfd: cfdProvenance } : null;
      const nextRelationship = effectiveRelationship ? { ...effectiveRelationship, referenceCaseId: effectiveRelationship.referenceCaseId ?? effectiveRelationship.baselineCaseId } : null;
      const operatingPointId = editingCase?.operatingPointId ?? referenceCase?.operatingPointId ?? draftOperatingPointId;
      if (!operatingPointId) return setError("Choose or create an operating point before adding a run.");
      const designId = editingCase?.designId ?? referenceCase?.designId ?? draftDesignId;
      if (!designId) return setError("Choose an engine design before adding an operating point.");
      const pairedDesign = designs.find((item) => item.id === designId);
      const pairedOperatingPoint = operatingPoints.find((item) => item.id === operatingPointId) ?? draftNewOperatingPoint;
      if (!pairedDesign || !pairedOperatingPoint) return setError("The engine revision and physical operating point must exist before CFD can be paired.");
      const pairingAudit = auditComparisonPairing(draft, nextTest, nextCfd, { design: pairedDesign, operatingPoint: pairedOperatingPoint });
      if (!pairingAudit.passed) return setError(`Automatic experiment–CFD pairing failed: ${pairingAudit.checks.filter((check) => !check.passed).map((check) => check.detail).join(" ")}`);
      compareProbeSets(nextTest, nextCfd);
      analyzeRdeProbeSet(nextTest, draft.probePositionsDeg, draft.annulusMeanDiameterMm, { maximumWaveCount: draft.maximumWaveCount, synchronizationConfirmed: draft.probeSynchronizationConfirmed, sensorBandwidthKHz: draft.experimentSensorBandwidthKHz, filterCutoffKHz: draft.experimentFilterCutoffKHz });
      analyzeRdeProbeSet(nextCfd, draft.probePositionsDeg, draft.annulusMeanDiameterMm, { maximumWaveCount: draft.maximumWaveCount, synchronizationConfirmed: draft.probeSynchronizationConfirmed });
      const experimentWallField = testWallPending ?? editingCase?.wallFields?.experiment ?? referenceCase?.wallFields?.experiment ?? draftOperatingPoint?.experiment?.wallField ?? null;
      const cfdWallField = cfdWallPending ?? editingCase?.wallFields?.cfd ?? null;
      const nextMetadata = cloneMetadata(draft);
      nextMetadata.comparisonMatchConfirmed = true;
      const nextCase: AnalysisCase = { id, designId, operatingPointId, source: editingCase?.source ?? "uploaded", relationship: nextRelationship, metadata: nextMetadata, testSignals: nextTest, cfdSignals: nextCfd, imports: nextImports, pairingAudit: { verifiedAt: new Date().toISOString(), fingerprint: pairingAudit.fingerprint, engineManifestFingerprint: pairingAudit.engineManifestFingerprint, operatingPointId: pairingAudit.operatingPointId, checks: pairingAudit.checks }, wallFields: { experiment: experimentWallField, cfd: cfdWallField } };
      if (!nextRelationship) {
        const existingPoint = operatingPoints.find((item) => item.id === operatingPointId);
        const nextPoint: OperatingPoint = {
          id: operatingPointId,
          designId,
          name: existingPoint?.name ?? draft.name,
          source: existingPoint?.source ?? (editingCase?.source === "demo" ? "demo" : draftNewOperatingPoint?.source ?? "uploaded"),
          inletPressureBar: existingPoint?.inletPressureBar ?? draft.inletPressureBar,
          inletTemperatureK: existingPoint?.inletTemperatureK ?? draft.inletTemperatureK,
          equivalenceRatio: existingPoint?.equivalenceRatio ?? draft.equivalenceRatio,
          massFlowKgS: existingPoint?.massFlowKgS ?? draft.massFlowKgS,
          backPressureBar: existingPoint?.backPressureBar ?? draft.backPressureBar,
          experiment: existingPoint?.experiment ?? {
            signals: nextTest,
            importProvenance: experimentProvenance ?? null,
            annulusMeanDiameterMm: draft.annulusMeanDiameterMm,
            annulusDiameterUncertaintyMm: draft.annulusDiameterUncertaintyMm,
            probePositionsDeg: [...draft.probePositionsDeg],
            maximumWaveCount: draft.maximumWaveCount,
            probeSynchronizationConfirmed: draft.probeSynchronizationConfirmed,
            experimentSensorBandwidthKHz: draft.experimentSensorBandwidthKHz,
            experimentFilterCutoffKHz: draft.experimentFilterCutoffKHz,
            pressureUncertaintyPct: draft.pressureUncertaintyPct,
            timingUncertaintyUs: draft.timingUncertaintyUs,
            physics: experimentPhysicsFromMetadata(draft),
            wallField: experimentWallField,
          },
          recommendation: existingPoint?.recommendation ?? draftNewOperatingPoint?.recommendation ?? null,
        };
        setOperatingPoints((current) => current.some((item) => item.id === operatingPointId) ? current.map((item) => item.id === operatingPointId ? nextPoint : item) : [...current, nextPoint]);
      }
      setCases((current) => editingCaseId ? current.map((item) => item.id === editingCaseId ? nextCase : item) : [...current, nextCase]);
      if (!editingCaseId && draftFrozenPlanId) setFrozenRunPlans((current) => current.map((plan) => plan.workOrder.id === draftFrozenPlanId ? completeRunPlan(plan, id) : plan));
      if (!caseBaselineId) setCaseBaselineId(id);
      setActiveDesignId(designId); setActiveOperatingPointId(operatingPointId); setActiveCaseId(id); setWorkspaceView("case"); setProductView("comparison"); setActiveProbe(0); setReviewingRerun(false); setShowLoader(false); setDraftNewOperatingPoint(null); setDraftFrozenPlanId(null); setTestWallPending(null); setCfdWallPending(null); setError("");
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
    const designId = `demo-${stamp}-design`;
    const operatingPointId = `demo-${stamp}-point`;
    const demoDesign: EngineDesign = {
      id: designId,
      name: "Synthetic annular demonstrator",
      source: "demo",
      application: "Rocket",
      fuel: "Hydrogen",
      oxidizer: "Air",
      annulusInnerDiameterMm: 78,
      annulusOuterDiameterMm: 86,
      chamberLengthMm: 120,
      injectorType: "Discrete orifices",
      injectorCount: 120,
      injectorDiameterMm: 0.8,
      injectorAngleDeg: 0,
      plenumVolumeCm3: 300,
      wallCondition: "Isothermal 450 K",
      exhaustConfiguration: "Open exit",
      equivalenceRatioMin: 0.75,
      equivalenceRatioMax: 1.25,
      massFlowKgSMin: 0.4,
      massFlowKgSMax: 0.84,
      inletPressureBarMin: 6,
      inletPressureBarMax: 10,
      inletTemperatureK: 300,
      backPressureBar: 1,
    };
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
        backPressureBar: 1,
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
        inletForcingMethod: "No inlet forcing applied",
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
      { id: baselineId, designId, operatingPointId, source: "demo", relationship: null, metadata: baseMetadata, testSignals: cloneSignals(demo.test), cfdSignals: cloneSignals(demo.cfd) },
      {
        id: meshId, designId, operatingPointId, source: "demo",
        relationship: { baselineCaseId: baselineId, referenceCaseId: baselineId, changedVariable: "mesh", changedParameter: "mesh-resolution", description: "50% front-region cell-size refinement" },
        metadata: fineMetadata,
        testSignals: cloneSignals(demo.test), cfdSignals: fineSignals,
      },
      {
        id: wallId, designId, operatingPointId, source: "demo",
        relationship: { baselineCaseId: baselineId, referenceCaseId: meshId, changedVariable: "wall", changedParameter: "wall-treatment", description: "Adjacent wall thermal boundary" },
        metadata: { ...cloneMetadata(fineMetadata), name: "Synthetic wall sensitivity", wallBoundaryCondition: "Adiabatic", solverRuntimeHours: 18.5 },
        testSignals: cloneSignals(demo.test), cfdSignals: wallSignals,
      },
    ];
    const demoOperatingPoint: OperatingPoint = { id: operatingPointId, designId, name: "Synthetic baseline", source: "demo", inletPressureBar: 8, inletTemperatureK: 300, equivalenceRatio: 1, massFlowKgS: 0.62, backPressureBar: 1 };
    setCases((current) => [...current, ...examples]);
    setDesigns((current) => [...current, normalizeEngineDesign(demoDesign)]);
    setOperatingPoints((current) => [...current, demoOperatingPoint]);
    setActiveDesignId(designId);
    setActiveOperatingPointId(operatingPointId);
    setCaseBaselineId(examples[0].id);
    setActiveCaseId(examples[0].id); setWorkspaceView("case"); setProductView("comparison"); setActiveProbe(0);
  }

  function loadPublishedEnvelopeExample() {
    const points = buildGe2022OperatingPoints();
    setDesigns((current) => current.some((item) => item.id === GE_2022_DESIGN_ID) ? current : [...current, normalizeEngineDesign({ ...GE_2022_DESIGN })]);
    setOperatingPoints((current) => {
      const existing = new Set(current.map((item) => item.id));
      return [...current, ...points.filter((item) => !existing.has(item.id))];
    });
    setActiveDesignId(GE_2022_DESIGN_ID);
    setActiveOperatingPointId(points[0]?.id ?? null);
    setActiveCaseId(null);
    setCaseBaselineId(null);
    setWorkspaceView("case");
    setProductView("envelope");
    setWorkspaceError("");
  }

  function downloadExample() {
    const demo = makeDemoProbeSignals();
    const header = ["time_ms", ...demo.test.map((_, index) => `p${index + 1}_MPa`)].join(",");
    const rows = [header, ...demo.test[0].time.slice(0, 800).map((time, index) => [time, ...demo.test.map((signal) => signal.pressure[index])].map((value) => value.toFixed(6)).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = "kythros-multi-probe-example.csv"; link.click(); URL.revokeObjectURL(url);
  }

  function downloadReport() {
    if (!activeCase || !testMode || !cfdMode || !assessment || !decisionQuality || !planningCase) return;
    const engineDesign = designs.find((design) => design.id === activeCase.designId) ?? null;
    const operatingPoint = operatingPoints.find((point) => point.id === activeCase.operatingPointId) ?? null;
    const report = {
      schema: "kythros-rde-run-report",
      analysisVersion: ANALYSIS_VERSION,
      knowledgeBaseVersion: KNOWLEDGE_BASE_VERSION,
      generatedAt: new Date().toISOString(),
      inputs: { engineDesign, operatingPoint, metadata: activeCase.metadata, experimentPhysics: experimentPhysicsFromMetadata(activeCase.metadata), cfdPhysics: cfdPhysicsFromMetadata(activeCase.metadata), relationship: activeCase.relationship ?? null, pairingAudit: activeCase.pairingAudit ?? null, fileMappings: activeCase.imports ?? null, experimentalSources: activeCase.testSignals.map((signal) => signal.name), cfdSources: activeCase.cfdSignals.map((signal) => signal.name), units: { time: "ms", pressure: "MPa", frequency: "kHz", waveSpeed: "m/s" } },
      outputs: { experimentMode: testMode, cfdMode, physicsComparison: buildPhysicsComparison(activeCase.metadata), validity: assessment.validity, dataQuality: assessment.dataQuality, coverage: assessment.coverage, metrics: assessment.metrics, hypotheses: assessment.hypotheses, activeCaseOutcome: activeCaseEvidence, decisionQuality, controlledNextRun: planAssessment?.nextRun ?? assessment.nextRun, caseHistoryEvidence, waveform: { correlation, normalizedRmse: nrmse, pressureBiasMpa: pressureBias, sharedAlignmentLagUs: probeSetComparison?.sharedLagUs, individualLagUs: probeSetComparison?.individualLagUs, alignmentSpreadUs: probeSetComparison?.alignmentSpreadUs } },
      citedSources: sourcesFor([...new Set(assessment.hypotheses.flatMap((hypothesis) => hypothesis.sourceIds))]),
      methodSources: WAVE_METHOD_SOURCES,
      publishedValidationSources: PUBLISHED_VALIDATION_SOURCES,
      evidenceRoles: {
        directCaseEvidence: activeCase.source === "demo"
          ? "Generated demonstration pressure values, entered run settings, declared uncertainties, and verified one-change relationships determine this result. It is not evidence from a physical engine."
          : "The user-provided experiment and CFD pressure values, entered run settings, declared uncertainties, and verified one-change relationships determine the metrics and recommendation.",
        recommendationScope: {
          selectedCase: activeCase.metadata.name,
          planningReferenceCase: planningCase.metadata.name,
          sharedAcrossCaseFamily: caseHistoryEvidence.length > 0,
          explanation: "Kythros recalculates the selected run's diagnosis or rerun result. One operating point contains its experiment, baseline CFD, and qualifying one-change CFD reruns. The next-run plan starts from the most recent rerun that passed a support or convergence rule.",
        },
        storageBoundary: "A saved workspace stores the entered settings, pressure values, file mappings, and run relationships. When the workspace is reopened, Kythros recalculates the metrics, diagnoses, rerun classifications, and recommendation.",
        diagnosticRuleSources: likelySources,
        methodSources: WAVE_METHOD_SOURCES,
        publicAnalyzerValidation: {
          summary: PUBLISHED_VALIDATION_SUMMARY,
          cases: RAW_DATASET_VALIDATION_CASES,
          role: "Software validation only. Public benchmark cases test the analyzer; they do not count as independent operating-point evidence and do not choose the recommendation for this user-provided run.",
        },
      },
      predictiveModelState: { operability: "Not fitted", backflow: "Not available", performance: "Not available", thermal: "Not available", explanation: "No predictive output is substituted for a missing validated model." },
      perProbe: comparisons,
      methods: ["shared bounded cross-correlation", "Hann-windowed FFT pressure spectrum", "cycle-by-cycle passage tracking", "sliding-window circumferential phase-mode fit", "uncertainty resolution by RSS", "structured diagnostic rules", "adaptive controlled-rerun outcome classification"],
      limitations: ["The ranked explanations choose which one-change CFD test to run next; they do not prove causality.", "The support, rejection, and convergence limits are Kythros prototype product rules. They are not probabilities and are not taken from the cited papers.", "Kythros propagates pressure and timing uncertainty only into the scalar outputs that support that calculation.", "Wave-mode inference requires synchronized probes and assumes one dominant rotating mode. Kythros reports ambiguous or simultaneous modes as not identifiable.", "Optional performance, feed-system, thermal, and duration differences are descriptive until quantity-specific definitions and uncertainty budgets are supplied."],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "kythros-rde-run-report.json"; link.click(); URL.revokeObjectURL(url);
  }

  function downloadFrozenPlan(plan: FrozenRunPlan) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan.workOrder, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = nextRunWorkOrderFileName(plan.workOrder);
    link.click();
    URL.revokeObjectURL(url);
  }

  function currentFrozenPlan() {
    if (!planningCase || !planAssessment) return null;
    const workOrder = createNextRunWorkOrder(planAssessment.nextRun, planningCase);
    if (!workOrder) return null;
    const existing = frozenRunPlans.find((plan) => plan.status === "pending" && sameWorkOrderDefinition(plan.workOrder, workOrder));
    if (existing) return existing;
    const created = freezeRunPlan(workOrder);
    setFrozenRunPlans((current) => [...current, created]);
    return created;
  }

  function downloadNextRunWorkOrder() {
    const plan = currentFrozenPlan();
    if (plan) downloadFrozenPlan(plan);
  }

  function downloadOpenFoamHandoff() {
    const plan = currentFrozenPlan();
    if (!plan) return;
    const handoff = buildOpenFoamNextRunHandoff(plan.workOrder);
    const url = URL.createObjectURL(new Blob([JSON.stringify(handoff, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `kythros-openfoam-handoff-${plan.workOrder.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openFrozenRunPlan(plan: FrozenRunPlan) {
    const workOrder = plan.workOrder;
    const startingCase = cases.find((item) => item.id === workOrder.startingCase.id);
    if (!startingCase || plan.status !== "pending") return;
    const definition = CONTROLLED_PARAMETERS[workOrder.change.parameter];
    const inherited = cloneMetadata(startingCase.metadata);
    inherited.name = `${startingCase.metadata.name} · ${definition.label}`;
    clearCfdPhysics(inherited);
    if (typeof workOrder.change.suggestedTargetValue === "number") {
      (inherited[definition.primaryField] as number) = workOrder.change.suggestedTargetValue;
    }
    const baselineCaseId = startingCase.relationship?.baselineCaseId ?? startingCase.id;
    setEditingCaseId(null);
    setDraftDesignId(startingCase.designId ?? activeDesignId);
    setDraftOperatingPointId(startingCase.operatingPointId ?? activeOperatingPointId);
    setDraftNewOperatingPoint(null);
    setDraftFrozenPlanId(workOrder.id);
    setLoaderMode("comparison-run");
    setDraftRelationship({
      baselineCaseId,
      referenceCaseId: startingCase.id,
      changedVariable: definition.variable,
      changedParameter: definition.id,
      description: definition.guidance,
      recommendation: recommendationSnapshot(workOrder),
    });
    setDraft(inherited);
    setTestPending(null); setCfdPending(null); setTestWallPending(null); setCfdWallPending(null); setError(""); setReviewingRerun(false); setShowLoader(true);
  }

  function startRecommendedRerun() {
    const plan = currentFrozenPlan();
    if (plan) openFrozenRunPlan(plan);
  }

  function downloadWorkspace() {
    if (!cases.length && !designs.length) return;
    const content = serializeWorkspace({ cases, activeCaseId, baselineCaseId: caseBaselineId, designs, activeDesignId, operatingPoints, activeOperatingPointId, frozenRunPlans });
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
      if ((cases.length || designs.length) && !window.confirm("Replace the current browser-session engines, operating points, and runs with this saved workspace?")) return;
      setCases(restored.cases);
      setDesigns(restored.designs);
      setOperatingPoints(restored.operatingPoints);
      setFrozenRunPlans(restored.frozenRunPlans);
      setActiveDesignId(restored.activeDesignId);
      setActiveOperatingPointId(restored.activeOperatingPointId);
      setActiveCaseId(restored.activeCaseId);
      setCaseBaselineId(restored.baselineCaseId);
      setEditingCaseId(null);
      setDraft(cloneMetadata(EMPTY_METADATA));
      setDraftRelationship(null);
      setDraftFrozenPlanId(null);
      setTestPending(null);
      setCfdPending(null);
      setShowLoader(false);
      setShowHelp(false);
      setError("");
      setWorkspaceError("");
      setActiveProbe(0);
      setActiveView("signals");
      setWorkspaceView("case");
      setProductView(restored.activeCaseId ? "comparison" : restored.activeDesignId ? "design" : "home");
    } catch (reason) {
      setWorkspaceError(reason instanceof Error ? reason.message : "The workspace could not be opened.");
    }
  }

  const updateNumber = (key: keyof CaseMetadata, value: string) => setDraft((current) => ({ ...current, [key]: value === "" ? Number.NaN : Number(value) }));
  const updateText = (key: keyof CaseMetadata, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const numberValue = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? value : "";

  function saveEngineDesign(design: EngineDesign) {
    const previous = designs.find((item) => item.id === design.id) ?? null;
    const saved = createEngineRevision(design, previous);
    setDesigns((current) => [...current, saved]);
    setActiveDesignId(saved.id);
  }

  return <main className="app-shell">
    <header className="product-header">
      <a className="brand" href="#top" aria-label="Go to Kythros home" onClick={(event) => { event.preventDefault(); setProductView("home"); requestAnimationFrame(() => document.getElementById("top")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}><span className="brand-mark">K</span><span><strong>KYTHROS</strong><small>BY CAELUS</small></span></a>
      <p>RDE design, simulation, and validation</p>
      <nav className="product-tabs" aria-label="Kythros workspaces"><button className={productView === "home" ? "active" : ""} aria-current={productView === "home" ? "page" : undefined} onClick={() => setProductView("home")}>Home</button><button className={productView === "design" ? "active" : ""} aria-current={productView === "design" ? "page" : undefined} onClick={() => setProductView("design")}>Design</button><button className={productView === "simulation" ? "active" : ""} aria-current={productView === "simulation" ? "page" : undefined} onClick={() => setProductView("simulation")}>CFD Suite</button><button className={productView === "envelope" ? "active" : ""} aria-current={productView === "envelope" ? "page" : undefined} onClick={() => setProductView("envelope")}>Envelope</button><button className={productView === "comparison" ? "active" : ""} aria-current={productView === "comparison" ? "page" : undefined} onClick={() => setProductView("comparison")}>Experiment Validation</button><button className={productView === "benchmark" ? "active" : ""} aria-current={productView === "benchmark" ? "page" : undefined} onClick={() => setProductView("benchmark")}>Benchmark</button></nav>
      <div className="header-actions"><span className="prototype-tag">v{ANALYSIS_VERSION}</span><DesktopDownload /><PwaInstallButton /><button className="button secondary help-button" onClick={() => setShowHelp(true)}>Help</button><button className="button primary" onClick={() => setProductView(designs.length ? "simulation" : "design")}>{designs.length ? "Open CFD Suite" : "+ New engine"}</button></div>
    </header>
    {workspaceError && <p className="workspace-error-banner" role="alert">{workspaceError}</p>}

    <section className="content" id="top">
      {productView === "home" ? <section className="home-workspace" aria-labelledby="home-title">
        <div className="home-hero">
          <span className="empty-kicker">INPUT → SIMULATE → 2D PLAYBACK → IMPROVE</span>
          <h1 id="home-title">Design the engine. Run the flow. Improve it.</h1>
          <p>Enter the RDE and operating condition, choose a run quality, and press Run. Kythros manages the solver, shows the calculated flow, and makes missing evidence visible before you decide what to change.</p>
          <div className="home-actions"><button className="button primary" onClick={() => setProductView(designs.length ? "simulation" : "design")}>{designs.length ? "Open CFD Suite →" : "Design the first RDE →"}</button><button className="button secondary" onClick={() => setShowHelp(true)}>See how it works</button></div>
        </div>

        <DesktopDownload details />

        <section className="home-load-card" aria-labelledby="home-load-title">
          <div className="home-load-heading"><span>OPEN A WORKSPACE</span><h2 id="home-load-title">Continue work or inspect an example</h2><p>All workspace loaders live here. New RDE development starts with Design; saved and example projects restore their existing engines, simulations, and evidence.</p></div>
          <div className="home-load-options">
            <article><span>YOUR WORK</span><strong>Saved Kythros workspace</strong><p>Restore engine revisions, operating points, CFD cases, experimental evidence, and frozen next-run plans.</p><label className="button primary workspace-file-button">Open saved workspace<input type="file" accept=".json" onChange={openWorkspace} hidden /></label></article>
            <article><span>REAL PUBLISHED SUMMARY</span><strong>Observed operating points</strong><p>Inspect source-backed operating conditions and reported wave modes. This example does not include raw CFD fields.</p><button className="button secondary" onClick={loadPublishedEnvelopeExample}>Load published observations</button></article>
            <article><span>SYNTHETIC · WORKFLOW ONLY</span><strong>Analysis demonstration</strong><p>Inspect how Kythros analyzes a baseline CFD case and tracks controlled reruns. The generated values are not physical validation.</p><button className="button secondary" onClick={loadExampleCaseHistory}>Load synthetic demonstration</button></article>
          </div>
        </section>

        <details className="home-supporting-details">
          <summary><span>METHOD AND EVIDENCE</span><strong>What Kythros does and does not do</strong><small>Open the five-step workflow, solver boundary, and public analyzer checks.</small></summary>
          <div className="home-supporting-content">
        <section className="home-workflow-card" aria-label="Intended Kythros workflow">
          <div className="card-heading"><div><span>PRIMARY WORKFLOW</span><h2>One engine record from concept through validation</h2><p>Geometry, CFD models, results, recommended changes, and experiments stay connected to the exact engine revision and operating condition.</p></div></div>
          <div className="screening-workflow"><article><b>1</b><span><strong>Input</strong><small>Select the engine, operating condition, and simulation quality.</small></span></article><article><b>2</b><span><strong>Run</strong><small>Calculate the reacting flow and velocity field.</small></span></article><article><b>3</b><span><strong>Output</strong><small>Inspect flow fields, check numerical evidence, and decide what to test next.</small></span></article></div>
          <div className="home-evidence-boundary"><article><span>RAPID 2D</span><strong>Fast design screening</strong><p>Run a periodic reacting-flow screen directly in the web app.</p></article><article><span>DETAILED 2D</span><strong>Physics and convergence</strong><p>Prepare reviewed chemistry, turbulence, wall, and refinement studies.</p></article><article><span>DESIGN ADVISOR</span><strong>What changes next</strong><p>Numerically usable results produce one engine change and one controlled next simulation.</p></article></div>
        </section>

        <PublicExperimentBenchmarks />
          </div>
        </details>

      </section> : productView === "benchmark" ? <ExperimentBenchmark /> : productView === "design" ? <DesignPlanner designs={designs} activeDesignId={activeDesignId} operatingPoints={operatingPoints} onSelectDesign={selectDesign} onSaveDesign={saveEngineDesign} onAddOperatingPoint={openOperatingPoint} onOpenEnvelope={(designId) => { selectDesign(designId); setProductView("envelope"); }} /> : productView === "simulation" ? <Rde2dWorkspace designs={designs} activeDesignId={activeDesignId} operatingPoints={operatingPoints} onSelectDesign={selectDesign} onOpenDesign={() => setProductView("design")} onOpenEnvelope={() => setProductView("envelope")} onOpenValidation={() => setProductView("comparison")} /> : productView === "envelope" ? <OperatingEnvelope designs={designs} activeDesignId={activeDesignId} operatingPoints={operatingPoints} runs={cases} onSelectDesign={selectDesign} onAddOperatingPoint={openOperatingPoint} onOpenDesign={() => setProductView("design")} onOpenHome={() => setProductView("home")} onAddBaselineCfd={openBaselineCfdForOperatingPoint} onOpenRun={(caseId) => { const run = cases.find((item) => item.id === caseId); if (run?.operatingPointId) setActiveOperatingPointId(run.operatingPointId); setActiveCaseId(caseId); setActiveProbe(0); setWorkspaceView("case"); setProductView("comparison"); }} /> : !activeCase || !activeOperatingPoint || !testMode || !cfdMode || !activeComparison || !assessment || !planAssessment || !decisionQuality || !planningCase ? <section className="empty-workspace">
        <span className="empty-kicker">EXPERIMENT VALIDATION · OPTIONAL</span><h1>{activeOperatingPoint?.experiment ? "Measured operating point ready" : "Validate CFD against a physical engine"}</h1>
        <p>{activeOperatingPoint?.experiment ? "The experimental observation is already part of the measured envelope. Add a baseline CFD result only when you want to compare simulation with this measurement." : "Choose an engine and add a measured operating point. CFD comparisons are created separately and stay attached to that physical condition."}</p>
        <span className="empty-status">{activeOperatingPoint?.experiment ? "No CFD comparison has been added for this operating point" : "No measured operating point has been selected"}</span>
        <div className="empty-actions"><button className="button primary" onClick={() => activeOperatingPoint?.experiment ? openBaselineCfdForOperatingPoint(activeOperatingPoint.id) : openNewCase()}>{activeOperatingPoint?.experiment ? "Add baseline CFD comparison →" : activeDesignId ? "Add first measured operating point →" : "Define an engine first →"}</button><button className="button secondary" onClick={() => setProductView("home")}>Go to Home</button></div>
        <div className="empty-requirements"><span><b>1</b><i><strong>Compare</strong> matched experiment and CFD pressure traces</i></span><span><b>2</b><i><strong>Diagnose</strong> pressure and rotating-wave mismatches</i></span><span><b>3</b><i><strong>Run and update</strong> the adaptive CFD plan</i></span></div>
      </section> : <>
        <section className="experiment-validation-notice"><div><span>EXPERIMENT VALIDATION</span><strong>This screen answers whether CFD matches hot-fire data.</strong><p>For engine simulation, 2D timestep playback, and design recommendations, use the CFD Suite.</p></div><button className="button secondary" onClick={() => setProductView("simulation")}>Back to CFD Suite →</button></section>
        <ComparisonHierarchy designs={designs} operatingPoints={operatingPoints} runs={cases} activeDesignId={activeDesignId} activeOperatingPointId={activeOperatingPointId} activeRunId={activeCaseId} onSelectDesign={selectDesign} onSelectOperatingPoint={selectOperatingPoint} onSelectRun={(id) => { setActiveCaseId(id); setActiveProbe(0); setWorkspaceView("case"); }} onAddOperatingPoint={() => activeDesignId && openOperatingPoint(activeDesignId)} onAddRun={openNewRunForOperatingPoint} onViewHistory={() => setWorkspaceView("compare")} onSaveWorkspace={downloadWorkspace} />
        <ProspectiveValidationLedger plans={frozenRunPlans} cases={cases} activeOperatingPointId={activeOperatingPointId} onResume={openFrozenRunPlan} onDownload={downloadFrozenPlan} />

        {workspaceView === "compare" && baselineSummary ? <section className="case-history-comparison" aria-label="Case history">
          <div className="case-history-heading"><div><span className="empty-kicker">RUN HISTORY</span><h1>{activeOperatingPoint.name}</h1><p>{operatingPointLabel(activeOperatingPoint)}. Every row is a run at this one physical condition. A rerun affects the plan only when exactly one named CFD parameter changes.</p></div><label className="baseline-select"><span>Baseline run</span><select value={baselineSummary.item.id} onChange={(event) => setCaseBaselineId(event.target.value)}>{caseSummaries.filter((summary) => !summary.item.relationship).map((summary) => <option key={summary.item.id} value={summary.item.id}>{summary.item.metadata.name}</option>)}</select></label></div>
          <div className="case-history-table-wrap"><table className="case-history-table direct-delta-table">
            <thead><tr><th>Run</th><th>Operating-point check</th><th>Experimental change</th><th>CFD error change</th><th>Run status</th></tr></thead>
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
                <td><span className={`comparison-status ${relationEvidence?.state === "supports" || relationEvidence?.sequenceStatus === "converged" ? "pass" : relationEvidence?.controlled ? "review" : summary.assessment.validity.status === "Blocked" || caseReviews ? "review" : "neutral"}`}>{isBaseline ? "Baseline CFD" : relationEvidence?.controlled ? outcomeLabel(relationEvidence) : "Comparison only"}</span></td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="case-history-note"><strong>How this works:</strong> Kythros checks the saved settings and experiment samples. A valid one-change rerun updates the plan; a run with multiple changes remains a comparison and does not update the plan.</p>
        </section> : <>
          <div className="case-heading"><div><span className={`source-dot ${activeCase.source === "demo" ? "demo" : ""}`} /><span>{activeCase.source === "demo" ? "Synthetic demonstration run" : "User-provided run"}</span></div><h1>{activeCase.metadata.name}</h1><p>{activeOperatingPoint.name} · {activeCase.relationship ? `one-change ${activeCase.relationship.changedParameter ? parameterLabel(activeCase.relationship.changedParameter).toLowerCase() : changeLabel(activeCase.relationship.changedVariable).toLowerCase()} CFD rerun starting from ${activeReferenceName ?? baselineCaseName ?? "the baseline run"}` : `experiment + baseline CFD with ${caseHistoryEvidence.length} related rerun${caseHistoryEvidence.length === 1 ? "" : "s"}`}</p></div>

          <EngineeringDecisionPanel summary={decisionSummary} nextRun={planAssessment.nextRun} showLatestResult={!activeCaseEvidence} decisionQuality={decisionQuality} selectedCaseName={activeCase.metadata.name} selectedAnalysisInput={activeAnalysisInput} planningCaseName={planningCase.metadata.name} publishedSources={likelySources} researchClaims={likelyHypothesis?.researchClaims ?? []} publishedValidation={PUBLISHED_VALIDATION_SUMMARY} onEdit={openCaseEditor} onDownloadReport={downloadReport} onDownloadNextRun={planAssessment.nextRun.decisionPolicy.changedParameter ? downloadNextRunWorkOrder : null} onDownloadOpenFoam={planAssessment.nextRun.decisionPolicy.changedParameter ? downloadOpenFoamHandoff : null} onStartNextRun={planAssessment.nextRun.decisionPolicy.changedParameter ? startRecommendedRerun : null} onSaveWorkspace={downloadWorkspace} onViewHistory={operatingPointRuns.length > 1 ? () => setWorkspaceView("compare") : null} />

          <details className="comparison-secondary-details">
            <summary><span>ADDITIONAL ENGINE PHYSICS</span><strong>Thermal, feed-system, and performance evidence</strong><small>Open optional fields, wall maps, supporting validity checks, and measurement definitions.</small></summary>
            <div className="comparison-secondary-content">
          <RdePhysicsVisual design={activeDesign} rows={physicsComparisons} experimentWallField={activeCase.wallFields?.experiment ?? activeOperatingPoint.experiment?.wallField} cfdWallField={activeCase.wallFields?.cfd} onEdit={openCaseEditor}/>

          {showDetailedEvidence && <>
          <section className={`assessment-banner ${totalReview ? "review" : "pass"}`} aria-label="Comparison conclusion">
            <div><span>COMPARISON CONCLUSION</span><h2>{assessment.validity.status === "Blocked" ? "Assessment blocked until experiment–CFD matching is confirmed" : totalReview ? `${totalReview} evidence check${totalReview === 1 ? "" : "s"} require review` : "No selected CFD-to-experiment difference exceeds current uncertainty"}</h2><p>{assessment.validity.status === "Blocked" ? "Do not change the CFD model from this pairing yet." : totalReview ? "The highlighted findings determine the ranked explanations and one-variable next-run plan below." : "This does not prove the CFD is valid for every output or operating point. It means this run contains no resolved pressure discrepancy."}</p></div>
            <strong>{assessment.validity.status === "Blocked" ? "BLOCKED" : totalReview ? "REVIEW" : "NO RESOLVED MISMATCH"}</strong>
          </section>

          <section className="coverage-grid" aria-label="Validation coverage">
            {assessment.coverage.map((item) => <article key={item.module} className={item.status === "Assessed" ? "coverage-assessed" : item.status === "Inconclusive" ? "coverage-inconclusive" : "coverage-missing"}><span>{item.module}</span><strong>{item.status}</strong><small>{item.detail}</small></article>)}
          </section>

          <section className="quality-validity-grid">
            <article className="validity-panel"><div className="section-heading"><span>01</span><div><h2>Comparison validity</h2><p>Can this pairing support a CFD conclusion?</p></div></div><ul>{assessment.validity.checks.map((check) => <li key={check.label}><span className={`check-dot ${check.status.toLowerCase()}`} /> <div><strong>{check.label}<i>{check.status}</i></strong><small>{check.detail}</small></div></li>)}</ul></article>
            <article className="data-quality-panel"><div className="section-heading"><span>02</span><div><h2>Data quality</h2><p>Sampling, duration, continuity, and clipping</p></div></div><div className="quality-stats"><span><b>{average(assessment.dataQuality.experiment.map((result) => result.capturedCycles)).toFixed(1)}</b> experiment cycles</span><span><b>{average(assessment.dataQuality.cfd.map((result) => result.capturedCycles)).toFixed(1)}</b> CFD cycles</span><span><b>{average(assessment.dataQuality.experiment.map((result) => result.samplesPerCycle)).toFixed(0)}</b> samples/cycle</span></div><ul>{assessment.dataQuality.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></article>
          </section>

          <section className="workflow" aria-label="Kythros inputs and outputs">
            <article className="inputs-panel"><div className="panel-heading"><div><span className="step-number">03</span><div><h2>Inputs used</h2><p>Every required field affects validity, calculation, or diagnosis</p></div></div><button className="text-button" onClick={openCaseEditor}>Edit run</button></div><ol className="input-list">{inputRows.map(([label, value]) => <li key={label}><i aria-hidden="true">✓</i><div><strong>{label}</strong><span>{value}</span></div></li>)}</ol></article>
            <div className="flow-arrow" aria-hidden="true"><span>ANALYZE</span><i>→</i></div>
            <article className="outputs-panel"><div className="panel-heading"><div><span className="step-number">04</span><div><h2>Experiment vs CFD</h2><p>CFD minus experiment, resolved against uncertainty where supported</p></div></div></div>
              <div className="comparison-table-wrap"><table className="comparison-table uncertainty-table">
                <thead><tr><th>Quantity</th><th>Experiment</th><th>CFD</th><th>CFD − experiment</th><th>Combined uncertainty or Kythros prototype limit</th><th>Assessment</th></tr></thead>
                <tbody>{assessment.metrics.map((metric) => <tr key={metric.id} className={metric.tone === "review" ? "comparison-row-review" : metric.tone === "neutral" ? "comparison-row-neutral" : ""}>
                  <th scope="row"><strong>{metric.label}</strong><small>{metric.purpose}</small></th>
                  <td>{formatMetricValue(metric, metric.experiment)}</td><td>{formatMetricValue(metric, metric.cfd)}</td><td className="difference-cell">{formatMetricDifference(metric)}</td>
                  <td className="uncertainty-cell">{metric.uncertainty === null || metric.assessment.status === "match" || metric.assessment.status === "mismatch" ? metric.uncertaintyLabel : `±${metric.uncertainty.toFixed(metricDigits(metric))}${metric.unit ? ` ${metric.unit}` : ""}`}<small>{metric.assessment.explanation}</small></td>
                  <td><span className={`comparison-status ${metric.tone}`}>{metric.assessment.label}</span></td>
                </tr>)}</tbody>
              </table></div>

              <section className="result-block mismatch-block"><div><span className="result-index">05</span><h3>Waveform agreement</h3></div><div className="comparison-metrics">
                <div className={waveformWithinLimit ? "metric-pass" : "metric-review"}><span>Aligned correlation</span><strong>{correlation.toFixed(3)}</strong><small>{waveformWithinLimit ? "Passes Kythros prototype limit: at least 0.700" : "Outside Kythros prototype limit: below 0.700"}</small></div>
                <div><span>Normalized RMSE</span><strong>{(nrmse * 100).toFixed(1)}<i>%</i></strong><small>Residual relative to experimental oscillation RMS</small></div>
                <div><span>Mean pressure bias</span><strong>{signed(pressureBias, 3)} <i>MPa</i></strong><small>Its significance is assessed in the mean-pressure row above</small></div>
              </div><p className="metric-note">Correlation, harmonic, and variability checks use Kythros prototype product limits. The cited papers did not set these limits. Pressure, frequency, speed, impulse, and rise-time rows use the entered experiment and CFD uncertainties. {inconclusiveMetrics ? `${inconclusiveMetrics} metric${inconclusiveMetrics === 1 ? " cannot" : "s cannot"} be classified from the available run data.` : ""}</p></section>

              <section className="result-block causes-block"><div><span className="result-index">06</span><h3>Ranked diagnostic hypotheses</h3></div><ol>{assessment.hypotheses.map((hypothesis, index) => <li key={hypothesis.title}><b>{index + 1}. {hypothesis.title}</b><span>{hypothesis.evidence.map((item) => `${item.state}: ${item.observation}`).join(" ")}</span><small>Model inputs: {hypothesis.modelInputs.filter(Boolean).join(" · ")}</small></li>)}</ol><small>These are transparent sensitivity-test priorities, not causal proof.</small></section>

              <button className="report-button" onClick={downloadReport}><span><b>08</b><strong>Download traceable report</strong><small>Inputs, validity, uncertainty, metrics, hypotheses, and recommended next CFD run</small></span><i>↓</i></button>
            </article>
          </section>

          </>}

          <section className="evidence-panel physics-comparison-panel" aria-label="Engine physics comparison"><div className="evidence-heading"><div><span className="calculated-label">OPTIONAL DOCUMENTED EVIDENCE</span><h2>Performance, feed-system, thermal, and repeatability comparison</h2><p>{physicsProvidedCount ? `${physicsProvidedCount} of ${physicsComparisons.length} quantities have at least one documented value.` : "No optional engine-physics values were provided for this run."} Kythros reports CFD minus experiment only when both values exist; it never infers a missing value.</p></div><button className="button secondary" onClick={openCaseEditor}>Add or edit values</button></div><div className="comparison-table-wrap"><table className="comparison-table physics-comparison-table"><thead><tr><th>Evidence layer</th><th>Quantity</th><th>Experiment</th><th>CFD</th><th>CFD − experiment</th></tr></thead><tbody>{physicsComparisons.map((row) => <tr key={row.key}><td><span className="physics-layer-tag">{row.layer === "feed" ? "Feed system" : row.layer[0].toUpperCase() + row.layer.slice(1)}</span></td><th scope="row">{row.label}</th><td>{formatPhysicsValue(row.experiment, row.unit)}</td><td>{formatPhysicsValue(row.cfd, row.unit)}</td><td className="difference-cell">{row.difference === null ? "Not comparable" : `${row.difference > 0 ? "+" : ""}${formatPhysicsValue(row.difference, row.unit)}`}</td></tr>)}</tbody></table></div><p className="metric-note">These scalar differences are descriptive in this version. They do not automatically pass or fail a CFD run because the required definitions and uncertainty budgets depend on the measurement method.</p><details className="classification-method physics-sources"><summary>Measurement basis and primary experimental sources</summary><div><p>{PHYSICS_SOURCE_LIMITATION}</p><ul>{PHYSICS_EVIDENCE_SOURCES.map((source) => <li key={source.title}><a href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}</strong></a><span>{source.authors} ({source.year}) · {source.contribution}</span></li>)}</ul></div></details></section>

            </div>
          </details>

          <section className="evidence-panel primary-signal-evidence" aria-label="Calculated signal evidence"><div className="evidence-heading"><div><span className="calculated-label">CALCULATED AFTER CASE ANALYSIS</span><h2>Pressure and wave evidence</h2><p>Every trace, spectrum, propagation phase, and cycle statistic is calculated from the active case.</p></div><div className="control-group"><div className="probe-tabs" aria-label="Probe selection">{activeCase.testSignals.map((_, probe) => <button key={probe} className={activeProbe === probe ? "active" : ""} onClick={() => setActiveProbe(probe)}>P{probe + 1}</button>)}</div><div className="view-tabs" aria-label="Evidence view"><button className={activeView === "signals" ? "active" : ""} onClick={() => setActiveView("signals")}>Pressure</button><button className={activeView === "spectrum" ? "active" : ""} onClick={() => setActiveView("spectrum")}>Spectrum</button><button className={activeView === "residual" ? "active" : ""} onClick={() => setActiveView("residual")}>Residual</button><button className={activeView === "phase" ? "active" : ""} onClick={() => setActiveView("phase")}>Propagation</button><button className={activeView === "cycles" ? "active" : ""} onClick={() => setActiveView("cycles")}>Cycle stability</button></div></div></div><div className="chart-heading"><span>{activeView === "phase" ? `${activeCase.testSignals.length} probes · ${testMode.identifiability.toLowerCase()} experimental mode` : activeView === "cycles" ? `${testMode.cycleSeries.length} experiment cycles · ${cfdMode.cycleSeries.length} CFD cycles` : `Probe P${activeProbe + 1} · ${activeCase.metadata.probePositionsDeg[activeProbe]}° · ${activeComparison.time.length.toLocaleString()} aligned samples`}</span><Legend residual={activeView === "residual"} /></div>{activeView === "signals" && <SignalChart comparison={activeComparison} />}{activeView === "spectrum" && <SpectrumChart comparison={activeComparison} />}{activeView === "residual" && <ResidualChart comparison={activeComparison} />}{activeView === "phase" && <PhaseChart experiment={testMode} simulation={cfdMode} positionsDeg={activeCase.metadata.probePositionsDeg} />}{activeView === "cycles" && <CycleChart experiment={testMode} simulation={cfdMode} />}<div className="wave-summary"><span><b>{probeSetComparison?.sharedLagUs.toFixed(2)} µs</b> shared experiment–CFD alignment</span><span><b>{testMode.identifiability === "Not identifiable" ? "Not identifiable" : `${testMode.waveCount}-wave ${testMode.direction.toLowerCase()}`}</b> experiment · {testMode.identifiability}</span><span><b>{cfdMode.identifiability === "Not identifiable" ? "Not identifiable" : `${cfdMode.waveCount}-wave ${cfdMode.direction.toLowerCase()}`}</b> CFD · {cfdMode.identifiability}</span><span><b>{testMode.identifiability === "Not identifiable" || cfdMode.identifiability === "Not identifiable" ? "Not identifiable" : `${testMode.phaseJitterDeg.toFixed(1)}° / ${cfdMode.phaseJitterDeg.toFixed(1)}°`}</b> phase jitter</span></div>{[...testMode.warnings, ...cfdMode.warnings].length > 0 && <ul className="wave-warnings">{[...new Set([...testMode.warnings, ...cfdMode.warnings])].map((warning) => <li key={warning}>{warning}</li>)}</ul>}</section>
          <footer><span>Kythros v{ANALYSIS_VERSION} · calculated from the saved run data</span><span>{operatingPoints.length} operating point{operatingPoints.length === 1 ? "" : "s"} · {cases.length} run{cases.length === 1 ? "" : "s"} · not a certification or causal proof</span></footer>
        </>}
      </>}
    </section>

    {showLoader && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowLoader(false)}><section className="loader-modal" role="dialog" aria-modal="true" aria-labelledby="loader-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={() => setShowLoader(false)} aria-label="Close inputs">×</button><div className="loader-intro"><div><span className="modal-kicker">{measuredPointDraft ? "MEASURED OPERATING POINT" : "CFD COMPARISON RUN"}</span><h2 id="loader-title">{measuredPointDraft ? "Add measured operating point" : reviewingRerun ? "Review one-change rerun" : editingCaseId ? "Edit run" : draftRelationship ? "Add CFD rerun" : "Add baseline CFD comparison"}</h2></div>{!reviewingRerun && <button className="input-help-button" onClick={() => setShowHelp(true)}>What does each input mean?</button>}</div>{!reviewingRerun && <p>{measuredPointDraft ? "Enter the physical condition and experimental measurements. Pressure probes define the wave response; optional performance, feed-system, thermal, and duration values add separate evidence layers. No CFD setup or result is required here." : "The experiment and physical condition are inherited from the operating point. Add CFD inputs here only for comparison and rerun planning."}</p>}

      {reviewingRerun && draftReferenceCase && draftRelationship && cfdPending ? <section className="rerun-review-step" aria-label="Controlled rerun review">
        <span>Ready to analyze</span>
        <h3>{draft.name}</h3>
        <div className="rerun-review-list">
          <p><strong>Starting run</strong><span>{draftReferenceCase.metadata.name}</span></p>
          <p><strong>Experiment reused</strong><span>{inheritedExperimentName}</span></p>
          <p><strong>Changed only</strong><span>{draftRelationship.changedParameter ? parameterLabel(draftRelationship.changedParameter) : changeLabel(draftRelationship.changedVariable)} · {changedRerunFields.map(caseFieldLabel).join(", ")}</span></p>
          <p><strong>New CFD result</strong><span>{cfdPending.provenance.fileName}</span></p>
        </div>
        <div className="rerun-review-confirmation"><strong>Operating point and experiment are locked.</strong><span>Kythros will compare this CFD result with the inherited experiment and starting run settings.</span></div>
        <div className="modal-actions"><button className="button secondary" onClick={() => setReviewingRerun(false)}>Back to inputs</button><button className="button primary" onClick={applyCase}>Analyze rerun →</button></div>
      </section> : <>

      <div className="form-section">
        <h3>{measuredPointDraft ? "Engine, operating point, and experiment geometry" : "Engine, run, and geometry"}</h3>
        <div className="form-grid four">
          <label><span>Engine / design</span><select disabled={!measuredPointDraft} value={draftDesignId ?? ""} onChange={(event) => setDraftDesignId(event.target.value || null)}><option value="" disabled>Select engine</option>{designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}</select></label>
          <label><span>{measuredPointDraft ? "Operating point name" : draftRelationship ? "Rerun name" : "Baseline CFD run name"}</span><input value={draft.name} onChange={(event) => updateText("name", event.target.value)} /></label>
          <label><span>{measuredPointDraft ? "Mean diameter from engine (mm)" : "Mean diameter (mm)"}</span><input disabled={measuredPointDraft || rerunFieldLocked("annulusMeanDiameterMm")} type="number" value={numberValue(draft.annulusMeanDiameterMm)} onChange={(event) => updateNumber("annulusMeanDiameterMm", event.target.value)} /></label>
          <label><span>Diameter uncertainty (mm)</span><input disabled={rerunFieldLocked("annulusDiameterUncertaintyMm")} type="number" step="0.01" value={numberValue(draft.annulusDiameterUncertaintyMm)} onChange={(event) => updateNumber("annulusDiameterUncertaintyMm", event.target.value)} /></label>
          <label><span>Maximum expected waves</span><input disabled={rerunFieldLocked("maximumWaveCount")} type="number" min="1" max="12" value={numberValue(draft.maximumWaveCount)} onChange={(event) => updateNumber("maximumWaveCount", event.target.value)} /></label>
        </div>
        <label className="probe-angle-editor"><span>Probe angles (deg) · minimum 3, nonuniform preferred</span><div className="angle-inputs">{draft.probePositionsDeg.map((angle, index) => <input disabled={rerunFieldLocked("probePositionsDeg")} key={index} type="number" aria-label={`Probe ${index + 1} angle`} placeholder={`P${index + 1}`} value={numberValue(angle)} onChange={(event) => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.map((value, position) => position === index ? (event.target.value === "" ? Number.NaN : Number(event.target.value)) : value) }))} />)}<button disabled={controlledRerunDraft || !measuredPointDraft} type="button" onClick={() => setDraft((current) => ({ ...current, probePositionsDeg: [...current.probePositionsDeg, Number.NaN] }))}>+ probe</button>{draft.probePositionsDeg.length > 3 && <button disabled={controlledRerunDraft || !measuredPointDraft} type="button" onClick={() => setDraft((current) => ({ ...current, probePositionsDeg: current.probePositionsDeg.slice(0, -1) }))}>Remove</button>}</div></label>
        <label className="confirmation-check"><input disabled={rerunFieldLocked("probeSynchronizationConfirmed")} type="checkbox" checked={draft.probeSynchronizationConfirmed} onChange={(event) => setDraft((current) => ({ ...current, probeSynchronizationConfirmed: event.target.checked }))} /><span>I confirm every experimental pressure probe uses one synchronized acquisition time base.</span></label>
        {!measuredPointDraft && <div className="automatic-pairing"><span>AUTOMATIC PAIRING</span><strong>Verified when the run is analyzed</strong><p>Kythros checks the inherited operating point, probe count against the saved angle map, synchronized time base, and overlapping experiment–CFD window. The saved run records the resulting fingerprint.</p></div>}
      </div>

      {!measuredPointDraft && (draftOperatingPointRuns.length > 0 || draftRelationship) && <div className="form-section"><h3>{editingCaseId ? "Run relationship" : "Controlled CFD rerun"}</h3><p className="form-help">{editingCaseId ? "This relationship is locked because changing it would change the meaning of the saved result." : "This rerun inherits the engine, operating point, experiment, and probes. Choose exactly one CFD parameter to change."}</p><div className="form-grid four">
        <label><span>Operating point baseline run</span><select disabled={Boolean(editingCaseId) || Boolean(draftRelationship)} value={draftRelationship?.baselineCaseId ?? ""} onChange={(event) => chooseCaseFamily(event.target.value)}><option value="">Not a related rerun</option>{draftOperatingPointRuns.filter((item) => item.id !== editingCaseId && !item.relationship).map((item) => <option key={item.id} value={item.id}>{item.metadata.name}</option>)}</select></label>
        <label><span>Starting run</span><select disabled={!draftRelationship || Boolean(editingCaseId)} value={draftRelationship?.referenceCaseId ?? draftRelationship?.baselineCaseId ?? ""} onChange={(event) => chooseStartingCase(event.target.value)}>{draftRelationship && draftOperatingPointRuns.filter((item) => item.id !== editingCaseId && (item.id === draftRelationship.baselineCaseId || item.relationship?.baselineCaseId === draftRelationship.baselineCaseId)).map((item) => <option key={item.id} value={item.id}>{item.metadata.name}</option>)}</select></label>
        <label><span>Single CFD parameter</span><select disabled={!draftRelationship || Boolean(editingCaseId)} value={draftRelationship?.changedParameter ?? ""} onChange={(event) => chooseChangedParameter(event.target.value ? event.target.value as ControlledParameter : null)}><option value="">Choose one exact parameter</option>{CONTROLLED_PARAMETER_DEFINITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Change description</span><input disabled={!draftRelationship || Boolean(editingCaseId)} value={draftRelationship?.description ?? ""} onChange={(event) => setDraftRelationship((current) => current ? { ...current, description: event.target.value } : null)} placeholder="e.g. 50% front-cell refinement" /></label>
      </div>{editingCaseId ? <div className="rerun-inheritance"><strong>{draftRelationship ? "Controlled-rerun definition locked" : "Baseline definition locked"}</strong><span>Create a new run to test a different CFD parameter.</span></div> : draftReferenceCase && <div className="rerun-inheritance"><strong>Starting run copied: {draftReferenceCase.metadata.name}</strong><span>{!draftRelationship?.changedParameter ? "Choose the one CFD parameter being tested." : `Only ${parameterLabel(draftRelationship.changedParameter).toLowerCase()} fields are editable. The operating point and experiment are locked.`}</span></div>}</div>}

      <div className="form-section">
        <div className="form-section-heading"><div><h3>{measuredPointDraft ? "Experimental pressure measurements" : "Synchronized pressure probes"}</h3><p className="form-help">{measuredPointDraft ? "Map the time column and one pressure column for each synchronized experimental probe." : "The operating point supplies the experimental measurements. Upload and map the CFD result for this comparison."}</p></div><button onClick={downloadExample}>Download example CSV</button></div>
        <div className={`file-mapper-grid ${measuredPointDraft ? "single" : ""}`}>
          {measuredPointDraft
            ? <PressureFileMapper key={`experiment-new-${draft.probePositionsDeg.length}`} kind="Experiment" expectedProbeCount={draft.probePositionsDeg.length} onMapped={setTestPending} />
            : draftReferenceCase && !editingCaseId
              ? <section className="inherited-experiment"><div><span>EXPERIMENT REUSED</span><strong>{inheritedExperimentName}</strong></div><p>Exact samples inherited from <b>{draftReferenceCase.metadata.name}</b>. No experiment re-upload is needed.</p></section>
              : draftOperatingPoint?.experiment && !editingCaseId
                ? <section className="inherited-experiment"><div><span>MEASURED EXPERIMENT</span><strong>{draftOperatingPoint.experiment.importProvenance?.fileName ?? draftOperatingPoint.name}</strong></div><p>Experimental samples are inherited from this operating point. No re-upload is needed.</p></section>
                : <PressureFileMapper key={`experiment-${editingCaseId ?? "new"}-${draft.probePositionsDeg.length}`} kind="Experiment" expectedProbeCount={draft.probePositionsDeg.length} currentFileName={editingCaseId ? cases.find((item) => item.id === editingCaseId)?.testSignals[0]?.name.split(" · ")[0] : undefined} onMapped={setTestPending} />}
          {!measuredPointDraft && <PressureFileMapper key={`cfd-${editingCaseId ?? "new"}-${draft.probePositionsDeg.length}-${draftRelationship?.referenceCaseId ?? "standalone"}`} kind="CFD" expectedProbeCount={draft.probePositionsDeg.length} currentFileName={editingCaseId ? cases.find((item) => item.id === editingCaseId)?.cfdSignals[0]?.name.split(" · ")[0] : undefined} onMapped={setCfdPending} />}
        </div>
        <div className="form-grid two measurement-chain"><label><span>Experiment sensor bandwidth (kHz)</span><input disabled={!measuredPointDraft || rerunFieldLocked("experimentSensorBandwidthKHz")} type="number" step="0.1" value={numberValue(draft.experimentSensorBandwidthKHz)} onChange={(event) => updateNumber("experimentSensorBandwidthKHz", event.target.value)} /></label><label><span>Experiment low-pass / anti-alias cutoff (kHz)</span><input disabled={!measuredPointDraft || rerunFieldLocked("experimentFilterCutoffKHz")} type="number" step="0.1" value={numberValue(draft.experimentFilterCutoffKHz)} onChange={(event) => updateNumber("experimentFilterCutoffKHz", event.target.value)} /></label></div>
      </div>

      <div className="form-section"><h3>Operating point</h3><p className="form-help">{measuredPointDraft ? "Enter the physical test condition. These values define one marker in the measured envelope." : "This physical condition is inherited from the measured operating point and cannot be changed by a CFD run."}</p><div className="form-grid five"><label><span>Inlet / plenum pressure (bar)</span><input disabled={!measuredPointDraft || rerunFieldLocked("inletPressureBar")} type="number" value={numberValue(draft.inletPressureBar)} onChange={(event) => updateNumber("inletPressureBar", event.target.value)} /></label><label><span>Mass flow (kg/s)</span><input disabled={!measuredPointDraft || rerunFieldLocked("massFlowKgS")} type="number" step="0.001" value={numberValue(draft.massFlowKgS)} onChange={(event) => updateNumber("massFlowKgS", event.target.value)} /></label><label><span>Equivalence ratio</span><input disabled={!measuredPointDraft || rerunFieldLocked("equivalenceRatio")} type="number" step="0.01" value={numberValue(draft.equivalenceRatio)} onChange={(event) => updateNumber("equivalenceRatio", event.target.value)} /></label><label><span>Back pressure (bar)</span><input disabled={!measuredPointDraft || rerunFieldLocked("backPressureBar")} type="number" step="0.01" value={numberValue(draft.backPressureBar)} onChange={(event) => updateNumber("backPressureBar", event.target.value)} /></label><label><span>Inlet temperature (K)</span><input disabled={!measuredPointDraft || rerunFieldLocked("inletTemperatureK")} type="number" value={numberValue(draft.inletTemperatureK)} onChange={(event) => updateNumber("inletTemperatureK", event.target.value)} /></label></div></div>

      <div className="form-section"><h3>{measuredPointDraft ? "Optional engine-physics measurements" : "Optional engine-physics comparison"}</h3><p className="form-help">Add only documented measurements or directly calculated solver outputs. Missing values remain unavailable and do not lower the pressure-and-wave result.</p><div className="form-grid four">{PHYSICS_MEASUREMENT_DEFINITIONS.flatMap((item) => {
        const experimentField = <label key={`experiment-${item.key}`}><span>Experiment {item.label.toLowerCase()}{item.unit ? ` (${item.unit})` : ""} · optional</span><input disabled={!measuredPointDraft || rerunFieldLocked(item.experimentKey)} type="number" step="any" value={numberValue(draft[item.experimentKey] as number | undefined)} onChange={(event) => updateNumber(item.experimentKey, event.target.value)} /></label>;
        if (measuredPointDraft) return [experimentField];
        const cfdField = <label key={`cfd-${item.key}`}><span>CFD {item.label.toLowerCase()}{item.unit ? ` (${item.unit})` : ""} · optional</span><input disabled={rerunFieldLocked(item.cfdKey)} type="number" step="any" value={numberValue(draft[item.cfdKey] as number | undefined)} onChange={(event) => updateNumber(item.cfdKey, event.target.value)} /></label>;
        return [experimentField, cfdField];
      })}</div></div>

      <div className="form-section"><h3>Optional spatial wall evidence</h3><p className="form-help">Upload axial position and circumferential angle with wall heat flux, wall temperature, or both. Kythros plots only mapped samples and does not turn a scalar peak into a field.</p><div className={`file-mapper-grid ${measuredPointDraft ? "single" : ""}`}>
        {measuredPointDraft
          ? <SpatialFieldMapper kind="Experiment" currentFileName={draftNewOperatingPoint?.experiment?.wallField?.fileName} onMapped={setTestWallPending}/>
          : <section className="inherited-experiment"><div><span>EXPERIMENT WALL FIELD</span><strong>{draftOperatingPoint?.experiment?.wallField?.fileName ?? activeCase?.wallFields?.experiment?.fileName ?? "No spatial experiment field"}</strong></div><p>{draftOperatingPoint?.experiment?.wallField || activeCase?.wallFields?.experiment ? "Inherited from the measured operating point." : "No experimental wall map is available; scalar evidence remains separate."}</p></section>}
        {!measuredPointDraft && <SpatialFieldMapper kind="CFD" currentFileName={editingCaseId ? activeCase?.wallFields?.cfd?.fileName : undefined} onMapped={setCfdWallPending}/>} 
      </div></div>

      {!measuredPointDraft && <div className="form-section"><h3>Solver + numerical schemes</h3>{!controlledRerunDraft && !editingCaseId && <SolverManifestImporter metadata={draft} onApply={(values) => setDraft((current) => ({ ...current, ...values }))} />}<div className="form-grid four"><label><span>Solver</span><input disabled={rerunFieldLocked("solver")} value={draft.solver} onChange={(event) => updateText("solver", event.target.value)} /></label><label><span>Version</span><input disabled={rerunFieldLocked("solverVersion")} value={draft.solverVersion} onChange={(event) => updateText("solverVersion", event.target.value)} /></label><label><span>Dimensionality</span><select disabled={rerunFieldLocked("dimensionality")} value={draft.dimensionality} onChange={(event) => setDraft((current) => ({ ...current, dimensionality: event.target.value as Dimensionality }))}><option value="">Select</option><option value="2D">2D</option><option value="3D">3D</option></select></label><label><span>Runtime (hours) · optional</span><input disabled={rerunFieldLocked("solverRuntimeHours")} type="number" min="0" step="0.1" value={numberValue(draft.solverRuntimeHours)} onChange={(event) => updateNumber("solverRuntimeHours", event.target.value)} /></label><label><span>Spatial scheme</span><input disabled={rerunFieldLocked("spatialScheme")} value={draft.spatialScheme} onChange={(event) => updateText("spatialScheme", event.target.value)} /></label><label><span>Spatial order</span><input disabled={rerunFieldLocked("spatialOrder")} type="number" value={numberValue(draft.spatialOrder)} onChange={(event) => updateNumber("spatialOrder", event.target.value)} /></label><label><span>Numerical flux</span><input disabled={rerunFieldLocked("numericalFlux")} value={draft.numericalFlux} onChange={(event) => updateText("numericalFlux", event.target.value)} /></label><label><span>Limiter / filter / dissipation</span><input disabled={rerunFieldLocked("limiterFilter")} placeholder="Enter None if unused" value={draft.limiterFilter} onChange={(event) => updateText("limiterFilter", event.target.value)} /></label><label><span>Temporal scheme</span><input disabled={rerunFieldLocked("temporalScheme")} value={draft.temporalScheme} onChange={(event) => updateText("temporalScheme", event.target.value)} /></label><label><span>Temporal order</span><input disabled={rerunFieldLocked("temporalOrder")} type="number" value={numberValue(draft.temporalOrder)} onChange={(event) => updateNumber("temporalOrder", event.target.value)} /></label><label><span>Time step (µs)</span><input disabled={rerunFieldLocked("timeStepUs")} type="number" step="0.001" value={numberValue(draft.timeStepUs)} onChange={(event) => updateNumber("timeStepUs", event.target.value)} /></label><label><span>CFL</span><input disabled={rerunFieldLocked("cfl")} type="number" step="0.01" value={numberValue(draft.cfl)} onChange={(event) => updateNumber("cfl", event.target.value)} /></label></div></div>}

      {!measuredPointDraft && <div className="form-section"><h3>Resolution + convergence</h3><div className="form-grid four"><label><span>Total mesh cells</span><input disabled={rerunFieldLocked("meshCells")} type="number" value={numberValue(draft.meshCells)} onChange={(event) => updateNumber("meshCells", event.target.value)} /></label><label><span>Minimum front cell (mm)</span><input disabled={rerunFieldLocked("minimumCellSizeMm")} type="number" step="0.001" value={numberValue(draft.minimumCellSizeMm)} onChange={(event) => updateNumber("minimumCellSizeMm", event.target.value)} /></label><label><span>Cells / induction length</span><input disabled={rerunFieldLocked("cellsPerInductionLength")} type="number" step="0.1" value={numberValue(draft.cellsPerInductionLength)} onChange={(event) => updateNumber("cellsPerInductionLength", event.target.value)} /></label><label><span>Near-wall cell (mm)</span><input disabled={rerunFieldLocked("nearWallCellSizeMm")} type="number" step="0.001" value={numberValue(draft.nearWallCellSizeMm)} onChange={(event) => updateNumber("nearWallCellSizeMm", event.target.value)} /></label><label><span>Documented mesh-study change (%) · optional</span><input disabled={rerunFieldLocked("meshConvergencePct")} type="number" step="0.1" value={numberValue(draft.meshConvergencePct)} onChange={(event) => updateNumber("meshConvergencePct", event.target.value)} /></label><label><span>Documented time-step-study change (%) · optional</span><input disabled={rerunFieldLocked("timeStepConvergencePct")} type="number" step="0.1" value={numberValue(draft.timeStepConvergencePct)} onChange={(event) => updateNumber("timeStepConvergencePct", event.target.value)} /></label></div></div>}

      {!measuredPointDraft && <div className="form-section"><h3>Physics + boundaries</h3><div className="form-grid four"><label><span>Chemical mechanism</span><input disabled={rerunFieldLocked("chemistryModel")} value={draft.chemistryModel} onChange={(event) => updateText("chemistryModel", event.target.value)} /></label><label><span>Species</span><input disabled={rerunFieldLocked("chemistrySpecies")} type="number" value={numberValue(draft.chemistrySpecies)} onChange={(event) => updateNumber("chemistrySpecies", event.target.value)} /></label><label><span>Reactions</span><input disabled={rerunFieldLocked("chemistryReactions")} type="number" value={numberValue(draft.chemistryReactions)} onChange={(event) => updateNumber("chemistryReactions", event.target.value)} /></label><label><span>Chemistry integration</span><input disabled={rerunFieldLocked("chemistryIntegrator")} value={draft.chemistryIntegrator} onChange={(event) => updateText("chemistryIntegrator", event.target.value)} /></label><label><span>Turbulence model</span><input disabled={rerunFieldLocked("turbulenceModel")} placeholder="Enter None if unused" value={draft.turbulenceModel} onChange={(event) => updateText("turbulenceModel", event.target.value)} /></label><label><span>Combustion model</span><input disabled={rerunFieldLocked("combustionModel")} placeholder="Enter None if unused" value={draft.combustionModel} onChange={(event) => updateText("combustionModel", event.target.value)} /></label><label><span>Wall thermal condition</span><input disabled={rerunFieldLocked("wallBoundaryCondition")} value={draft.wallBoundaryCondition} onChange={(event) => updateText("wallBoundaryCondition", event.target.value)} /></label><label><span>Inlet treatment</span><input disabled={rerunFieldLocked("inletBoundaryCondition")} value={draft.inletBoundaryCondition} onChange={(event) => updateText("inletBoundaryCondition", event.target.value)} /></label><label><span>Inlet forcing method</span><input disabled={rerunFieldLocked("inletForcingMethod")} value={draft.inletForcingMethod} onChange={(event) => updateText("inletForcingMethod", event.target.value)} placeholder="None, synthetic, or measured history" /></label><label><span>Outlet treatment</span><input disabled={rerunFieldLocked("outletBoundaryCondition")} value={draft.outletBoundaryCondition} onChange={(event) => updateText("outletBoundaryCondition", event.target.value)} /></label><label><span>Ignition / initialization</span><input disabled={rerunFieldLocked("initializationMethod")} value={draft.initializationMethod} onChange={(event) => updateText("initializationMethod", event.target.value)} /></label></div></div>}

      <div className="form-section"><h3>{measuredPointDraft ? "Experiment uncertainty" : "Experiment + CFD uncertainty"}</h3><div className="form-grid four"><label><span>Experiment pressure uncertainty (%)</span><input disabled={!measuredPointDraft || rerunFieldLocked("pressureUncertaintyPct")} type="number" step="0.1" value={numberValue(draft.pressureUncertaintyPct)} onChange={(event) => updateNumber("pressureUncertaintyPct", event.target.value)} /></label><label><span>Experiment timing uncertainty (µs)</span><input disabled={!measuredPointDraft || rerunFieldLocked("timingUncertaintyUs")} type="number" step="0.01" value={numberValue(draft.timingUncertaintyUs)} onChange={(event) => updateNumber("timingUncertaintyUs", event.target.value)} /></label>{!measuredPointDraft && <><label><span>CFD pressure uncertainty (%)</span><input disabled={rerunFieldLocked("cfdPressureUncertaintyPct")} type="number" step="0.1" value={numberValue(draft.cfdPressureUncertaintyPct)} onChange={(event) => updateNumber("cfdPressureUncertaintyPct", event.target.value)} /></label><label><span>CFD timing uncertainty (µs)</span><input disabled={rerunFieldLocked("cfdTimingUncertaintyUs")} type="number" step="0.01" value={numberValue(draft.cfdTimingUncertaintyUs)} onChange={(event) => updateNumber("cfdTimingUncertaintyUs", event.target.value)} /></label></>}</div></div>

      {error && <p className="error-message">{error}</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setShowLoader(false)}>Cancel</button><button className="button primary" onClick={measuredPointDraft ? applyMeasuredOperatingPoint : controlledRerunDraft ? reviewRerun : applyCase}>{measuredPointDraft ? "Add measured operating point →" : controlledRerunDraft ? "Review rerun →" : draftRelationship ? "Analyze rerun →" : "Analyze baseline CFD →"}</button></div>
      </>}
    </section></div>}

    {showHelp && <div className="modal-backdrop help-backdrop" role="presentation" onMouseDown={() => setShowHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="close-button" onClick={() => setShowHelp(false)} aria-label="Close Kythros guide">×</button><span className="modal-kicker">KYTHROS WORKFLOW GUIDE</span><h2 id="help-title">Input. Run. Inspect. Improve.</h2><p>Kythros keeps the engine definition, local solver job, calculated fields, recommended change, operating envelope, and later experiment validation attached to one engine revision.</p>
      <div className="help-workflow" aria-label="Kythros workflow"><article><b>1</b><strong>Input</strong><span>Select the saved engine, operating point, and run quality.</span></article><article><b>2</b><strong>Run</strong><span>Rapid 2D records pressure timesteps in the app. Detailed 2D exports a specification for an external solver.</span></article><article><b>3</b><strong>Output</strong><span>Play or scrub saved 2D pressure frames on the engine model, then review the evidence.</span></article></div>
      <div className="help-boundary"><article><span>2D PLAYBACK</span><strong>Calculated frames on your model</strong><p>Recorded pressure is wrapped around the chamber. The model does not resolve radial variations.</p></article><article><span>NUMERICAL GATES</span><strong>Advice only after checks pass</strong><p>If conservation or refinement fails, Kythros keeps the engine fixed and requests the exact numerical rerun.</p></article><article><span>EXPERIMENT VALIDATION</span><strong>A separate physical check</strong><p>When hot-fire data exist, this workspace tests whether the CFD represents the engine. It is not required to run CFD.</p></article></div>
      <section className="help-workspaces"><h3>Choose the workspace</h3><div><article><strong>Design</strong><p>Create or revise the physical engine.</p></article><article><strong>CFD Suite</strong><p>Select a run quality, launch the solver, play the recorded 2D flow, and receive the next design action.</p></article><article><strong>Envelope</strong><p>Track planned, simulation-only, and measured conditions.</p></article><article><strong>Experiment Validation</strong><p>Compare matched CFD and hot-fire data only when both exist.</p></article></div></section>
      <details className="help-input-reference" open={showLoader}><summary>Detailed operating-point and CFD input reference</summary><p>Use documented values. Kythros leaves missing settings and uncertainty unavailable rather than inferring them.</p><div className="help-groups">{CASE_INPUT_HELP.map((group) => <section key={group.title} className="help-group"><div><h3>{group.title}</h3><p>{group.description}</p></div><dl>{group.items.map((item) => <div key={item.key} className="help-item"><dt>{item.label}<span className={`requirement-tag ${item.requirement.toLowerCase()}`}>{item.requirement}</span></dt><dd><p>{item.definition}</p><div className="help-details"><span><b>Format / units</b>{item.format}</span><span><b>Where to find it</b>{item.obtainFrom}</span><span><b>Used for</b>{item.usedFor}</span><span><b>If missing</b>{item.missingEffect}</span></div></dd></div>)}</dl></section>)}</div></details>
      <div className="help-actions"><button className="button primary" onClick={() => setShowHelp(false)}>{showLoader ? "Back to inputs" : "Close guide"}</button></div>
    </section></div>}
  </main>;
}

