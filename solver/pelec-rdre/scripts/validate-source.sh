#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
solver_root="$(cd "$script_directory/.." && pwd)"

python3 -m unittest discover -s "$solver_root/tests" -p 'test_*.py'
python3 -m py_compile "$solver_root/runtime/kythros_case.py" "$solver_root/runtime/postprocess_volume.py" "$solver_root/runtime/kythros_pelec_rdre.py"

if grep -R "{{[A-Z0-9_]\+}}" "$solver_root/Exec/KythrosRDRE/smoke.inp"; then
  echo "smoke input contains an unresolved template token" >&2
  exit 1
fi
