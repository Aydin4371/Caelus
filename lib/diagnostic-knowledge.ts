export const KNOWLEDGE_BASE_VERSION = "2026.08.3";

export type DiagnosticCauseId =
  | "case-validity"
  | "data-quality"
  | "spatial-resolution"
  | "chemistry-timescale"
  | "inlet-boundary"
  | "wall-loss"
  | "initialization-mode"
  | "missing-unsteadiness"
  | "validation-coverage";

export type DiagnosticSource = {
  id: string;
  authors: string;
  year: number;
  title: string;
  publication: string;
  doi: string;
  url: string;
  configuration: string;
  finding: string;
  limitation: string;
  reviewedAt: string;
};

export type DiagnosticResearchClaim = {
  statement: string;
  sourceIds: string[];
  boundary: string;
};

export const DIAGNOSTIC_SOURCES: DiagnosticSource[] = [
  {
    id: "strakey-ferguson-2022",
    authors: "Strakey, P. A.; Ferguson, D. H.",
    year: 2022,
    title: "Validation of a Computational Fluid Dynamics Model of a Methane-Oxygen Rotating Detonation Engine",
    publication: "AIAA SCITECH 2022 Forum, AIAA 2022-1113",
    doi: "10.2514/6.2022-1113",
    url: "https://doi.org/10.2514/6.2022-1113",
    configuration: "ANSYS Fluent LES of the AFRL methane–oxygen rocket RDE, using pressure- and density-based solvers, skeletal chemistry, mesh-resolution variation, and wall-heat-loss variation.",
    finding: "The study varied mesh resolution and wall heat loss, then compared CFD with experiment for wave count, wave speed, thrust, and mean annulus wall pressure.",
    limitation: "This source establishes relevant sensitivities and comparison quantities for one AFRL configuration; it does not provide a universal mesh or wall-loss threshold.",
    reviewedAt: "2026-08-09",
  },
  {
    id: "tobias-agrawal-paxson-2022",
    authors: "Tobias, J. R.; Agrawal, A. K.; Paxson, D. E.",
    year: 2022,
    title: "Experimental and Computational Analysis of a Rotating Detonation Combustor",
    publication: "AIAA SCITECH 2022 Forum, AIAA 2022-1879",
    doi: "10.2514/6.2022-1879",
    url: "https://doi.org/10.2514/6.2022-1879",
    configuration: "Quasi-two-dimensional CFD of an annular RDC compared with dynamic pressure, static-pressure distribution, detonation speed, and 100 kHz PIV at the annulus exit.",
    finding: "The authors reported good experiment–CFD agreement for dynamic pressure, Chapman–Jouguet speed, static-pressure distribution, and time-resolved exit velocity, including shock-passage spikes.",
    limitation: "This is a validation example for its tested combustor and model; it supports multi-observable comparison but does not identify a universal cause of mismatch.",
    reviewedAt: "2026-08-09",
  },
  {
    id: "batista-et-al-2026",
    authors: "Batista, A.; Burr, J. R.; Ross, M. C.; Harvazinski, M. E.; Paulson, E. J.",
    year: 2026,
    title: "Spatiotemporal Sensitivity in Rotating Detonation Rocket Engine Large Eddy Simulations",
    publication: "AIAA SCITECH 2026 Forum, AIAA 2026-2419",
    doi: "10.2514/6.2026-2419",
    url: "https://doi.org/10.2514/6.2026-2419",
    configuration: "Non-premixed RDRE LES at 36, 97, and 481 million cells, with chemical sub-time-stepping used to examine temporal resolution.",
    finding: "Chamber pressure, thrust, and specific impulse were less sensitive to resolution than local dynamics such as operating mode, wave count, wave speed, and secondary-wave behavior.",
    limitation: "A high-fidelity rocket configuration; transfer to other fuels, injectors, and solvers requires a controlled check.",
    reviewedAt: "2026-08-09",
  },
  {
    id: "dille-et-al-2024",
    authors: "Dille, K. J.; Frederick, M. D.; Slabaugh, C. D.; Heister, S. D.",
    year: 2024,
    title: "Rotating detonation combustor performance informed through a novel megahertz-rate stagnation pressure measurement",
    publication: "Physics of Fluids 36(2), 026127",
    doi: "10.1063/5.0195465",
    url: "https://doi.org/10.1063/5.0195465",
    configuration: "RDC experiment using schlieren-derived stagnation-pressure measurements at 1 MHz, supplemented by numerical modeling of the tested conditions.",
    finding: "For the tested conditions, pressure ratio and wave speed decreased as mean operating pressure increased; the accompanying model associated the trend with greater preburning before wave arrival.",
    limitation: "The preburning interpretation and trend apply to the tested combustor and operating range; they do not prescribe a general inlet-boundary correction.",
    reviewedAt: "2026-08-09",
  },
  {
    id: "yan-teng-ng-2021",
    authors: "Yan, C.; Teng, H.; Ng, H. D.",
    year: 2021,
    title: "Effects of slot injection on detonation wavelet characteristics in a rotating detonation engine",
    publication: "Acta Astronautica 182, 274–285",
    doi: "10.1016/j.actaastro.2021.02.010",
    url: "https://doi.org/10.1016/j.actaastro.2021.02.010",
    configuration: "Two-dimensional reactive-Euler simulations with two-step induction–reaction kinetics, varying slot area ratio, injection stagnation state, and chemical sensitivity.",
    finding: "Injection conditions, mass flow, and slot-generated inhomogeneity affected whether the rotating detonation was self-sustained and altered the wavelet pattern and frontal structure.",
    limitation: "The study concerns idealized two-dimensional slot-injection wavelets and does not establish a general wave-count or facility-boundary rule.",
    reviewedAt: "2026-08-09",
  },
  {
    id: "paxson-miki-2022",
    authors: "Paxson, D. E.; Miki, K.",
    year: 2022,
    title: "Computational Assessment of Inlet Backflow Effects on Rotating Detonation Engine Performance and Operability",
    publication: "AIAA SCITECH 2022 Forum, AIAA 2022-1263",
    doi: "10.2514/6.2022-1263",
    url: "https://doi.org/10.2514/6.2022-1263",
    configuration: "Idealized two- and three-dimensional CFD of a premixed airbreathing RDE with an annular slit inlet.",
    finding: "The simulations found that inlet backflow can substantially affect predicted pressure gain and that an instability appeared in certain configurations.",
    limitation: "The idealized premixed slit inlet does not provide a universal backflow correction; it is relevant only when the simulated inlet differs materially from the hardware.",
    reviewedAt: "2026-08-09",
  },
  {
    id: "yao-wang-2016",
    authors: "Yao, S.; Wang, J.-P.",
    year: 2016,
    title: "Multiple ignitions and the stability of rotating detonation waves",
    publication: "Applied Thermal Engineering 108, 927–936",
    doi: "10.1016/j.applthermaleng.2016.07.166",
    url: "https://doi.org/10.1016/j.applthermaleng.2016.07.166",
    configuration: "Three-dimensional reactive-Euler simulations of premixed stoichiometric hydrogen–air with Arrhenius chemistry and multiple ignition patterns.",
    finding: "The simulations produced one-, two-, and eight-wave modes; initial waves dominated the one- and two-wave cases, while new waves formed during development of the eight-wave case.",
    limitation: "The result demonstrates initialization and mode-selection sensitivity for an idealized hydrogen–air model, not a universal mapping from ignition pattern to wave count.",
    reviewedAt: "2026-08-09",
  },
  {
    id: "nist-ir-8298",
    authors: "Yeo, D.",
    year: 2020,
    title: "A Summary of Industrial Verification, Validation, and Uncertainty Quantification Procedures in Computational Fluid Dynamics",
    publication: "NIST Interagency/Internal Report 8298",
    doi: "10.6028/NIST.IR.8298",
    url: "https://doi.org/10.6028/NIST.IR.8298",
    configuration: "Review of industrial CFD V&V and uncertainty-quantification procedures, with emphasis on computational wind engineering.",
    finding: "The report separates physical-model, discretization, iterative, and user/programming sources of inaccuracy and calls for numerical, input, and experimental uncertainty to be estimated in validation.",
    limitation: "This is authoritative general CFD guidance with a computational-wind focus, not primary RDE evidence or a source of RDE-specific thresholds.",
    reviewedAt: "2026-08-09",
  },
];

