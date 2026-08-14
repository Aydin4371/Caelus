# Caevera by Caelus

Caevera is a browser-based RDE simulation-to-test research application. It
compares three or more synchronized experimental pressure traces with matching
CFD virtual probes, determines whether differences are resolved beyond the stated
uncertainty, orders traceable diagnostic hypotheses by evidence state, and recommends one
controlled next simulation. When a related rerun is added, Caevera classifies
the predicted response as confirmed, converged, rejected, or inconclusive and
updates the next recommendation. It also aggregates comparable controlled
reruns already loaded in the workspace, showing observed outcome counts,
metric-error improvement, and runtime multiplier without inventing precedent.
The interface leads with the engineering conclusion and keeps the underlying
case counts available as a disclosure rather than presenting unexplained raw
statistics.
Diagnosis, next action, expected result, comparable-case history, and input
provenance now appear in one engineering-decision card. Technical ranking and
conditional branches remain available under disclosures.

The application starts as an empty case workspace and accepts multiple
operating points. It does not run CFD. Uploaded data and deterministic analysis
remain in the browser session.

The header Help guide defines every case-loader input. Pressure, spectrum,
residual, propagation-phase, and cycle-stability graphs remain absent until a
case has been parsed and analyzed; their traces are calculated from the active
case rather than embedded examples.

The current release is a research prototype. It does not certify a model,
establish an engine-wide operating envelope, or prove the cause of a
discrepancy.

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
- Adds comparable-case intelligence using only loaded, verified controlled
  reruns. Synthetic precedents remain visibly labeled and do not influence
  uploaded cases.
- Recalculates every recommendation, outcome, metric improvement, and runtime
  summary from stored pressure arrays and entered case metadata. Workspaces
  contain inputs and relationships, not cached recommendations or preset
  conclusions.
- Uses an evidence-strength label instead of an invented probability. Caevera
  does not display a percentage confidence until a real calibration dataset can
  support one.

## v1.4 branch and provenance update

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
- Caevera branding throughout the interface and reports

That release also used deterministic local analysis rather than an LLM.

## v0.6 changes implemented

- Replaced numeric hypothesis scores with explicit `supports`, `weakens`,
  `unknown`, and `cannot-assess` evidence states.
- Added a versioned source ledger containing seven primary RDE papers and one
  NIST V&V guide, with DOI, applicability, finding, and limitation records.
- Verified the bibliographic metadata against the publisher or issuing agency
  and narrowed cause mappings so papers are not cited for claims they did not
  study.
- Added optional baseline relationships for controlled reruns. A linked rerun
  affects a diagnosis only after Caevera verifies the same experiment and
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
  multimode analyzer used for uploads. These are analyzer regression tests,
  never paired experiment–CFD evidence or company precedent.

No heat, thrust, LLM, or automatic CFD execution is included in v1.0.

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
matching. Caevera previews values after conversion to milliseconds and MPa
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
prototype method limits because estimator/repeatability uncertainty is not yet
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
