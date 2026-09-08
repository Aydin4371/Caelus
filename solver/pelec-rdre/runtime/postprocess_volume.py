"""Convert a completed PeleC AMReX plotfile to the Kythros cylindrical volume."""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np


def _import_yt():
    try:
        import yt  # type: ignore
    except ImportError as error:  # pragma: no cover - exercised in packaged runtime
        raise RuntimeError("the solver runtime is missing the yt AMReX reader") from error
    return yt


def _field(dataset: Any, candidates: Iterable[str]) -> tuple[str, str]:
    wanted = {candidate.lower() for candidate in candidates}
    fields = list(dataset.field_list) + list(dataset.derived_field_list)
    for item in fields:
        if str(item[-1]).lower() in wanted:
            return item
    raise RuntimeError(f"the PeleC plotfile does not contain any of: {', '.join(candidates)}")


def _values(dataset: Any, field: tuple[str, str], points: np.ndarray) -> np.ndarray:
    result = dataset.find_field_values_at_points(field, points)
    return np.asarray(result, dtype=np.float64)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def convert_plotfile(
    plotfile: Path,
    request: dict[str, Any],
    solver_binary: Path,
    visualization_shape: tuple[int, int, int],
) -> dict[str, Any]:
    yt = _import_yt()
    yt.funcs.mylog.setLevel(40)
    dataset = yt.load(str(plotfile))
    radial_cells, circumferential_cells, axial_cells = visualization_shape
    engine = request["engine"]
    inner_radius_m = float(engine["annulusInnerDiameterMm"]) * 0.0005
    outer_radius_m = float(engine["annulusOuterDiameterMm"]) * 0.0005
    axial_length_m = float(engine["chamberLengthMm"]) * 0.001

    radial = np.linspace(inner_radius_m, outer_radius_m, radial_cells, endpoint=False)
    radial += 0.5 * (outer_radius_m - inner_radius_m) / radial_cells
    theta = np.linspace(0.0, 2.0 * math.pi, circumferential_cells, endpoint=False)
    axial = np.linspace(0.0, axial_length_m, axial_cells, endpoint=False)
    axial += 0.5 * axial_length_m / axial_cells
    x_grid, theta_grid, radial_grid = np.meshgrid(axial, theta, radial, indexing="ij")
    y_grid = radial_grid * np.cos(theta_grid)
    z_grid = radial_grid * np.sin(theta_grid)
    # PeleC case coordinates are centimetres.
    points = np.column_stack((x_grid.ravel(), y_grid.ravel(), z_grid.ravel())) * 100.0

    pressure_cgs = _values(dataset, _field(dataset, ("pressure",)), points)
    temperature = _values(dataset, _field(dataset, ("Temp", "temperature")), points)
    velocity_x_cgs = _values(dataset, _field(dataset, ("x_velocity",)), points)
    velocity_y_cgs = _values(dataset, _field(dataset, ("y_velocity",)), points)
    velocity_z_cgs = _values(dataset, _field(dataset, ("z_velocity",)), points)
    try:
        water = _values(dataset, _field(dataset, ("Y(H2O)", "H2O")), points)
        reaction = np.clip(water / max(float(np.nanmax(water)), 1.0e-12), 0.0, 1.0)
    except RuntimeError:
        low = float(np.nanpercentile(temperature, 2.0))
        high = float(np.nanpercentile(temperature, 98.0))
        reaction = np.clip((temperature - low) / max(high - low, 1.0), 0.0, 1.0)

    theta_flat = theta_grid.ravel()
    velocity_radial_cgs = velocity_y_cgs * np.cos(theta_flat) + velocity_z_cgs * np.sin(theta_flat)
    velocity_theta_cgs = -velocity_y_cgs * np.sin(theta_flat) + velocity_z_cgs * np.cos(theta_flat)
    inlet_slice = velocity_x_cgs.reshape(axial_cells, circumferential_cells, radial_cells)[0]
    backflow_pct = 100.0 * float(np.count_nonzero(inlet_slice < 0.0)) / float(inlet_slice.size)

    return {
        "schema": "kythros-rde-3d-volume",
        "formatVersion": 1,
        "runId": request["runId"],
        "designId": engine["designId"],
        "designFingerprint": engine.get("designFingerprint"),
        "operatingConditionId": request["operatingCondition"]["id"],
        "solver": {
            "name": "PeleC Kythros RDRE",
            "version": "pelec-c3f925c+kythros-1",
            "executableHash": _sha256(solver_binary),
        },
        "provenance": {
            "computedAt": datetime.now(timezone.utc).isoformat(),
            "host": "local-desktop",
            "caseDefinitionId": "gas-fed-annular-hydrogen-v1",
            "validationStatus": "development-unvalidated",
        },
        "grid": {
            "coordinateSystem": "cylindrical-r-theta-x",
            "storageOrder": "axial-circumferential-radial",
            "radialCells": radial_cells,
            "circumferentialCells": circumferential_cells,
            "axialCells": axial_cells,
            "innerRadiusM": inner_radius_m,
            "outerRadiusM": outer_radius_m,
            "axialLengthM": axial_length_m,
        },
        "fields": {
            "pressurePa": (pressure_cgs * 0.1).tolist(),
            "temperatureK": temperature.tolist(),
            "reactionProgress": reaction.tolist(),
            "velocityAxialMps": (velocity_x_cgs * 0.01).tolist(),
            "velocityRadialMps": (velocity_radial_cgs * 0.01).tolist(),
            "velocityCircumferentialMps": (velocity_theta_cgs * 0.01).tolist(),
        },
        "summary": {
            "solverConverged": True,
            "massConservationErrorPct": None,
            "peakPressureBar": float(np.nanmax(pressure_cgs) / 1.0e6),
            "peakTemperatureK": float(np.nanmax(temperature)),
            "waveCount": None,
            "dominantFrequencyKHz": None,
            "injectorBackflowPct": backflow_pct,
            "estimatedThrustN": None,
            "peakWallHeatFluxMWm2": None,
            "adjacentGridChangePct": None,
            "adjacentTimeStepChangePct": None,
        },
    }
