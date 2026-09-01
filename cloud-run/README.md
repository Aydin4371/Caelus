# Kythros Google Cloud execution

Kythros uses two managed Google Cloud components:

1. a small authenticated gateway service that stores case packages, starts jobs, reports status, and cancels executions;
2. three scale-to-zero Cloud Run Jobs that execute the approved OpenFOAM image at quick, balanced, or refined compute sizes.

Users never install OpenFOAM or receive Google Cloud credentials. The Sites Worker forwards authenticated requests to the gateway with a server-side token.

## Required before deployment

- Google Cloud project with billing enabled
- `gcloud` authenticated as a project administrator
- a unique Cloud Storage bucket name
- an engineer-reviewed RDE case in `solver/template/`
- solver and postprocessor commands that create `kythros-result.json`

The repository intentionally does not present the placeholder template as a physical RDE model. Cloud execution is activated only after the reviewed template, chemistry, boundaries, ignition, solver, and result adapter have been supplied.

## Deploy

```bash
export GCP_PROJECT_ID="your-project-id"
export GCP_REGION="northamerica-northeast1"
export KYTHROS_GCS_BUCKET="your-unique-kythros-runs-bucket"
export KYTHROS_SOLVER_COMMAND="your reviewed solver command"
export KYTHROS_POSTPROCESS_COMMAND="your result adapter command"
bash cloud-run/deploy.sh
```

The script builds both images, creates the private storage and identities, deploys three Cloud Run Jobs and the authenticated gateway, and prints the two runtime values that must be stored in the Kythros Sites deployment.

## Security boundary

- The browser calls only `/api/cloud-cfd` on Kythros.
- Kythros requires an authenticated user before accepting a paid job.
- The gateway requires a random bearer token stored only in managed runtime secrets.
- Case and result objects are private to the job service accounts.
- The gateway verifies job ownership before returning status or accepting cancellation.
- Every case path is checked before it is written to the solver filesystem.

Production pilots should add per-user quotas and a billing/credit policy before access is expanded beyond approved users.
