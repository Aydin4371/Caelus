# Kythros RDE methodology

## Scope

Version 2.0 has two distinct evidence paths. The Operating Envelope accepts an
experiment-only operating point and does not require CFD. Published summary
observations may be displayed with explicit provenance, but they are excluded
from raw-signal analysis and model fitting. The Comparison module analyzes a
matched operating point using at least three synchronized experimental pressure
traces and matching CFD virtual probes. It asks:

> Does the CFD reproduce the measured rotating-wave and pressure behavior,
> which differences are resolved beyond uncertainty, and what single controlled
> run should be performed next?

It does not validate the complete engine or prove that a ranked hypothesis
caused a discrepancy.

The Operating Envelope always presents measured observations first. One
operating point produces one physical marker. Related mesh,
time-step, chemistry, boundary, or initialization reruns remain evidence for
that marker and do not create new operating conditions. Marker position comes
from the entered equivalence ratio, inlet pressure, or mass flow. Marker color,
wave count, frequency, propagation speed, and stability come from the analyzed
experimental pressure probes. For a published-summary point, the marker
preserves the author's reported mode and Kythros shows any Stable,
Transitional, or Unstable label as a transparent display grouping rather than a
raw-signal reanalysis.

Version 2.0 uses an explicit three-level hierarchy.
One engine design fixes the propellant pair, annulus, injector, plenum, wall,
and exhaust definition. It can contain several physical operating points. Each
operating point may then contain its own baseline plus related one-change CFD
reruns. Each saved run references exactly one operating point, and each
operating point references exactly one engine design. Older saved workspaces
are migrated into this hierarchy when the physical condition can be recovered
from the baseline.

The design workspace calculates geometry, area, volume, mass flux, and pressure
ratios directly from entered values. Its nine-point screening plan brackets the
entered equivalence-ratio, mass-flow, and inlet-pressure ranges. When measured
points exist, the next planned point is the untested point farthest from the
loaded observations in normalized operating-condition space. This is a
coverage calculation, not an active-learning model or predicted optimum.
A planned point counts as covered when its normalized Euclidean distance from
a loaded operating point is at most 0.03 after equivalence ratio, mass flow,
and inlet pressure are each scaled by the entered design range. This tolerance
is used only to track plan coverage; it does not merge or alter analyzed cases.

Kythros does not draw a boundary until the exploratory-model gates pass. The
gate requires at least 12 uploaded, signal-ready experimental observations, at
least two measured stability classes, 60% buffered leave-one-condition-out
balanced accuracy, and 70% supported-holdout coverage. CFD numerical
convergence is not part of this experiment-only model gate. The local kernel
model then requires at least three nearby observations for an individual
prediction. Unsupported space remains blank, and displayed color fades with
uncertainty. The next-test recommendation searches only supported space for a
high-uncertainty class boundary.

Before the result is measured, Kythros freezes the recommended condition,
predicted class, three class probabilities, uncertainty, and training count.
Five sequential blind recommendations with at least 60% accuracy and a
three-class Brier score no higher than 0.22 pass the product's prototype
prospective gate. Here the Brier score is the mean squared probability error
across Stable, Transitional, and Unstable: 0 is perfect, 2/3 is worst, and
uniform one-third probabilities score 2/9. These point counts and score limits
are development policies rather than published RDE acceptance standards, so a
passed gate is not external validation or deployment certification.

Kythros still does not infer injector backflow from annulus pressure traces;
that requires an explicit reverse-flow channel and a separately validated
calculation.

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

Before interpreting CFD error, Kythros checks:

1. explicit confirmation that geometry, operating point, coordinates, and
   evidence window match;
2. probe-layout alias risk;
3. whether all traces provide a usable common window; and
4. confidence in the selected rotating mode relative to the next-best mode.

An unconfirmed physical pairing blocks tuning recommendations. Data-quality or
mode-identifiability findings produce a review state rather than silently
continuing as if the comparison were definitive.

## 2. Data quality

For each trace, Kythros reports sample count, duration, sample rate, samples per
dominant cycle, captured cycles, interval variation, detected gaps, dropped
source rows, and possible clipping plateaus.

Current review rules flag fewer than five captured cycles, fewer than twenty
samples per cycle, sample-interval variation above 1%, acquisition gaps,
dropped nonnumeric rows, or three or more consecutive identical samples.

