# Kythros local Full 3D CFD

## User flow

1. Download and run the combined Windows desktop installer.
2. Open **CFD Suite**, select **Full 3D**, and press **Install Full 3D runtime** once.
3. If Windows enables WSL2, restart when requested and press Install again.
4. Select an engine, operating point, and run quality, then press **Run Full 3D**.
5. The desktop command layer writes one versioned request and starts the fixed
   solver executable without constructing a shell command from user input.
6. Kythros polls the local job, validates the returned volume, and displays
   pressure, temperature, reaction progress, velocity magnitude, and integrated
   streamlines.
7. Numerical gates either withhold engine advice or return one controlled change
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

## Implemented solver case

- Three-dimensional Cartesian PeleC domain with an embedded annular chamber
- Finite-rate LiDryer hydrogen chemistry
- Circular injectors inherited from the saved engine revision
- Injector mass flow, angle, temperature, and mixture ratio from the operating point
- Characteristic pressure outlet and adiabatic no-slip annulus walls
- Temperature- and pressure-gradient AMR
- AMReX plotfiles retained locally and sampled into the Kythros cylindrical volume

## Evidence boundary

The source build and installer path are implemented. The CPU release remains a
development solver until the shock, detonation, conservation, convergence, and
RDRE wave-metric validation ladder passes. CUDA performance, installer signing,
and clean-machine release testing are separate release gates. Kythros must not
present a completed calculation as experiment-validated before those gates and
prospective RDE evidence pass.
