# Caelus RDE comparison methodology

## Scope

The current method compares one experimental pressure history with one CFD
virtual-probe pressure history. It answers a narrow question:

> How closely does the simulated pressure signal reproduce the measured signal
> at this operating point, under explicitly stated prototype metrics?

It does not, by itself, validate an engine, explain every discrepancy, or build
an operating envelope.

## Required assumptions

- Both traces correspond to the same geometry and operating condition.
- The CFD probe represents the physical sensor location.
- Pressure is expressed in MPa after import and time in milliseconds.
- The overlapping interval contains at least 32 usable samples.
- Large acquisition-time offsets have already been resolved using timestamps or
  a trigger.

## 1. Common time base

The median sample interval is calculated for each trace. Caelus uses the larger
interval, \(\Delta t\), and linearly interpolates both signals onto a common
overlapping time base. At most 2,400 native-interval samples are used in the
current browser implementation.

This cap bounds interactive computation. It preserves the native comparison
interval instead of compressing a long trace and introducing simple
downsampling aliases.

## 2. Restricted cross-correlation alignment

Let \(p_t[n]\) be the test signal and \(p_c[n]\) the CFD signal. For each
candidate lag \(\ell\), Caelus calculates the normalized correlation

\[
r(\ell)=
\frac{\sum_n (p_t[n]-\bar p_t)(p_c[n+\ell]-\bar p_c)}
{\sqrt{\sum_n(p_t[n]-\bar p_t)^2\sum_n(p_c[n+\ell]-\bar p_c)^2}}.
\]

An RDE trace is strongly periodic, so unrestricted correlation can align the
wrong detonation cycle. The search is therefore restricted to 45% of the
preliminary dominant period. The reported phase lag is

\[
\Delta t_{lag}=\ell^*\Delta t,
\]

where \(\ell^*\) maximizes \(r(\ell)\) inside that restricted window.

## 3. Frequency comparison

The mean is removed from each aligned signal and a one-sided direct discrete
Fourier transform is evaluated. The dominant nonzero bin defines the test and
CFD frequencies, \(f_t\) and \(f_c\). Relative frequency error is

\[
e_f=\frac{|f_c-f_t|}{|f_t|}.
\]

The prototype review threshold is \(e_f \le 0.05\).

## 4. Pressure-amplitude comparison

For each centered signal, the sinusoidal-equivalent amplitude is

\[
A=\sqrt{2}\;\mathrm{RMS}(p-\bar p).
\]

The relative amplitude error is

\[
e_A=\frac{|A_c-A_t|}{A_t}.
\]

The prototype review threshold is \(e_A \le 0.15\). This metric is useful for a
dominant periodic mode but does not replace peak-pressure distributions or
cycle-to-cycle statistics.

## 5. Residual metrics

After alignment, the residual is

\[
\epsilon[n]=p_t[n]-p_c[n].
\]

Caelus reports:

- pressure bias: \(\bar p_c-\bar p_t\);
- root-mean-square error: \(\sqrt{\overline{\epsilon^2}}\);
- normalized RMSE: RMSE divided by the RMS of the centered test signal; and
- aligned waveform correlation, with a prototype review threshold of 0.70.

## 6. Prototype agreement index

For quick ranking in the interface, Caelus calculates

\[
S=0.6\max(0,r)+0.2e^{-4e_f}+0.2e^{-3e_A},
\]

clipped to \([0,1]\). This weighting is explicit and testable, but it is not
calibrated as a validation probability. The individual metrics and residual
should be inspected instead of treating \(S\) as a pass/fail authority.

## 7. Rule-based recommendation

The current recommendation logic checks evidence in this order:

1. correlation below 0.70: verify timing, probe location, and matched windows;
2. frequency error above 5%: investigate operating-condition sensitivity;
3. amplitude error above 15%: investigate amplitude drivers such as physical
   model assumptions, wall losses, and sensor response;
4. otherwise: evaluate a nearby operating point.

These statements are investigation priorities, not automated diagnoses. They
must be revised and validated with domain experts and real datasets.

## Known limitations

- No sensor transfer-function correction is applied.
- Measurement, discretization, parameter, and model-form uncertainties are not
  propagated.
- The spectral estimator does not yet use windowing, Welch averaging, or
  confidence intervals.
- Only one sensor pair is compared at a time.
- Mode count, wave speed, heat flux, thrust, and optical diagnostics are not yet
  included.
- No causal claim is made from a discrepancy metric.
- An operating envelope requires multiple paired operating points and is
  intentionally locked in the current interface.

## Evidence needed for a research release

A stronger evaluation should pre-register tolerances, use paired public or
partner-laboratory data, withhold operating points from method development, and
compare Caelus outputs with expert assessments. Results should report both
successful and failed comparisons and should quantify sensitivity to sample
rate, window length, noise, missing samples, timing error, and sensor response.
