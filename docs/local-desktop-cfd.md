# Kythros local Full 3D CFD

## User flow

1. Save an immutable RDE revision in **Design**.
2. Open **CFD Suite**, select **Full 3D**, an operating point, and a run quality.
3. Press **Run Full 3D**. Kythros checks the computer on every attempt.
4. The desktop command layer writes one versioned request and starts the fixed
   solver executable without constructing a shell command from user input.
5. Kythros polls the local job, validates the returned volume, and displays
   pressure, temperature, reaction progress, velocity magnitude, and integrated
   streamlines.
6. Numerical gates either withhold engine advice or return one controlled change
   and one next simulation.

The browser build remains useful for Rapid 2D and for opening results. It cannot
start a workstation process because browsers are isolated from local executables.

## Runtime boundary

| Component | Responsibility |
|---|---|
| React application | Input, job controls, status, volumetric display, advice |
| Tauri command layer | Hardware inspection, safe job storage, process lifecycle |
| Kythros Solver Runtime | Linux environment, pinned dependencies, solver pack |
| PeleC RDRE pack | Compressible reacting-flow calculation and post-processing |

On Windows, the solver runtime is an imported WSL2 distribution named
`KythrosSolver`. On Linux, it uses the same filesystem contract directly. The
desktop app never accepts an arbitrary executable path or interpolates engine
input into a shell command.

## Result contract

`kythros-rde-3d-volume` format 1 contains:

- radial, circumferential, and axial grid dimensions and physical bounds;
- cell-centred pressure, temperature, and reaction progress;
- axial, radial, and circumferential velocity components;
- solver name, version, executable hash, case-pack identity, and timestamp;
- convergence, conservation, wave, backflow, thrust, heat-flux, and adjacent-run
  summaries when the solver actually computed them.

Missing quantities remain `null`. A result is rejected if any required field has
the wrong length, contains a non-finite value, loses positivity, or lacks solver
provenance.

## Release boundary

The desktop process control and volume contract are implemented in this source
tree. A distributable production solver runtime additionally requires a pinned
PeleC build, an RDRE-specific problem definition, benchmark evidence, signed
Windows/Linux packages, and release hardware testing. Until those artifacts
pass, the UI reports **solver pack not installed** and does not invent a Full 3D
result.

