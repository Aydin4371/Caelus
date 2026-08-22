export type PublishedScalarMeasurement = {
  id: string;
  label: string;
  location: string;
  experiment: number;
  cfd: number;
  unit: string;
};

export type PublishedPairedSource = {
  id: "tobias-agrawal-paxson-2022" | "strakey-bedick-ferguson-2021";
  title: string;
  authors: string;
  year: number;
  url: string;
  provenance: string;
  limitation: string;
};

export const PUBLISHED_PAIRED_SOURCES: Record<PublishedPairedSource["id"], PublishedPairedSource> = {
  "tobias-agrawal-paxson-2022": {
    id: "tobias-agrawal-paxson-2022",
    title: "Experimental and Computational Analysis of a Rotating Detonation Combustor",
    authors: "Jonathan R. Tobias; Ajay K. Agrawal; Daniel E. Paxson",
    year: 2022,
    url: "https://ntrs.nasa.gov/api/citations/20210024138/downloads/AIAA_SciTech_2022_UA_Tobias_final.pdf",
    provenance: "Values transcribed from the Case A results text and Figure 4 discussion on pages 5–6 of the NASA-hosted author manuscript.",
    limitation: "The public paper provides printed scalar values and plotted traces, not downloadable matched pressure arrays. These values validate comparison arithmetic only.",
  },
  "strakey-bedick-ferguson-2021": {
    id: "strakey-bedick-ferguson-2021",
    title: "Computational Fluid Dynamics Combustion Modeling for Rotating Detonation Engines",
    authors: "Peter A. Strakey; Clinton R. Bedick; Donald H. Ferguson",
    year: 2021,
    url: "https://www.osti.gov/servlets/purl/1765177",
    provenance: "Values transcribed from the 0.5 mm combustion-model comparison in the Results and Discussion section of the OSTI-hosted manuscript.",
    limitation: "This is a retrospective one-factor result from the same publication used to interpret it. It is not a blind or prospective recommendation test.",
  },
};

/**
 * Source values only. Calculated errors and outcome labels are deliberately not
 * stored here so the product and tests must derive them at runtime.
 */
export const TOBIAS_CASE_A_INPUT = {
  sourceId: "tobias-agrawal-paxson-2022" as const,
  caseId: "case-a-high-flowrate",
  measurements: [
    { id: "wave-frequency", label: "Wave frequency", location: "RDC annulus", experiment: 6.4, cfd: 6.6, unit: "kHz" },
    { id: "static-pressure-ctap-1", label: "Static pressure", location: "CTAP 1, z = 22.3 mm", experiment: 425, cfd: 400, unit: "kPa" },
    { id: "static-pressure-ctap-3", label: "Static pressure", location: "CTAP 3, z = 92 mm", experiment: 380, cfd: 380, unit: "kPa" },
  ] satisfies PublishedScalarMeasurement[],
};

export const STRAKEY_COMBUSTION_INPUT = {
  sourceId: "strakey-bedick-ferguson-2021" as const,
  caseId: "afrl-netl-phi-1-atmospheric-0.5-mm",
  changedVariable: "turbulence–chemistry interaction model",
  experiment: { waveCount: 1, waveSpeedMps: 1740 },
  baselineCfd: { label: "No turbulence–chemistry interaction", waveCount: 2, waveSpeedMps: 1790 },
  rerunCfd: { label: "PaSR combustion model", waveCount: 1, waveSpeedMps: 1844 },
};

export function signedPercentDifference(experiment: number, cfd: number) {
  if (![experiment, cfd].every(Number.isFinite) || experiment === 0) throw new Error("A finite, non-zero experiment value and finite CFD value are required.");
  return 100 * (cfd - experiment) / Math.abs(experiment);
}

export function evaluatePublishedPairedComparison(measurements: PublishedScalarMeasurement[]) {
  if (!measurements.length) throw new Error("At least one published paired measurement is required.");
  const metrics = measurements.map((measurement) => ({
    ...measurement,
    difference: measurement.cfd - measurement.experiment,
    percentDifference: signedPercentDifference(measurement.experiment, measurement.cfd),
  }));
  return {
    metrics,
    maximumAbsolutePercentDifference: Math.max(...metrics.map((metric) => Math.abs(metric.percentDifference))),
  };
}

export function evaluatePublishedControlledRerun(input = STRAKEY_COMBUSTION_INPUT) {
  const baselineWaveCountError = Math.abs(input.baselineCfd.waveCount - input.experiment.waveCount);
  const rerunWaveCountError = Math.abs(input.rerunCfd.waveCount - input.experiment.waveCount);
  const baselineWaveSpeedErrorPct = Math.abs(signedPercentDifference(input.experiment.waveSpeedMps, input.baselineCfd.waveSpeedMps));
  const rerunWaveSpeedErrorPct = Math.abs(signedPercentDifference(input.experiment.waveSpeedMps, input.rerunCfd.waveSpeedMps));
  const waveCountImproved = rerunWaveCountError < baselineWaveCountError;
  const waveSpeedImproved = rerunWaveSpeedErrorPct < baselineWaveSpeedErrorPct;
  const improvements = [waveCountImproved, waveSpeedImproved].filter(Boolean).length;

  return {
    baselineWaveCountError,
    rerunWaveCountError,
    baselineWaveSpeedErrorPct,
    rerunWaveSpeedErrorPct,
    waveSpeedErrorChangePctPoints: rerunWaveSpeedErrorPct - baselineWaveSpeedErrorPct,
    waveCountImproved,
    waveSpeedImproved,
    classification: improvements === 2 ? "Improved both published checks" as const
      : improvements === 0 ? "Improved neither published check" as const
        : "Mixed result" as const,
  };
}

export const TOBIAS_CASE_A_RESULT = evaluatePublishedPairedComparison(TOBIAS_CASE_A_INPUT.measurements);
export const STRAKEY_COMBUSTION_RESULT = evaluatePublishedControlledRerun();

