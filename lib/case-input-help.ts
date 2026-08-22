import type { CaseMetadata } from "./caevera-types.ts";

export type CaseInputHelpKey = keyof CaseMetadata
  | "baselineCaseId"
  | "changedVariable"
  | "changeDescription"
  | "experimentCsv"
  | "cfdCsv"
  | "experimentWallFieldCsv"
  | "cfdWallFieldCsv";

export type CaseInputHelpGroup = {
  title: string;
  description: string;
  items: Array<{
    key: CaseInputHelpKey;
    label: string;
    definition: string;
    format: string;
    requirement: "Required" | "Conditional" | "Optional";
    obtainFrom: string;
    usedFor: string;
    missingEffect: string;
  }>;
};

type InputHelpDetails = Omit<CaseInputHelpGroup["items"][number], "key" | "label" | "definition">;

const CASE_INPUT_HELP_BASE: Array<Omit<CaseInputHelpGroup, "items"> & { items: Array<Pick<CaseInputHelpGroup["items"][number], "key" | "label" | "definition">> }> = [
  {
    title: "Operating point, run, and geometry",
    description: "Names the physical operating point or CFD run, inherits the annulus geometry from the engine, and records where each synchronized pressure probe is located.",
    items: [
      { key: "name", label: "Operating-point or run name", definition: "A short identifier for the physical test condition or CFD run, such as 8 bar · φ 1.0 or Baseline CFD." },
      { key: "annulusMeanDiameterMm", label: "Mean diameter from engine (mm)", definition: "The annulus mean-line diameter calculated from the selected engine geometry and used with measured wave frequency to calculate circumferential wave speed." },
      { key: "annulusDiameterUncertaintyMm", label: "Diameter uncertainty (mm)", definition: "Standard uncertainty of the mean-line diameter used when propagating uncertainty into circumferential wave speed." },
      { key: "probePositionsDeg", label: "Probe angles (deg)", definition: "The circumferential locations of P1 through PN in one angular coordinate system shared by experiment and CFD. Use at least three; four or more nonuniform locations are preferred." },
      { key: "maximumWaveCount", label: "Maximum expected waves", definition: "The largest physically plausible simultaneous co-rotating wave count included in the phase-mode search. Use prior imaging, operating knowledge, or a conservative upper bound." },
      { key: "probeSynchronizationConfirmed", label: "Probe synchronization", definition: "Confirms that every pressure column within each file was acquired or exported on one common clock. This is required for direction, wave count, and phase calculations." },
      { key: "comparisonMatchConfirmed", label: "Comparison-match confirmation", definition: "Confirms that geometry, operating point, probe locations, and analysis window match before Kythros interprets any difference." },
      { key: "baselineCaseId", label: "Baseline CFD run · optional", definition: "Links later CFD reruns to the baseline at this operating point. Every linked rerun reuses the operating point's experiment and physical condition." },
      { key: "changedVariable", label: "Single CFD change · optional", definition: "Declares the only CFD setting group allowed to differ from the selected starting run. Kythros verifies the saved settings before using the rerun to update the plan." },
      { key: "changeDescription", label: "Change description · optional", definition: "Records exactly what changed, including the old and new values, for example front-cell size 0.25 mm → 0.125 mm." },
    ],
  },
  {
    title: "Pressure files",
    description: "Supplies the experiment and CFD pressure histories. Kythros calculates the graphs and metrics from these values; the CSV does not contain diagnoses or evidence labels.",
    items: [
      { key: "experimentCsv", label: "Experiment CSV", definition: "Measured pressure history with time_ms and contiguous p1_MPa through pN_MPa columns. Each row must represent the same instant for every probe." },
      { key: "cfdCsv", label: "CFD CSV", definition: "Virtual-probe pressure history at the same locations and operating point, using the same probe count and column naming as the experiment file." },
      { key: "experimentSensorBandwidthKHz", label: "Experiment sensor bandwidth (kHz)", definition: "Usable frequency bandwidth of the complete pressure sensor and conditioning chain. Kythros checks whether it covers the fundamental and harmonic bands used in the analysis." },
      { key: "experimentFilterCutoffKHz", label: "Experiment filter cutoff (kHz)", definition: "Applied analog or digital low-pass/anti-alias cutoff. A cutoff below the analyzed harmonic band limits sharp-front and harmonic comparisons." },
    ],
  },
  {
    title: "Operating conditions",
    description: "Defines the physical state stored once on the operating point and inherited by every CFD run beneath it.",
    items: [
      { key: "inletPressureBar", label: "Inlet pressure (bar)", definition: "The documented inlet or plenum pressure for the case. Use one consistent pressure definition across related cases." },
      { key: "backPressureBar", label: "Back pressure (bar)", definition: "The documented downstream pressure paired with this operating point. Use one consistent static or total-pressure definition across the engine dataset." },
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
      { key: "solverRuntimeHours", label: "Runtime (hours) · optional", definition: "Elapsed wall-clock solver time for this case, used to compare the computational cost of successful reruns with their baseline." },
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
    title: "Optional engine-physics evidence",
    description: "Adds documented performance, feed-system, thermal, and sustained-operation quantities. Experiment values belong to the operating point; CFD values belong to a run. Missing values remain unavailable.",
    items: [
      { key: "experimentNetThrustN", label: "Experiment net thrust (N) · optional", definition: "Measured gross thrust after documented tare, base-drag, and facility corrections needed to obtain net thrust." },
      { key: "cfdNetThrustN", label: "CFD net thrust (N) · optional", definition: "Net axial force calculated from the CFD control surface using a definition matched to the corrected experiment." },
      { key: "experimentSpecificImpulseS", label: "Experiment specific impulse (s) · optional", definition: "Measured net thrust divided by the documented propellant weight-flow definition." },
      { key: "cfdSpecificImpulseS", label: "CFD specific impulse (s) · optional", definition: "CFD net thrust divided by the same propellant weight-flow definition used for the experiment." },
      { key: "experimentPressureGainPct", label: "Experiment total-pressure gain (%) · optional", definition: "Documented change in total pressure from the selected inlet/plenum station to the selected exit station, expressed relative to the inlet value." },
      { key: "cfdPressureGainPct", label: "CFD total-pressure gain (%) · optional", definition: "CFD total-pressure change evaluated at stations and with averaging definitions matched to the experiment." },
      { key: "experimentInjectorPressureRatio", label: "Experiment injector pressure ratio · optional", definition: "Documented upstream injector/plenum pressure divided by the chamber-side reference pressure, using consistent static or total definitions." },
      { key: "cfdInjectorPressureRatio", label: "CFD injector pressure ratio · optional", definition: "Simulated injector pressure ratio evaluated with the same station and pressure definitions as the experiment." },
      { key: "experimentBackflowFractionPct", label: "Experiment injector backflow duty cycle (%) · optional", definition: "Fraction of the documented observation window during which injector or plenum flow is measured to reverse." },
      { key: "cfdBackflowFractionPct", label: "CFD injector backflow duty cycle (%) · optional", definition: "Fraction of the CFD comparison window during which the matched injector control surface has negative mass flux." },
      { key: "experimentWallHeatFluxMWm2", label: "Experiment wall heat flux (MW/m²) · optional", definition: "Measured wall heat flux at a documented location, time window, and sensor response definition." },
      { key: "cfdWallHeatFluxMWm2", label: "CFD wall heat flux (MW/m²) · optional", definition: "Simulated wall heat flux at the matching location and with the same averaging window." },
      { key: "experimentPeakWallTemperatureK", label: "Experiment peak wall temperature (K) · optional", definition: "Highest documented wall temperature over the stated sensor locations and observation window." },
      { key: "cfdPeakWallTemperatureK", label: "CFD peak wall temperature (K) · optional", definition: "Highest simulated wall temperature over the matching surface and time window." },
      { key: "experimentSustainedDurationS", label: "Experiment sustained run duration (s) · optional", definition: "Continuous duration for which the reported rotating-wave response was observed under the stated condition." },
      { key: "cfdSustainedDurationS", label: "CFD sustained duration (s) · optional", definition: "Physical flow time represented after startup transients for which the simulated response remains sustained." },
      { key: "experimentWallFieldCsv", label: "Experiment thermal profile or wall field · optional", definition: "Measured axial locations with wall heat flux, wall temperature, or both. Circumferential angle is optional: omit it for an axial profile, or include it for sparse sensors or a surface field. Each value must be a documented measurement or reconstruction." },
      { key: "cfdWallFieldCsv", label: "CFD thermal profile or wall field · optional", definition: "CFD wall samples using the same axial origin, wall selection, and averaging window as the experiment. Include circumferential angle only when it exists in both datasets or when the CFD field is being inspected independently." },
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
      { key: "meshConvergencePct", label: "Documented mesh-study change (%) · optional", definition: "A manually entered percentage from a separate documented mesh study. It is not read from or calculated from either pressure CSV." },
      { key: "timeStepConvergencePct", label: "Documented time-step-study change (%) · optional", definition: "A manually entered percentage from a separate documented time-step study. It is not read from or calculated from either pressure CSV." },
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
    description: "Lets Kythros distinguish a resolved discrepancy from a difference that is smaller than current uncertainty.",
    items: [
      { key: "pressureUncertaintyPct", label: "Experiment pressure uncertainty (%)", definition: "The stated uncertainty of measured pressure amplitude or level, expressed as a percentage of the reported quantity." },
      { key: "timingUncertaintyUs", label: "Experiment timing uncertainty (µs)", definition: "Combined timing uncertainty from acquisition, synchronization, and sensor response, in microseconds." },
      { key: "cfdPressureUncertaintyPct", label: "CFD pressure uncertainty (%)", definition: "The numerical uncertainty assigned to CFD pressure results, ideally based on mesh and time-step studies rather than a guessed tolerance." },
      { key: "cfdTimingUncertaintyUs", label: "CFD timing uncertainty (µs)", definition: "The numerical uncertainty assigned to CFD wave-arrival timing or phase, in microseconds." },
    ],
  },
];


const INPUT_HELP_DETAILS = {
  "name": {
    "format": "Free text; use a unique run or operating-point identifier.",
    "requirement": "Required",
    "obtainFrom": "Experiment log or CFD run directory.",
    "usedFor": "Operating-point and run selectors, reports, exports, and rerun links.",
    "missingEffect": "The operating point or run cannot be saved or distinguished from others."
  },
  "annulusMeanDiameterMm": {
    "format": "Millimetres; mean of inner and outer annulus diameters at the probe plane.",
    "requirement": "Required",
    "obtainFrom": "Combustor drawing or as-built metrology.",
    "usedFor": "Converts passage frequency and identified wave count into circumferential wave speed.",
    "missingEffect": "Wave speed cannot be calculated."
  },
  "annulusDiameterUncertaintyMm": {
    "format": "Millimetres; non-negative one-standard-uncertainty value.",
    "requirement": "Required",
    "obtainFrom": "Drawing tolerance, dimensional inspection, or metrology report.",
    "usedFor": "Propagates geometric uncertainty into wave-speed uncertainty.",
    "missingEffect": "Wave speed may be shown, but its experiment–CFD significance is inconclusive."
  },
  "probePositionsDeg": {
    "format": "Degrees from one shared 0° datum; enter one unique angle for every mapped probe.",
    "requirement": "Required",
    "obtainFrom": "Sensor installation drawing and matching CFD virtual-probe coordinates.",
    "usedFor": "Fits circumferential phase, wave count, direction, speed, and placement ambiguity.",
    "missingEffect": "Only per-probe pressure and frequency comparisons remain available."
  },
  "maximumWaveCount": {
    "format": "Positive integer from 1 to 12; upper bound on physically plausible simultaneous fronts.",
    "requirement": "Required",
    "obtainFrom": "Prior imaging, facility experience, or a deliberately conservative physical bound.",
    "usedFor": "Defines the candidate wave-count search set.",
    "missingEffect": "Mode fitting is not run."
  },
  "probeSynchronizationConfirmed": {
    "format": "Checkbox; confirm common clock/trigger within each probe array.",
    "requirement": "Required",
    "obtainFrom": "DAQ configuration and CFD sampling setup.",
    "usedFor": "Authorizes probe-to-probe phase, direction, count, speed, and jitter calculations.",
    "missingEffect": "Kythros does not report wave count, direction, speed, phase pattern, or phase jitter as identified results."
  },
  "comparisonMatchConfirmed": {
    "format": "Checkbox; confirm same geometry, operating point, probe locations, and evidence window.",
    "requirement": "Required",
    "obtainFrom": "Experiment run sheet, CFD case setup, and export window.",
    "usedFor": "Controls whether any mismatch may influence a diagnostic recommendation.",
    "missingEffect": "Diagnosis is blocked; Kythros recommends correcting the pairing."
  },
  "baselineCaseId": {
    "format": "Select one existing baseline CFD run at this operating point.",
    "requirement": "Optional",
    "obtainFrom": "Kythros run list for the selected operating point.",
    "usedFor": "Groups one baseline with reruns that reuse its experiment and physical operating point.",
    "missingEffect": "The run is analyzed as a standalone comparison and cannot update the operating point's one-change rerun plan."
  },
  "changedVariable": {
    "format": "Choose exactly one CFD variable group.",
    "requirement": "Conditional",
    "obtainFrom": "Simulation change log.",
    "usedFor": "Checks whether exactly one CFD setting group changed from the selected starting run.",
    "missingEffect": "Kythros treats the run as a comparison only and does not use it to update the plan."
  },
  "changeDescription": {
    "format": "Exact before → after wording, including values and units where known.",
    "requirement": "Conditional",
    "obtainFrom": "Simulation change log or solver input diff.",
    "usedFor": "Makes the related rerun reproducible and reportable.",
    "missingEffect": "The rerun may be linked, but the controlled change is not auditable."
  },
  "experimentCsv": {
    "format": "CSV, TSV, or semicolon-delimited text; map one time plus at least three pressure columns.",
    "requirement": "Required",
    "obtainFrom": "DAQ export after documented calibration/filtering.",
    "usedFor": "Provides measured time histories for every pressure and wave calculation.",
    "missingEffect": "No experiment–CFD analysis can run."
  },
  "cfdCsv": {
    "format": "CSV, TSV, or semicolon-delimited text; map matching virtual probes.",
    "requirement": "Required",
    "obtainFrom": "Solver monitor or virtual-probe export.",
    "usedFor": "Provides simulated time histories for comparison at the experimental locations.",
    "missingEffect": "No experiment–CFD analysis can run."
  },
  "experimentSensorBandwidthKHz": {
    "format": "kHz; usable −3 dB or manufacturer/calibrated system bandwidth, not sampling rate.",
    "requirement": "Required",
    "obtainFrom": "Transducer calibration sheet plus charge amplifier/conditioning chain.",
    "usedFor": "Checks whether fundamental and harmonic content lies inside the measurement response.",
    "missingEffect": "Harmonic/front-shape conclusions are limited and sensor attenuation cannot be separated from CFD smoothing."
  },
  "experimentFilterCutoffKHz": {
    "format": "kHz; applied analog or digital low-pass/anti-alias cutoff.",
    "requirement": "Required",
    "obtainFrom": "DAQ/filter configuration or processing script.",
    "usedFor": "Checks attenuation of fundamental/harmonics and consistency with Nyquist.",
    "missingEffect": "Spectrum and rise-time differences may be measurement-limited."
  },
  "inletPressureBar": {
    "format": "bar; state whether this is static, total, or plenum pressure consistently across cases.",
    "requirement": "Required",
    "obtainFrom": "Experiment run sheet and CFD inlet definition.",
    "usedFor": "Verifies operating-point matching and supports inlet-related diagnostic context.",
    "missingEffect": "The physical pairing and related-case comparison are incomplete."
  },
  "backPressureBar": {
    "format": "bar; state whether this is static or total pressure consistently across operating points.",
    "requirement": "Required",
    "obtainFrom": "Facility run sheet and CFD outlet boundary definition.",
    "usedFor": "Defines the operating point, pressure ratio, 2D envelope slice, and predictive-model feature vector.",
    "missingEffect": "The operating point cannot be stored or compared on a pressure-ratio-consistent envelope."
  },
  "inletTemperatureK": {
    "format": "kelvin; use the temperature at the same inlet/plenum definition as pressure.",
    "requirement": "Required",
    "obtainFrom": "Thermocouple/facility log and CFD inlet definition.",
    "usedFor": "Verifies operating-point matching and chemistry/inlet context.",
    "missingEffect": "The physical pairing and related-case comparison are incomplete."
  },
  "equivalenceRatio": {
    "format": "Dimensionless fuel/oxidizer ratio divided by stoichiometric ratio.",
    "requirement": "Required",
    "obtainFrom": "Calibrated mass-flow calculation or experiment run sheet.",
    "usedFor": "Defines the operating point and related-case identity.",
    "missingEffect": "The physical pairing and validation-envelope location are incomplete."
  },
  "massFlowKgS": {
    "format": "kg/s; total reactant mass flow represented by both files.",
    "requirement": "Required",
    "obtainFrom": "Calibrated flow meters and CFD boundary summary.",
    "usedFor": "Verifies operating-point matching and inlet-model context.",
    "missingEffect": "The physical pairing and related-case comparison are incomplete."
  },
  "solver": {
    "format": "Solver/product name or internal code identifier.",
    "requirement": "Required",
    "obtainFrom": "CFD case metadata.",
    "usedFor": "Makes recommendations and reports reproducible.",
    "missingEffect": "The numerical setup cannot be traced."
  },
  "solverVersion": {
    "format": "Release, commit hash, or internal build identifier.",
    "requirement": "Required",
    "obtainFrom": "Solver executable metadata or repository commit.",
    "usedFor": "Distinguishes behavior that may change between solver builds.",
    "missingEffect": "The run cannot be reproduced exactly."
  },
  "solverRuntimeHours": {
    "format": "Positive wall-clock hours for the completed CFD run.",
    "requirement": "Optional",
    "obtainFrom": "Scheduler accounting, solver log, or run summary.",
    "usedFor": "Calculates the runtime multiplier observed in comparable confirmed reruns.",
    "missingEffect": "The recommendation still works, but comparable-case cost evidence is omitted."
  },
  "dimensionality": {
    "format": "Select 2D or 3D.",
    "requirement": "Required",
    "obtainFrom": "CFD domain definition.",
    "usedFor": "Provides context for mode-selection and missing-unsteadiness hypotheses.",
    "missingEffect": "Domain-mode limitations cannot be interpreted."
  },
  "spatialScheme": {
    "format": "Named spatial reconstruction/discretization.",
    "requirement": "Required",
    "obtainFrom": "Solver input deck.",
    "usedFor": "Interprets peak/rise-time smoothing and mesh sensitivities.",
    "missingEffect": "Spatial-resolution recommendations lack method context."
  },
  "spatialOrder": {
    "format": "Positive integer formal order in smooth regions.",
    "requirement": "Required",
    "obtainFrom": "Solver documentation and run input.",
    "usedFor": "Interprets numerical dissipation with the spatial scheme.",
    "missingEffect": "Spatial-resolution context is incomplete."
  },
  "numericalFlux": {
    "format": "Named Riemann/interface flux such as HLLC or Roe.",
    "requirement": "Required",
    "obtainFrom": "Solver input deck.",
    "usedFor": "Records a major pressure-front dissipation choice.",
    "missingEffect": "Front-smearing recommendations are not reproducible."
  },
  "limiterFilter": {
    "format": "Limiter, shock sensor, filter, or artificial dissipation; enter None if unused.",
    "requirement": "Required",
    "obtainFrom": "Solver input deck.",
    "usedFor": "Interprets attenuated peaks, rise time, and harmonics.",
    "missingEffect": "Kythros cannot distinguish undocumented numerical damping from physical/model effects."
  },
  "temporalScheme": {
    "format": "Named time integrator.",
    "requirement": "Required",
    "obtainFrom": "Solver input deck.",
    "usedFor": "Provides context for phase/frequency and time-step sensitivity.",
    "missingEffect": "Time-resolution recommendations are incomplete."
  },
  "temporalOrder": {
    "format": "Positive integer formal temporal order.",
    "requirement": "Required",
    "obtainFrom": "Solver documentation and input deck.",
    "usedFor": "Interprets the reported flow time step.",
    "missingEffect": "Time-resolution context is incomplete."
  },
  "timeStepUs": {
    "format": "Microseconds; physical flow-solver time step represented by the pressure export.",
    "requirement": "Required",
    "obtainFrom": "Solver control file or run log.",
    "usedFor": "Makes chemistry/time-resolution recommendations specific to the current baseline.",
    "missingEffect": "A time-resolution sensitivity cannot be tied to the current run."
  },
  "cfl": {
    "format": "Dimensionless reported CFL value.",
    "requirement": "Required",
    "obtainFrom": "Solver log or control file.",
    "usedFor": "Checks time-step strategy and related-run consistency.",
    "missingEffect": "Time-resolution context is incomplete."
  },
  "meshCells": {
    "format": "Positive integer total cell count.",
    "requirement": "Required",
    "obtainFrom": "Mesh summary or solver startup log.",
    "usedFor": "Provides global mesh provenance; it is not treated as local resolution proof.",
    "missingEffect": "The mesh cannot be traced across related runs."
  },
  "minimumCellSizeMm": {
    "format": "Millimetres; smallest cell dimension in the detonation-front/reaction region.",
    "requirement": "Required",
    "obtainFrom": "Mesh metrics at the analyzed region.",
    "usedFor": "Defines the baseline for the recommended front-region refinement.",
    "missingEffect": "A spatial-refinement recommendation cannot name the current baseline."
  },
  "cellsPerInductionLength": {
    "format": "Dimensionless estimate at a stated relevant thermochemical state.",
    "requirement": "Required",
    "obtainFrom": "Induction-length calculation plus local mesh size.",
    "usedFor": "Provides physically scaled front-resolution context.",
    "missingEffect": "Resolution evidence is weaker and mesh-cell count alone is not accepted as proof."
  },
  "nearWallCellSizeMm": {
    "format": "Millimetres; characteristic first-cell height/size at the wall.",
    "requirement": "Required",
    "obtainFrom": "Mesh quality report.",
    "usedFor": "Provides wall-loss/numerical resolution context.",
    "missingEffect": "Wall-related numerical resolution cannot be assessed."
  },
  "meshConvergencePct": {
    "format": "Percent change in a named CFD output between two documented mesh levels; enter the magnitude as a non-negative value.",
    "requirement": "Optional",
    "obtainFrom": "Documented mesh sensitivity study.",
    "usedFor": "Provides prior mesh-sensitivity context before a related rerun is added.",
    "missingEffect": "Kythros does not assume mesh convergence. A related one-change mesh rerun can provide the missing result."
  },
  "timeStepConvergencePct": {
    "format": "Percent change in a named CFD output between two documented flow time steps; enter the magnitude as a non-negative value.",
    "requirement": "Optional",
    "obtainFrom": "Documented time-step study.",
    "usedFor": "Provides prior time-step-sensitivity context before a related rerun is added.",
    "missingEffect": "Kythros does not assume time-step convergence. A related one-change time-step rerun can provide the missing result."
  },
  "chemistryModel": {
    "format": "Mechanism name and preferably file/version.",
    "requirement": "Required",
    "obtainFrom": "Solver input and mechanism repository.",
    "usedFor": "Provides context for wave-frequency and pressure-energy sensitivities.",
    "missingEffect": "Chemistry-related recommendations are not reproducible."
  },
  "chemistrySpecies": {
    "format": "Positive integer species count.",
    "requirement": "Required",
    "obtainFrom": "Mechanism file or solver startup summary.",
    "usedFor": "Records mechanism scope for related-case checks.",
    "missingEffect": "Mechanism identity is incomplete."
  },
  "chemistryReactions": {
    "format": "Positive integer elementary/global reaction count.",
    "requirement": "Required",
    "obtainFrom": "Mechanism file or solver startup summary.",
    "usedFor": "Records mechanism scope for related-case checks.",
    "missingEffect": "Mechanism identity is incomplete."
  },
  "chemistryIntegrator": {
    "format": "Named source-term integrator and splitting approach.",
    "requirement": "Required",
    "obtainFrom": "Solver input deck.",
    "usedFor": "Defines what may be tightened in a chemistry time-resolution test.",
    "missingEffect": "Chemistry time-resolution recommendations cannot isolate one control."
  },
  "turbulenceModel": {
    "format": "Named RANS/LES/hybrid closure; enter None when unused.",
    "requirement": "Required",
    "obtainFrom": "Solver input deck.",
    "usedFor": "Provides context for cycle variability and missing unsteadiness.",
    "missingEffect": "The physics model card is incomplete."
  },
  "combustionModel": {
    "format": "Named turbulence–chemistry/flame model; enter None for direct finite-rate chemistry without another closure.",
    "requirement": "Required",
    "obtainFrom": "Solver input deck.",
    "usedFor": "Separates chemistry mechanism from additional combustion closure.",
    "missingEffect": "Combustion-model effects cannot be traced."
  },
  "wallBoundaryCondition": {
    "format": "Exact thermal condition, including temperature/profile for isothermal walls or coupling method for CHT.",
    "requirement": "Required",
    "obtainFrom": "CFD boundary input and experiment wall condition.",
    "usedFor": "Defines the baseline for a one-variable wall-loss sensitivity.",
    "missingEffect": "Wall-loss recommendations cannot name or reproduce the current condition."
  },
  "inletBoundaryCondition": {
    "format": "Exact imposed variables, injector representation, and backflow treatment.",
    "requirement": "Required",
    "obtainFrom": "CFD boundary input and hardware/injector description.",
    "usedFor": "Defines the baseline for an inlet-representation sensitivity.",
    "missingEffect": "Inlet-related recommendations cannot name or reproduce the current condition."
  },
  "outletBoundaryCondition": {
    "format": "Exact downstream pressure/non-reflecting formulation.",
    "requirement": "Required",
    "obtainFrom": "CFD boundary input.",
    "usedFor": "Records potential reflection/back-pressure context and holds it fixed in inlet tests.",
    "missingEffect": "Boundary sensitivities are not auditable."
  },
  "initializationMethod": {
    "format": "Ignition kernel, imposed wave, pre-detonator surrogate, or restart procedure.",
    "requirement": "Required",
    "obtainFrom": "CFD initial-condition setup.",
    "usedFor": "Defines the baseline for a mode-selection sensitivity.",
    "missingEffect": "Initialization-related recommendations cannot be reproduced."
  },
  "pressureUncertaintyPct": {
    "format": "Percent, non-negative one-standard measurement uncertainty including calibration where available.",
    "requirement": "Required",
    "obtainFrom": "Calibration certificate and uncertainty budget.",
    "usedFor": "Determines whether pressure amplitude/mean/peak/impulse differences are resolved.",
    "missingEffect": "Pressure differences are reported but their significance is inconclusive."
  },
  "timingUncertaintyUs": {
    "format": "Microseconds; combined DAQ clock, synchronization, and sensor-response timing uncertainty.",
    "requirement": "Required",
    "obtainFrom": "DAQ specification and timing uncertainty budget.",
    "usedFor": "Propagates into frequency, phase-related timing, rise time, and impulse significance.",
    "missingEffect": "Timing-sensitive experiment–CFD differences are inconclusive."
  },
  "cfdPressureUncertaintyPct": {
    "format": "Percent, preferably from mesh/time-step studies rather than an arbitrary allowance.",
    "requirement": "Required",
    "obtainFrom": "Numerical uncertainty assessment.",
    "usedFor": "Combines with measurement uncertainty for pressure mismatch resolution.",
    "missingEffect": "Pressure differences are reported but not classified as resolved."
  },
  "cfdTimingUncertaintyUs": {
    "format": "Microseconds; numerical uncertainty in wave-arrival timing/phase.",
    "requirement": "Required",
    "obtainFrom": "Mesh/time-step timing study.",
    "usedFor": "Combines with experiment timing uncertainty for supported timing outputs.",
    "missingEffect": "Timing-sensitive differences are inconclusive."
  },
  "experimentNetThrustN": {
    "format": "Newtons; corrected net axial force using a documented sign and tare convention.", "requirement": "Optional", "obtainFrom": "Calibrated thrust stand, facility tare, and base-drag correction.", "usedFor": "Descriptive performance evidence and matched CFD comparison.", "missingEffect": "Kythros makes no thrust claim for this operating point."
  },
  "cfdNetThrustN": {
    "format": "Newtons; matched control-surface and pressure-reference definition.", "requirement": "Optional", "obtainFrom": "CFD force or momentum-balance report.", "usedFor": "CFD minus experiment net-thrust comparison.", "missingEffect": "Net thrust is not compared."
  },
  "experimentSpecificImpulseS": {
    "format": "Seconds; document whether denominator is fuel, total propellant, or another convention.", "requirement": "Optional", "obtainFrom": "Corrected net thrust and calibrated mass-flow measurements.", "usedFor": "Descriptive propulsion-performance evidence.", "missingEffect": "Kythros makes no specific-impulse claim."
  },
  "cfdSpecificImpulseS": {
    "format": "Seconds; use the same denominator convention as experiment.", "requirement": "Optional", "obtainFrom": "CFD net thrust and matched mass flow.", "usedFor": "CFD minus experiment specific-impulse comparison.", "missingEffect": "Specific impulse is not compared."
  },
  "experimentPressureGainPct": {
    "format": "Signed percent; negative values are permitted. Document stations and averaging.", "requirement": "Optional", "obtainFrom": "Calibrated total-pressure survey or documented equivalent-available-pressure method.", "usedFor": "Descriptive pressure-gain evidence.", "missingEffect": "Kythros makes no pressure-gain claim."
  },
  "cfdPressureGainPct": {
    "format": "Signed percent using experiment-matched stations and averaging.", "requirement": "Optional", "obtainFrom": "CFD total-pressure integration or matched equivalent method.", "usedFor": "CFD minus experiment pressure-gain comparison.", "missingEffect": "Pressure gain is not compared."
  },
  "experimentInjectorPressureRatio": {
    "format": "Dimensionless upstream-to-chamber pressure ratio; state static or total.", "requirement": "Optional", "obtainFrom": "Synchronized plenum and chamber pressure measurements.", "usedFor": "Feed-system margin and injector-coupling evidence.", "missingEffect": "Injector pressure-ratio behavior remains unavailable."
  },
  "cfdInjectorPressureRatio": {
    "format": "Dimensionless; use the same stations and pressure definitions as experiment.", "requirement": "Optional", "obtainFrom": "CFD plenum/injector and chamber monitors.", "usedFor": "Matched feed-system comparison.", "missingEffect": "Injector pressure ratio is not compared."
  },
  "experimentBackflowFractionPct": {
    "format": "Percent of observation time with documented reverse flow.", "requirement": "Optional", "obtainFrom": "Time-resolved injector/plenum flow or a validated reverse-flow diagnostic.", "usedFor": "Quantifies measured feed-system interruption.", "missingEffect": "A pressure trace alone is not relabeled as backflow."
  },
  "cfdBackflowFractionPct": {
    "format": "Percent of matched CFD window with negative injector mass flux.", "requirement": "Optional", "obtainFrom": "Signed injector-face mass-flow history.", "usedFor": "CFD minus experiment backflow-duty-cycle comparison.", "missingEffect": "CFD backflow is not compared."
  },
  "experimentWallHeatFluxMWm2": {
    "format": "MW/m² at a documented location and averaging window.", "requirement": "Optional", "obtainFrom": "Calibrated heat-flux gauge or documented inverse heat-transfer method.", "usedFor": "Thermal-loading evidence.", "missingEffect": "Kythros makes no wall heat-flux claim."
  },
  "cfdWallHeatFluxMWm2": {
    "format": "MW/m² at the experiment-matched wall location and window.", "requirement": "Optional", "obtainFrom": "CFD wall heat-flux field or monitor.", "usedFor": "CFD minus experiment heat-flux comparison.", "missingEffect": "Wall heat flux is not compared."
  },
  "experimentPeakWallTemperatureK": {
    "format": "Kelvin; document sensor locations, response, and observation window.", "requirement": "Optional", "obtainFrom": "Calibrated thermocouple, pyrometry, or infrared measurement.", "usedFor": "Thermal-limit and cooling evidence.", "missingEffect": "Kythros makes no wall-temperature claim."
  },
  "cfdPeakWallTemperatureK": {
    "format": "Kelvin over the matched wall surface and time window.", "requirement": "Optional", "obtainFrom": "Conjugate or prescribed-wall CFD result.", "usedFor": "CFD minus experiment peak-temperature comparison.", "missingEffect": "Peak wall temperature is not compared."
  },
  "experimentSustainedDurationS": {
    "format": "Seconds of continuous reported response after startup.", "requirement": "Optional", "obtainFrom": "Test log and synchronized diagnostics.", "usedFor": "Separates a short mode observation from sustained-operation evidence.", "missingEffect": "Kythros does not claim repeatability or endurance."
  },
  "cfdSustainedDurationS": {
    "format": "Seconds of physical simulated time after startup transients.", "requirement": "Optional", "obtainFrom": "CFD time history and run log.", "usedFor": "Shows whether simulation covers the experimental sustained window.", "missingEffect": "Duration coverage is not compared."
  },
  "experimentWallFieldCsv": {
    "format": "CSV/TSV with axial position, circumferential angle, and at least one heat-flux or wall-temperature column.", "requirement": "Optional", "obtainFrom": "Calibrated heat-flux sensors, infrared/thermocouple reconstruction, or another documented spatial thermal diagnostic.", "usedFor": "Projects measured locations onto the physical annular chamber and preserves their exact coordinates in an unwrapped wall map.", "missingEffect": "No experimental thermal field is displayed; any scalar peak remains a scalar only."
  },
  "cfdWallFieldCsv": {
    "format": "CSV/TSV with axial position, circumferential angle, and wall heat flux or temperature using matched units and coordinates.", "requirement": "Optional", "obtainFrom": "CFD wall-surface export after applying the documented averaging window.", "usedFor": "Projects the CFD wall field onto the same physical chamber and exact unwrapped coordinates used by the experiment.", "missingEffect": "No CFD thermal field is displayed; Kythros does not invent a field from a peak value."
  }
} satisfies Record<CaseInputHelpKey, InputHelpDetails>;

export const CASE_INPUT_HELP: CaseInputHelpGroup[] = CASE_INPUT_HELP_BASE.map((group) => ({
  ...group,
  items: group.items.map((item) => ({ ...item, ...INPUT_HELP_DETAILS[item.key] })),
}));
