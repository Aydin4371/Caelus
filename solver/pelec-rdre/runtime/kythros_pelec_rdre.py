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

RUNTIME_VERSION = "0.2.0"
NATIVE_ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
DEFAULT_BINARY = NATIVE_ROOT / "kythros-pelec-rdre.exe" if os.name == "nt" else Path("/opt/kythros/libexec/kythros-pelec-rdre.bin")
DEFAULT_TEMPLATE = NATIVE_ROOT / "inputs.template" if os.name == "nt" else Path("/opt/kythros/share/kythros/inputs.template")
DEFAULT_ACCELERATOR_FILE = NATIVE_ROOT / "accelerator.txt" if os.name == "nt" else Path("/opt/kythros/share/kythros/accelerator.txt")


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


def run(request_path: Path, result_path: Path, *, self_test: bool = False) -> None:
    request = load_request(request_path)
    parameters = request_to_parameters(request)
    if self_test:
        # Exercise the production request/render/solve/convert path at CI scale.
        # This explicit command is never used by the desktop Run action.
        from kythros_case import CaseParameters
        values = {**parameters.values, "AXIAL_CELLS": "8", "TRANSVERSE_CELLS": "64",
                  "DOMAIN_LOW_CM": "-4.8", "DOMAIN_HIGH_CM": "4.8", "AMR_LEVELS": "0",
                  "STOP_TIME_S": "1e-8"}
        parameters = CaseParameters(values, (2, 32, 4))
    binary = Path(os.environ.get("KYTHROS_PELEC_BINARY", str(DEFAULT_BINARY)))
    template_path = Path(os.environ.get("KYTHROS_PELEC_TEMPLATE", str(DEFAULT_TEMPLATE)))
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise RuntimeError(f"the packaged PeleC executable is missing at {binary}")
    if not template_path.is_file():
        raise RuntimeError(f"the packaged PeleC input template is missing at {template_path}")

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
    packaged_library_directory = binary.parent / "lib"
    if packaged_library_directory.is_dir():
        prior_library_path = environment.get("LD_LIBRARY_PATH")
        environment["LD_LIBRARY_PATH"] = (
            f"{packaged_library_directory}:{prior_library_path}"
            if prior_library_path
            else str(packaged_library_directory)
        )
    started = time.monotonic()
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(binary), generated_input.name],
            cwd=job_directory,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        while process.poll() is None:
            if (job_directory / "cancel.flag").exists():
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                _progress(job_directory, "cancelled", 0.0, "The simulation was cancelled.")
                return
            elapsed = time.monotonic() - started
            fraction = min(0.90, 0.08 + 0.82 * (1.0 - pow(2.718281828, -elapsed / 1800.0)))
            _progress(job_directory, "solving", fraction, "PeleC is advancing the reacting flow.")
            time.sleep(2.0)
    if process.returncode != 0:
        tail = "\n".join(log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-30:])
        raise RuntimeError(f"PeleC exited with code {process.returncode}.\n{tail}")

    if (job_directory / "cancel.flag").exists():
        _progress(job_directory, "cancelled", 0.0, "The simulation was cancelled.")
        return
    _progress(job_directory, "post-processing", 0.94, "Sampling the computed 3D flow volume.")
    result = convert_plotfile(
        _latest_plotfile(job_directory), request, binary, parameters.visualization_shape
    )
    _write_json(result_path, result)
    _progress(job_directory, "completed", 1.0, "Full 3D result is ready.")


def self_test(directory: Path) -> int:
    directory.mkdir(parents=True, exist_ok=False)
    request = {
        "schema": "kythros-local-rde-3d-request", "formatVersion": 1, "runId": "native-package-test",
        "caseDefinition": {"id": "gas-fed-annular-hydrogen-v1"},
        "engine": {"designId": "native-package-test", "application": "rocket", "fuel": "hydrogen", "oxidizer": "air",
                   "annulusInnerDiameterMm": 77, "annulusOuterDiameterMm": 85, "chamberLengthMm": 12,
                   "injectorDiameterMm": 1.6, "injectorCount": 24, "injectorAngleDeg": 0},
        "operatingCondition": {"id": "native-package-test", "inletPressureBar": 2, "backPressureBar": 1,
                               "inletTemperatureK": 300, "equivalenceRatio": 1, "massFlowKgS": 0.01},
        "numerics": {"presetId": "development", "amrLevels": 1, "maximumCfl": 0.15, "endTimeMs": 0.00001},
    }
    request_path = directory / "request.json"
    result_path = directory / "result.json"
    _write_json(request_path, request)
    run(request_path, result_path, self_test=True)
    result = json.loads(result_path.read_text(encoding="utf-8"))
    import math
    if result.get("schema") != "kythros-rde-3d-volume" or not result.get("fields"):
        raise RuntimeError("Packaged runtime returned an invalid result")
    for name, values in result["fields"].items():
        if len(values) != 256 or not all(math.isfinite(value) for value in values):
            raise RuntimeError(f"Packaged runtime returned invalid {name}")
    log = (directory / "pelec.log").read_text(errors="replace")
    if "STEP = 1" not in log:
        raise RuntimeError("Packaged solver did not advance a flow step")
    _write_json(directory / "package-test-passed.json", {"native": os.name == "nt", "runtime": RUNTIME_VERSION,
                "requestRoundTrip": True, "cleanExit": True, "finiteFields": True, "physicalValidation": False})
    print("PASS: packaged native request, reacting solver, clean exit, and result conversion")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="kythros-pelec-rdre")
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--self-test", type=Path, help=argparse.SUPPRESS)
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
    if arguments.self_test is not None:
        return self_test(arguments.self_test)
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

