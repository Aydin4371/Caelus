# Caevera RDE methodology

## Scope

Version 1.3 analyzes matched RDE operating points using at least three
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
- The experimental sensor bandwidth and applied filter cutoff are documented.
- Probe angles share one annulus direction and reference.
- Pressure and timing uncertainties are supplied as one-standard-uncertainty
  estimates when the user wants a resolved/unresolved interpretation.
- Annulus geometry is represented by a mean diameter for wave-speed inference.

Nonuniform probe positions are preferred. Three probes can support a candidate
mode, while four or more well-placed probes are recommended for an identified
mode. Equal spacing can make wave count and direction aliases indistinguishable.

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

Caevera also compares Nyquist frequency, sensor bandwidth, and filter cutoff
with the passage-frequency harmonic bands used by the pressure metrics. These
are explicit method checks. Passing them does not establish a complete sensor
transfer function or eliminate measurement bias.

## 3. Common time base and bounded alignment

Caevera first estimates bounded correlation lags for every matching probe pair,
then uses the median as one shared experiment-to-CFD lag for the entire probe
array. Every pair is recomputed using that shared lag. This prevents independent
per-probe alignment from removing a real circumferential phase mismatch. Each
pair uses the larger median sample interval and linear interpolation over its
common interval; the interactive waveform comparison uses at most 2,400
native-interval samples.

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

The dominant frequency comes from a Hann-windowed, zero-padded radix-2 FFT
amplitude spectrum, with parabolic peak interpolation. For test
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

The passage frequency is the median dominant FFT frequency across probes. At
that frequency, Caevera calculates Hann-windowed complex phase \(\phi_i\) at
every probe position \(\theta_i\).

For candidate wave count \(m\in\{1,\ldots,m_{max}\}\), where the user supplies
the physically plausible maximum, and direction sign
\(s\in\{-1,+1\}\), predicted relative phase is

\[
\Delta\phi_i^{pred}=s\,m\,(\theta_i-\theta_1).
\]

The candidate with the smallest RMS wrapped phase error is selected. Caevera
also reports the next candidate and classifies the result as **Identified**,
**Candidate**, or **Not identifiable** using phase residual, separation from the
runner-up, probe count, synchronization, and window-to-window mode consistency.
The result is downgraded rather than silently choosing a mode when the evidence
does not distinguish it.

For mean annulus diameter \(D\), detected temporal frequency \(f\), and wave
count \(m\), circumferential speed is

\[
c=\frac{\pi D f}{m}.
\]

With \(D\) in millimetres and \(f\) in kilohertz, \(c\) is in metres per
second.

## 6. Stability classification

Rising mean crossings provide cycle-by-cycle passage frequency and peak
pressure. A linear fit over the cycle frequencies estimates record-wide drift.
The pressure array is also divided into up to twelve windows, each covering
roughly three cycles, to refit mode count/direction and relative phase. This
produces frequency variation, phase jitter, and a count of mode transitions.

The current explicit stability categories are:

- **Stable:** identified mode, no transition, drift \(\le 3\%\), frequency
  variation \(\le 2\%\), and phase jitter \(\le 15^\circ\)
- **Transitional:** at least a candidate mode, no more than one transition,
  drift \(\le 8\%\), frequency variation \(\le 5\%\), and phase jitter
  \(\le 30^\circ\)
- **Unstable:** otherwise

These are transparent product method limits, not universal physical boundaries.
Simultaneous co-/counter-rotating content is flagged through poor or changing
fits; it is not uniquely decomposed by this release.

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
supplied timing contribution. Wave-speed uncertainty conservatively combines
frequency and supplied mean-diameter uncertainty. Rise-time uncertainty combines
the two timing inputs. Pressure impulse combines pressure and timing contributions.

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
motivated it. The highest-ranked candidate becomes an adaptive next-run plan:

- one recommended change;
- variables to hold fixed;
- expected outcome;
- confirmation criterion;
- rejection criterion;
- inconclusive criterion;
- an explanation of why this run outranks the alternatives;
- conditional next actions for confirmation, rejection, and an inconclusive result;
- the latest controlled-rerun outcome;
- comparable controlled-rerun outcomes and observed cost when available;
- alternative hypothesis; and
- evidence strength.

