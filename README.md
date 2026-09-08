# Kythros by Caelus

Kythros is a connected RDE design and CFD research application. One immutable
engine revision supplies geometry, injectors, propellants, materials, cooling,
and operating limits across Rapid 2D, Detailed 2D, and Full 3D workflows. The
built-in Rapid 2D solver calculates a periodic reacting-flow field, maps that
field around the physical annulus in an interactive 3D viewer, and converts the
result into one controlled engine or operating-condition change plus one
next-simulation action. The downloadable Tauri desktop shell adds a local Full
3D execution boundary: it checks the workstation, launches a fixed solver
runtime, monitors the job, validates a true cylindrical volume result, and
displays solver-derived three-component streamlines inside the RDE.

The Operating Envelope records planned, simulation-only, and measured points.
Experiment Validation remains a separate optional workflow: it pairs three or
more synchronized hot-fire pressure traces with matching higher-fidelity CFD
virtual probes, checks whether differences exceed uncertainty, and recommends
one controlled rerun. Diagnosis, next action, evidence, and provenance stay
traceable without making experimental comparison the only product.

The pre-validation workflow is executable rather than only descriptive. Every
controlled rerun names one atomic CFD parameter, locks unrelated model-card
fields, and can start from a frozen, downloadable next-run work order. Frozen
plans are persisted before their result is loaded and completed through a
prospective CFD ledger. Baseline model cards can be prefilled from a Kythros
JSON manifest or inspected from selected OpenFOAM files or a case folder. When
a result is loaded, Kythros verifies the immutable engine revision, operating
point, probe mapping, synchronization state, and common time window, then saves
the engine and pairing fingerprints with the case. These controls improve
reproducibility but do not replace external matched experiment and CFD data.

The application starts as an empty workspace and accepts multiple operating
points. Its built-in Kythros Rapid 2D solver advances a reduced compressible
reacting-flow model directly in the browser. The finite-volume calculation uses
periodic circumferential boundaries, injector inflow, a pressure outlet, an
ignition kernel, simplified one-step heat release, a Rusanov flux, and an
adaptive CFL-limited time step. It returns the calculated pressure,
temperature, reaction-progress, and velocity fields plus wave, pressure-gain,
backflow, and approximate performance indicators. Detailed 2D and Full 3D use
the same engine record, operating condition, model controls, required outputs,
result import, and traceability workflow. Detailed 2D retains a solver-handoff
path. Full 3D is wired to the installed desktop runtime and will not start
unless the supported case, hardware, runtime, and solver checks all pass.

This browser calculation is deliberately a screening model. It omits detailed
chemical kinetics, turbulence, resolved injector jets, viscous wall heating,
cooling and component life, and three-dimensional flow. The 3D viewer wraps the
calculated circumferential–axial field around the annulus; it does not convert
the reduced model into a full 3D CFD solve. Traceable Detailed 2D and Full 3D
specifications remain available for reviewed solver execution and result return.
The Full 3D viewer is separate: it accepts only a radial × circumferential ×
axial result containing axial, radial, and circumferential velocity fields. It
never promotes the wrapped 2D calculation to Full 3D.
Work remains in memory until the user downloads a versioned workspace file;
refreshing the page does not provide durable browser storage.

The header Help guide defines every case-loader input. Pressure, spectrum,
residual, propagation-phase, and cycle-stability graphs remain absent until a
case has been parsed and analyzed; their traces are calculated from the active
case rather than embedded examples.

The current release is a research prototype. It does not certify a model or
prove the cause of a discrepancy.

## Desktop Full 3D execution

- `npm run desktop:dev` opens the existing application inside the Tauri shell.
- The Rust command layer owns hardware detection, fixed-path solver execution,
  progress polling, cancellation, per-job storage, and volumetric result return.
- Windows uses the `KythrosSolver` WSL2 distribution; Linux uses the same
  runtime at `/opt/kythros/bin/kythros-pelec-rdre`.
- `.github/workflows/kythros-desktop-installer.yml` builds the pinned CPU
  PeleC case, executes a real three-dimensional annulus smoke run, constructs
  the isolated solver runtime, and bundles it into a Windows NSIS installer.
