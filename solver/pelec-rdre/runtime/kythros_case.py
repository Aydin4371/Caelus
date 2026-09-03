"""Translate a versioned Kythros engine request into a PeleC RDRE case."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API_SCHEMA = "kythros-local-rde-3d-request"
API_VERSION = 1
SUPPORTED_CASE = "gas-fed-annular-hydrogen-v1"


class CaseError(ValueError):
    """Raised when a request cannot be represented by the first RDRE case."""


@dataclass(frozen=True)
class CaseParameters:
    values: dict[str, str]
    visualization_shape: tuple[int, int, int]


def _number(container: dict[str, Any], key: str, *, positive: bool = True) -> float:
    value = container.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise CaseError(f"{key} must be a finite number")
    result = float(value)
    if positive and result <= 0.0:
        raise CaseError(f"{key} must be positive")
    return result


def _integer(container: dict[str, Any], key: str, minimum: int = 1) -> int:
    value = container.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or int(value) != value:
        raise CaseError(f"{key} must be an integer")
    result = int(value)
    if result < minimum:
        raise CaseError(f"{key} must be at least {minimum}")
    return result


def validate_request(request: dict[str, Any]) -> None:
    if request.get("schema") != API_SCHEMA or request.get("formatVersion") != API_VERSION:
        raise CaseError("unsupported Kythros Full 3D request format")
    case = request.get("caseDefinition")
    if not isinstance(case, dict) or case.get("id") != SUPPORTED_CASE:
        raise CaseError("this runtime supports the gas-fed annular hydrogen case only")
    engine = request.get("engine")
    condition = request.get("operatingCondition")
    numerics = request.get("numerics")
    if not isinstance(engine, dict) or not isinstance(condition, dict) or not isinstance(numerics, dict):
        raise CaseError("engine, operatingCondition, and numerics are required")
    if str(engine.get("application", "")).lower() != "rocket":
        raise CaseError("the first Full 3D case supports rocket engines")
    fuel = "".join(character for character in str(engine.get("fuel", "")).lower() if character.isalnum())
    oxidizer = "".join(character for character in str(engine.get("oxidizer", "")).lower() if character.isalnum())
    if fuel not in {"h2", "hydrogen", "gaseoushydrogen"}:
        raise CaseError("the first Full 3D case requires hydrogen fuel")
    if oxidizer not in {"air", "o2", "oxygen", "gaseousoxygen"}:
        raise CaseError("the first Full 3D case requires air or oxygen")

    inner = _number(engine, "annulusInnerDiameterMm")
    outer = _number(engine, "annulusOuterDiameterMm")
    if outer <= inner:
        raise CaseError("annulusOuterDiameterMm must exceed annulusInnerDiameterMm")
    _number(engine, "chamberLengthMm")
    injector_diameter = _number(engine, "injectorDiameterMm")
    injector_count = _integer(engine, "injectorCount", 3)
    if injector_diameter >= outer - inner:
        raise CaseError("injectorDiameterMm must be smaller than the physical annulus gap")
    mean_radius = 0.25 * (inner + outer)
    injector_pitch = 2.0 * math.pi * mean_radius / injector_count
    if injector_diameter >= injector_pitch:
        raise CaseError("the circular injector holes overlap at the entered count and diameter")
    inlet_pressure = _number(condition, "inletPressureBar")
    back_pressure = _number(condition, "backPressureBar")
    if inlet_pressure <= back_pressure:
        raise CaseError("inletPressureBar must exceed backPressureBar")
    _number(condition, "inletTemperatureK")
    _number(condition, "equivalenceRatio")
    _number(condition, "massFlowKgS")
    _number(numerics, "maximumCfl")
    _number(numerics, "endTimeMs")
    _integer(numerics, "amrLevels", 0)


def _mixture_mass_fractions(equivalence_ratio: float, oxidizer: str) -> tuple[float, float, float]:
    # 2 H2 + O2 -> 2 H2O. At phi=1, m_H2 / m_O2 = 4.032 / 31.998.
    h2_o2_mass_ratio = equivalence_ratio * 4.032 / 31.998
    nitrogen_o2_mass_ratio = 3.291 if oxidizer == "air" else 0.0
    denominator = h2_o2_mass_ratio + 1.0 + nitrogen_o2_mass_ratio
    return (
        h2_o2_mass_ratio / denominator,
        1.0 / denominator,
        nitrogen_o2_mass_ratio / denominator,
    )


def _mesh_for_preset(preset: str) -> tuple[int, int, tuple[int, int, int]]:
    if preset == "development":
        return 160, 1, (16, 72, 72)
    if preset == "workstation":
        return 320, 2, (20, 96, 96)
    if preset == "evidence":
        return 512, 3, (24, 128, 128)
    raise CaseError("numerics.presetId is not supported")


def request_to_parameters(request: dict[str, Any]) -> CaseParameters:
    validate_request(request)
    engine = request["engine"]
    condition = request["operatingCondition"]
    numerics = request["numerics"]

    inner_radius_cm = _number(engine, "annulusInnerDiameterMm") * 0.05
    outer_radius_cm = _number(engine, "annulusOuterDiameterMm") * 0.05
    chamber_length_cm = _number(engine, "chamberLengthMm") * 0.1
    injector_radius_cm = _number(engine, "injectorDiameterMm") * 0.05
    injector_count = _integer(engine, "injectorCount", 3)
    injector_angle_rad = math.radians(_number(engine, "injectorAngleDeg", positive=False))
    phi = _number(condition, "equivalenceRatio")
    oxidizer_key = "".join(
        character for character in str(engine.get("oxidizer", "")).lower() if character.isalnum()
    )
    oxidizer = "air" if oxidizer_key == "air" else "oxygen"
    y_h2, y_o2, y_n2 = _mixture_mass_fractions(phi, oxidizer)
    axial_cells, default_amr, visualization_shape = _mesh_for_preset(
        str(numerics.get("presetId", ""))
    )
    requested_amr = _integer(numerics, "amrLevels", 0)
    if requested_amr != default_amr:
        raise CaseError("the selected preset and AMR level do not match the signed case definition")

    requested_domain_half_width_cm = outer_radius_cm + max(0.12, 0.04 * outer_radius_cm)
    # PeleC's quadratic embedded-boundary gradient stencil requires cubic cells.
    # Derive the transverse extent from the axial spacing and round the count to
    # the input template's blocking factor instead of distorting the cell shape.
    cell_width_cm = chamber_length_cm / axial_cells
    transverse_cells = int(
        math.ceil((2.0 * requested_domain_half_width_cm / cell_width_cm) / 8.0) * 8
    )
    domain_half_width_cm = 0.5 * transverse_cells * cell_width_cm
    back_pressure_bar = _number(condition, "backPressureBar")
    ignition_pressure_bar = max(20.0, 2.5 * _number(condition, "inletPressureBar"))
    gap_cm = outer_radius_cm - inner_radius_cm

    values = {
        "STOP_TIME_S": f"{_number(numerics, 'endTimeMs') * 1.0e-3:.12g}",
        "DOMAIN_LOW_CM": f"{-domain_half_width_cm:.12g}",
        "DOMAIN_HIGH_CM": f"{domain_half_width_cm:.12g}",
        "CHAMBER_LENGTH_CM": f"{chamber_length_cm:.12g}",
        "AXIAL_CELLS": str(axial_cells),
        "TRANSVERSE_CELLS": str(transverse_cells),
        "MAX_CFL": f"{_number(numerics, 'maximumCfl'):.12g}",
        "AMR_LEVELS": str(default_amr),
        "INNER_RADIUS_CM": f"{inner_radius_cm:.12g}",
        "OUTER_RADIUS_CM": f"{outer_radius_cm:.12g}",
        "CHAMBER_PRESSURE_CGS": f"{back_pressure_bar * 1.0e6:.12g}",
        "CHAMBER_TEMPERATURE_K": f"{min(_number(condition, 'inletTemperatureK'), 500.0):.12g}",
        "INLET_TEMPERATURE_K": f"{_number(condition, 'inletTemperatureK'):.12g}",
        "OUTLET_PRESSURE_CGS": f"{back_pressure_bar * 1.0e6:.12g}",
        "MASS_FLOW_GPS": f"{_number(condition, 'massFlowKgS') * 1000.0:.12g}",
        "INJECTOR_RADIUS_CM": f"{injector_radius_cm:.12g}",
        "INJECTOR_COUNT": str(injector_count),
        "INJECTOR_ANGLE_RAD": f"{injector_angle_rad:.12g}",
        "Y_H2": f"{y_h2:.16g}",
        "Y_O2": f"{y_o2:.16g}",
        "Y_N2": f"{y_n2:.16g}",
        "IGNITION_PRESSURE_CGS": f"{ignition_pressure_bar * 1.0e6:.12g}",
        "IGNITION_RADIUS_CM": f"{max(0.12, min(0.45, 0.8 * gap_cm)):.12g}",
        "IGNITION_AXIAL_LOCATION_CM": f"{max(0.3, min(1.0, 0.08 * chamber_length_cm)):.12g}",
    }
    return CaseParameters(values=values, visualization_shape=visualization_shape)


def render_inputs(template: str, parameters: CaseParameters) -> str:
    rendered = template
    for key, value in parameters.values.items():
        rendered = rendered.replace("{{" + key + "}}", value)
    if "{{" in rendered or "}}" in rendered:
        raise CaseError("the PeleC input template contains an unresolved value")
    return rendered


def load_request(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CaseError(f"could not read the Kythros request: {error}") from error
    if not isinstance(value, dict):
        raise CaseError("the Kythros request must be a JSON object")
    validate_request(value)
    return value
