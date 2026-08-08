import type { CaseMetadata } from "./caevera-types.ts";
import {
  REVIEW_THRESHOLDS,
  type Comparison,
  type DataQualityResult,
  type RdeModeResult,
} from "./rde-analysis.ts";
import {
  assessResolvedDifference,
  exactAssessment,
  frequencyUncertaintyKHz,
  rss,
  statusTone,
  type UncertaintyAssessment,
} from "./uncertainty.ts";

export type MetricAssessment = {
  id: string;
  label: string;
  purpose: string;
  experiment: number | string;
  cfd: number | string;
  difference: number | string;
  percentDifference: number | null;
  unit: string;
  uncertainty: number | null;
  uncertaintyLabel: string;
  assessment: UncertaintyAssessment;
  tone: "pass" | "review" | "neutral";
};

export type ValidityCheck = {
  label: string;
  status: "Pass" | "Review" | "Blocked";
  detail: string;
};

export type DiagnosticHypothesis = {
  title: string;
  score: number;
  evidence: string[];
  modelInputs: string[];
};

export type ControlledNextRun = {
  title: string;
  change: string;
  reason: string;
  evidence: string[];
  holdFixed: string[];
  expectedOutcome: string;
  confirmationCriterion: string;
  rejectionCriterion: string;
  alternativeHypothesis: string;
  evidenceStrength: "High" | "Moderate" | "Exploratory";
};

export type CoverageItem = {
  module: string;
  status: "Assessed" | "Inconclusive" | "Not assessed";
  detail: string;
};

export type CaseAssessment = {
  validity: {
    status: "Valid" | "Review" | "Blocked";
    checks: ValidityCheck[];
  };
  dataQuality: {
    status: "Ready" | "Review";
    experiment: DataQualityResult[];
    cfd: DataQualityResult[];
    findings: string[];
  };
  metrics: MetricAssessment[];
  coverage: CoverageItem[];
  hypotheses: DiagnosticHypothesis[];
  nextRun: ControlledNextRun;
};

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Number.NaN;
}

function pressureMetric(comparisons: Comparison[], key: keyof Comparison["testMetrics"], source: "test" | "cfd") {
  return average(comparisons.map((comparison) => comparison[source === "test" ? "testMetrics" : "cfdMetrics"][key] as number));
}

function resolvedPressureMetric({
  id,
  label,
  purpose,
  unit,
  test,
  cfd,
  metadata,
  includeTiming = false,
  testFrequencyKHz = 8,
  cfdFrequencyKHz = 8,
}: {
  id: string;
  label: string;
  purpose: string;
  unit: string;
  test: number;
  cfd: number;
  metadata: CaseMetadata;
  includeTiming?: boolean;
  testFrequencyKHz?: number;
  cfdFrequencyKHz?: number;
}): MetricAssessment {
  const difference = cfd - test;
  const experimentRelative = metadata.pressureUncertaintyPct / 100;
  const cfdRelative = metadata.cfdPressureUncertaintyPct / 100;
  const experimentTiming = includeTiming ? metadata.timingUncertaintyUs / (1000 / Math.max(testFrequencyKHz, 1e-12)) : 0;
  const cfdTiming = includeTiming ? metadata.cfdTimingUncertaintyUs / (1000 / Math.max(cfdFrequencyKHz, 1e-12)) : 0;
  const experimentUncertainty = Math.abs(test) * rss(experimentRelative, experimentTiming);
  const cfdUncertainty = Math.abs(cfd) * rss(cfdRelative, cfdTiming);
  const assessment = assessResolvedDifference(difference, experimentUncertainty, cfdUncertainty);
  return {
    id,
    label,
    purpose,
    experiment: test,
    cfd,
    difference,
    percentDifference: Number.isFinite(test) ? 100 * difference / Math.max(Math.abs(test), 1e-12) : null,
    unit,
    uncertainty: assessment.combined,
    uncertaintyLabel: "Combined measurement + numerical uncertainty (RSS, k=1)",
    assessment,
    tone: statusTone(assessment.status),
  };
}

