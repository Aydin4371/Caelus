# Kythros local OpenFOAM runner

The companion service lets the 2D Simulation workspace execute OpenFOAM on
the same computer as Kythros. It binds to `127.0.0.1:8788`, accepts only
versioned Kythros case packages, writes every job to an isolated directory,
and exposes status, logs, cancellation, and results to the browser.

It does not download a solver, choose an RDE chemistry mechanism, or turn a
generic reacting-flow case into a validated RDE model.

## 1. Install OpenFOAM locally

On Windows 10 or 11, use OpenFOAM's supported WSL2 installation route:

- <https://openfoam.org/download/windows/>
- <https://openfoam.org/download/ubuntu/>

Open an Ubuntu/WSL terminal and initialize the installed OpenFOAM environment
as instructed by that installer. The exact `bashrc` path depends on the
installed distribution and version.

## 2. Check and start the runner

From the Kythros repository, inside the initialized OpenFOAM shell:

```bash
npm install
npm run runner:check
npm run runner:start
```

In a second terminal, run Kythros locally:

```bash
npm run dev
```

Open the 2D Simulation workspace and select **Check connection**. With only
`blockMesh` and `checkMesh` available, Kythros enables **Verify mesh locally**.
That is a real OpenFOAM mesh job, not a reacting-flow solution.

## 3. Configure a reviewed reacting RDE case

The reacting-run button requires all of the following:

1. `blockMesh` and `checkMesh` on `PATH`.
2. A complete, engineer-reviewed OpenFOAM case template.
3. A solver executable.
4. A postprocessor that writes `kythros-result.json` in the case directory.

Set these before starting the runner:

```bash
export KYTHROS_RDE_CASE_TEMPLATE=/absolute/path/to/reviewed-rde-case
export KYTHROS_RDE_SOLVER=foamRun
export KYTHROS_RDE_SOLVER_ARGS='[]'
export KYTHROS_RDE_POSTPROCESSOR=/absolute/path/to/kythros-result-adapter
export KYTHROS_RDE_POSTPROCESSOR_ARGS='[]'
npm run runner:start
```

The runner copies the template into a new job folder, applies the generated
geometry and traceability files, runs `blockMesh`, runs `checkMesh`, launches
the configured solver without a shell, executes the postprocessor, and returns
the resulting Kythros summary to the browser.

The reviewed template owns the complete `system/controlDict`, initial fields,
thermophysical properties, chemistry, transport, boundaries, ignition, and
numerical schemes. It may explicitly include the generated
`system/kythrosRunControl` file to inherit Kythros's selected time step and end
time. Kythros never silently replaces the template's complete control
dictionary.

## Result contract

The postprocessor must create `kythros-result.json` using the
`kythros-rde-2d-result` format shown in the exported
`kythros-result.template.json`. Values must come from solver outputs. Unknown
quantities remain `null`; they must not be inferred merely to unlock a design
recommendation.

## Local security and data

- The default runner listens only on `127.0.0.1`.
- Browser origins are restricted to local Kythros development origins.
- The browser cannot supply an executable or arbitrary shell command.
- Job file paths are validated against absolute paths and traversal.
- Local job data is written under `runner/.jobs/` and is excluded from Git.
- Set `KYTHROS_RUNNER_JOB_ROOT` to use a different local directory.
- Set `KYTHROS_RUNNER_ALLOWED_ORIGINS` only when intentionally serving the UI
  from another origin. Running both Kythros and the runner locally is the
  supported first configuration.

OpenFOAM is open-source software. Local runs do not create a Kythros cloud
compute charge, but they use the machine's CPU, memory, storage, and power.
