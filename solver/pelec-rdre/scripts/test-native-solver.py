"""Run real reacting flow and read its final plotfile on native Windows."""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
import yt


def check_log(log_text: str) -> None:
    if re.search(r"CVODE.*ERROR|\[ERROR\]|corrector convergence test failed|Native exception", log_text, re.I):
        raise RuntimeError("Solver reported a native or chemistry error")


def amr_regression(binary: Path, work: Path, source: Path) -> None:
    """Exercise coarse/fine copies and reactions with more threads than boxes."""
    inputs = (source / "Exec/KythrosRDRE/smoke.inp").read_text()
    # Short physical interval, but multiple coarse steps and fine subcycles.
    inputs += """
max_step = 3
stop_time = 3.e-8
pelec.fixed_dt = 1.e-8
amr.max_level = 1
amr.ref_ratio = 2
amr.max_grid_size = 16
amr.regrid_int = 2
tagging.tempgrad = 0.1
tagging.max_tempgrad_lev = 1
pelec.diffuse_temp = 1
pelec.diffuse_vel = 1
pelec.diffuse_spec = 1
pelec.diffuse_enth = 1
"""
    temperatures = []
    for threads in (1, 2, 27):
        case = work / f"amr-{threads}-threads"
        case.mkdir()
        (case / "inputs").write_text(inputs)
        with (case / "pelec.log").open("w") as log:
            result = subprocess.run(
                [str(binary), "inputs"], cwd=case,
                env={**os.environ, "OMP_NUM_THREADS": str(threads)},
                stdout=log, stderr=subprocess.STDOUT, timeout=600,
            )
        log_text = (case / "pelec.log").read_text(errors="replace")
        if result.returncode:
            print(log_text[-12000:])
            raise RuntimeError(f"AMR regression ({threads} threads) exited with {result.returncode}")
        check_log(log_text)
        if "[Level 1 step" not in log_text or "STEP = 3" not in log_text:
            raise RuntimeError("AMR regression did not complete refinement and three steps")
        plots = sorted(p for p in case.glob("plt*") if (p / "Header").is_file())
        dataset = yt.load(str(plots[-1]))
        if float(dataset.current_time) <= 0:
            raise RuntimeError("AMR regression did not advance")
        data = dataset.all_data()
        # Covered EB cells contain body states: inspect fluid cells only.
        fluid = np.asarray(data[("boxlib", "vfrac")]) > 0
        temp = np.asarray(data[("boxlib", "Temp")])[fluid]
        if not temp.size or not np.isfinite(temp).all() or temp.min() < 200 or temp.max() > 10000:
            raise RuntimeError(f"AMR regression corrupted fluid temperature ({threads} threads)")
        temperatures.append((float(temp.min()), float(temp.max())))
        print(f"PASS: AMR with {threads} threads; temperature range {temperatures[-1]}")
    if not np.allclose(temperatures, temperatures[0], rtol=1.e-5, atol=1.e-3):
        raise RuntimeError(f"Thread-dependent temperature extrema: {temperatures}")


def chemistry_failure_regression(binary: Path, work: Path) -> None:
    case = work / "chemistry-failure"
    case.mkdir()
    # Deliberately exceed the integration budget in a hot homogeneous mixture.
    # This must fail promptly, never return a partially integrated result.
    with (case / "pelec.log").open("w") as log:
        result = subprocess.run(
            [str(binary), str(work / "smoke.inp"), "cvode.max_substeps=1",
             "prob.chamber_temperature=4000", "pelec.fixed_dt=1e-3",
             "stop_time=1e-3", "pelec.init_shrink=1", "ode.rtol=1e-12", "ode.atol=1e-16"],
            cwd=case, env={**os.environ, "OMP_NUM_THREADS": "2"},
            stdout=log, stderr=subprocess.STDOUT, timeout=60,
        )
    log_text = (case / "pelec.log").read_text(errors="replace")
    if result.returncode == 0 or "Kythros: CVODE failed" not in log_text:
        raise RuntimeError("CPU chemistry failure was not propagated")
    print("PASS: chemistry failure stops the solver instead of flooding logs")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    parser.add_argument("work_directory", type=Path)
    args = parser.parse_args()
    binary = args.binary.resolve()
    work = args.work_directory.resolve()
    work.mkdir(parents=True, exist_ok=False)
    source = Path(__file__).resolve().parents[1]
    shutil.copyfile(source / "Exec/KythrosRDRE/smoke.inp", work / "smoke.inp")
    environment = {**os.environ, "OMP_NUM_THREADS": "2"}
    with (work / "pelec.log").open("w", encoding="utf-8") as log:
        result = subprocess.run(
            [str(binary), "smoke.inp"], cwd=work, env=environment,
            stdout=log, stderr=subprocess.STDOUT, timeout=600,
        )
    print((work / "pelec.log").read_text(encoding="utf-8", errors="replace"))
    if result.returncode:
        log_text = (work / "pelec.log").read_text(encoding="utf-8", errors="replace")
        for map_file in binary.parent.glob("native-solver.map"):
            symbols = []
            for line in map_file.read_text(errors="replace").splitlines():
                match = re.match(r"\s+[0-9a-fA-F]+:[0-9a-fA-F]+\s+(\S+)\s+([0-9a-fA-F]{12,16})\s", line)
                if match:
                    symbols.append((int(match[2], 16), match[1]))
            for offset in re.findall(r"kythros-pelec-rdre\.exe (?:at offset|\+) ([0-9a-fA-F]+)", log_text):
                address = 0x140000000 + int(offset, 16)
                preceding = [s for s in symbols if s[0] <= address]
                if preceding:
                    nearest = max(preceding)
                    print(f"Native symbol: {nearest[1]} + {address-nearest[0]:x}")
        raise RuntimeError(f"Native solver exited with {result.returncode}")
    check_log((work / "pelec.log").read_text(errors="replace"))
    plots = sorted(p for p in work.glob("plt*") if (p / "Header").is_file())
    if not plots:
        raise RuntimeError("Solver produced no readable plotfile")
    dataset = yt.load(str(plots[-1]))
    if float(dataset.current_time) <= 0:
        raise RuntimeError("Solver did not advance past the initial condition")
    sys.path.insert(0, str(source / "runtime"))
    from postprocess_volume import convert_plotfile
    # Geometry matches smoke.inp (which uses centimetres).
    request = {
        "runId": "native-windows-smoke",
        "engine": {"designId": "smoke", "annulusInnerDiameterMm": 77,
                   "annulusOuterDiameterMm": 85, "chamberLengthMm": 12},
        "operatingCondition": {"id": "smoke"},
    }
    volume = convert_plotfile(plots[-1], request, binary, (2, 32, 4))
    for name, values in volume["fields"].items():
        if len(values) != 256 or not np.isfinite(values).all():
            raise RuntimeError(f"Invalid converted field: {name}")
    for name in ("pressurePa", "temperatureK"):
        if min(volume["fields"][name]) <= 0:
            raise RuntimeError(f"Nonpositive {name}")
    if min(volume["fields"]["temperatureK"]) < 200:
        raise RuntimeError("Cold reactant energy was reset toward zero temperature")
    amr_regression(binary, work, source)
    chemistry_failure_regression(binary, work)
    (work / "result.json").write_text(json.dumps(volume, allow_nan=False), encoding="utf-8")
    print("PASS: native reacting-flow step and Kythros volume conversion; not physical validation.")


if __name__ == "__main__":
    main()