- The initial case contract is intentionally narrow: rocket-fed annular
  hydrogen/air or hydrogen/oxygen designs using the reviewed PeleC RDRE pack.
- Full 3D engine advice is withheld until solver completion, mass conservation,
  and an adjacent mesh or time-step check pass the product's visible screening
  gates. These gates are not a claim of experimental validation.

See `docs/local-desktop-cfd.md` and `solver/pelec-rdre/README.md` for the
runtime contract and the remaining solver-pack validation work.

Automated regression tests use public evidence without presenting partial
checks as complete experiment-CFD validation. Three compact Zenodo pressure
records also appear in an explicitly experiment-only analyzer panel; they
exercise the production analyzer but have no matched CFD files or comparable
pressure-amplitude unit. Tobias
et al. Case A includes experiment and CFD results in the paper, so its printed
values exercise paired-comparison arithmetic, but the source does not release
matched numeric pressure arrays. The Strakey et al. combustion-model rerun
similarly exercises before-and-after outcome classification from reported
values. The source values are tabulated in
`public/data/published-paired-validation.csv`; calculated errors and outcome
labels are not stored in that file. None counts as an end-to-end Comparison
demonstration or validates the next-run recommendation engine.

## Comparison workflow hardening

- Separates mesh resolution from spatial method, flow time step from temporal
  method, chemistry mechanism from chemistry integration and combustion model,
  and inlet treatment from inlet forcing. A qualifying rerun can change only
  one named parameter family.
- Generates a frozen JSON work order containing the starting case, exact
  parameter, locked settings, required outputs, comparison question, and
  versioned classification rule.
- Preserves the work-order identifier and recommendation snapshot on reruns
  started from the decision panel, and keeps pending and completed plans in a
  prospective ledger.
- Adds a generic CFD model-card manifest, OpenFOAM case-folder inspection, and
  a solver handoff containing the frozen work order, locked-setting checklist,
  and an exact `deltaT` include only when a numerical target is safe to emit.
  Detected values and generated edits are always reviewed before application.
- Replaces the manual pairing checkbox with calculated checks and saved engine,
  operating-point, and pressure-pairing fingerprints.
- Makes every Build revision immutable. Refining geometry, materials, cooling,
  or operating limits creates a new engine ID while earlier evidence remains
  attached to the prior revision.
- Keeps the full reasoning ledger under a disclosure so the next action remains
  the primary interface.

## v2.0.0 Kythros hierarchy and evidence-learning envelope

- Renames the product to Kythros by Caelus.
- Stores one explicit hierarchy: engine/design → operating point → runs.
  Experiment, baseline CFD, and controlled CFD reruns therefore cannot be
  mistaken for separate physical conditions.
- Keeps Comparison focused on one operating point while its calculated mode,
  stability, evidence quality, and numerical status feed the separate
  Operating Envelope.
- Builds the measured envelope directly from completed real operating points
  and reports stable, transitional, and unstable counts without inventing a
  boundary between observations.
- Uses an explicit 2D slice with inlet pressure and mass flow as the default
  axes. The two remaining variables are shown as held-fixed controls, while
  geometry, injector, propellants, and walls are fixed by the engine record.
- Gates the first exploratory local-kernel classifier on at least 12 uploaded,
  signal-ready experimental points, at least two measured stability classes,
  60% buffered-holdout balanced accuracy, and 70% supported-holdout coverage.
  A prediction also requires three nearby observations; unsupported space stays
  blank. These counts and score limits are versioned prototype policies, not
  accepted RDE standards.
- Freezes each model-recommended prediction before the experiment and scores
  later outcomes. Five sequential blind recommendations, 60% accuracy, and a
  three-class Brier score no higher than 0.22 pass only Kythros's prototype
  prospective gate; they do not establish external validation or deployment
  readiness.
- Selects an uncertainty-aware next operating point only inside measured
  support. Until the model gate passes, the recommendation remains the
  transparent coverage-based screening point.
