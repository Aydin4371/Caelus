from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))

from kythros_case import CaseError, render_inputs, request_to_parameters  # noqa: E402


def request() -> dict:
    return {
        "schema": "kythros-local-rde-3d-request",
        "formatVersion": 1,
        "runId": "test-run",
        "caseDefinition": {
            "id": "gas-fed-annular-hydrogen-v1",
            "validationStatus": "development-unvalidated",
            "solverFamily": "PeleC",
        },
        "engine": {
            "designId": "engine-1",
            "designFingerprint": "sha256:test",
            "name": "Test annulus",
            "application": "Rocket",
            "fuel": "Hydrogen",
            "oxidizer": "Air",
            "annulusInnerDiameterMm": 77.0,
            "annulusOuterDiameterMm": 85.0,
            "chamberLengthMm": 120.0,
            "injectorType": "Discrete orifices",
            "injectorCount": 120,
            "injectorDiameterMm": 0.8,
            "injectorAngleDeg": 12.0,
            "exhaustConfiguration": "Open exit",
        },
        "operatingCondition": {
            "id": "point-1",
            "name": "Nominal",
            "inletPressureBar": 8.0,
            "inletTemperatureK": 300.0,
            "equivalenceRatio": 1.0,
            "massFlowKgS": 0.62,
            "backPressureBar": 1.0,
        },
        "numerics": {
            "presetId": "development",
            "approximateCells": 3_000_000,
            "amrLevels": 1,
            "maximumCfl": 0.35,
            "endTimeMs": 0.15,
        },
        "requiredOutputs": ["pressure", "temperature"],
    }


class CaseTranslationTests(unittest.TestCase):
    def test_translates_engine_geometry_and_operating_condition(self) -> None:
        parameters = request_to_parameters(request())
        self.assertEqual(parameters.values["INNER_RADIUS_CM"], "3.85")
        self.assertEqual(parameters.values["OUTER_RADIUS_CM"], "4.25")
        self.assertEqual(parameters.values["CHAMBER_LENGTH_CM"], "12")
        self.assertEqual(parameters.values["MASS_FLOW_GPS"], "620")
        self.assertEqual(parameters.values["OUTLET_PRESSURE_CGS"], "1000000")
        self.assertEqual(parameters.values["INJECTOR_COUNT"], "120")
        self.assertEqual(parameters.visualization_shape, (16, 72, 72))

    def test_air_mixture_is_normalized(self) -> None:
        parameters = request_to_parameters(request())
        total = sum(float(parameters.values[key]) for key in ("Y_H2", "Y_O2", "Y_N2"))
        self.assertAlmostEqual(total, 1.0, places=12)
        self.assertGreater(float(parameters.values["Y_N2"]), 0.7)

    def test_embedded_boundary_mesh_uses_cubic_cells(self) -> None:
        parameters = request_to_parameters(request())
        axial_width = float(parameters.values["CHAMBER_LENGTH_CM"]) / float(
            parameters.values["AXIAL_CELLS"]
        )
        transverse_width = (
            float(parameters.values["DOMAIN_HIGH_CM"])
            - float(parameters.values["DOMAIN_LOW_CM"])
        ) / float(parameters.values["TRANSVERSE_CELLS"])
        self.assertAlmostEqual(axial_width, transverse_width, places=12)

    def test_oxygen_case_contains_no_nitrogen(self) -> None:
        value = request()
        value["engine"]["oxidizer"] = "Oxygen"
        parameters = request_to_parameters(value)
        self.assertEqual(float(parameters.values["Y_N2"]), 0.0)

    def test_rejects_unsupported_propellant(self) -> None:
        value = request()
        value["engine"]["fuel"] = "Methane"
        with self.assertRaisesRegex(CaseError, "hydrogen"):
            request_to_parameters(value)

    def test_rejects_mismatched_signed_preset(self) -> None:
        value = request()
        value["numerics"]["amrLevels"] = 3
        with self.assertRaisesRegex(CaseError, "preset and AMR"):
            request_to_parameters(value)

    def test_rejects_injectors_that_do_not_fit_the_annulus(self) -> None:
        value = request()
        value["engine"]["injectorDiameterMm"] = 9.0
        with self.assertRaisesRegex(CaseError, "annulus gap"):
            request_to_parameters(value)

    def test_renders_every_template_value(self) -> None:
        template = (ROOT / "Exec" / "KythrosRDRE" / "inputs.template").read_text(encoding="utf-8")
        rendered = render_inputs(template, request_to_parameters(request()))
        self.assertNotIn("{{", rendered)
        self.assertIn('eb2.geom_type = "kythros-annulus"', rendered)
        self.assertIn("prob.injector_count = 120", rendered)

    def test_example_request_stays_valid_json(self) -> None:
        encoded = json.dumps(request())
        self.assertEqual(json.loads(encoded)["runId"], "test-run")


if __name__ == "__main__":
    unittest.main()
