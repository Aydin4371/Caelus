#!/usr/bin/env python3
"""Stable command-line boundary between Kythros desktop and PeleC."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, os.environ.get("KYTHROS_PYTHON_PATH", "/opt/kythros/lib/kythros"))

from kythros_case import CaseError, load_request, render_inputs, request_to_parameters
from postprocess_volume import convert_plotfile

RUNTIME_VERSION = "0.1.0"
DEFAULT_BINARY = Path("/opt/kythros/libexec/kythros-pelec-rdre.bin")
DEFAULT_TEMPLATE = Path("/opt/kythros/share/kythros/inputs.template")
DEFAULT_ACCELERATOR_FILE = Path("/opt/kythros/share/kythros/accelerator.txt")


def _accelerator() -> str:
    path = Path(os.environ.get("KYTHROS_ACCELERATOR_FILE", str(DEFAULT_ACCELERATOR_FILE)))
    try:
        value = path.read_text(encoding="utf-8").strip().lower()
    except OSError:
        return "unknown"
    return {"cpu": "cpu-openmp", "cuda": "cuda"}.get(value, value or "unknown")


def _write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    temporary.replace(path)


def _progress(job_directory: Path, state: str, progress: float, message: str) -> None:
    _write_json(
        job_directory / "progress.json",
        {"state": state, "progress": progress, "message": message},
    )


def _latest_plotfile(job_directory: Path) -> Path:
    candidates = sorted(
        (path for path in job_directory.glob("plt*") if path.is_dir()),
        key=lambda path: path.name,
    )
    if not candidates:
        raise RuntimeError("PeleC completed without writing a plotfile")
    return candidates[-1]


def run(request_path: Path, result_path: Path) -> None:
    request = load_request(request_path)
    parameters = request_to_parameters(request)
    binary = Path(os.environ.get("KYTHROS_PELEC_BINARY", str(DEFAULT_BINARY)))
    template_path = Path(os.environ.get("KYTHROS_PELEC_TEMPLATE", str(DEFAULT_TEMPLATE)))
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise RuntimeError(f"the packaged PeleC executable is missing at {binary}")
    if not template_path.is_file():
        raise RuntimeError(f"the signed PeleC input template is missing at {template_path}")

    job_directory = request_path.resolve().parent
    generated_input = job_directory / "inputs.generated"
    generated_input.write_text(
        render_inputs(template_path.read_text(encoding="utf-8"), parameters),
        encoding="utf-8",
    )
    _progress(job_directory, "meshing", 0.05, "Building the three-dimensional annular mesh.")

    log_path = job_directory / "pelec.log"
    environment = os.environ.copy()
    environment.setdefault("OMP_NUM_THREADS", str(max(1, (os.cpu_count() or 2) - 1)))
    started = time.monotonic()
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(binary), generated_input.name],
            cwd=job_directory,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        while process.poll() is None:
            elapsed = time.monotonic() - started
            fraction = min(0.90, 0.08 + 0.82 * (1.0 - pow(2.718281828, -elapsed / 1800.0)))
            _progress(job_directory, "solving", fraction, "PeleC is advancing the reacting flow.")
            time.sleep(2.0)
    if process.returncode != 0:
        tail = "\n".join(log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-30:])
        raise RuntimeError(f"PeleC exited with code {process.returncode}.\n{tail}")

    _progress(job_directory, "post-processing", 0.94, "Sampling the computed 3D flow volume.")
    result = convert_plotfile(
        _latest_plotfile(job_directory), request, binary, parameters.visualization_shape
    )
    _write_json(result_path, result)
    _progress(job_directory, "completed", 1.0, "Full 3D result is ready.")


def main() -> int:
    parser = argparse.ArgumentParser(prog="kythros-pelec-rdre")
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--request", type=Path)
    parser.add_argument("--result", type=Path)
    arguments = parser.parse_args()
    if arguments.version:
        print(
            f"Kythros PeleC RDRE runtime {RUNTIME_VERSION}; "
            f"solver=PeleC-c3f925c+kythros-1; accelerator={_accelerator()}; "
            "case=gas-fed-annular-hydrogen-v1"
        )
        return 0
    if arguments.request is None or arguments.result is None:
        parser.error("--request and --result are required")
    try:
        run(arguments.request, arguments.result)
        return 0
    except (CaseError, RuntimeError, OSError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
