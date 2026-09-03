#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: package-runtime.sh <solver-binary> <accelerator-file> <staging-directory> <output-tar>" >&2
  exit 2
fi

binary="$1"
accelerator_file="$2"
staging_directory="$3"
output_tar="$4"
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
solver_root="$(cd "$script_directory/.." && pwd)"

rm -rf "$staging_directory"
mkdir -p \
  "$staging_directory/opt/kythros/bin" \
  "$staging_directory/opt/kythros/libexec" \
  "$staging_directory/opt/kythros/lib/kythros" \
  "$staging_directory/opt/kythros/share/kythros"
install -m 0755 "$binary" "$staging_directory/opt/kythros/libexec/kythros-pelec-rdre.bin"
install -m 0755 "$solver_root/runtime/kythros_pelec_rdre.py" "$staging_directory/opt/kythros/bin/kythros-pelec-rdre"
install -m 0644 "$solver_root/runtime/kythros_case.py" "$staging_directory/opt/kythros/lib/kythros/kythros_case.py"
install -m 0644 "$solver_root/runtime/postprocess_volume.py" "$staging_directory/opt/kythros/lib/kythros/postprocess_volume.py"
install -m 0644 "$solver_root/Exec/KythrosRDRE/inputs.template" "$staging_directory/opt/kythros/share/kythros/inputs.template"
install -m 0644 "$accelerator_file" "$staging_directory/opt/kythros/share/kythros/accelerator.txt"

tar -C "$staging_directory" -czf "$output_tar" opt
