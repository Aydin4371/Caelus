# PeleC RDRE solver pack

This directory contains the first executable Kythros Full 3D solver case and
its stable desktop integration boundary. It uses pinned PeleC and PelePhysics
sources, a three-dimensional annular embedded boundary, finite-rate LiDryer
hydrogen chemistry, discrete circular injectors, a characteristic pressure
outlet, AMR controls, and a cylindrical volume postprocessor.

The packaged executable must be installed at:

```text
/opt/kythros/bin/kythros-pelec-rdre
```

It must support:

```text
kythros-pelec-rdre --version
kythros-pelec-rdre --request /path/request.json --result /path/kythros-volume-result.json
```

The request uses `kythros-local-rde-3d-request` format 1. The result uses
`kythros-rde-3d-volume` format 1. Long-running jobs may write `progress.json`
beside the request with `state`, `progress`, and `message` fields.

## Build and smoke test

```text
solver/pelec-rdre/scripts/build-solver.sh cpu /tmp/kythros-solver
solver/pelec-rdre/scripts/test-smoke.sh /tmp/kythros-solver/output/kythros-pelec-rdre.bin /tmp/kythros-smoke
```

These scripts maintain the Linux developer build. Windows releases use the
native build and bundled result reader described below.

## Native Windows solver build

`Kythros native Windows solver` builds the pinned case with native Windows
Clang on a Windows runner, with MPI, CUDA, and Fortran disabled and
CPU OpenMP enabled. It does not use WSL, Docker, or a Linux distribution.

Developers with PowerShell 7, Visual Studio C++/Clang tools, Git, CMake, and Python
3.12 can reproduce the build and test:

```powershell
./solver/pelec-rdre/scripts/build-windows.ps1 -WorkDirectory C:/kythros-native
python -m pip install --only-binary=:all: -r solver/pelec-rdre/runtime/requirements.txt
python solver/pelec-rdre/scripts/test-native-solver.py C:/kythros-native/output/kythros-pelec-rdre.exe "C:/kythros native smoke"
```

The workflow uploads `Kythros-Native-Windows-CPU` only after the native
executable advances the reacting annulus beyond its initial state and yt
converts its final plotfile into finite Kythros volume fields. The package
includes the executable, C++/OpenMP redistributable DLLs, inputs, dependency
notices, upstream pins, and an executable hash. Keep these files together.

The standalone artifact is the solver backend. The Full 3D installer workflow
also freezes the Python result reader, bundles both components with the desktop
app, installs it into a Windows path containing spaces, and invokes the installed
app to test request rendering, reacting flow, clean exit, and result conversion
with Python removed from PATH. Users install Kythros and select Run Full 3D;
there is no WSL setup step. The one-step test establishes portability; it does not establish convergence, physical
accuracy, sustained detonation, or GPU support.

Windows adaptations are checked against the pinned sources: timestamp APIs,
compiler options, explicit annulus/CVODE registration, and factory destruction
that does not access an already-destroyed static registry. Crash diagnostics
retain native addresses and linker symbols for failed CI runs.

The current smoke case also needs physical investigation: its final temperature
range is approximately 10.27–14.15 K on both Linux and Windows. Matching that
existing result is a portability observation, not an acceptable physical
validation result. Do not use this case as engineering evidence.

## Required before evidence claims

- Pass shock-tube, reacting-shock, CJ/ZND, conservation, mesh-convergence,
  time-step-convergence, and RDRE wave-metric checks.
- Build and test the CUDA executable on supported NVIDIA hardware.
- Hash, sign, and publish the executable and combined installer.

The CPU package is an executable development build, not experimental
validation. Kythros withholds physical design advice until its numerical gates
pass, and the application must continue to label the case unvalidated until
prospective experiment evidence exists.