- Preserves older workspace files through a version-3 migration that creates
  explicit operating-point records from older engine-linked baselines.
- Defines the matching durable-storage target in
  `docs/kythros-data-model.sql`. Cloud persistence is not enabled until an
  authenticated owner boundary is available; downloaded workspace files are
  the persistence mechanism for this release.

## v1.7.0 design and screening workspace

- Adds engine-design records above operating points and CFD rerun case families.
- Records gas-fed annular geometry, injector configuration, propellants, and
  operating limits without inferring missing engineering inputs.
- Calculates mean diameter, annulus gap and area, chamber volume, total
  injector area, area ratio, mass-flux ranges, and pressure ratio directly from
  the entered values.
- Generates a nine-point screening plan and selects the next condition by
  measured coverage distance. This is a data-coverage decision, not an
  operability or performance prediction.
- Keeps Operating Envelopes separated by engine design, displays planned conditions
  as hollow markers, and excludes every synthetic case from physical-evidence
  counts.
- Exports a versioned design manifest and screening-plan CSV for CFD or test
  setup while marking predictive operability, backflow, performance, and
  thermal models as unavailable.

## v1.6.0 observed operating-map workspace

- Adds a separate Operating envelope tab while preserving the full Compare and
  diagnose workflow.
- Uses baseline cases as physical operating points and keeps their related CFD
  reruns attached to the same point.
- Calculates each marker's experimental stability, mode, frequency, wave
  speed, signal status, and numerical-convergence status from the saved case.
- Lets the user map equivalence ratio, inlet pressure, and mass flow without
  treating untested space as predicted behavior.
- Explicitly withholds interpolation and injector-backflow conclusions until a
  versioned model and the required injector or plenum channels exist.

## v1.5.1 plain-language decision states

- Every evidence column now says exactly what its findings mean. A zero count
  means no analyzed finding was classified in that direction; it does not mean
  the CSV is incomplete.
- The interface explicitly distinguishes pressure-file values from findings
  that Kythros calculates after comparing cases.
- Numerical-convergence, model-sensitivity, evidence-readiness, prior-family,
  and research-source descriptions now name what is compared, which rule is
  applied, and what the user should do next.
- Input help distinguishes values read from pressure files from manually
  entered study results, and case-entry errors identify the exact field that
  needs correction.
- The downloadable report uses the same plain-language definitions as the
  interface.

## v1.5.0 traceable generated recommendations

- Comparable precedent excludes the active case family, so a rerun cannot
  count itself as independent prior evidence.
- The decision card exposes the exact reviewed claim, DOI-linked sources, and
  applicability boundary for the active recommendation.
- Literature is attached claim by claim. Branches without a directly
  applicable paper say so instead of borrowing a nearby citation.
- Numerical and model-sensitivity limits are visibly labeled as versioned
  prototype policies rather than literature-derived acceptance limits.
- Next-run text is assembled from the selected variable, current setting,
  target metrics, calculated evidence, and structured policy fields. The old
  cause-specific recommendation paragraph bank and legacy single-trace
  recommendation function were removed.

## v1.4.4 immutable case relationships

- A saved case keeps the family, starting case, and declared CFD variable that
  were recorded when it was analyzed.
- The edit screen displays those relationship fields as locked and directs the
  user to add a new case when testing a different variable.
- Saving an edited case uses its stored relationship even if transient form
  state is modified, preventing a mesh rerun from being relabeled as an
  initialization rerun.

## v1.4.3 controlled-rerun guardrails

- After a starting case is selected, geometry, operating point, experiment
  setup, and unrelated CFD settings are inherited and locked.
- Only the declared CFD variable group, run time, and new CFD uncertainty may
  be edited. Switching the declared group restores the starting settings first.
- A rerun cannot reach analysis until at least one setting in the declared group
  changed and a new CFD result was mapped.
- A short review step names the starting case, reused experiment, changed
  settings, and new CFD file before the calculation begins.

## v1.4.2 controlled-rerun setup

- Selecting a case-family baseline and starting case now copies the complete
  starting model card into a new rerun.
