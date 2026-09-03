import type { EngineDesign, OperatingPoint } from "./design-workspace.ts";

export const GE_2022_SOURCE = {
  title: "Experimental Research of Two-phase Rotating Detonation Combustor Operating with High Total Temperature Air",
  authors: "G. Ge, Y. Ma, Z. Xia, H. Ma, L. Deng, and C. Zhou",
  year: 2022,
  url: "https://www.jafmonline.net/article_2078_f410588e48dc83f2822a880a68f78923.pdf",
  doi: "https://doi.org/10.47176/jafm.15.05.33591",
  locator: "Table 1, pp. 1440–1441",
} as const;

export const GE_2022_DESIGN_ID = "published-ge-2022-gasoline-air";

export const GE_2022_DESIGN: EngineDesign = {
  id: GE_2022_DESIGN_ID,
  name: "Ge et al. gasoline–air RDE (2022)",
  source: "published",
  application: "Air-breathing",
  fuel: "Gasoline",
  oxidizer: "High-total-temperature air; oxygen mass fraction restored after the heater",
  annulusInnerDiameterMm: 166,
  annulusOuterDiameterMm: 204,
  chamberLengthMm: 155,
  injectorType: "Laval-like air slit + 36 gasoline nozzles",
  injectorCount: 36,
  injectorDiameterMm: Number.NaN,
  injectorAngleDeg: Number.NaN,
  plenumVolumeCm3: Number.NaN,
  wallCondition: "As tested; wall thermal condition not tabulated",
  exhaustConfiguration: "Open exit at 1 atm",
  equivalenceRatioMin: 0.53,
  equivalenceRatioMax: 1.25,
  massFlowKgSMin: 1.1484,
  massFlowKgSMax: 1.2006,
  inletPressureBarMin: Number.NaN,
  inletPressureBarMax: Number.NaN,
  inletTemperatureK: 713,
  backPressureBar: 1.01325,
};

type PublishedRow = {
  caseNumber: number;
  equivalenceRatio: number;
  inletTemperatureK: number;
  airMassFlowKgS: number;
  fuelMassFlowKgS: number;
  frequencyKHz: number;
  reportedMode: string;
  waveCount: number | null;
};

// Direct transcription of the 13 unique operating conditions in Table 1.
// Case 14 repeats Case 10's condition for a longer-duration test, so it is not
// added as a second envelope marker at identical coordinates.
export const GE_2022_ROWS: PublishedRow[] = [
  { caseNumber: 1, equivalenceRatio: 1.19, inletTemperatureK: 483, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0857, frequencyKHz: Number.NaN, reportedMode: "Failure", waveCount: null },
  { caseNumber: 2, equivalenceRatio: 1.19, inletTemperatureK: 573, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0857, frequencyKHz: 1.6724, reportedMode: "Intermittent detonation", waveCount: 1 },
  { caseNumber: 3, equivalenceRatio: 1.19, inletTemperatureK: 643, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0857, frequencyKHz: 1.7822, reportedMode: "Single wave", waveCount: 1 },
  { caseNumber: 4, equivalenceRatio: 1.19, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0857, frequencyKHz: 1.9009, reportedMode: "Single wave", waveCount: 1 },
  { caseNumber: 5, equivalenceRatio: 1.19, inletTemperatureK: 793, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0857, frequencyKHz: 1.8355, reportedMode: "Double-wave collision / single wave", waveCount: null },
  { caseNumber: 6, equivalenceRatio: 0.53, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0384, frequencyKHz: Number.NaN, reportedMode: "Failure", waveCount: null },
  { caseNumber: 7, equivalenceRatio: 0.61, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0442, frequencyKHz: 1.4520, reportedMode: "Sporadic detonation", waveCount: null },
  { caseNumber: 8, equivalenceRatio: 0.66, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0479, frequencyKHz: 1.5217, reportedMode: "Intermittent detonation", waveCount: null },
  { caseNumber: 9, equivalenceRatio: 0.79, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0573, frequencyKHz: 1.6137, reportedMode: "Double-wave collision / single wave", waveCount: null },
  { caseNumber: 10, equivalenceRatio: 0.84, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0624, frequencyKHz: 1.8182, reportedMode: "Double-wave collision / single wave", waveCount: null },
  { caseNumber: 11, equivalenceRatio: 0.97, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0703, frequencyKHz: 1.8273, reportedMode: "Double-wave collision / single wave", waveCount: null },
  { caseNumber: 12, equivalenceRatio: 1.06, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0763, frequencyKHz: 1.8491, reportedMode: "Single wave", waveCount: 1 },
  { caseNumber: 13, equivalenceRatio: 1.25, inletTemperatureK: 713, airMassFlowKgS: 1.1100, fuelMassFlowKgS: 0.0906, frequencyKHz: 1.8784, reportedMode: "Single wave", waveCount: 1 },
];

export function buildGe2022OperatingPoints(): OperatingPoint[] {
  return GE_2022_ROWS.map((row) => ({
    id: `${GE_2022_DESIGN_ID}-case-${row.caseNumber}`,
    designId: GE_2022_DESIGN_ID,
    name: `Published test #${row.caseNumber}`,
    source: "published",
    inletPressureBar: Number.NaN,
    inletTemperatureK: row.inletTemperatureK,
    equivalenceRatio: row.equivalenceRatio,
    massFlowKgS: row.airMassFlowKgS + row.fuelMassFlowKgS,
    backPressureBar: 1.01325,
    publishedObservation: {
      sourceTitle: GE_2022_SOURCE.title,
      sourceUrl: GE_2022_SOURCE.url,
      sourceLocator: row.caseNumber === 10
        ? `${GE_2022_SOURCE.locator}, Case #10; long-duration repeat Case #14 in Sec. 3.5 and Figs. 23–25`
        : `${GE_2022_SOURCE.locator}, Case #${row.caseNumber}`,
      reportedMode: row.reportedMode,
      waveCount: row.waveCount,
      waveFrequencyKHz: row.frequencyKHz,
      airMassFlowKgS: row.airMassFlowKgS,
      fuelMassFlowKgS: row.fuelMassFlowKgS,
      waveSpeedMps: row.waveCount && Number.isFinite(row.frequencyKHz)
        ? Math.PI * 0.185 * row.frequencyKHz * 1000 / row.waveCount
        : null,
      physics: row.caseNumber === 10 ? { sustainedDurationS: 3.13146 } : null,
      evidenceNotes: row.caseNumber === 10 ? {
        feed: "The Case 14 repeat at this same condition includes qualitative fuel-plenum and chamber pressure histories; no tabulated backflow fraction is reported.",
        repeatability: "Case 14 repeated this condition for 3.13146 s with an average reported wave frequency of about 1.9223 kHz.",
      } : undefined,
      limitation: "The paper reports operating conditions, dominant frequency, and propagation mode, but does not provide the underlying synchronized pressure files or a tabulated plenum pressure for this point.",
    },
  }));
}

export const GE_2022_CLASSIFICATION_NOTE = "Kythros maps the paper's reported single-wave mode to Stable, intermittent/sporadic/mixed propagation to Transitional, and failure to Unstable. These labels are a transparent display mapping of the authors' reported modes, not a reanalysis of raw signals.";
