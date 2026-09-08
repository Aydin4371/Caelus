#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: build-rootfs.sh <runtime-tar> <work-directory> <rootfs-tar>" >&2
  exit 2
fi

runtime_tar="$1"
work_directory="$2"
rootfs_tar="$3"
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
solver_root="$(cd "$script_directory/.." && pwd)"

rm -rf "$work_directory"
mkdir -p "$work_directory/runtime-root"
tar -xzf "$runtime_tar" -C "$work_directory/runtime-root"
cp "$solver_root/runtime/Dockerfile.rootfs" "$work_directory/Dockerfile"
docker build -t kythros-solver-rootfs:local "$work_directory"
container="$(docker create kythros-solver-rootfs:local)"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker export "$container" --output "$rootfs_tar"