- The exact experiment pressure samples are inherited from the starting case;
  the user uploads only the new CFD result.
- A relationship that cannot be used names every detected problem, including
  changed physical inputs, different experiment samples, a missing declared
  setting change, or extra CFD setting groups.
- The calculated result remains comparison-only until the declared one-change
  relationship passes all checks.

## v1.3 reasoning-engine update

- Uses the latest accepted rerun settings, so a follow-up mesh recommendation
  starts from the actual fine mesh rather than stale baseline metadata.
- Treats each result as an explicit state transition: continue, advance,
  repeat, or ignore.
- Closes mesh and flow-time-step sequences at a documented 2% adjacent-level
  response, advances after rejected/completed sensitivities, and repeats an
  inconclusive one-variable bracket.
- Requires exact experiment-trace equality and rejects hidden multi-setting
  changes before a related rerun can affect the plan.
- Adds a classifiable measured-unsteadiness branch and makes data-quality gates
  outrank CFD tuning.
- Adds comparable-case intelligence using only analyzed, verified controlled
  reruns. Synthetic precedents remain visibly labeled and do not influence
  uploaded cases.
- Recalculates every recommendation, outcome, metric improvement, and runtime
  summary from stored pressure arrays and entered case metadata. Workspaces
  contain inputs and relationships, not cached recommendations or preset
  conclusions.
- Uses a categorical recommendation status instead of an invented probability
  or additive readiness score. Signal quality, experiment-CFD pairing, a
  classified controlled rerun, and independent confirmation remain visible as
  separate conditions. Published references and public benchmarks never raise
  a case's recommendation status.

## v1.4.1 branch, provenance, and outcome-policy update

- Every controlled rerun now records both its case-family baseline and the exact
  starting case whose settings it inherited.
- Rerun error reduction, response magnitude, new mismatches, and runtime change
  are calculated against that starting case, not automatically against the
  original baseline.
- Confirmed or converged settings advance the accepted branch. Rejected and
  inconclusive settings do not; the plan resumes from their recorded starting
  case.
- The recommendation card identifies the shared family plan, the accepted
  starting case, and the unresolved evidence required by the active decision
  rule.
- Outcome limits are passed to the interface as structured numerical policy.
  The interface no longer extracts thresholds or case conclusions from canned
  strings.
- Numerical refinement is now judged only by adjacent-level CFD change. Whether
  agreement with experiment improved, worsened, or created another mismatch is
  calculated and reported separately rather than being mistaken for mesh or
  time-step convergence.
- The outcome panel selects a general rule set from the recommended variable:
  numerical convergence for mesh/time step, model-sensitivity evidence for
  physics changes, and case-specific pass/fail criteria for evidence gates.

## Version 1.0 product contract

Each case requires:

1. Annulus mean diameter, uncertainty, and at least three probe positions
2. Three or more synchronized experimental pressure traces, with four or more
   nonuniform probes recommended for stronger mode identifiability
3. Matching CFD virtual-probe traces
4. Sensor bandwidth and filter cutoff
5. Operating conditions
6. A detailed CFD model card
7. Experimental and numerical pressure/timing uncertainties
8. Confirmation that geometry, operating point, probes, clocks, and comparison window
   match

The interface returns only:

1. Likely issue
2. Recommended next run
3. Why

The downloadable report retains the full validity, data-quality, metric,
uncertainty, evidence-state, source, and next-run records.

## v0.4 changes implemented

- Data-quality checks for sample rate, duration, gaps, dropped rows, and
  clipping plateaus
- Comparison-validity checks for physical case matching, probe-layout alias
  risk, common evidence windows, and mode identifiability
- Cycle-resolved peak pressure, impulse, 10–90% rise time, second harmonic,
  and variability metrics
- Root-sum-square experiment/CFD uncertainty resolution for supported scalar
  outputs
- Separate statuses for within uncertainty, resolved mismatch, inconclusive,
  exact match, and prototype method-limit review
- Detailed solver, scheme, resolution, chemistry, boundary, initialization,
  and convergence inputs