function prototypeAssessment(matches: boolean, label: string, explanation: string): UncertaintyAssessment {
  return {
    combined: null,
    status: matches ? "within-limit" : "review",
    label: matches ? "Within method limit" : "Review",
    explanation,
  };
}

function categoricalMetric(id: string, label: string, purpose: string, experiment: string | number, cfd: string | number): MetricAssessment {
  const assessment = exactAssessment(experiment === cfd);
  return {
    id,
    label,
    purpose,
    experiment,
    cfd,
    difference: experiment === cfd ? "No difference" : "Different",
    percentDifference: null,
    unit: "",
    uncertainty: 0,
    uncertaintyLabel: "Exact categorical comparison",
    assessment,
    tone: statusTone(assessment.status),
  };
}

function caseDataQuality(comparisons: Comparison[]) {
  const experiment = comparisons.map((comparison) => comparison.testQuality);
  const cfd = comparisons.map((comparison) => comparison.cfdQuality);
  const findings = [...new Set([...experiment, ...cfd].flatMap((result) => result.findings).filter((finding) => !finding.startsWith("Sampling")))];
  return {
    experiment,
    cfd,
    findings: findings.length ? findings : ["All six traces passed the current sampling, duration, continuity, and clipping checks."],
    status: [...experiment, ...cfd].some((result) => result.status === "Review") ? "Review" as const : "Ready" as const,
  };
}

function probeLayoutReview(positionsDeg: number[]) {
  const normalized = positionsDeg.map((value) => ((value % 360) + 360) % 360).sort((a, b) => a - b);
  const gaps = normalized.map((value, index) => {
    const next = normalized[(index + 1) % normalized.length] + (index === normalized.length - 1 ? 360 : 0);
    return next - value;
  });
  return Math.max(...gaps) - Math.min(...gaps) < 2;
}

function metricById(metrics: MetricAssessment[], id: string) {
  return metrics.find((metric) => metric.id === id);
}

function isMismatch(metric: MetricAssessment | undefined) {
  return metric?.assessment.status === "resolved-mismatch" || metric?.assessment.status === "mismatch" || metric?.assessment.status === "review";
}

function numeric(value: number | string) {
  return typeof value === "number" ? value : Number.NaN;
}

