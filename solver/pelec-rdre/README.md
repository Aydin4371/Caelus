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

The installer workflow performs those steps, constructs an isolated WSL2
runtime, bundles it into the Windows desktop installer, and uploads the
installer as a workflow artifact.

## Required before evidence claims

- Pass shock-tube, reacting-shock, CJ/ZND, conservation, mesh-convergence,
  time-step-convergence, and RDRE wave-metric checks.
- Build and test the CUDA executable on supported NVIDIA hardware.
- Hash, sign, and publish the executable and combined installer.

The CPU package is an executable development build, not experimental
validation. Kythros withholds physical design advice until its numerical gates
pass, and the application must continue to label the case unvalidated until
prospective experiment evidence exists.