The interface presents only the immediate run as actionable. Later runs remain
conditional until the current result is uploaded. The plan moves through four
stages: evidence gate, numerical verification, physics sensitivity, and
validation expansion. The sequence is adaptive rather than a fixed checklist.
The result prioritizes a sensitivity experiment. It is not causal inference.

## 9. Evidence-state diagnosis and case history

Caevera does not assign a numeric confidence or cause score. Each diagnostic
observation is recorded as `supports`, `weakens`, `unknown`, or
`cannot-assess`, with a strength and basis (`case`, `case-history`, or
`literature`). Hypotheses are ordered deterministically: validity gates first,
then required repeats and unfinished sensitivities, controlled-rerun support,
net supporting evidence, strong evidence, comparable-case precedent, and
finally unresolved evidence.

Every uploaded item is a case. A case may optionally identify an existing case
as its baseline and record one changed CFD variable group. The relationship is
used as diagnostic evidence only when Caevera verifies the same geometry,
operating point, probe layout, every experimental trace sample, and exactly one
changed CFD group. Otherwise the item remains a comparison only.

Primary literature provides traceable applicability context and identifies
physically defensible sensitivity directions. It never proves that a paper's
reported mechanism caused the discrepancy in the loaded case. That claim
requires a controlled rerun whose result supports or weakens the hypothesis.
Sources are mapped only to the mechanisms they directly studied. A diagnostic
branch with no directly applicable reviewed source remains an uncited prototype
heuristic; Caevera does not borrow a citation from an adjacent topic.

For a verified one-variable rerun, Caevera evaluates the metrics predicted to
respond to that variable:

| Changed CFD group | Targeted outputs | Minimum response used for rejection |
|---|---|---:|
| Mesh | Peak pressure, rise time, harmonics | 5% |
| Time step | Frequency, rise time | 1% |
| Chemistry | Frequency, amplitude, impulse | 2% |
| Inlet | Mean pressure, frequency | 2% |
| Wall | Amplitude, impulse | 2% |
| Initialization | Wave count, direction, transitions | categorical change |
| Measured unsteady forcing | Cycle variability, frequency drift, phase jitter | 2% |

A rerun confirms the predicted signature when mean targeted error falls by at
least 25%. It rejects that signature when the target response is below the
listed threshold or targeted error worsens by at least 5%. Other outcomes are
inconclusive. These are explicit prototype decision limits, not calibrated
probabilities and not proof that the associated model choice caused the original
discrepancy.

## 10. Comparable-case intelligence

Caevera aggregates completed controlled reruns across the loaded workspace when
they share the selected cause and overlap the active mismatch signature. The
next-run card reports:

- the number of comparable controlled reruns;
- confirmed, converged, rejected, and inconclusive counts;
- mean per-metric error reduction among confirmed reruns; and
- mean runtime multiplier among confirmed reruns when both baseline and rerun
  wall-clock runtime were supplied.

The interface first translates these values into a direct engineering
conclusion: whether prior comparable runs support the proposed change, what
effect was observed, and how that precedent should influence the immediate
test. Outcome counts remain available in a collapsed evidence disclosure.

The primary interface combines that conclusion with the diagnosis, single next
run, controlled variables, expected result, and input provenance in one
engineering-decision card. Detailed ranking logic and conditional outcomes are
collapsed by default. Evidence is labeled by support level or as a
demonstration; no percentage confidence is shown because the prototype has not
been calibrated against a sufficiently large independent case set.

No precedent result is embedded in the application or saved as a derived
workspace output. On every render, Caevera recalculates baseline and rerun
metrics from the stored experiment and CFD pressure arrays, verifies the
one-variable relationship from entered metadata, classifies the result, and
then aggregates it. Runtime multipliers use only user-entered solver hours.
The engineering rule definitions and decision thresholds are versioned code;
their application and all displayed numerical results depend on the loaded
inputs.

One or two uploaded precedents are labeled limited evidence. Three or more are
labeled a repeated workspace pattern. These summaries are descriptive and
configuration-specific; they are not calibrated probabilities. Synthetic demo
cases are labeled as demonstrations and are excluded from precedent used for an
uploaded case. The generated demo contains signal arrays and model-card inputs,
but its metrics and recommendations pass through the same analysis pipeline as
uploaded files. Caevera never substitutes invented historical counts for
missing case history.

