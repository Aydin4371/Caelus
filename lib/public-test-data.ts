export type PublicEvidenceLevel = "raw-array" | "tabulated-values" | "campaign-range" | "qualitative-spatial";

export type PublicThermalEvidence = {
  id: string;
  sourceTitle: string;
  authors: string;
  year: number;
  sourceUrl: string;
  locator: string;
  propellants: string;
  configuration: string;
  evidenceLevel: Extract<PublicEvidenceLevel, "campaign-range" | "qualitative-spatial">;
  heatFluxRangeMWm2: readonly [number, number] | null;
  measurementLocations: number | null;
  reportedCoverage: string;
  reusableAsMap: false;
  limitation: string;
};

/**
 * Source-backed thermal evidence available publicly as of the cited release.
 * None of these records is converted into a surface map unless numerical
 * axial/circumferential samples are actually released.
 */
export const PUBLIC_THERMAL_EVIDENCE: PublicThermalEvidence[] = [
  {
    id: "lim-2019-rp2-gox",
    sourceTitle: "Experimental Studies of Liquid Injector Response and Wall Heat Flux in a Rotating Detonation Rocket Engine",
    authors: "Dasheng Lim",
    year: 2019,
    sourceUrl: "https://doi.org/10.25394/PGS.11113250",
    locator: "Dissertation abstract and wall-heat-flux chapter",
    propellants: "RP-2 / gaseous oxygen",
    configuration: "Annular RDRE; 36 embedded thermocouples",
    evidenceLevel: "campaign-range",
    heatFluxRangeMWm2: [2.8, 8.3],
    measurementLocations: 36,
    reportedCoverage: "Outer-wall inverse-heat-transfer estimate over the reported campaign",
    reusableAsMap: false,
    limitation: "The public landing record reports the campaign range, but not a machine-readable axial-angle-value array. The range can benchmark scale, not reconstruct a wall field.",
  },
  {
    id: "nasa-2025-straight-annulus",
    sourceTitle: "Calorimeter Heat Flux Trends in Rotating Detonation Rocket Engines",
    authors: "NASA Glenn Research Center team",
    year: 2025,
    sourceUrl: "https://ntrs.nasa.gov/api/citations/20240015605/downloads/AIAA_SciTech_2025_Calorimeter_final.pdf",
    locator: "Straight-annulus calorimeter configuration",
    propellants: "Gaseous oxygen / gaseous hydrogen",
    configuration: "Straight annulus; spatial calorimeter stations",
    evidenceLevel: "campaign-range",
    heatFluxRangeMWm2: [5, 12],
    measurementLocations: 13,
    reportedCoverage: "Average heat-flux trend at 13 axial locations",
    reusableAsMap: false,
    limitation: "The reported configuration range is retained as a range. Without the numerical station table, Kythros does not assign those values to individual locations.",
  },
  {
    id: "nasa-2025-constricted-annulus",
    sourceTitle: "Calorimeter Heat Flux Trends in Rotating Detonation Rocket Engines",
    authors: "NASA Glenn Research Center team",
    year: 2025,
    sourceUrl: "https://ntrs.nasa.gov/api/citations/20240015605/downloads/AIAA_SciTech_2025_Calorimeter_final.pdf",
    locator: "Constricted-annulus calorimeter configuration",
    propellants: "Gaseous oxygen / gaseous hydrogen",
    configuration: "Constricted annulus; spatial calorimeter stations",
    evidenceLevel: "campaign-range",
    heatFluxRangeMWm2: [6, 18],
    measurementLocations: 9,
    reportedCoverage: "Average heat-flux trend at 9 axial locations",
    reusableAsMap: false,
    limitation: "The reported configuration range is retained as a range. It is not a pointwise field and is never painted onto the Kythros engine schematic.",
  },
  {
    id: "shi-2023-rp3-ir",
    sourceTitle: "Experimental study on wall temperature and heat flux of a rotating detonation combustor",
    authors: "Shi et al.",
    year: 2023,
    sourceUrl: "https://arxiv.org/pdf/2306.01390",
    locator: "Sections 2–4 and infrared wall-temperature figures",
    propellants: "RP-3 kerosene / oxygen-enriched air",
    configuration: "145 mm chamber; 74° infrared measurement sector; φ 0.44, 0.55 and 0.64",
    evidenceLevel: "qualitative-spatial",
    heatFluxRangeMWm2: null,
    measurementLocations: null,
    reportedCoverage: "Infrared wall temperature plus inverse heat-transfer analysis over a documented sector",
    reusableAsMap: false,
    limitation: "The paper publishes plotted spatial distributions and qualitative trends, but no machine-readable temperature or heat-flux array. Kythros records coverage and operating conditions without digitizing colors into invented samples.",
  },
  {
    id: "h2-air-2024-thermocouples",
    sourceTitle: "Heat transfer characteristics of H2-air rotating detonation combustor",
    authors: "Experimental H2-air study team",
    year: 2024,
    sourceUrl: "https://doi.org/10.1063/5.0179717",
    locator: "Experimental wall-temperature and heat-flux trends",
    propellants: "Hydrogen / air",
    configuration: "Thermocouple measurements; equivalence ratio 0.8–1.3",
    evidenceLevel: "qualitative-spatial",
    heatFluxRangeMWm2: null,
    measurementLocations: null,
    reportedCoverage: "Axial wall-temperature and heat-flux trends across equivalence-ratio and mass-flow sweeps",
    reusableAsMap: false,
    limitation: "The source supports the direction and shape of reported trends. Exact numerical samples are not entered when they are unavailable from a table or released data file.",
  },
];

export const PUBLIC_DATA_DOWNLOADS = [
  { label: "Ge et al. operating-point table", href: "/data/ge-2022-operating-points.csv", evidence: "13 tabulated experimental conditions" },
  { label: "Public thermal evidence ledger", href: "/data/public-thermal-evidence.csv", evidence: `${PUBLIC_THERMAL_EVIDENCE.length} source/configuration records` },
  { label: "Oexle–Bohon BD0041 pressure fixture", href: "/data/zenodo-bd0041.json", evidence: "4,096 samples per pressure channel" },
  { label: "Oexle–Bohon BD0038 pressure fixture", href: "/data/zenodo-bd0038.json", evidence: "4,096 samples per pressure channel" },
  { label: "Oexle–Bohon CE2029 pressure fixture", href: "/data/zenodo-ce2029.json", evidence: "4,096 samples per pressure channel" },
] as const;