Kythros also compares Nyquist frequency, sensor bandwidth, and filter cutoff
with the passage-frequency harmonic bands used by the pressure metrics. These
are explicit method checks. Passing them does not establish a complete sensor
transfer function or eliminate measurement bias.

## 3. Common time base and bounded alignment

Kythros first estimates bounded correlation lags for every matching probe pair,
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

Rising mean crossings define pressure cycles. Kythros calculates:

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
that frequency, Kythros calculates Hann-windowed complex phase \(\phi_i\) at
every probe position \(\theta_i\).

For candidate wave count \(m\in\{1,\ldots,m_{max}\}\), where the user supplies
the physically plausible maximum, and direction sign
\(s\in\{-1,+1\}\), predicted relative phase is

\[
\Delta\phi_i^{pred}=s\,m\,(\theta_i-\theta_1).
\]

The candidate with the smallest RMS wrapped phase error is selected. Kythros
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
uncertainties \(u_t\) and \(u_c\), Kythros uses

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

Kythros does not assign a numeric confidence or cause score. Each diagnostic
observation is recorded as `supports`, `weakens`, `unknown`, or
`cannot-assess`, with a strength and basis (`case`, `case-history`, or
`literature`). A computed policy requirement may also appear with basis
`policy`; it identifies the exact result still needed by the active decision
rule. Hypotheses are ordered deterministically: validity gates first,
then required repeats and unfinished sensitivities, controlled-rerun support,
net supporting evidence, strong evidence, comparable-case precedent, and
finally unresolved evidence.

The recommendation header also avoids an additive readiness score. It reports
a categorical status calculated from four separate conditions: signal quality,
experiment-CFD pairing, availability of a classified one-change rerun, and
independent confirmation from another uploaded case family. The data source is
reported separately so generated demonstrations cannot be mistaken for engine
evidence. Published references and public benchmark cases support or test the
method; they never raise the recommendation status for an analyzed case.

Every uploaded item is a case. A related case identifies a case-family baseline,
the exact starting case whose settings it inherited, and one changed CFD
variable group. The relationship is used as diagnostic evidence only when
Kythros verifies the same geometry, operating point, probe layout, every
experimental trace sample, and exactly one changed CFD group relative to that
starting case. Otherwise the item remains a comparison only.

For a new related rerun, the interface copies the selected starting case's
complete metadata and reuses its exact experiment samples. The user supplies
the declared CFD-setting change and the new CFD result. Kythros still verifies
the saved data rather than trusting the selection. If verification fails, the
case remains comparison-only and the evidence record lists each changed
physical input, experiment-sample difference, missing declared setting change,
or additional CFD setting group.

The new-rerun loader prevents those relationship errors before analysis.
Comparison inputs and unrelated CFD groups are disabled after a starting case
and declared variable are chosen. Changing the declared variable restores the
starting model card before exposing the newly selected group. Solver runtime
and CFD-result uncertainty remain editable because they describe the result,
not an additional causal model change. A review gate then verifies that the
declared group changed and identifies the inherited experiment and new CFD file.

Once a case is analyzed, its family baseline, starting case, and declared CFD
variable are immutable. Editing the case can correct metadata or replace its
mapped signals, but it cannot reinterpret the existing result as a different
controlled experiment. Testing another variable requires a new related case,
which preserves the audit trail and prevents stale settings from being
misclassified under a new label.

Classification also uses the declared starting case. Targeted error reduction,
CFD response, newly introduced mismatches, adjacent-level convergence, and
runtime multiplier are calculated between the starting case and the rerun.
They are not copied from the family baseline. A confirmed or converged rerun
advances the accepted branch only when it starts from the current accepted tip.
A rejected or inconclusive rerun leaves that tip unchanged, so the next plan
explicitly resumes from the last accepted settings.

Primary literature provides traceable applicability context and identifies
physically defensible sensitivity directions. It never proves that a paper's
reported mechanism caused the discrepancy in the analyzed case. That claim
requires a controlled rerun whose result supports or weakens the hypothesis.
Each displayed research claim stores its own source IDs and applicability
boundary. Sources are mapped only to claims they directly support. A diagnostic
branch with no directly applicable reviewed source is visibly labeled as a
prototype policy; Kythros does not borrow a citation from an adjacent topic.

The pressure files contain time and pressure values only. Kythros creates the
evidence findings after it analyzes the active case and its verified
one-change reruns. In the interface, "supports" means a calculated finding is
consistent with the explanation, "contradicts" means a calculated finding
weighs against it, and "still needed" identifies the result required before a
classification can be made. A zero count means no analyzed finding was placed
in that category. It never means that a contradictory CSV column was expected
or missing.

