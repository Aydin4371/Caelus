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

## Current claim boundary

Published tests currently verify five wave-speed calculations and three
pressure-record behaviors. They validate the analyzer, not a customer case.
Production recommendations are recalculated from the active uploaded
experiment and CFD arrays, entered metadata, declared uncertainty, and any
qualifying controlled company reruns. Complete paired experiment–CFD validation
still requires numeric pressure arrays from both sides at matching probe
locations and operating conditions.
