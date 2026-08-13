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
  if (status === "effect-confirmed") return "Confirmed";
  if (status === "converged") return "Converged";
  if (status === "rejected") return "Rejected";
  if (status === "inconclusive") return "Inconclusive";
  if (status === "comparison-only") return "Comparison only";
  return "Not run for this selected case";
}

export function buildDecisionQuality(input: DecisionQualityInput): DecisionQuality {
  const decisiveControlledResult = ["effect-confirmed", "converged", "rejected"].includes(input.controlledResultStatus ?? "");
  const gates: DecisionQualityGate[] = [
    {
      id: "real-data",
      label: "Real paired experiment + CFD data",
      satisfied: input.source === "uploaded",
      result: input.source === "uploaded" ? "Uploaded" : "Generated demonstration only",
    },
    {
      id: "validity",
      label: "Comparison validity",
      satisfied: input.validityStatus === "Valid",
      result: input.validityStatus,
    },
    {
      id: "data-quality",
      label: "Signal quality",
      satisfied: input.dataQualityStatus === "Ready",
      result: input.dataQualityStatus,
    },
    {
      id: "controlled-result",
      label: "Decisive one-change result",
      satisfied: decisiveControlledResult,
      result: controlledResultLabel(input.controlledResultStatus),
    },
    {
      id: "company-precedent",
      label: "Comparable company precedent",
      satisfied: input.uploadedPrecedentCount > 0,
      result: input.uploadedPrecedentCount > 0
        ? `${input.uploadedPrecedentCount} uploaded controlled rerun${input.uploadedPrecedentCount === 1 ? "" : "s"}`
        : "None loaded",
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
    ? "The calculations and branching logic ran, but generated signals cannot establish confidence for a real engine decision."
    : input.validityStatus === "Blocked"
      ? "The comparison is blocked. Repair the case match before using the recommendation to change CFD."
      : input.dataQualityStatus === "Review"
        ? "The loaded signals limit the decision. Resolve the data-quality findings before relying on the recommendation."
        : score >= 4
          ? "The selected case has direct, decision-relevant support. Engineering review is still required."
          : "The recommendation is usable as the next controlled test, but it still lacks one or more real evidence layers.";

  return { score, maximumScore: 5, label, explanation, gates };
}
