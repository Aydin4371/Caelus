# Public-data validation boundary

Kythros separates public evidence by what the source actually releases. A
source-reported observation is never relabeled as an independently inferred
Kythros result.

## Runtime-calculated checks

- Three Oexle–Bohon public pressure records are stored as 4,096-sample JSON
  fixtures under `public/data/`. The browser loads those arrays and runs the
  production `analyzeRdeProbeSet` function. The displayed frequencies,
  secondary-component checks, identifiability, phase residuals and pass/fail
  states are calculated at runtime.
- Five Xue et al. wave-speed cases are recalculated from passage frequency,
  mean annulus diameter and wave count. The displayed residual is not stored.
- The 13 Ge et al. operating conditions preserve the authors' propagation-mode
  strings. Stable/transitional/unstable counts are a deterministic display
  grouping calculated from those strings, not a raw-signal reanalysis.

## Thermal evidence levels

Public RDE thermal sources often publish campaign ranges, axial plots, sparse
sensor diagrams or color figures without a numerical surface array. Kythros
therefore distinguishes:

1. campaign range;
2. axial profile;
3. sparse axial-angle sensors;
4. numerical surface field.

A campaign range is shown as a range. It is not assigned to individual wall
locations. An uploaded axial profile renders as circumferentially averaged
bands and a one-dimensional plot. Only records with explicit axial position,
circumferential angle and numerical value render as a surface field.

The public thermal ledger currently contains the Lim RP-2/GOX dissertation,
two NASA calorimeter configurations, Shi et al.'s infrared study and the 2024
H2-air thermocouple study. None is silently digitized from figure colors.

## What these checks do not validate

The public package validates selected calculations, conservative signal-mode
behavior, data provenance, missing-data handling and interface workflows. It
does not establish general classifier accuracy, CFD diagnostic accuracy,
thermal-field prediction, a learned operating boundary or the quality of a
next-test recommendation. Those claims require additional eligible raw engine
campaigns and prospective blind tests.
