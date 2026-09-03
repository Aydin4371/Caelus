# PeleC RDRE solver pack

This directory defines the Kythros integration boundary for the first genuine
Full 3D solver pack. It is not a substitute numerical solver and it contains no
generated CFD fields.

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

## Required before distribution

- Pin and record a PeleC release plus all AMReX and PelePhysics submodules.
- Implement the gas-fed annular hydrogen case in three physical dimensions.
- Map the versioned Kythros engine, injector, and operating-point fields without
  undocumented defaults.
- Export a cell-centred cylindrical visualization volume with all three velocity
  components and retain the full solver plotfiles locally.
- Pass shock-tube, reacting-shock, CJ/ZND, conservation, mesh-convergence,
  time-step-convergence, and RDRE wave-metric checks.
- Hash and sign the executable and runtime image.

PeleC is the selected foundation because it is an open-source AMR compressible
reacting-flow code with CPU and GPU execution. Kythros still owns the
RDRE-specific case definition, validation, packaging, and user workflow.

