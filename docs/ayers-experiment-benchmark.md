# Ayers Configuration A: first executable experiment comparison

Source: Z. M. Ayers, V. Athmanathan, T. R. Meyer, and D. E. Paxson,
“Variably Premixed Rotating Detonation Engine for Evaluation of Detonation
Cycle Dynamics,” Journal of Propulsion and Power 39(3), 2023.
DOI: https://doi.org/10.2514/1.B38868
Author manuscript: https://ntrs.nasa.gov/api/citations/20220016805/downloads/Ayers_JPP_2022_11042022.pdf

This work is suitable for investigating premixed hydrogen/air models because it
separates mixing effects. We selected Configuration A, Table 1 case (i), because
its straight annulus does not require Configuration B's backward-facing step
and shortened centerbody. This is an **exploratory model discrepancy benchmark**,
not a matched validated CFD case.

## Source ledger

| Quantity | Source value | Locator (printed manuscript page) |
| --- | --- | --- |
| Inner / outer diameter | 120.9 / 135.6 mm | Fig. 1(a), p. 6 |
| Chamber / centerbody length | 138.1 / 138.1 mm | Fig. 1(a), p. 6 |
| Chamber mass flux | 55 kg/(m² s) | Table 1 case (i), p. 13 |
| Equivalence ratio / premixed fraction | 1.03 / 1.0 | Table 1, p. 13 |
| Manifold temperature | 295 K | Table 1, p. 13 |
| Manifold pressure | 0.89 MPa = 8.9 bar | Table 1, p. 13 |
| Mean chamber pressure | 0.110 MPa = 1.10 bar | Table 1, p. 13 |
| Static-pressure station | 9.1 mm downstream of injector | Section III.C, p. 12 |
| Observed wave behaviour | Counterpropagating pair | Fig. 6 and discussion, p. 13 |

The figure diameters imply a 7.35 mm gap, whereas the text and inset state
7.62 mm. Preserve this conflict. We use the diameter labels and derive total
mass flow as mass flux times annular area. We do not silently adjust geometry
or the observation to improve agreement. Ambient outlet pressure 1.01325 bar
is a model assumption, not a measured source value.

The source's 4.2 kHz example is not assigned as a quantitative target to this
case: it describes a Configuration B example, not Table 1 case (i).

## Reproduce

From the repository root, with Node >=22.13:

```
node --experimental-strip-types scripts/run-ayers-benchmark.mjs
```

The script runs the production Fast 2D solver three times:

- baseline: 64 × 24, maximum step 500 ns;
- mesh change only: 128 × 48, maximum step 500 ns;
- time-step change only: 64 × 24, maximum step 250 ns.

All runs end at 1 ms. Point pressure at azimuth zero and axial position 9.1 mm
is interpolated between periodic/axial cell centers. The 0.5–1 ms mean is
integrated over actual solver time steps, not averaged over animation frames.
CFL still limits the time step. Source-input, solver-source SHA-256, output
SHA-256, settings, diagnostics, and differences are saved in
`public/data/benchmarks/ayers-case-i-report.json`.

`ayers-case-i-replay.json` stores an actual baseline result with 48 frames and
probe history. Stored display values have eight significant digits; the report
retains full precision. The GIF encoder uses a single pressure color range for
all frames and timing proportional to physical frame timestamps. It does not
interpolate movement, synthesize flame imagery, or present calculated frames
as experimental footage. The export is slowed to approximately six seconds.

## Result and interpretation

The initial study gives about 5.34 bar at baseline, 5.09 bar on the finer mesh,
and 5.34 bar at the smaller time step. The reference is 1.10 bar. This is a
large descriptive discrepancy, not evidence of agreement. Mass balance passes
but does not establish physical accuracy. Two resolution levels do not prove
asymptotic convergence or justify a grid-convergence index.

The crucial mismatch is the inlet: the experimental porous medium dissipates
pressure, but the current Fast 2D fixed-state boundary receives the 8.9 bar
manifold value directly. Existing inlet-velocity clipping is also retained;
entered flow is therefore not a guarantee of realized boundary mass flux.
No coefficients or boundary values are fitted to the observed 1.10 bar.
The local 3D discrete-hole case is not substituted for the porous injector.

Other gaps: inviscid constant-property single-step chemistry, different
ignition treatment, no CTAP response model, a short numerical startup interval
rather than an established firing interval, no quantified uncertainty for the
printed mean, and the inconsistent published annular gap. The observation
of counterpropagation cannot be verified by the current single-peak tracker;
no mode agreement is claimed. The paper does not supply a raw pressure array
for this case, and none is fabricated from the scalar mean or plotted images.

The next modelling step is an independently specified porous-inlet boundary,
then sufficient post-transient duration and spatial/temporal refinement before
making an experimental validation claim. This benchmark deliberately remains
`not-validated` even if an individual scalar happens to match.

## App

Open **Benchmark** in the top navigation. The saved baseline loads immediately;
Run benchmark recomputes the selected configuration. Play/scrub the actual
calculated frames, download a GIF or the full run JSON, and inspect the recorded
three-run study. Desktop Vite now copies the existing public directory so the
benchmark data also ship in the installed app.
