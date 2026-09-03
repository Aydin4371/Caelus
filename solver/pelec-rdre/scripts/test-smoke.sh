#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: test-smoke.sh <solver-binary> <work-directory>" >&2
  exit 2
fi

binary="$1"
work_directory="$2"
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
solver_root="$(cd "$script_directory/.." && pwd)"

mkdir -p "$work_directory"
cp "$solver_root/Exec/KythrosRDRE/smoke.inp" "$work_directory/smoke.inp"
(
  cd "$work_directory"
  OMP_NUM_THREADS=2 "$binary" smoke.inp
)

plotfile="$(find "$work_directory" -maxdepth 1 -type d -name 'plt*' -print -quit)"
if [[ -z "$plotfile" || ! -f "$plotfile/Header" ]]; then
  echo "PeleC smoke run did not produce an AMReX plotfile" >&2
  exit 1
fi