- Removal of the previous opaque composite agreement score

## v0.5 changes implemented

- A deterministic diagnostic engine separated from the interface
- Ranked hypotheses that cite calculated discrepancies and the model-card
  settings that motivated them
- One-variable next-run plans with hold-fixed variables, expected behavior,
  confirmation criteria, rejection criteria, alternatives, and evidence
  strength
- Direct case-to-case physical and CFD-error deltas relative to a user-selected
  baseline
- A validation-coverage matrix that explicitly marks thermal and performance
  modules as not assessed when those measurements are absent
- Kythros branding throughout the interface and reports

That release also calculated every result directly from the saved case data rather than using an LLM.

## v0.6 changes implemented

- Replaced numeric hypothesis scores with explicit `supports`, `weakens`,
  `unknown`, and `cannot-assess` evidence states.
- Added a versioned source ledger containing seven primary RDE papers and one
  NIST V&V guide, with DOI, applicability, finding, and limitation records.
- Verified the bibliographic metadata against the publisher or issuing agency
  and narrowed cause mappings so papers are not cited for claims they did not
  study.
- Added optional baseline relationships for controlled reruns. A linked rerun
  affects a diagnosis only after Kythros verifies the same experiment and
  operating point and exactly one changed CFD variable group.
- Renamed the multi-case feature to case history. Every uploaded item remains
  a case; unrelated cases remain comparisons only.
- Reduced the visible case output to likely issue, recommended next run, and
  why. Detailed evidence and citations stay in the traceable report.

No LLM is used in v0.6.

## v0.7 pressure and wave-dynamics scope

- Accepts synchronized `P1` through `PN` pressure columns instead of a fixed
  three-probe format.
- Uses one robust shared experiment-to-CFD time alignment for the full probe
  array so independent alignment cannot erase spatial phase error.
- Uses a Hann-windowed FFT with interpolated dominant frequency.
- Fits wave count and direction candidates to circumferential phase and labels
  the result Identified, Candidate, or Not identifiable.
- Calculates cycle-by-cycle passage frequency and peak pressure, record-wide
  frequency drift, phase jitter, and window-to-window mode transitions.
- Adds calculated propagation and cycle-stability graphs below the concise
  recommendation.
- Checks sensor bandwidth, filter cutoff, Nyquist frequency, probe
  synchronization, and placement alias risk before trusting wave conclusions.
- Stores the reviewed primary method sources and their applicability limits in
  the downloaded evidence report.

No LLM is used in v0.7.

## v1.0 real-user workflow

- Maps arbitrary CSV, TSV, or semicolon-delimited time and pressure columns
  instead of requiring prescribed header names or column order.
- Converts user-confirmed time and pressure units into milliseconds and MPa,
  previews converted rows, and records the complete mapping in the case.
- Adds conclusion-specific data-quality gates for duration, sample density,
  time jitter, gaps, clipping, spectral signal-to-noise ratio, and aliasing.
- Withholds wave count, direction, speed, phase pattern, and jitter whenever
  the mapped probe array or data quality cannot uniquely support them.
- Gives every case input a specific unit/format, source location, calculation
  use, requirement state, and missing-input consequence.
- Saves and reopens complete browser workspaces with raw signals, mappings,
  metadata, uncertainty, and related-case links. Derived outputs are
  recalculated with the recorded analysis version rather than stored as stale
  duplicates.
- Replaces arbitrary next-run percentages with recommendations tied to the
  current model-card values, combined uncertainty, and documented sensitivity
  sequence.
- Reproduces five published RDE frequency/wave-count/geometry-to-speed values
  and runs two checksum-locked Zenodo pressure fixtures through the same
  multimode analyzer used for user-provided cases. These are analyzer regression
  tests, never paired experiment-CFD evidence or independent case-family evidence.

The historical v1.0 release did not include heat or thrust evidence, an LLM, or
automatic CFD execution. The current release can store and compare documented
scalar and spatial thermal/performance evidence, but it still does not predict
those quantities or execute CFD.

## v1.1 adaptive CFD run plan

