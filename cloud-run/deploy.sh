#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GCP_REGION:=northamerica-northeast1}"
: "${KYTHROS_GCS_BUCKET:?Set KYTHROS_GCS_BUCKET to a globally unique bucket name}"
: "${KYTHROS_SOLVER_COMMAND:?Set the reviewed OpenFOAM solver command}"
: "${KYTHROS_POSTPROCESS_COMMAND:?Set the Kythros result-adapter command}"

if [[ ! -f cloud-run/solver/template/system/controlDict ]]; then
  echo "Add the reviewed RDE case template under cloud-run/solver/template before deployment." >&2
  exit 1
fi

command -v gcloud >/dev/null
command -v openssl >/dev/null

gcloud config set project "$GCP_PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com secretmanager.googleapis.com

gcloud artifacts repositories describe kythros-cfd --location "$GCP_REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create kythros-cfd --repository-format docker --location "$GCP_REGION"
gcloud storage buckets describe "gs://$KYTHROS_GCS_BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$KYTHROS_GCS_BUCKET" --location "$GCP_REGION" --uniform-bucket-level-access

for account in kythros-cfd-gateway kythros-cfd-solver; do
  gcloud iam service-accounts describe "$account@$GCP_PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$account"
done

gcloud storage buckets add-iam-policy-binding "gs://$KYTHROS_GCS_BUCKET" --member "serviceAccount:kythros-cfd-gateway@$GCP_PROJECT_ID.iam.gserviceaccount.com" --role roles/storage.objectAdmin >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$KYTHROS_GCS_BUCKET" --member "serviceAccount:kythros-cfd-solver@$GCP_PROJECT_ID.iam.gserviceaccount.com" --role roles/storage.objectAdmin >/dev/null
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member "serviceAccount:kythros-cfd-gateway@$GCP_PROJECT_ID.iam.gserviceaccount.com" --role roles/run.developer >/dev/null

REGISTRY="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/kythros-cfd"
gcloud builds submit cloud-run/gateway --tag "$REGISTRY/gateway:latest"
gcloud builds submit cloud-run/solver --tag "$REGISTRY/openfoam-rde:latest"

deploy_job() {
  local name="$1" cpu="$2" memory="$3" timeout="$4"
  gcloud run jobs deploy "$name" --region "$GCP_REGION" --image "$REGISTRY/openfoam-rde:latest" \
    --service-account "kythros-cfd-solver@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --cpu "$cpu" --memory "$memory" --task-timeout "$timeout" --max-retries 0 \
    --set-env-vars "^@^KYTHROS_SOLVER_COMMAND=$KYTHROS_SOLVER_COMMAND@KYTHROS_POSTPROCESS_COMMAND=$KYTHROS_POSTPROCESS_COMMAND"
}

deploy_job kythros-rde-quick 2 8Gi 3600s
deploy_job kythros-rde-balanced 4 16Gi 10800s
deploy_job kythros-rde-refined 8 32Gi 21600s

TOKEN_FILE="$(mktemp)"
trap 'rm -f "$TOKEN_FILE"' EXIT
openssl rand -hex 32 > "$TOKEN_FILE"
if gcloud secrets describe kythros-cfd-gateway-token >/dev/null 2>&1; then
  gcloud secrets versions add kythros-cfd-gateway-token --data-file "$TOKEN_FILE"
else
  gcloud secrets create kythros-cfd-gateway-token --data-file "$TOKEN_FILE" --replication-policy automatic
fi
gcloud secrets add-iam-policy-binding kythros-cfd-gateway-token --member "serviceAccount:kythros-cfd-gateway@$GCP_PROJECT_ID.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor >/dev/null

gcloud run deploy kythros-cfd-gateway --region "$GCP_REGION" --image "$REGISTRY/gateway:latest" --allow-unauthenticated \
  --service-account "kythros-cfd-gateway@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID,GCP_REGION=$GCP_REGION,KYTHROS_GCS_BUCKET=$KYTHROS_GCS_BUCKET,KYTHROS_JOB_QUICK=kythros-rde-quick,KYTHROS_JOB_BALANCED=kythros-rde-balanced,KYTHROS_JOB_REFINED=kythros-rde-refined" \
  --set-secrets "KYTHROS_GATEWAY_TOKEN=kythros-cfd-gateway-token:latest"

GATEWAY_URL="$(gcloud run services describe kythros-cfd-gateway --region "$GCP_REGION" --format='value(status.url)')"
echo "Cloud execution deployed."
echo "Set KYTHROS_CFD_GATEWAY_URL in Sites to: $GATEWAY_URL"
echo "Set KYTHROS_CFD_GATEWAY_TOKEN in Sites from Secret Manager: kythros-cfd-gateway-token"
