# Concordia by Caelus

Concordia is a browser-based RDE research application that compares three
synchronized hot-fire pressure traces with matching CFD virtual probes. It
opens as an empty case workspace, accepts multiple operating points during a
browser session, and turns each paired case into a compact, traceable
assessment of wave behavior, CFD–test mismatch, possible model drivers, and
the next useful run.

**Caelus** is the company/project identity. **Concordia** is the product: a
simulation-to-test assurance layer for advanced propulsion.

The current release is a deterministic research prototype. It does not run
CFD, establish an engine-wide operating envelope, prove the cause of a
discrepancy, or replace formal verification, validation, and uncertainty
quantification.

## Version 0.4 product contract

Concordia requires:

1. Annulus geometry
2. Three or more physical-sensor and virtual-probe positions
3. At least three synchronized experimental pressure traces
4. Matching CFD pressure traces
5. Operating conditions
6. A basic CFD model card
7. Sensor uncertainty

It returns:

1. Dominant wave frequency
2. Circumferential wave speed
3. Wave count and direction
4. Mode stability
5. Pressure and waveform mismatch
6. Ranked model hypotheses to investigate
7. A recommended next simulation or measurement
8. A versioned, traceable JSON report

## What is implemented

- Local three-probe CSV import; pressure data remains in the browser session
- Multiple named operating points with a clear case selector
- An optional synthetic example that opens from the otherwise empty workspace
  to explain the comparison format without becoming the default case
- A direct, large-format experiment-versus-CFD comparison table showing the
  signed CFD-minus-experiment difference, the current limit, and the outcome
- A case-level conclusion that identifies exactly how many checks need review
- Honest waveform reporting: correlation is assessed against its current
  prototype limit, while normalized RMSE and mean bias remain ungraded until
  uncertainty propagation is implemented
- Unit-aware parsing for milliseconds, seconds, microseconds, Pa, kPa, and MPa
- Common-time-base interpolation and bounded sub-cycle alignment
- Dominant pressure frequency, amplitude, correlation, bias, RMSE, and residual
  comparison at each probe
- Three-probe phase fitting for one-to-four-wave mode count and direction
- Wave speed derived from mean annulus diameter, frequency, and wave count
- Prototype stability classification from phase fit and sub-window frequency
  drift
- Model-card-aware ranking of investigation hypotheses
- Downloadable case report containing inputs, sources, methods, outputs, and
  claim limitations
- Deterministic synthetic three-probe demonstration data
- Automated numerical and rendered-application tests

The analysis is deliberately separated from the interface in
`lib/rde-analysis.ts`. An engineer can inspect and test the method without
trusting dashboard code or a language model.

## Run locally

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run dev
```

Open the local address printed by the development server.

## Pressure-file format

Upload one experimental file and one CFD file. Each file contains the shared
time base and three pressure columns:

```csv
time_ms,p1_MPa,p2_MPa,p3_MPa
0.000000,0.152100,-0.447921,0.809342
0.002500,0.301244,-0.282409,0.915071
```

Each file needs at least 32 rows. Supported time units are `ms`, `s`, and `us`;
supported pressure units are `MPa`, `kPa`, and `Pa`. Probe aliases include
`p1_MPa`, `pressure_p1_MPa`, `probe1_MPa`, and `sensor1_MPa`, repeated for P2
and P3.

The two files must represent the same geometry, probe positions, operating
condition, and acquisition window. Nonuniform probe spacing is strongly
preferred because some equally spaced layouts alias wave count and direction.

## Verification

```bash
npm run test:analysis
npm run typecheck
npm run lint
npm test
```

The numerical tests cover exact CFD–test agreement, recovery of a known timing
and amplitude difference, unit conversion, malformed input rejection,
three-probe parsing, and recovery of a known rotating mode, direction, wave
speed, and stability.

## Scientific status

The current thresholds are explicit prototype review rules, not universal RDE
validation criteria. A result marked **within limit** is not a probability of
validity or certification claim. Investigation priorities are hypotheses for
targeted testing, not causal conclusions, and are only ranked when at least one
comparison exceeds a current limit. Sensor uncertainty is recorded in the
report but is not yet propagated through every output.

The next research milestone is evaluation against paired published or
partner-laboratory data, followed by uncertainty propagation and withheld-case
testing. An operating envelope should be added only after multiple defensible
operating points exist.

See [docs/methodology.md](docs/methodology.md) for equations, assumptions, and
claim boundaries.

This software is for research and demonstration. It is not approved for design
certification, safety-critical decisions, or operational use.