function buildHypotheses(metadata: CaseMetadata, metrics: MetricAssessment[], validity: CaseAssessment["validity"], dataQuality: CaseAssessment["dataQuality"]) {
  const candidates: DiagnosticHypothesis[] = [];
  const frequency = metricById(metrics, "frequency");
  const meanPressure = metricById(metrics, "mean-pressure");
  const peakPressure = metricById(metrics, "peak-pressure");
  const amplitude = metricById(metrics, "amplitude");
  const impulse = metricById(metrics, "impulse");
  const riseTime = metricById(metrics, "rise-time");
  const harmonics = metricById(metrics, "harmonics");
  const variability = metricById(metrics, "cycle-variability");
  const mode = metricById(metrics, "wave-count");

  if (validity.status === "Blocked") {
    candidates.push({
      title: "Case matching or data mapping",
      score: 10,
      evidence: validity.checks.filter((check) => check.status === "Blocked").map((check) => check.detail),
      modelInputs: ["Geometry", "operating point", "probe coordinates", "comparison window"],
    });
  }
  if (dataQuality.status === "Review") {
    candidates.push({
      title: "Acquisition or export quality",
      score: 8,
      evidence: dataQuality.findings,
      modelInputs: ["Sample rate", "record duration", "timestamps", "sensor range"],
    });
  }
  if (isMismatch(peakPressure) && numeric(peakPressure!.cfd) < numeric(peakPressure!.experiment) && numeric(riseTime?.cfd ?? Number.NaN) > numeric(riseTime?.experiment ?? Number.NaN)) {
    candidates.push({
      title: "Spatial resolution or numerical dissipation",
      score: 7 + (Number.isFinite(metadata.meshConvergencePct) && metadata.meshConvergencePct > 2 ? 2 : 0),
      evidence: [
        `CFD peak pressure is ${Math.abs(peakPressure!.percentDifference ?? 0).toFixed(1)}% low.`,
        `CFD pressure rise is ${Math.abs(riseTime?.percentDifference ?? 0).toFixed(1)}% longer.`,
        Number.isFinite(metadata.meshConvergencePct) ? `Latest mesh-change effect is ${metadata.meshConvergencePct.toFixed(1)}%.` : "No mesh-convergence result was supplied.",
      ],
      modelInputs: [`${metadata.minimumCellSizeMm} mm minimum cell`, `${metadata.cellsPerInductionLength} cells/induction length`, metadata.numericalFlux, metadata.limiterFilter],
    });
  }
  if (isMismatch(frequency)) {
    candidates.push({
      title: "Inlet boundary or chemistry timescale",
      score: 6.5,
      evidence: [`Wave-frequency difference is ${Math.abs(frequency!.percentDifference ?? 0).toFixed(1)}% and is ${frequency!.assessment.label.toLowerCase()}.`],
      modelInputs: [metadata.inletBoundaryCondition, `${metadata.inletPressureBar} bar`, `${metadata.inletTemperatureK} K`, `φ ${metadata.equivalenceRatio}`, metadata.chemistryModel],
    });
  }
  if (isMismatch(meanPressure)) {
    candidates.push({
      title: "Inlet/outlet pressure treatment",
      score: 5.5,
      evidence: [`Mean-pressure bias is ${numeric(meanPressure!.difference).toFixed(3)} MPa.`],
      modelInputs: [metadata.inletBoundaryCondition, metadata.outletBoundaryCondition, `${metadata.massFlowKgS} kg/s`],
    });
  }
  if (isMismatch(amplitude) || isMismatch(impulse)) {
    candidates.push({
      title: "Wall-loss or reaction-rate energy release",
      score: 5.7,
      evidence: [
        isMismatch(amplitude) ? `Pressure-amplitude difference is ${Math.abs(amplitude!.percentDifference ?? 0).toFixed(1)}% and exceeds combined uncertainty.` : "Pressure amplitude is not independently resolved.",
        isMismatch(impulse) ? `Wave-passage impulse difference is ${Math.abs(impulse!.percentDifference ?? 0).toFixed(1)}% and exceeds combined uncertainty.` : "Pressure impulse is not independently resolved.",
      ],
      modelInputs: [metadata.wallBoundaryCondition, `${metadata.nearWallCellSizeMm} mm near-wall cell`, metadata.chemistryModel, metadata.chemistryIntegrator],
    });
  }
  if (isMismatch(mode)) {
    candidates.push({
      title: "Initialization or domain-mode sensitivity",
      score: 8.5,
      evidence: [`Experiment and CFD predict different rotating-wave counts.`],
      modelInputs: [metadata.initializationMethod, metadata.dimensionality, `${metadata.meshCells.toLocaleString()} cells`],
    });
  }
  if (isMismatch(harmonics)) {
    candidates.push({
      title: "Shock-capturing scheme or chemistry response",
      score: 5,
      evidence: [`Second-harmonic ratio differs by ${Math.abs(harmonics!.percentDifference ?? 0).toFixed(1)}%.`],
      modelInputs: [metadata.spatialScheme, metadata.numericalFlux, metadata.limiterFilter, metadata.chemistryIntegrator],
    });
  }
  if (isMismatch(variability) && numeric(variability!.cfd) < numeric(variability!.experiment)) {
    candidates.push({
      title: "Missing unsteadiness in the CFD setup",
      score: 4.5,
      evidence: [`CFD cycle variability is lower by ${Math.abs(numeric(variability!.difference)).toFixed(1)} percentage points.`],
      modelInputs: [metadata.turbulenceModel, metadata.combustionModel, metadata.inletBoundaryCondition, metadata.dimensionality],
    });
  }

  if (!candidates.length) {
    candidates.push({
      title: "Validation-envelope coverage",
      score: 1,
      evidence: ["No current comparison is resolved beyond uncertainty or fails an exact mode check."],
      modelInputs: [`${metadata.inletPressureBar} bar`, `${metadata.inletTemperatureK} K`, `φ ${metadata.equivalenceRatio}`],
    });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}

function nextRunFor(hypothesis: DiagnosticHypothesis, metadata: CaseMetadata): ControlledNextRun {
  const common = {
    evidence: hypothesis.evidence,
    evidenceStrength: hypothesis.score >= 8 ? "High" as const : hypothesis.score >= 5 ? "Moderate" as const : "Exploratory" as const,
  };
  if (hypothesis.title === "Case matching or data mapping") return {
    ...common,
    title: "Verify the comparison before changing CFD",
    change: "Re-export one synchronized window after confirming geometry, operating point, probe coordinates, and trigger time.",
    reason: "A model change cannot be interpreted while the experiment/CFD pairing is unconfirmed.",
    holdFixed: ["CFD solution", "signal processing settings"],
    expectedOutcome: "The validity checks pass and the remaining mismatches can be attributed to the paired case.",
    confirmationCriterion: "All case-matching checks pass and every probe has at least five common cycles.",
    rejectionCriterion: "The mismatch persists after the corrected export with the same sign and magnitude.",
    alternativeHypothesis: "If the corrected pairing still disagrees, evaluate spatial resolution next.",
  };
  if (hypothesis.title === "Acquisition or export quality") return {
    ...common,
    title: "Repair the evidence window first",
    change: "Re-export or reacquire the affected traces at a continuous sample rate with at least five complete cycles and no clipping.",
    reason: "The current record can bias peaks, rise time, frequency, or cycle statistics.",
    holdFixed: ["Operating point", "CFD model", "probe coordinates"],
    expectedOutcome: "Data-quality findings clear without altering the physical case.",
    confirmationCriterion: "No gaps or clipping; at least 20 samples per cycle and five captured cycles.",
    rejectionCriterion: "The new record passes quality checks but produces the same resolved mismatch.",
    alternativeHypothesis: "If the mismatch remains, proceed to the highest-ranked CFD hypothesis.",
  };
  if (hypothesis.title === "Spatial resolution or numerical dissipation") return {
    ...common,
    title: "Run one spatial-refinement case",
    change: `Reduce the ${metadata.minimumCellSizeMm.toFixed(3)} mm minimum cell size by 50% in the detonation-front region without changing the flux or limiter.`,
    reason: "Low peaks plus a slower rise are consistent with front smearing, especially without a converged mesh result.",
    holdFixed: ["Chemistry mechanism", "time step and CFL", "boundary conditions", "wall model", "initialization"],
    expectedOutcome: "Peak pressure increases and rise time shortens while frequency and wave count remain approximately unchanged.",
    confirmationCriterion: "Peak and rise-time mismatch both shrink by at least 25%, with frequency changing by less than 2%.",
    rejectionCriterion: "Peak and rise time change by less than 5% after refinement.",
    alternativeHypothesis: "If refinement has little effect, test chemistry integration or wall-loss treatment next.",
  };
  if (hypothesis.title === "Initialization or domain-mode sensitivity") return {
    ...common,
    title: "Run an initialization-sensitivity case",
    change: `Repeat the case with a second physically defensible ignition pattern while keeping ${metadata.dimensionality || "the current dimensionality"}.`,
    reason: "Wave-count disagreement can reflect the selected attractor rather than steady operating conditions alone.",
    holdFixed: ["Mesh", "time step", "chemistry", "boundary conditions", "wall model"],
    expectedOutcome: "The CFD either reaches the experimental mode or demonstrates persistent mode-selection disagreement.",
    confirmationCriterion: "The alternate initialization reaches the experimental wave count and direction for the final five cycles.",
    rejectionCriterion: "Both initializations converge to the same nonexperimental mode.",
    alternativeHypothesis: "If mode selection is persistent, investigate domain dimensionality and inlet-plenum treatment.",
  };
  if (hypothesis.title === "Inlet boundary or chemistry timescale") return {
    ...common,
    title: "Run one inlet-condition sensitivity case",
    change: "Perturb inlet temperature by the measured uncertainty bound while keeping mass flow and equivalence ratio fixed.",
    reason: "Wave-frequency disagreement points first to the supplied flow/ignition timescale, but the test must isolate one variable.",
    holdFixed: ["Mesh", "time step", "chemistry", "wall model", "initialization", "mass flow", "equivalence ratio"],
    expectedOutcome: "Frequency moves toward the experiment without materially changing the inferred wave mode.",
    confirmationCriterion: "Frequency mismatch shrinks by at least 25% and wave count is unchanged.",
    rejectionCriterion: "Frequency changes by less than 1% or moves farther from the experiment.",
    alternativeHypothesis: "If inlet sensitivity is weak, test ignition-delay sensitivity in the chemical mechanism.",
  };
  if (hypothesis.title === "Inlet/outlet pressure treatment") return {
    ...common,
    title: "Run one boundary-condition sensitivity case",
    change: "Change only the outlet/back-pressure treatment to the next physically defensible formulation.",
    reason: "A resolved mean-pressure bias can arise from how mass and pressure are closed at the domain boundaries.",
    holdFixed: ["Mesh", "time step", "chemistry", "inlet state", "wall model", "initialization"],
    expectedOutcome: "Mean pressure moves toward experiment while wave frequency remains stable.",
    confirmationCriterion: "Mean-pressure bias shrinks by at least 25% with frequency changing by less than 2%.",
    rejectionCriterion: "Mean pressure changes by less than the combined uncertainty.",
    alternativeHypothesis: "If boundary sensitivity is weak, examine wall heat-loss treatment.",
  };
  if (hypothesis.title === "Shock-capturing scheme or chemistry response") return {
    ...common,
    title: "Run one numerical-dissipation sensitivity case",
    change: `Use the next less-dissipative verified flux/limiter option instead of ${metadata.numericalFlux || "the current scheme"}.`,
    reason: "Harmonic structure is sensitive to how sharp fronts and secondary pressure features are preserved.",
    holdFixed: ["Mesh", "time step", "chemistry", "boundaries", "wall model", "initialization"],
    expectedOutcome: "Harmonic ratio and waveform correlation improve without changing the dominant mode.",
    confirmationCriterion: "Harmonic mismatch shrinks by at least 25% and wave count remains fixed.",
    rejectionCriterion: "Harmonics change by less than 5% or spurious oscillations appear.",
    alternativeHypothesis: "If scheme sensitivity is weak, test chemistry integration accuracy.",
  };
  if (hypothesis.title === "Wall-loss or reaction-rate energy release") return {
    ...common,
    title: "Run one wall-loss sensitivity case",
    change: `Bracket the current wall treatment (${metadata.wallBoundaryCondition}) with one physically defensible adjacent thermal condition.`,
    reason: "Resolved amplitude or impulse disagreement indicates a pressure-energy difference while the dominant wave mode may still agree.",
    holdFixed: ["Mesh", "time step", "chemistry", "inlet/outlet conditions", "initialization", "numerical flux"],
    expectedOutcome: "Pressure amplitude and impulse move together toward the experiment without shifting wave frequency or count.",
    confirmationCriterion: "Both amplitude and impulse mismatch shrink by at least 25%, with frequency changing by less than 2%.",
    rejectionCriterion: "Amplitude and impulse change by less than their combined uncertainty.",
    alternativeHypothesis: "If wall-loss sensitivity is weak, test chemistry integration or front resolution next.",
  };
  if (hypothesis.title === "Missing unsteadiness in the CFD setup") return {
    ...common,
    title: "Run one inlet-unsteadiness sensitivity case",
    change: "Add a bounded inlet fluctuation matching the measured facility variability.",
    reason: "The CFD is more repeatable cycle-to-cycle than the experiment.",
    holdFixed: ["Mean inlet state", "mesh", "time step", "chemistry", "walls", "initialization"],
    expectedOutcome: "Cycle variability approaches the experiment without shifting the mean mode.",
    confirmationCriterion: "Variability difference shrinks by at least 25% and mean frequency changes by less than 2%.",
    rejectionCriterion: "Variability remains unchanged or the mean operating point shifts outside uncertainty.",
    alternativeHypothesis: "If inlet fluctuations do not matter, examine turbulence/combustion coupling and 3D effects.",
  };
  return {
    ...common,
    title: "Add the nearest unvalidated operating point",
    change: "Run and test the nearest operating condition in equivalence ratio while keeping the hardware and numerical method fixed.",
    reason: "The current case does not expose a resolved mismatch; the next value is broader validation coverage.",
    holdFixed: ["Geometry", "mesh strategy", "time step strategy", "chemistry", "boundary formulation", "diagnostic locations"],
    expectedOutcome: "The demonstrated agreement envelope expands by one controlled condition.",
    confirmationCriterion: "The new case passes validity/data-quality checks and reports uncertainty-aware comparisons.",
    rejectionCriterion: "The new case reveals a resolved mismatch, which becomes the next diagnostic target.",
    alternativeHypothesis: "Repeat the current case to quantify repeatability before expanding the envelope.",
  };
}

export function buildCaseAssessment(
  metadata: CaseMetadata,
  comparisons: Comparison[],
  testMode: RdeModeResult,
  cfdMode: RdeModeResult,
): CaseAssessment {
  const durationTest = average(comparisons.map((comparison) => comparison.testQuality.durationMs));
  const durationCfd = average(comparisons.map((comparison) => comparison.cfdQuality.durationMs));
  const frequencyDifference = cfdMode.waveFrequencyKHz - testMode.waveFrequencyKHz;
  const testFrequencyUncertainty = frequencyUncertaintyKHz(testMode.waveFrequencyKHz, durationTest, metadata.timingUncertaintyUs);
  const cfdFrequencyUncertainty = frequencyUncertaintyKHz(cfdMode.waveFrequencyKHz, durationCfd, metadata.cfdTimingUncertaintyUs);
  const frequencyAssessment = assessResolvedDifference(frequencyDifference, testFrequencyUncertainty, cfdFrequencyUncertainty);
  const frequencyMetric: MetricAssessment = {
    id: "frequency",
    label: "Wave frequency",
    purpose: "Rotational event rate",
    experiment: testMode.waveFrequencyKHz,
    cfd: cfdMode.waveFrequencyKHz,
    difference: frequencyDifference,
    percentDifference: 100 * frequencyDifference / Math.max(testMode.waveFrequencyKHz, 1e-12),
    unit: "kHz",
    uncertainty: frequencyAssessment.combined,
    uncertaintyLabel: "Timing + finite-record spectral uncertainty (RSS, k=1)",
    assessment: frequencyAssessment,
    tone: statusTone(frequencyAssessment.status),
  };

  const speedDifference = cfdMode.waveSpeedMps - testMode.waveSpeedMps;
  const testSpeedUncertainty = testMode.waveSpeedMps * testFrequencyUncertainty / Math.max(testMode.waveFrequencyKHz, 1e-12);
  const cfdSpeedUncertainty = cfdMode.waveSpeedMps * cfdFrequencyUncertainty / Math.max(cfdMode.waveFrequencyKHz, 1e-12);
  const speedAssessment = assessResolvedDifference(speedDifference, testSpeedUncertainty, cfdSpeedUncertainty);
  const speedMetric: MetricAssessment = {
    id: "speed",
    label: "Wave speed",
    purpose: "Circumferential propagation",
    experiment: testMode.waveSpeedMps,
    cfd: cfdMode.waveSpeedMps,
    difference: speedDifference,
    percentDifference: 100 * speedDifference / Math.max(testMode.waveSpeedMps, 1e-12),
    unit: "m/s",
    uncertainty: speedAssessment.combined,
    uncertaintyLabel: "Frequency contribution only; geometry uncertainty not supplied",
    assessment: speedAssessment,
    tone: statusTone(speedAssessment.status),
  };

  const amplitude = resolvedPressureMetric({ id: "amplitude", label: "Pressure amplitude", purpose: "Mean oscillation amplitude", unit: "MPa", test: pressureMetric(comparisons, "oscillationAmplitude", "test"), cfd: pressureMetric(comparisons, "oscillationAmplitude", "cfd"), metadata });
  const peak = resolvedPressureMetric({ id: "peak-pressure", label: "Cycle peak pressure", purpose: "Mean peak across detected cycles", unit: "MPa", test: pressureMetric(comparisons, "peakPressure", "test"), cfd: pressureMetric(comparisons, "peakPressure", "cfd"), metadata });
  const meanPressure = resolvedPressureMetric({ id: "mean-pressure", label: "Mean pressure", purpose: "Average chamber pressure at probes", unit: "MPa", test: pressureMetric(comparisons, "meanPressure", "test"), cfd: pressureMetric(comparisons, "meanPressure", "cfd"), metadata });
  const impulse = resolvedPressureMetric({ id: "impulse", label: "Pressure impulse", purpose: "Positive pressure area per wave passage", unit: "MPa·ms", test: pressureMetric(comparisons, "impulsePerCycleMpaMs", "test"), cfd: pressureMetric(comparisons, "impulsePerCycleMpaMs", "cfd"), metadata, includeTiming: true, testFrequencyKHz: testMode.waveFrequencyKHz, cfdFrequencyKHz: cfdMode.waveFrequencyKHz });

  const testRise = pressureMetric(comparisons, "riseTimeUs", "test");
  const cfdRise = pressureMetric(comparisons, "riseTimeUs", "cfd");
  const riseDifference = cfdRise - testRise;
  const riseAssessment = assessResolvedDifference(riseDifference, metadata.timingUncertaintyUs, metadata.cfdTimingUncertaintyUs);
  const rise: MetricAssessment = {
    id: "rise-time", label: "10–90% rise time", purpose: "Detonation-front sharpness", experiment: testRise, cfd: cfdRise, difference: riseDifference,
    percentDifference: 100 * riseDifference / Math.max(Math.abs(testRise), 1e-12), unit: "µs", uncertainty: riseAssessment.combined,
    uncertaintyLabel: "Combined experiment + CFD timing uncertainty (RSS, k=1)", assessment: riseAssessment, tone: statusTone(riseAssessment.status),
  };

  const testHarmonics = pressureMetric(comparisons, "secondHarmonicRatio", "test");
  const cfdHarmonics = pressureMetric(comparisons, "secondHarmonicRatio", "cfd");
  const harmonicDifference = cfdHarmonics - testHarmonics;
  const harmonicPercent = 100 * harmonicDifference / Math.max(Math.abs(testHarmonics), 1e-12);
  const harmonicWithin = Math.abs(harmonicPercent) <= 100 * REVIEW_THRESHOLDS.maximumHarmonicRatioError;
  const harmonicAssessment = prototypeAssessment(harmonicWithin, "±30% method limit", "No spectral-estimator uncertainty is available yet; this uses an explicit prototype review limit.");
  const harmonics: MetricAssessment = {
    id: "harmonics", label: "Second-harmonic ratio", purpose: "Secondary waveform structure", experiment: testHarmonics, cfd: cfdHarmonics, difference: harmonicDifference,
    percentDifference: harmonicPercent, unit: "", uncertainty: null, uncertaintyLabel: "Prototype ±30% method limit", assessment: harmonicAssessment, tone: statusTone(harmonicAssessment.status),
  };

  const testVariability = pressureMetric(comparisons, "cycleVariabilityPct", "test");
  const cfdVariability = pressureMetric(comparisons, "cycleVariabilityPct", "cfd");
  const variabilityDifference = cfdVariability - testVariability;
  const variabilityWithin = Math.abs(variabilityDifference) <= REVIEW_THRESHOLDS.maximumCycleVariabilityDifferencePct;
  const variabilityAssessment = prototypeAssessment(variabilityWithin, "±10 percentage-point method limit", "Repeatability uncertainty is not supplied; this uses a prototype review limit.");
  const variability: MetricAssessment = {
    id: "cycle-variability", label: "Cycle variability", purpose: "Cycle-to-cycle pressure-range variation", experiment: testVariability, cfd: cfdVariability, difference: variabilityDifference,
    percentDifference: null, unit: "%", uncertainty: null, uncertaintyLabel: "Prototype ±10 percentage-point method limit", assessment: variabilityAssessment, tone: statusTone(variabilityAssessment.status),
  };

  const metrics = [
    frequencyMetric,
    speedMetric,
    categoricalMetric("wave-count", "Wave count", "Number of rotating waves", testMode.waveCount, cfdMode.waveCount),
    categoricalMetric("direction", "Direction", "Direction of rotation", testMode.direction, cfdMode.direction),
    categoricalMetric("stability", "Mode stability", "Classification over the analysis window", testMode.stability, cfdMode.stability),
    amplitude,
    peak,
    meanPressure,
    impulse,
    rise,
    harmonics,
    variability,
  ];

  const dataQuality = caseDataQuality(comparisons);
  const matchCheck: ValidityCheck = metadata.comparisonMatchConfirmed
    ? { label: "Matched physical case", status: "Pass", detail: "The user confirmed matching geometry, operating point, probe coordinates, and comparison window." }
    : { label: "Matched physical case", status: "Blocked", detail: "Matching geometry, operating point, probe coordinates, and comparison window have not been confirmed." };
  const layoutRisk = probeLayoutReview(metadata.probePositionsDeg);
  const checks: ValidityCheck[] = [
    matchCheck,
    { label: "Probe layout", status: layoutRisk ? "Review" : "Pass", detail: layoutRisk ? "Equally spaced probes can alias some wave-count/direction combinations." : "Nonuniform circumferential spacing reduces common mode aliases." },
    { label: "Common evidence window", status: dataQuality.status === "Ready" ? "Pass" : "Review", detail: dataQuality.status === "Ready" ? "All traces provide a continuous, usable comparison window." : "At least one trace has a sampling, duration, continuity, or clipping finding." },
    { label: "Mode identifiability", status: Math.min(testMode.modeConfidence, cfdMode.modeConfidence) >= 0.6 ? "Pass" : "Review", detail: `Experiment confidence ${testMode.modeConfidence.toFixed(2)}; CFD confidence ${cfdMode.modeConfidence.toFixed(2)}.` },
  ];
  const validity = {
    checks,
    status: checks.some((check) => check.status === "Blocked") ? "Blocked" as const : checks.some((check) => check.status === "Review") ? "Review" as const : "Valid" as const,
  };
  const coverage: CoverageItem[] = [
    { module: "Wave dynamics", status: "Assessed", detail: "Frequency, speed, count, direction, stability, and mode confidence" },
    { module: "Pressure", status: "Assessed", detail: "Amplitude, peaks, mean, impulse, rise time, harmonics, and cycle variability" },
    { module: "Uncertainty", status: metrics.some((metric) => metric.assessment.status === "inconclusive") ? "Inconclusive" : "Assessed", detail: "Experiment and CFD pressure/timing inputs propagated where supported" },
    { module: "Thermal", status: "Not assessed", detail: "No temperature or heat-flux data loaded" },
    { module: "Performance", status: "Not assessed", detail: "No thrust or total-pressure data loaded" },
  ];
  const hypotheses = buildHypotheses(metadata, metrics, validity, dataQuality);
  return { validity, dataQuality, metrics, coverage, hypotheses, nextRun: nextRunFor(hypotheses[0], metadata) };
}
