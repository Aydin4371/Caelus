# Caelus RDE Envelope

Caelus RDE Envelope is a browser-based research application for comparing a
rotating detonation engine (RDE) hot-fire pressure trace with a matching CFD
virtual-probe trace. It aligns the two signals, calculates reproducible
frequency, amplitude, waveform, bias, and residual metrics, and produces a
traceable engineering assessment.

The current release is a research prototype. It does **not** run CFD, establish
a full engine operating envelope, or replace formal verification, validation,
and uncertainty-quantification work.

## What is implemented

- Local CSV/TSV import; uploaded signals remain in the browser session
- Unit-aware parsing for seconds, milliseconds, microseconds, Pa, kPa, and MPa
- Common-time-base interpolation
- Sub-cycle cross-correlation alignment for periodic RDE pressure signals
- One-sided pressure spectra and dominant-frequency comparison
- Pressure-amplitude error, phase lag, waveform correlation, RMSE, normalized
  RMSE, and pressure bias
- Transparent prototype agreement index and evidence-based review flags
- Downloadable, versioned JSON comparison report
- Deterministic synthetic demonstration data
- Automated tests using signals with known frequency, amplitude, and phase
  differences

## Repository structure

```text
app/                     React interface and styles
lib/rde-analysis.ts      Deterministic engineering analysis engine
tests/                   Numerical and rendered-application tests
docs/methodology.md      Equations, assumptions, thresholds, and limitations
.openai/hosting.json     Current Sites deployment identity
```

The analysis is deliberately separated from the interface. An engineer can
inspect and test the numerical method without trusting dashboard code or a
language model.

## Run locally

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run dev
```

Then open the local address printed by the development server.

## Input format

Each file must contain at least 32 samples and a header naming one time column
and one pressure column. The preferred schema is:

```csv
time_ms,pressure_MPa
0.000000,0.152100
0.002500,0.301244
```

Supported time headers: `time_ms`, `time_s`, `time_us`, `t_ms`, `t_s`, `t_us`.
Supported pressure headers: `pressure_MPa`, `pressure_kPa`, `pressure_Pa`, and
their `p_*` equivalents. Bare `time`/`t` and `pressure`/`p` are interpreted as
milliseconds and MPa.

The two files should represent the same operating condition, sensor location,
and acquisition window. Larger timing offsets should be resolved from test and
simulation timestamps rather than inferred from a periodic waveform.

## Verification

Run the standalone numerical tests:

```bash
npm run test:analysis
```

Run type checking, linting, numerical tests, a production build, and the
rendered-app test:

```bash
npm run typecheck
npm run lint
npm test
```

The tests verify exact agreement, recovery of a known sub-cycle lag, detection
of a known amplitude mismatch, unit conversion, ambiguous-column rejection,
and report provenance.

## Scientific status

The current thresholds are prototype review rules, not universally accepted RDE
validation criteria. The composite agreement index is a transparent ranking
metric—not a probability that the CFD model is valid. A scientifically stronger
release will add sensor uncertainty, numerical uncertainty, model-form
uncertainty, operating-condition metadata, and evaluation against published or
partner-laboratory data.

See [docs/methodology.md](docs/methodology.md) for the equations and claim
boundaries.

## Near-term research roadmap

1. Evaluate the method on paired public or laboratory RDE pressure data.
2. Add measurement and CFD uncertainty to each discrepancy metric.
3. Compare multiple probe locations and phase-averaged fields.
4. Add campaign-level operating points and withhold runs for evaluation.
5. Generate an uncertainty-bounded operability map only after sufficient paired
   runs exist.

This software is for research and demonstration. It is not approved for design
certification, safety-critical decisions, or operational use.
