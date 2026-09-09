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
    (work / "result.json").write_text(json.dumps(volume, allow_nan=False), encoding="utf-8")
    print("PASS: native reacting-flow step and Kythros volume conversion; not physical validation.")


if __name__ == "__main__":
    main()
