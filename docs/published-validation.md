# Published pressure/wave validation cases

Kythros separates calculation validation from complete experiment–CFD validation.

## Automated tabulated benchmarks

The automated suite reproduces five published frequency/geometry/wave-count to
propagation-speed cases from:

S. Xue, X. Zhang, J. Yang, D. Liu, H. Ma, and C. Zhou, “Experimental study on
the rotating detonation engine based on a gas mixture,” *Frontiers in Energy
Research*, 11, 1136156 (2023). DOI:
[10.3389/fenrg.2023.1136156](https://doi.org/10.3389/fenrg.2023.1136156).

The paper states outer and inner annulus diameters of 206 mm and 166 mm. The
mean diameter is therefore 186 mm. Its printed passage frequencies and
propagation velocities are rounded, so the acceptance tolerance is explicitly
2 m/s. The short-combustor record is tested as a two-wave mode; dividing
passage frequency by wave count is therefore part of the benchmark.

These tests validate the deterministic conversion

```text
wave speed = pi × mean diameter × passage frequency / wave count
```

They do not validate pressure-amplitude extraction, CFD agreement, or a causal
diagnosis.

## Automated pressure-record benchmarks

The real-data ledger also records:

D. Oexle and M. Bohon, “High speed video image and pressure data of counter
rotating detonation waves,” Zenodo (2026). DOI:
[10.5281/zenodo.18886925](https://doi.org/10.5281/zenodo.18886925).

The CC BY 4.0 archive contains raw and processed MATLAB pressure records plus
high-speed-imaging labels for BD0041, BD0038, and CE2029. It is experiment-only.

Three 4,096-sample compact fixtures are committed and run through the
production `analyzeRdeProbeSet` function on every test run. Each fixture uses
zero-based source index 70,921, retains every second sample from the 500 kHz
processed pressure record, and rounds stored channel values to six decimal
places. The source archive path, start index, stride, and sample rate are
recorded in `lib/published-benchmarks.ts`:

- **BD0041 / 2CR:** must not yield a unique single-mode result when the two
  counter-rotating waves have similar speed. The test checks the published
  passage-frequency neighborhood, a large spatial phase residual, and a
  withheld wave speed.
- **BD0038 / 2CRT:** must expose the separated secondary non-harmonic component
  and withhold a unique single-mode result.
- **CE2029 / DS2:** the seven source channels contain only four unique
  circumferential angles. The test preserves those recorded angles, uses the
  four unique azimuths for spatial phase analysis, and requires the strong
  second non-harmonic component to prevent a false single-mode result.

The committed JSON files are protected by SHA-256 values in
`lib/published-benchmarks.ts`. The pressure values retain the source-processed
channel unit, so these fixtures validate frequency and mode ambiguity, not MPa
amplitude. CE2029 does not validate a full three-wave reconstruction because
the published pressure geometry has only four unique circumferential angles;
it validates the more conservative requirement that Kythros not force one
identified rotating mode from a strong multi-component spectrum.

## Published paired experiment-CFD values

The public-data ledger also contains three matched Case A values from:

J. R. Tobias, A. K. Agrawal, and D. E. Paxson, “Experimental and
Computational Analysis of a Rotating Detonation Combustor,” *AIAA SciTech
2022*. NASA manuscript:
[20210024138](https://ntrs.nasa.gov/api/citations/20210024138/downloads/AIAA_SciTech_2022_UA_Tobias_final.pdf).

The paper prints measured and simulated wave frequency plus measured and
simulated static pressure at CTAP 1 and CTAP 3. Kythros stores only those source
values, then calculates signed percent differences at runtime. The source
ledger is `public/data/published-paired-validation.csv`.

The paper does contain CFD results. These values validate paired-comparison
arithmetic and its presentation, but they are not a loadable Comparison case.
They do not validate waveform alignment, pressure-amplitude extraction, or
spatial mode identification because the source does not release matched numeric
experiment and CFD pressure arrays.

## Retrospective one-factor rerun

The same ledger records the 0.5 mm comparison from:

P. A. Strakey, C. R. Bedick, and D. H. Ferguson, “Computational Fluid Dynamics
Combustion Modeling for Rotating Detonation Engines,” AIAA SciTech 2021.
OSTI manuscript: [1765177](https://www.osti.gov/servlets/purl/1765177).

The paper reports a one-wave, 1740 m/s experiment; a two-wave, 1790 m/s CFD
case without turbulence-chemistry interaction; and a one-wave, 1844 m/s PaSR
case using the same numerical settings. Kythros computes the before-and-after
wave-count error and wave-speed error. The mode error improves while the
wave-speed error worsens, so the runtime result is classified as mixed rather
than as an overall success.

This checks one-factor outcome classification on real published values. It is
retrospective because the same paper supplies the intervention and its outcome;
it does not prove that Kythros selected the intervention before seeing the
result. The paper contains CFD results, but it does not provide the matched raw
experiment and CFD pressure files needed by the Comparison loader.

## Current claim boundary

Published checks now verify five wave-speed calculations, three raw
pressure-record behaviors, one paired scalar comparison, and one retrospective
controlled rerun. These remain automated regression checks and documented
source records. They are not shown on the homepage because they do not exercise
the full Comparison and next-run recommendation workflow.

Production recommendations remain recalculated from the active uploaded
experiment and CFD arrays, entered metadata, declared uncertainty, and any
qualifying controlled company reruns. Complete paired waveform validation still
requires numeric pressure arrays from both sides at matching probe locations
and operating conditions. Prospective recommendation validation additionally
requires that the follow-up CFD result be withheld until after Kythros records
its recommendation.