export const SOURCE_IDS_BY_CAUSE: Record<DiagnosticCauseId, string[]> = {
  "case-validity": ["nist-ir-8298"],
  "data-quality": [],
  "spatial-resolution": ["strakey-ferguson-2022", "batista-et-al-2026", "nist-ir-8298"],
  "chemistry-timescale": ["batista-et-al-2026", "nist-ir-8298"],
  "inlet-boundary": ["dille-et-al-2024", "yan-teng-ng-2021", "paxson-miki-2022"],
  "wall-loss": ["strakey-ferguson-2022"],
  "initialization-mode": ["yao-wang-2016"],
  "missing-unsteadiness": [],
  "validation-coverage": ["tobias-agrawal-paxson-2022", "nist-ir-8298"],
};

export const RESEARCH_CLAIMS_BY_CAUSE: Record<DiagnosticCauseId, DiagnosticResearchClaim[]> = {
  "case-validity": [{
    statement: "CFD validation should separate numerical, model-input, and experimental uncertainty before agreement is interpreted.",
    sourceIds: ["nist-ir-8298"],
    boundary: "General CFD V&V guidance, not an RDE-specific acceptance limit.",
  }],
  "data-quality": [],
  "spatial-resolution": [{
    statement: "RDE studies show that spatial resolution can change local pressure and rotating-wave dynamics even when integral outputs appear less sensitive.",
    sourceIds: ["strakey-ferguson-2022", "batista-et-al-2026"],
    boundary: "The cited configurations do not define a universal mesh size or convergence percentage.",
  }, {
    statement: "Mesh independence must be demonstrated separately from agreement with experiment.",
    sourceIds: ["nist-ir-8298"],
    boundary: "This is general verification guidance rather than RDE-specific causal evidence.",
  }],
  "chemistry-timescale": [{
    statement: "Flow and chemistry time resolution are distinct numerical sensitivities that can affect local RDE wave dynamics.",
    sourceIds: ["batista-et-al-2026", "nist-ir-8298"],
    boundary: "The studies do not prescribe one universal flow step, chemistry substep, or mechanism.",
  }],
  "inlet-boundary": [{
    statement: "Injection state, slot-generated nonuniformity, and detonation-driven backflow can change RDE pressure gain, operability, and wave structure.",
    sourceIds: ["dille-et-al-2024", "yan-teng-ng-2021", "paxson-miki-2022"],
    boundary: "Pressure probes alone cannot identify which inlet mechanism is responsible in a new engine.",
  }],
  "wall-loss": [{
    statement: "Wall heat-loss treatment is a documented RDE pressure-response sensitivity worth isolating in a controlled rerun.",
    sourceIds: ["strakey-ferguson-2022"],
    boundary: "The cited combustor does not establish a universal wall model or heat-loss correction.",
  }],
  "initialization-mode": [{
    statement: "Different physically defined ignition patterns can select different rotating-wave modes.",
    sourceIds: ["yao-wang-2016"],
    boundary: "The demonstrated mode selection is configuration-specific and does not predict the mode of another RDE.",
  }],
  "missing-unsteadiness": [],
  "validation-coverage": [{
    statement: "Experiment-CFD validation should use multiple observables and demonstrate agreement over the intended operating envelope.",
    sourceIds: ["tobias-agrawal-paxson-2022", "nist-ir-8298"],
    boundary: "Agreement in one combustor or operating point does not validate another configuration.",
  }],
};

export function sourcesFor(ids: string[]) {
  return ids.map((id) => DIAGNOSTIC_SOURCES.find((source) => source.id === id)).filter((source): source is DiagnosticSource => Boolean(source));
}
