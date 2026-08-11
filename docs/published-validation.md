# Published pressure/wave validation cases

Caevera separates calculation validation from complete experiment–CFD validation.

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

## Registered raw experimental dataset

The real-data ledger also records:

D. Oexle and M. Bohon, “High speed video image and pressure data of counter
rotating detonation waves,” Zenodo (2026). DOI:
[10.5281/zenodo.18886925](https://doi.org/10.5281/zenodo.18886925).

The CC BY 4.0 archive contains raw and processed MATLAB pressure records plus
high-speed-imaging labels for BD0041, BD0038, and CE2029. It is 3.4 GB and is
experiment-only. Caevera therefore registers these cases and their expected
multimode behavior, but does not claim that a small invented or digitized trace
is the released dataset. A future compact fixture must be extracted with
recorded file hashes, variable names, time windows, probe coordinates, and the
dataset’s processing scripts.

## Current claim boundary

At v1.0, published tests verify the wave-speed calculation against exact
reported values and maintain a traceable real-data fixture target. Complete
paired experiment–CFD validation still requires numeric pressure arrays from
both sides at matching probe locations and operating conditions.