## 11. Coverage and traceable report

The product scope is pressure and wave dynamics. Thermal and
performance remain not assessed unless those measurements are added in later
modules. The JSON report stores metadata, source names, modes, validity, data
quality, uncertainty states, per-probe evidence, ranked hypotheses, next-run
plan, methods, limitations, and the reviewed primary sources behind the wave
analysis methods.

## Known limitations

- The method has not yet been validated against a paired public RDE benchmark
  case history or withheld laboratory cases.
- Sensor dynamic response and transfer-function correction are not applied.
- Geometry, parameter, and model-form uncertainty are not fully propagated.
- Harmonic and repeatability uncertainty are not estimated.
- Mode inference assumes synchronized probes and one dominant rotating mode.
- Diagnostic ranking is rule-based and needs comparison with expert decisions.
- Adaptive outcome thresholds have not yet been calibrated against withheld
  paired experiment-CFD rerun histories.
- Heat flux, wall temperature, thrust, optical diagnostics, species, and full
  spatial fields are outside version 1.3.
- One operating point cannot establish a validation envelope.

## Evidence required for a research release

A stronger release should pre-register tolerances, use paired public or
partner-laboratory data, withhold operating points from method development, and
compare Caevera recommendations with expert assessments. It should report
sensitivity to sample rate, window length, noise, missing samples, timing error,
probe placement, sensor response, mesh refinement, and time-step refinement.


## 13. Mapped data import and provenance (v1.0)

The import layer parses CSV, TSV, and semicolon-delimited text without assuming
specific headers. The user explicitly maps one acquisition-time column and at
least three pressure columns, then confirms the source units. Internally:

- time is converted to milliseconds;
- pressure is converted to MPa;
- rows with a missing/non-numeric mapped value are omitted and counted;
- converted time must be strictly increasing without duplicates;
- each pressure column may be used only once;
- a six-row converted preview is shown before the mapping becomes usable.

The case stores the file name, delimiter, selected source headers, source units,
valid/dropped row counts, and the experiment/CFD mapping. This provenance is
included in reports and saved workspaces.

## 14. Spectral SNR and conclusion-specific quality gates

For each trace, the Hann-windowed spectrum estimates a dominant fundamental.
A spectral noise floor is the median amplitude of non-harmonic bins inside the
analyzed band after excluding neighborhoods around the first three harmonics.
The reported spectral SNR is

```text
20 log10(fundamental amplitude / spectral noise floor).
```

The current explicit gates are:

- frequency: at least five cycles, at least 10 samples/cycle, no gaps or
  clipping, and spectral SNR at least 10 dB;
- phase/mode: the frequency gate plus at least 20 samples/cycle and no more
  than 1% sample-interval variation;
- front shape/harmonics: the phase gate plus Nyquist frequency at least five
  times the fundamental.

Failing one gate does not erase unrelated outputs. It creates a named list of
unavailable conclusions. A failed phase gate makes count, direction,
propagation speed, phase pattern, and phase jitter Not identifiable while a
usable single-probe pressure amplitude may still be reported.

These thresholds are analysis-method controls, not universal RDE acceptance
criteria.

## 15. Workspace persistence

A Caevera workspace is versioned JSON containing raw mapped signals, file
provenance, probe geometry, model-card inputs, uncertainty, and related-case
links. Non-finite optional values use an explicit tagged representation rather
than silently becoming JSON null. Opening a workspace validates every signal,
probe count, time ordering, case identifier, and schema version. Derived
metrics are recalculated by the current deterministic engine so saved results
cannot become detached from the saved raw evidence.

## 16. Published validation boundary

Exact published frequency, wave-count, annulus-diameter, and wave-speed values
are used as deterministic calculation benchmarks. Two checksum-locked compact
pressure fixtures from the registered Zenodo archive are also analyzed in the
mandatory suite. They verify that similar-speed counter-rotation is not falsely
collapsed into one mode and that a separated secondary traveling component is
detected. CE2029 remains registered but unembedded. None of these public cases
is described as full experiment–CFD validation because matching numeric arrays
from both sides do not exist.
