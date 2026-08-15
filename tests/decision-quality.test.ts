import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionQuality } from "../lib/decision-quality.ts";

test("scores only evidence gates satisfied by the selected case", () => {
  const baseline = buildDecisionQuality({
    source: "demo",
    validityStatus: "Valid",
    dataQualityStatus: "Ready",
    controlledResultStatus: null,
    uploadedPrecedentCount: 0,
  });
  const confirmedRerun = buildDecisionQuality({
    source: "demo",
    validityStatus: "Valid",
    dataQualityStatus: "Ready",
    controlledResultStatus: "effect-confirmed",
    uploadedPrecedentCount: 0,
  });

  assert.equal(baseline.score, 2);
  assert.equal(confirmedRerun.score, 3);
  assert.equal(baseline.label, "Demo only");
  assert.equal(confirmedRerun.gates.find((gate) => gate.id === "controlled-result")?.result, "A one-change rerun met the support rule");
});

test("treats a rejected controlled rerun as decisive evidence, not a low-quality result", () => {
  const result = buildDecisionQuality({
    source: "uploaded",
    validityStatus: "Valid",
    dataQualityStatus: "Ready",
    controlledResultStatus: "rejected",
    uploadedPrecedentCount: 2,
  });

  assert.equal(result.score, 5);
  assert.equal(result.label, "Strong");
  assert.equal(result.gates.find((gate) => gate.id === "controlled-result")?.result, "A one-change rerun met a rejection rule");
});

test("does not convert an inconclusive rerun or public validation into case support", () => {
  const result = buildDecisionQuality({
    source: "uploaded",
    validityStatus: "Review",
    dataQualityStatus: "Review",
    controlledResultStatus: "inconclusive",
    uploadedPrecedentCount: 0,
  });

  assert.equal(result.score, 1);
  assert.equal(result.label, "Not decision-ready");
  assert.equal(result.gates.find((gate) => gate.id === "controlled-result")?.satisfied, false);
});
