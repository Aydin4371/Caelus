# Caevera RDE methodology

## Scope

Version 0.5 analyzes one matched RDE operating point using at least three
synchronized experimental pressure traces and matching CFD virtual probes. It
asks:

> Does the CFD reproduce the measured rotating-wave and pressure behavior,
> which differences are resolved beyond uncertainty, and what single controlled
> run should be performed next?

It does not validate the complete engine or prove that a ranked hypothesis
caused a discrepancy.

## Required assumptions

- Experiment and CFD use the same geometry and operating condition.
- Each virtual probe represents the corresponding physical sensor position.
- Probe clocks are synchronized and major trigger offsets are already known.
- Probe angles share one annulus direction and reference.
- Pressure and timing uncertainties are supplied as one-standard-uncertainty
  estimates when the user wants a resolved/unresolved interpretation.
- Annulus geometry is represented by a mean diameter for wave-speed inference.

Nonuniform probe positions are preferred. Three equally spaced probes can make
some combinations of wave count and direction indistinguishable.

## 1. Comparison validity

Before interpreting CFD error, Caevera checks:

1. explicit confirmation that geometry, operating point, coordinates, and
   evidence window match;
2. probe-layout alias risk;
3. whether all traces provide a usable common window; and
4. confidence in the selected rotating mode relative to the next-best mode.

An unconfirmed physical pairing blocks tuning recommendations. Data-quality or
mode-identifiability findings produce a review state rather than silently
continuing as if the comparison were definitive.

## 2. Data quality

For each trace, Caevera reports sample count, duration, sample rate, samples per
dominant cycle, captured cycles, interval variation, detected gaps, dropped
source rows, and possible clipping plateaus.

Current review rules flag fewer than five captured cycles, fewer than twenty
samples per cycle, sample-interval variation above 1%, acquisition gaps,
dropped nonnumeric rows, or three or more consecutive identical samples.

These are explicit prototype checks. Passing them does not establish a sensor
transfer function or eliminate measurement bias.

## 3. Common time base and bounded alignment

For each probe pair, Caevera uses the larger median sample interval and linearly
interpolates experiment and CFD over their common time interval. The interactive
analysis uses at most 2,400 native-interval samples.

At candidate lag \(\ell\), normalized correlation is

\[
r(\ell)=
\frac{\sum_n (p_t[n]-\bar p_t)(p_c[n+\ell]-\bar p_c)}
{\sqrt{\sum_n(p_t[n]-\bar p_t)^2\sum_n(p_c[n+\ell]-\bar p_c)^2}}.
\]

Because RDE signals are periodic, automatic alignment is restricted to 45% of
the preliminary dominant period. Larger offsets require an acquisition trigger
or timestamp.

## 4. Frequency, residual, and pressure-cycle metrics

The dominant frequency comes from the pressure amplitude spectrum. For test
frequency \(f_t\) and CFD frequency \(f_c\), the signed difference is

\[
\Delta f=f_c-f_t.
\]

The sinusoidal-equivalent oscillation amplitude is

\[
A=\sqrt{2}\,\mathrm{RMS}(p-\bar p).
\]

Rising mean crossings define pressure cycles. Caevera calculates:

- mean peak pressure across complete cycles;
- mean positive pressure impulse per cycle,
  \(I=\int_{cycle}\max(p-\bar p,0)\,dt\);
- median 10–90% rise time around the rising front;
- second-harmonic-to-fundamental amplitude ratio; and
- coefficient of variation of cycle pressure range.

After alignment, residual \(\epsilon[n]=p_t[n]-p_c[n]\) supplies RMSE,
normalized RMSE, correlation, and mean pressure bias.

## 5. Rotating-mode inference

The mode frequency is the median rising-mean-crossing frequency across probes.
At that frequency, Caevera calculates complex phase \(\phi_i\) at every probe
position \(\theta_i\).

For candidate wave count \(m\in\{1,2,3,4\}\) and direction sign
\(s\in\{-1,+1\}\), predicted relative phase is

\[
\Delta\phi_i^{pred}=s\,m\,(\theta_i-\theta_1).
\]

The candidate with the smallest mean wrapped phase error is selected. The
reported confidence combines the best phase fit with separation from the
next-best wave-count/direction candidate. Caevera reports that alternative so
the mode classification is not presented as uniquely certain when it is not.

