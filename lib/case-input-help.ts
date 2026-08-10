import type { CaseMetadata } from "./caevera-types.ts";

export type CaseInputHelpKey = keyof CaseMetadata
  | "baselineCaseId"
  | "changedVariable"
  | "changeDescription"
  | "experimentCsv"
  | "cfdCsv";

export type CaseInputHelpGroup = {
  title: string;
  description: string;
  items: Array<{
    key: CaseInputHelpKey;
    label: string;
    definition: string;
  }>;
};

export const CASE_INPUT_HELP: CaseInputHelpGroup[] = [
  {
    title: "Case and geometry",
    description: "Identifies the comparison and locates the synchronized pressure probes around the annulus.",
    items: [
      { key: "name", label: "Case name", definition: "A short identifier for this experiment–CFD comparison, such as Baseline 8 bar." },
      { key: "annulusMeanDiameterMm", label: "Mean diameter (mm)", definition: "The annulus mean-line diameter used with the measured wave frequency to calculate circumferential wave speed." },
      { key: "annulusDiameterUncertaintyMm", label: "Diameter uncertainty (mm)", definition: "Standard uncertainty of the mean-line diameter used when propagating uncertainty into circumferential wave speed." },
      { key: "probePositionsDeg", label: "Probe angles (deg)", definition: "The circumferential locations of P1 through PN in one angular coordinate system shared by experiment and CFD. Use at least three; four or more nonuniform locations are preferred." },
      { key: "maximumWaveCount", label: "Maximum expected waves", definition: "The largest physically plausible simultaneous co-rotating wave count included in the phase-mode search. Use prior imaging, operating knowledge, or a conservative upper bound." },
      { key: "probeSynchronizationConfirmed", label: "Probe synchronization", definition: "Confirms that every pressure column within each file was acquired or exported on one common clock. This is required for direction, wave count, and phase calculations." },
      { key: "comparisonMatchConfirmed", label: "Comparison-match confirmation", definition: "Confirms that geometry, operating point, probe locations, and analysis window match before Caevera interprets any difference." },
      { key: "baselineCaseId", label: "Baseline case · optional", definition: "Links a controlled CFD rerun to the original case whose experiment and operating point remain unchanged." },
      { key: "changedVariable", label: "Single CFD change · optional", definition: "The one model or numerical variable group intentionally changed from the linked baseline." },
      { key: "changeDescription", label: "Change description · optional", definition: "The exact before/after change, for example front-cell size 0.25 mm → 0.125 mm." },
    ],
  },
  {
    title: "Pressure files",
    description: "Supplies the synchronized signals from which every visible graph and pressure metric is calculated.",
    items: [
      { key: "experimentCsv", label: "Experiment CSV", definition: "Measured pressure history with time_ms and contiguous p1_MPa through pN_MPa columns. Each row must represent the same instant for every probe." },
      { key: "cfdCsv", label: "CFD CSV", definition: "Virtual-probe pressure history at the same locations and operating point, using the same probe count and column naming as the experiment file." },
      { key: "experimentSensorBandwidthKHz", label: "Experiment sensor bandwidth (kHz)", definition: "Usable frequency bandwidth of the complete pressure sensor and conditioning chain. Caevera checks whether it covers the fundamental and harmonic bands used in the analysis." },
      { key: "experimentFilterCutoffKHz", label: "Experiment filter cutoff (kHz)", definition: "Applied analog or digital low-pass/anti-alias cutoff. A cutoff below the analyzed harmonic band limits sharp-front and harmonic comparisons." },
    ],
  },
  {
    title: "Operating conditions",
    description: "Defines the physical state represented by both datasets and helps verify whether related cases are comparable.",
    items: [
      { key: "inletPressureBar", label: "Inlet pressure (bar)", definition: "The documented inlet or plenum pressure for the case. Use one consistent pressure definition across related cases." },
      { key: "inletTemperatureK", label: "Inlet temperature (K)", definition: "The reactant inlet or plenum temperature corresponding to the stated inlet pressure." },
      { key: "equivalenceRatio", label: "Equivalence ratio", definition: "Actual fuel-to-oxidizer ratio divided by the stoichiometric ratio; 1.0 is stoichiometric, below 1.0 is lean, and above 1.0 is rich." },
      { key: "massFlowKgS", label: "Mass flow (kg/s)", definition: "Total reactant mass flow represented by the experiment and CFD case." },
    ],
  },
  {
    title: "Solver and numerical schemes",
    description: "Records the numerical choices that can change wave speed, peak pressure, rise time, and high-frequency content.",
    items: [
      { key: "solver", label: "Solver", definition: "The CFD code or solver family used to produce the virtual-probe data." },
      { key: "solverVersion", label: "Version", definition: "The exact solver release, commit, or internal build identifier needed to reproduce the run." },
      { key: "dimensionality", label: "Dimensionality", definition: "Whether the modeled domain is two-dimensional or three-dimensional." },
      { key: "spatialScheme", label: "Spatial scheme", definition: "The reconstruction or discretization used for spatial derivatives, such as MUSCL or WENO." },
      { key: "spatialOrder", label: "Spatial order", definition: "The formal order of accuracy of the spatial method in smooth regions." },
      { key: "numericalFlux", label: "Numerical flux", definition: "The interface or Riemann flux, such as HLLC or Roe, used to transmit information between cells." },
      { key: "limiterFilter", label: "Limiter / filter / dissipation", definition: "Any limiter, filter, shock sensor, or explicit artificial dissipation that can smooth pressure fronts. Enter None when unused." },
      { key: "temporalScheme", label: "Temporal scheme", definition: "The time-integration method, such as SSPRK3 or an implicit BDF method." },
      { key: "temporalOrder", label: "Temporal order", definition: "The formal order of accuracy of the time-integration method." },
      { key: "timeStepUs", label: "Time step (µs)", definition: "The physical time advanced per CFD step, in microseconds." },
      { key: "cfl", label: "CFL", definition: "The reported Courant–Friedrichs–Lewy number controlling the ratio of numerical time step to cell-crossing time." },
    ],
  },
  {
    title: "Resolution and convergence",
    description: "Describes whether the detonation front, induction region, wall region, and time evolution are numerically resolved.",
    items: [
      { key: "meshCells", label: "Total mesh cells", definition: "The total number of computational cells. This is context only and does not by itself prove local resolution." },
      { key: "minimumCellSizeMm", label: "Minimum front cell (mm)", definition: "The smallest cell dimension in the detonation-front or reaction-zone region used by the diagnostic engine." },
      { key: "cellsPerInductionLength", label: "Cells / induction length", definition: "The estimated number of cells spanning one chemical induction length at the relevant state." },
      { key: "nearWallCellSizeMm", label: "Near-wall cell (mm)", definition: "The characteristic cell height or size next to the wall where thermal and viscous gradients are represented." },
      { key: "meshConvergencePct", label: "Mesh-change result (%) · optional", definition: "The percentage change in the selected validation quantity between the current mesh and a finer or coarser mesh." },
      { key: "timeStepConvergencePct", label: "Time-step-change result (%) · optional", definition: "The percentage change in the selected validation quantity after a controlled time-step refinement." },
    ],
  },
  {
    title: "Physics and boundaries",
    description: "Records physical-model and boundary assumptions that can compete with numerical explanations for a mismatch.",
    items: [
      { key: "chemistryModel", label: "Chemical mechanism", definition: "The named reaction mechanism or mechanism file used by the CFD calculation." },
      { key: "chemistrySpecies", label: "Species", definition: "The number of chemical species retained in the stated mechanism." },
      { key: "chemistryReactions", label: "Reactions", definition: "The number of elementary or global reactions retained in the stated mechanism." },
      { key: "chemistryIntegrator", label: "Chemistry integration", definition: "The algorithm used to advance the chemical source terms, including whether it is explicit, implicit, or operator-split." },
      { key: "turbulenceModel", label: "Turbulence model", definition: "The RANS, LES, hybrid, or other turbulence closure. Enter None for a laminar or unmodeled case." },
      { key: "combustionModel", label: "Combustion model", definition: "Any turbulence–chemistry or flame model applied in addition to the chemical mechanism. Enter None when unused." },
      { key: "wallBoundaryCondition", label: "Wall thermal condition", definition: "The thermal wall treatment, such as adiabatic, isothermal with its temperature, or conjugate heat transfer." },
      { key: "inletBoundaryCondition", label: "Inlet treatment", definition: "How reactants enter the domain, including imposed total state, mass flow, injector representation, and backflow handling." },
      { key: "outletBoundaryCondition", label: "Outlet treatment", definition: "The downstream boundary formulation, including imposed pressure and any non-reflecting treatment." },
      { key: "initializationMethod", label: "Ignition / initialization", definition: "How the rotating detonation was started or initialized, including ignition-kernel location and imposed initial wave state." },
    ],
  },
  {
    title: "Experiment and CFD uncertainty",
    description: "Lets Caevera distinguish a resolved discrepancy from a difference that is smaller than current uncertainty.",
    items: [
      { key: "pressureUncertaintyPct", label: "Experiment pressure uncertainty (%)", definition: "The stated uncertainty of measured pressure amplitude or level, expressed as a percentage of the reported quantity." },
      { key: "timingUncertaintyUs", label: "Experiment timing uncertainty (µs)", definition: "Combined timing uncertainty from acquisition, synchronization, and sensor response, in microseconds." },
      { key: "cfdPressureUncertaintyPct", label: "CFD pressure uncertainty (%)", definition: "The numerical uncertainty assigned to CFD pressure results, ideally based on mesh and time-step studies rather than a guessed tolerance." },
      { key: "cfdTimingUncertaintyUs", label: "CFD timing uncertainty (µs)", definition: "The numerical uncertainty assigned to CFD wave-arrival timing or phase, in microseconds." },
    ],
  },
];
