# Concordia RDE methodology

## Scope

Version 0.3 analyzes one RDE operating point using at least three synchronized
experimental pressure traces and matching CFD virtual probes. It asks:

> Does the CFD reproduce the measured rotating-wave behavior at this operating
> point, where does it differ, and what should be tested next?

It does not validate the complete engine or prove that a ranked model
hypothesis caused the discrepancy.

## Required assumptions

- Experimental and CFD traces use the same geometry and operating condition.
- Each virtual probe represents the corresponding physical sensor position.
- Probe clocks are synchronized and large acquisition-time offsets are already
  resolved from timestamps or a trigger.
- Probe angles are measured around the same annulus direction and reference.
- Annulus geometry is represented by a mean diameter for the current speed
  calculation.
- Pressure is converted to MPa and time to milliseconds during import.

Nonuniform probe positions are preferred. Three equally spaced probes can make
some combinations of wave count and direction indistinguishable.

## 1. Per-probe common time base

For each experimental/CFD probe pair, Concordia finds the median sample
interval of each trace, uses the larger interval \(\Delta t\), and linearly
interpolates both signals over their common time interval. At most 2,400 native
interval samples are used in the interactive comparison.

## 2. Restricted CFD–test alignment

Let \(p_t[n]\) be a test signal and \(p_c[n]\) its CFD counterpart. At each
candidate lag \(\ell\), normalized correlation is

\[
r(\ell)=
\frac{\sum_n (p_t[n]-\bar p_t)(p_c[n+\ell]-\bar p_c)}
{\sqrt{\sum_n(p_t[n]-\bar p_t)^2\sum_n(p_c[n+\ell]-\bar p_c)^2}}.
\]

RDE traces are periodic, so an unrestricted search can align the wrong wave
cycle. Concordia restricts automatic alignment to 45% of the preliminary
dominant period. Larger shifts require acquisition timestamps.

## 3. Frequency, amplitude, and residual mismatch

A one-sided discrete Fourier transform supplies the dominant comparison
frequencies \(f_t\) and \(f_c\). Relative frequency error is

\[
e_f=\frac{|f_c-f_t|}{|f_t|}.
\]

The sinusoidal-equivalent pressure amplitude is

\[
A=\sqrt{2}\,\mathrm{RMS}(p-\bar p),
\qquad
e_A=\frac{|A_c-A_t|}{A_t}.
\]

After alignment, the residual is \(\epsilon[n]=p_t[n]-p_c[n]\). Concordia
reports correlation, RMSE, normalized RMSE, and mean pressure bias for each
probe, then displays their case-level averages.

Current review thresholds are correlation \(\ge 0.70\), frequency error
\(\le 5\%\), and amplitude error \(\le 15\%\). These are prototype rules, not
community validation standards.

## 4. Rotating-mode inference

The case frequency used for mode inference is the median rising-mean-crossing
frequency across the probe traces. At that frequency, Concordia calculates the
complex Fourier phase \(\phi_i\) at each probe position \(\theta_i\).

For candidate wave count \(m\in\{1,2,3,4\}\) and direction sign
\(s\in\{-1,+1\}\), the predicted relative phase is

\[
\Delta\phi_i^{pred}=s\,m\,(\theta_i-\theta_1).
\]

Concordia selects the candidate with the smallest mean wrapped angular error
between measured and predicted relative phase. A normalized phase-fit score is
reported internally. This is a compact mode estimator; ambiguous sensor
layouts or multimode operation require a more advanced method.

## 5. Wave speed

For annulus mean diameter \(D\), detected temporal frequency \(f\), and wave
count \(m\), circumferential wave speed is

\[
c=\frac{\pi D f}{m}.
\]

With \(D\) in millimetres and \(f\) in kilohertz, the numerical result is in
metres per second.

## 6. Prototype stability classification

Each trace is divided into two time windows and a crossing frequency is
estimated in each. Concordia combines the maximum cross-window frequency drift
with the circumferential phase fit:

- **Stable:** drift \(\le 3\%\) and phase fit \(\ge 0.90\)
- **Transitional:** drift \(\le 8\%\) and phase fit \(\ge 0.75\)
- **Unstable:** otherwise

This classification does not yet capture intermittent mode switching,
cycle-to-cycle statistics, or broadband combustion instability.

## 7. Ranked investigation hypotheses

Concordia ranks three transparent hypothesis families by discrepancy severity:

1. chemistry or wall-loss treatment, scaled by amplitude error;
2. inlet boundary specification, scaled by frequency error; and
3. probe mapping or temporal resolution, scaled by waveform disagreement.

The displayed text includes the corresponding operating or model-card values.
These rankings prioritize sensitivity runs; they are not causal inference.

## 8. Recommended next action and traceable report

The current decision order is:

1. low correlation: verify timestamps, probe mapping, and matched windows;
2. frequency error above 5%: sweep inlet temperature and mass flow;
3. amplitude error above 15%: test chemistry, wall-loss, and sensor-response
   sensitivity; or
4. otherwise: add a nearby operating point.

The downloadable JSON report records the input metadata, source filenames,
units, per-probe comparisons, inferred modes, ranked hypotheses, recommendation,
analysis version, methods, and limitations.

## Known limitations

- Sensor uncertainty is recorded but not yet propagated through every output.
- No sensor transfer-function correction is applied.
- Numerical, parameter, and model-form uncertainties are not propagated.
- The spectral estimator does not yet use windowing, Welch averaging, or
  confidence intervals.
- Mode inference assumes one dominant rotating mode and synchronized probes.
- The current hypothesis ranking is rule-based and requires validation against
  real cases and expert assessments.
- Heat flux, thrust, optical diagnostics, and whole-field CFD comparisons are
  outside version 0.3.
- One operating point cannot establish an operating envelope.

## Evidence required for a research release

A stronger release should pre-register tolerances, use paired public or
partner-laboratory data, withhold operating points from method development, and
compare Concordia outputs with expert assessments. It should report sensitivity
to sample rate, window length, noise, missing samples, timing error, probe
placement, sensor response, and mesh/time-step uncertainty.
