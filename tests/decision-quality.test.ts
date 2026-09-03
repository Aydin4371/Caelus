import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionQuality } from "../lib/decision-quality.ts";

test("labels generated data as a demonstration even when its checks pass", () => {
  const baseline = buildDecisionQuality({
    source: "demo",
    validityStatus: "Valid",
    dataQualityStatus: "Ready",
    controlledResultStatus: null,
    uploadedPrecedentCount: 0,
  });
  assert.equal(baseline.label, "Demo only");
  assert.equal(baseline.sourceLabel, "Generated demonstration signals");
  assert.equal(baseline.gates.find((gate) => gate.id === "data-quality")?.statusLabel, "Passed");
  assert.match(baseline.explanation, /do not support a decision about a physical engine/i);
});

test("calls a valid uploaded baseline a candidate test rather than confirmed evidence", () => {
  const baseline = buildDecisionQuality({
    source: "uploaded",
    validityStatus: "Valid",
    dataQualityStatus: "Ready",
    controlledResultStatus: null,
    uploadedPrecedentCount: 0,
  });

  assert.equal(baseline.label, "Candidate test only");
  assert.equal(baseline.sourceLabel, "Uploaded experiment and CFD");
  assert.equal(baseline.gates.find((gate) => gate.id === "controlled-result")?.statusLabel, "Not tested");
  assert.match(baseline.explanation, /does not yet confirm the explanation/i);
});

test("treats a rejected controlled rerun as decisive evidence, not a low-quality result", () => {
  const result = buildDecisionQuality({
    source: "uploaded",
    validityStatus: "Valid",
    dataQualityStatus: "Ready",
    controlledResultStatus: "rejected",
    uploadedPrecedentCount: 2,
  });

  assert.equal(result.label, "Ready for engineering review");
  assert.equal(result.gates.find((gate) => gate.id === "controlled-result")?.statusLabel, "Classified");
  assert.match(result.gates.find((gate) => gate.id === "controlled-result")?.result ?? "", /met a rejection rule/i);
  assert.equal(result.gates.find((gate) => gate.id === "company-precedent")?.status, "passed");
});

test("separates an inconclusive controlled result from invalid input data", () => {
  const inconclusive = buildDecisionQuality({
    source: "uploaded",
    validityStatus: "Valid",
    dataQualityStatus: "Ready",
    controlledResultStatus: "inconclusive",
    uploadedPrecedentCount: 0,
  });
  const result = buildDecisionQuality({
    source: "uploaded",
    validityStatus: "Review",
    dataQualityStatus: "Review",
    controlledResultStatus: "inconclusive",
    uploadedPrecedentCount: 0,
  });

  assert.equal(inconclusive.label, "Needs another controlled run");
  assert.equal(inconclusive.gates.find((gate) => gate.id === "controlled-result")?.statusLabel, "Inconclusive");
  assert.equal(result.label, "Not ready");
  assert.equal(result.gates.find((gate) => gate.id === "validity")?.status, "review");
});

test("marks a multi-change rerun as comparison only", () => {
  const result = buildDecisionQuality({
    source: "uploaded",
    validityStatus: "Valid",
    dataQualityStatus: "Ready",
    controlledResultStatus: "comparison-only",
    uploadedPrecedentCount: 0,
  });

  assert.equal(result.label, "Comparison only");
  assert.equal(result.gates.find((gate) => gate.id === "controlled-result")?.status, "blocked");
});
