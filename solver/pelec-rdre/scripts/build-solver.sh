#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: build-solver.sh <cpu|cuda> [work-directory]" >&2
  exit 2
fi

mode="$1"
work_directory="${2:-$(pwd)/.solver-build}"
case "$mode" in
  cpu|cuda) ;;
  *) echo "mode must be cpu or cuda" >&2; exit 2 ;;
esac

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
solver_root="$(cd "$script_directory/.." && pwd)"
pelec_commit="c3f925cc9f54b761b7d5a1efe9e5409c98ed3a3c"
source_directory="$work_directory/PeleC"
case_directory="$source_directory/Exec/KythrosRDRE"
output_directory="$work_directory/output"

mkdir -p "$work_directory" "$output_directory"
if [[ ! -d "$source_directory/.git" ]]; then
  git clone --recursive https://github.com/Pele-Suite/PeleC.git "$source_directory"
fi
git -C "$source_directory" fetch --depth 1 origin "$pelec_commit"
git -C "$source_directory" checkout --detach "$pelec_commit"
git -C "$source_directory" submodule update --init --recursive

rm -rf "$case_directory"
cp -R "$solver_root/Exec/KythrosRDRE" "$case_directory"

make_arguments=("-j$(getconf _NPROCESSORS_ONLN)" "USE_MPI=FALSE" "USE_OMP=TRUE")
if [[ "$mode" == "cuda" ]]; then
  make_arguments+=("USE_CUDA=TRUE" "USE_OMP=FALSE")
else
  make_arguments+=("USE_CUDA=FALSE")
fi
make -C "$case_directory" "${make_arguments[@]}" TPL
make -C "$case_directory" "${make_arguments[@]}"

binary="$(find "$case_directory" -maxdepth 1 -type f -name 'PeleC3d*.ex' -perm -u+x -print -quit)"
if [[ -z "$binary" ]]; then
  echo "PeleC build completed without a runnable three-dimensional executable" >&2
  exit 1
fi
install -m 0755 "$binary" "$output_directory/kythros-pelec-rdre.bin"
printf '%s\n' "$pelec_commit" > "$output_directory/pelec-commit.txt"
printf '%s\n' "$mode" > "$output_directory/accelerator.txt"

echo "$output_directory/kythros-pelec-rdre.bin"
