export type DecisionQualityInput = {
  source: "uploaded" | "demo";
  validityStatus: "Valid" | "Review" | "Blocked";
  dataQualityStatus: "Ready" | "Review";
  controlledResultStatus: "effect-confirmed" | "converged" | "rejected" | "inconclusive" | "comparison-only" | null;
  uploadedPrecedentCount: number;
};

export type DecisionQualityGate = {
  id: "real-data" | "validity" | "data-quality" | "controlled-result" | "company-precedent";
  label: string;
  satisfied: boolean;
  result: string;
};

export type DecisionQuality = {
  score: number;
  maximumScore: 5;
  label: "Demo only" | "Strong" | "Supported" | "Developing" | "Limited" | "Not decision-ready";
  explanation: string;
  gates: DecisionQualityGate[];
};

function controlledResultLabel(status: DecisionQualityInput["controlledResultStatus"]) {
  if (status === "effect-confirmed") return "A one-change rerun met the support rule";
  if (status === "converged") return "Adjacent numerical levels met the convergence rule";
  if (status === "rejected") return "A one-change rerun met a rejection rule";
  if (status === "inconclusive") return "A one-change rerun was analyzed but could not be classified";
  if (status === "comparison-only") return "The selected rerun changed more than one relevant input";
  return "No one-change result has been analyzed for the selected case";
}

export function buildDecisionQuality(input: DecisionQualityInput): DecisionQuality {
  const decisiveControlledResult = ["effect-confirmed", "converged", "rejected"].includes(input.controlledResultStatus ?? "");
  const gates: DecisionQualityGate[] = [
    {
      id: "real-data",
      label: "Physical experiment paired with CFD",
      satisfied: input.source === "uploaded",
      result: input.source === "uploaded" ? "Uses user-provided experiment and CFD data" : "Uses generated demonstration signals only",
    },
    {
      id: "validity",
      label: "Case-matching checks passed",
      satisfied: input.validityStatus === "Valid",
      result: input.validityStatus === "Valid" ? "Geometry, operating point, probes, and time window are confirmed" : input.validityStatus === "Blocked" ? "A required case-matching check is not confirmed" : "At least one validity check still needs review",
    },
    {
      id: "data-quality",
      label: "Signal-quality checks passed",
      satisfied: input.dataQualityStatus === "Ready",
      result: input.dataQualityStatus === "Ready" ? "Sampling, duration, continuity, clipping, and spectral checks passed" : "At least one signal-quality check needs review",
    },
    {
      id: "controlled-result",
      label: "One-change rerun has a classified result",
      satisfied: decisiveControlledResult,
      result: controlledResultLabel(input.controlledResultStatus),
    },
    {
      id: "company-precedent",
      label: "Independent result from another case family",
      satisfied: input.uploadedPrecedentCount > 0,
      result: input.uploadedPrecedentCount > 0
        ? `${input.uploadedPrecedentCount} comparable user-provided one-change rerun${input.uploadedPrecedentCount === 1 ? "" : "s"} from another family`
        : "No comparable rerun from another case family has been analyzed",
    },
  ];
  const score = gates.filter((gate) => gate.satisfied).length;
  const label: DecisionQuality["label"] = input.source === "demo"
    ? "Demo only"
    : score === 5
      ? "Strong"
      : score === 4
        ? "Supported"
        : score === 3
          ? "Developing"
          : score === 2
            ? "Limited"
            : "Not decision-ready";

  const explanation = input.source === "demo"
    ? "Generated signals verify the workflow only. They are not evidence from a physical engine."
    : input.validityStatus === "Blocked"
      ? "Do not change the CFD model from this result. First correct the failed case-matching check."
      : input.dataQualityStatus === "Review"
        ? "A signal-quality problem limits this decision. Correct the listed problem before relying on the recommendation."
        : score >= 4
          ? "The evidence is strong enough to use this next-run plan after engineering review."
          : "The plan can guide the next controlled test. The missing evidence layers are listed below.";

  return { score, maximumScore: 5, label, explanation, gates };
}