For a verified one-variable rerun, Kythros evaluates the metrics predicted to
respond to that variable:

| Changed CFD group | Targeted outputs | Decision rule |
|---|---|---:|
| Mesh | Peak pressure, rise time, harmonics | 2% adjacent-level convergence |
| Time step | Frequency, rise time | 2% adjacent-level convergence |
| Chemistry | Frequency, amplitude, impulse | 2% minimum response |
| Inlet | Mean pressure, frequency | 2% minimum response |
| Wall | Amplitude, impulse | 2% minimum response |
| Initialization | Wave count, direction, transitions | categorical change |
| Measured unsteady forcing | Cycle variability, frequency drift, phase jitter | 2% minimum response |

Numerical refinements and model sensitivities use different decision paths.
For mesh and flow-time-step refinement, Kythros compares targeted CFD outputs
between adjacent levels. A change at or below 2% completes that numerical
sequence; a change above 2% means the solution remains sensitive and another
level is required. Experimental agreement is reported separately. Improvement,
worsening, or a new mismatch cannot by itself establish numerical convergence
and does not cause a finer numerical setting to be discarded.

For chemistry, inlet, wall, initialization, and measured-unsteadiness tests, a
rerun supports the predicted signature when mean targeted error falls by at
least 25% and no new resolved mismatch appears. It does not support the
signature when the target response is below the listed threshold, targeted
error worsens by at least 5%, or a new resolved mismatch appears. Other outcomes
are inconclusive. These are explicit prototype decision limits, not calibrated
probabilities and not proof that the associated model choice caused the original
discrepancy.

The displayed next-run title, question, change, fixed inputs, target outputs,
and outcome criteria are assembled from structured fields: the selected
variable, current case setting, target metric IDs, calculated observations,
case-history state, and versioned policy values. Kythros does not select a
stored paragraph for a named cause. Static interface labels remain fixed, but
the decision content is generated from the analyzed case state.

## 10. Comparable-case intelligence

Kythros aggregates completed controlled reruns across the open workspace when
they share the selected cause and overlap the active mismatch signature. The
active case family is excluded from this pool because its reruns are already
used as direct case-history evidence and are not independent precedent. The
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
workspace output. On every render, Kythros recalculates baseline and rerun
metrics from the stored experiment and CFD pressure arrays, verifies the
one-variable relationship from entered metadata, classifies the result, and
then aggregates it. Runtime multipliers use only user-entered solver hours.
The engineering rule definitions and decision thresholds are versioned code;
their application and all displayed numerical results depend on the analyzed
inputs.

One or two uploaded precedents are labeled limited evidence. Three or more are
labeled a repeated workspace pattern. These summaries are descriptive and
configuration-specific; they are not calibrated probabilities. Synthetic demo
cases are labeled as demonstrations and are excluded from precedent used for an
uploaded case. The generated demo contains signal arrays and model-card inputs,
but its metrics and recommendations pass through the same analysis pipeline as
uploaded files. Kythros never substitutes invented historical counts for
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
  spatial fields are outside version 1.4.
- One operating point cannot establish a validation envelope.

## Evidence required for a research release

A stronger release should pre-register tolerances, use paired public or
partner-laboratory data, withhold operating points from method development, and
compare Kythros recommendations with expert assessments. It should report
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

A Kythros workspace is versioned JSON containing raw mapped signals, file
provenance, probe geometry, model-card inputs, uncertainty, and related-case
links. Non-finite optional values use an explicit tagged representation rather
than silently becoming JSON null. Opening a workspace validates every signal,
probe count, time ordering, case identifier, and schema version. Derived
metrics are recalculated by the current deterministic engine so saved results
cannot become detached from the saved raw evidence.

## 16. Published validation boundary

Exact published frequency, wave-count, annulus-diameter, and wave-speed values
are used as deterministic calculation benchmarks. Three checksum-locked
compact pressure fixtures from the registered Zenodo archive are also analyzed
in the mandatory suite. They verify that similar-speed counter-rotation is not
falsely collapsed into one mode, that separated secondary traveling components
are detected, and that CE2029's repeated circumferential probe angles do not
produce an invented single-mode result. None of these public cases is described
as full experiment–CFD validation because matching numeric arrays from both
sides do not exist.