- Keeps one immediate CFD run actionable while showing conditional next actions
  for confirmed, rejected, and inconclusive outcomes.
- Explains why the selected run outranks the alternative hypotheses without an
  opaque score.
- Separates evidence gates, numerical verification, physics sensitivity, and
  validation-envelope expansion.
- Evaluates verified related reruns against variable-specific target metrics and
  explicit response limits.
- Carries the latest controlled outcome into the recommendation even when the
  rerun itself is the active case.
- Includes the complete adaptive plan and latest outcome in the downloaded
  evidence report.

See [docs/published-validation.md](docs/published-validation.md) for dataset,
license, transformation, acceptance, and claim-boundary details.

## Code structure

- `lib/rde-analysis.ts`: signal parsing, pressure-cycle metrics, FFT spectra,
  data quality, and single-pair waveform comparison
- `lib/wave-dynamics.ts`: shared probe-array alignment, phase-mode fitting,
  drift, jitter, transitions, and mode identifiability
- `lib/wave-method-sources.ts`: reviewed primary sources for the wave-analysis methods
- `lib/uncertainty.ts`: uncertainty combination and resolved-difference states
- `lib/diagnostics.ts`: validity, metric assessments, hypotheses, and adaptive
  next-run plans
- `lib/case-history.ts`: related-case checks, direct deltas, and controlled-rerun outcomes
- `lib/diagnostic-knowledge.ts`: reviewed RDE source records and cause mappings
- `lib/caevera-types.ts`: case and model-card schemas
- `lib/data-import.ts`: delimited-file parsing, column mapping, unit conversion, provenance, and previews
- `lib/workspace.ts`: versioned complete-workspace save and restore
- `lib/published-benchmarks.ts`: attributable published calculation benchmarks and raw-dataset registry
- `components/pressure-file-mapper.tsx`: real-file mapping and preview interaction
- `app/page.tsx`: interaction and presentation

## Run locally

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run dev
```

Open the local address printed by the development server.

## Pressure-file mapping

Upload one experimental file and one CFD file as CSV, TSV, or
semicolon-delimited text. The columns may use any names and any order. In the
loader, explicitly select:

1. the acquisition-time column and its unit (`s`, `ms`, `us`, or `ns`);
2. one pressure column for every physical/virtual probe;
3. each pressure column's unit (`Pa`, `kPa`, `MPa`, `bar`, or `psi`).

Each file needs at least 32 valid mapped rows. The experiment and CFD files need
the same probe count, and the entered angles define their one-to-one physical
matching. Kythros previews values after conversion to milliseconds and MPa
before analysis. Nonuniform probe spacing is strongly preferred because equally
spaced layouts can alias wave-count and direction combinations.

## Verification

```bash
npm run test:analysis
npm run typecheck
npm run lint
npm test
```

The numerical suite covers exact agreement, known timing/amplitude mismatch,
data-quality failures, unit conversion, dropped-row provenance, multi-probe
mode recovery, shared alignment, frequency drift, mode transitions,
uncertainty classification, structured diagnostics, blocked
case matching, controlled case-history evidence, source integrity, and report content.
The suite also covers adaptive confirmed, rejected, and inconclusive branches.

## Scientific status

Uncertainty statuses use a root-sum-square one-standard-uncertainty estimate
(`k = 1`) from the inputs supplied by the user. This is not a certification
tolerance. Harmonic and cycle-variability checks still use clearly labeled
Kythros prototype product limits because estimator/repeatability uncertainty is not yet
available.

Diagnostic hypotheses prioritize controlled sensitivity studies; they are not
causal proof. Thermal, performance, species, optical, and whole-field
comparisons remain outside this release.

See [docs/methodology.md](docs/methodology.md) for equations, assumptions, and
claim boundaries, [docs/pressure-wave-sources.md](docs/pressure-wave-sources.md)
for the pressure/wave method sources,
[docs/published-validation.md](docs/published-validation.md) for the validation
case ledger, and [docs/diagnostic-sources.md](docs/diagnostic-sources.md) for the
diagnostic source ledger.