For mean annulus diameter \(D\), detected temporal frequency \(f\), and wave
count \(m\), circumferential speed is

\[
c=\frac{\pi D f}{m}.
\]

With \(D\) in millimetres and \(f\) in kilohertz, \(c\) is in metres per
second.

## 6. Stability classification

Each trace is divided into two windows. Caevera combines cross-window
frequency drift with circumferential phase fit:

- **Stable:** drift \(\le 3\%\) and phase fit \(\ge 0.90\)
- **Transitional:** drift \(\le 8\%\) and phase fit \(\ge 0.75\)
- **Unstable:** otherwise

This does not yet resolve intermittent mode switching or simultaneous modes.

## 7. Uncertainty-aware difference states

For an experiment value \(x_t\), CFD value \(x_c\), and corresponding standard
uncertainties \(u_t\) and \(u_c\), Caevera uses

\[
u_{comb}=\sqrt{u_t^2+u_c^2}.
\]

A scalar difference is **within uncertainty** when

\[
|x_c-x_t|\le u_{comb},
\]

and a **resolved mismatch** otherwise. Missing uncertainty produces an
inconclusive state rather than a pass.

Pressure-derived uncertainty uses the supplied relative pressure values.
Frequency uncertainty combines half a finite-record spectral bin with the
supplied timing contribution. Wave-speed uncertainty propagates frequency only;
diameter uncertainty is not yet an input. Rise-time uncertainty combines the
two timing inputs. Pressure impulse combines pressure and timing contributions.

Harmonic ratio and cycle variability currently use labeled prototype method
limits because estimator and repeatability uncertainty are not supplied. Their
status is not described as uncertainty resolution.

## 8. Diagnostic engine

The diagnostic engine is deterministic. It receives:

- validity and data-quality findings;
- resolved scalar and exact categorical discrepancies;
- waveform and cycle metrics; and
- the detailed CFD model card.

Candidate hypothesis families include case/data mapping, acquisition quality,
spatial resolution or numerical dissipation, inlet/chemistry timescale,
boundary pressure treatment, mode initialization, wall loss or reaction-rate
energy release, shock-capturing/harmonic response, and missing unsteadiness.

Each hypothesis records the discrepancy evidence and the model-card inputs that
motivated it. The highest-ranked candidate becomes a structured next-run plan:

- one recommended change;
- variables to hold fixed;
- expected outcome;
- confirmation criterion;
- rejection criterion;
- alternative hypothesis; and
- evidence strength.

The result prioritizes a sensitivity experiment. It is not causal inference.

## 9. Direct campaign comparison

The user selects one loaded case as a baseline. For every other case, Caevera
calculates direct deltas in inlet pressure, temperature, equivalence ratio,
mass flow, experimental frequency, wave speed, amplitude, peak pressure, and
cycle variability.

Separately, it reports how absolute CFD percentage error changed for frequency,
peak pressure, and amplitude. A negative CFD-error delta means agreement
improved. This prevents a favorable physical engine change from being confused
with better model accuracy.

## 10. Coverage and traceable report

The coverage matrix marks wave dynamics and pressure as assessed. Thermal and
performance remain not assessed unless those measurements are added in later
modules. The JSON report stores metadata, source names, modes, validity, data
quality, uncertainty states, per-probe evidence, ranked hypotheses, next-run
plan, methods, and limitations.

## Known limitations

- The method has not yet been validated against a paired public RDE benchmark
  campaign or withheld laboratory cases.
- Sensor dynamic response and transfer-function correction are not applied.
- Geometry, parameter, and model-form uncertainty are not fully propagated.
- Harmonic and repeatability uncertainty are not estimated.
- Mode inference assumes synchronized probes and one dominant rotating mode.
- Diagnostic ranking is rule-based and needs comparison with expert decisions.
- Heat flux, wall temperature, thrust, optical diagnostics, species, and full
  spatial fields are outside version 0.5.
- One operating point cannot establish a validation envelope.

## Evidence required for a research release

A stronger release should pre-register tolerances, use paired public or
partner-laboratory data, withhold operating points from method development, and
compare Caevera recommendations with expert assessments. It should report
sensitivity to sample rate, window length, noise, missing samples, timing error,
probe placement, sensor response, mesh refinement, and time-step refinement.
