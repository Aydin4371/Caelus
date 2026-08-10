# Caevera by Caelus

Caevera is a browser-based RDE simulation-to-test research application. It
compares three synchronized experimental pressure traces with matching CFD
virtual probes, determines whether differences are resolved beyond the stated
uncertainty, orders traceable diagnostic hypotheses by evidence state, and recommends one
controlled next simulation.

The application starts as an empty case workspace and accepts multiple
operating points. It does not run CFD. Uploaded data and deterministic analysis
remain in the browser session.

The header Help guide defines every case-loader input. Pressure, spectrum, and
residual graphs remain absent until a case has been parsed and analyzed; their
traces are calculated from the active case rather than embedded examples.

The current release is a research prototype. It does not certify a model,
establish an engine-wide operating envelope, or prove the cause of a
discrepancy.

## Version 0.6 product contract

Each case requires:

1. Annulus mean diameter and three nonuniform probe positions
2. Three synchronized experimental pressure traces
3. Matching CFD virtual-probe traces
4. Operating conditions
5. A detailed CFD model card
6. Experimental and numerical pressure/timing uncertainties
7. Confirmation that geometry, operating point, probes, and comparison window
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

## Code structure

- `lib/rde-analysis.ts`: signal parsing, alignment, pressure-cycle metrics,
  spectra, data quality, and rotating-mode inference
- `lib/uncertainty.ts`: uncertainty combination and resolved-difference states
- `lib/diagnostics.ts`: validity, metric assessments, hypotheses, and next-run
  plans
- `lib/case-history.ts`: related-case checks, direct deltas, and controlled-rerun evidence
- `lib/diagnostic-knowledge.ts`: reviewed RDE source records and cause mappings
- `lib/caevera-types.ts`: case and model-card schemas
- `app/page.tsx`: interaction and presentation

## Run locally

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run dev
```

Open the local address printed by the development server.

## Pressure-file format

Upload one experimental file and one CFD file. Each contains a shared time base
and three pressure columns:

```csv
time_ms,p1_MPa,p2_MPa,p3_MPa
0.000000,1.602100,1.052079,2.259342
0.002500,1.751244,1.217591,2.365071
```

Each file needs at least 32 valid rows. Supported time units are `ms`, `s`, and
`us`; supported pressure units are `MPa`, `kPa`, and `Pa`. Nonuniform probe
spacing is strongly preferred because equally spaced layouts can alias some
wave-count and direction combinations.

## Verification

```bash
npm run test:analysis
npm run typecheck
npm run lint
npm test
```

The numerical suite covers exact agreement, known timing/amplitude mismatch,
data-quality failures, unit conversion, dropped-row provenance, three-probe
mode recovery, uncertainty classification, structured diagnostics, blocked
case matching, controlled case-history evidence, source integrity, and report content.

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
claim boundaries, and [docs/diagnostic-sources.md](docs/diagnostic-sources.md)
for the reviewed source ledger.
