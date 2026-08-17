export type DecisionQualityInput = {
  source: "uploaded" | "demo";
  validityStatus: "Valid" | "Review" | "Blocked";
  dataQualityStatus: "Ready" | "Review";
  controlledResultStatus: "effect-confirmed" | "converged" | "rejected" | "inconclusive" | "comparison-only" | null;
  uploadedPrecedentCount: number;
};

export type DecisionQualityGate = {
  id: "data-quality" | "validity" | "controlled-result" | "company-precedent";
  label: string;
  status: "passed" | "review" | "blocked" | "not-yet";
  statusLabel: string;
  result: string;
};

export type DecisionQuality = {
  label: "Demo only" | "Ready for engineering review" | "Supported by this case" | "Candidate test only" | "Needs another controlled run" | "Comparison only" | "Not ready";
  explanation: string;
  sourceLabel: "Uploaded experiment and CFD" | "Generated demonstration signals";
  gates: DecisionQualityGate[];
};

function controlledResultGate(status: DecisionQualityInput["controlledResultStatus"]): DecisionQualityGate {
  if (status === "effect-confirmed") return {
    id: "controlled-result",
    label: "Controlled rerun",
    status: "passed",
    statusLabel: "Classified",
    result: "One verified one-change rerun met the support rule.",
  };
  if (status === "converged") return {
    id: "controlled-result",
    label: "Controlled rerun",
    status: "passed",
    statusLabel: "Classified",
    result: "Two verified adjacent numerical levels met the convergence rule.",
  };
  if (status === "rejected") return {
    id: "controlled-result",
    label: "Controlled rerun",
    status: "passed",
    statusLabel: "Classified",
    result: "One verified one-change rerun met a rejection rule.",
  };
  if (status === "inconclusive") return {
    id: "controlled-result",
    label: "Controlled rerun",
    status: "review",
    statusLabel: "Inconclusive",
    result: "A verified one-change rerun was analyzed, but it met neither decision rule.",
  };
  if (status === "comparison-only") return {
    id: "controlled-result",
    label: "Controlled rerun",
    status: "blocked",
    statusLabel: "Not controlled",
    result: "The selected rerun changed more than one relevant input, so it cannot isolate one explanation.",
  };
  return {
    id: "controlled-result",
    label: "Controlled rerun",
    status: "not-yet",
    statusLabel: "Not tested",
    result: "No verified one-change rerun has classified this explanation yet.",
  };
}

export function buildDecisionQuality(input: DecisionQualityInput): DecisionQuality {
  const controlledResult = controlledResultGate(input.controlledResultStatus);
  const gates: DecisionQualityGate[] = [
    {
      id: "data-quality",
      label: "Signal data",
      status: input.dataQualityStatus === "Ready" ? "passed" : "review",
      statusLabel: input.dataQualityStatus === "Ready" ? "Passed" : "Review",
      result: input.dataQualityStatus === "Ready"
        ? "Sampling, duration, continuity, clipping, and spectral checks passed."
        : "At least one calculated signal-quality check needs review.",
    },
    {
      id: "validity",
      label: "Experiment-CFD pairing",
      status: input.validityStatus === "Valid" ? "passed" : input.validityStatus === "Blocked" ? "blocked" : "review",
      statusLabel: input.validityStatus === "Valid" ? "Passed" : input.validityStatus === "Blocked" ? "Blocked" : "Review",
      result: input.validityStatus === "Valid"
        ? "Geometry, operating point, probes, and comparison window are confirmed."
        : input.validityStatus === "Blocked"
          ? "A required case-matching check failed or was not confirmed."
          : "At least one case-matching check still needs review.",
    },
    controlledResult,
    {
      id: "company-precedent",
      label: "Independent confirmation",
      status: input.uploadedPrecedentCount > 0 ? "passed" : "not-yet",
      statusLabel: input.uploadedPrecedentCount > 0 ? "Available" : "Not available",
      result: input.uploadedPrecedentCount > 0
        ? `${input.uploadedPrecedentCount} comparable user-provided one-change rerun${input.uploadedPrecedentCount === 1 ? "" : "s"} from another case family met the same decision rule.`
        : "No comparable user-provided rerun from another case family has confirmed this decision.",
    },
  ];

  const sourceLabel: DecisionQuality["sourceLabel"] = input.source === "uploaded"
    ? "Uploaded experiment and CFD"
    : "Generated demonstration signals";

  if (input.source === "demo") return {
    label: "Demo only",
    explanation: "Generated signals test the workflow. They do not support a decision about a physical engine.",
    sourceLabel,
    gates,
  };
  if (input.validityStatus !== "Valid" || input.dataQualityStatus === "Review") return {
    label: "Not ready",
    explanation: "A data-quality or case-pairing problem must be resolved before using this recommendation.",
    sourceLabel,
    gates,
  };
  if (input.controlledResultStatus === "comparison-only") return {
    label: "Comparison only",
    explanation: "This rerun changed multiple relevant inputs, so it cannot confirm or reject one explanation.",
    sourceLabel,
    gates,
  };
  if (input.controlledResultStatus === "inconclusive") return {
    label: "Needs another controlled run",
    explanation: "The controlled rerun was valid, but its response did not meet a support or rejection rule.",
    sourceLabel,
    gates,
  };
  if (["effect-confirmed", "converged", "rejected"].includes(input.controlledResultStatus ?? "")) {
    return input.uploadedPrecedentCount > 0 ? {
      label: "Ready for engineering review",
      explanation: "This case produced a classified controlled result, and another case family independently met the same rule.",
      sourceLabel,
      gates,
    } : {
      label: "Supported by this case",
      explanation: "This case produced a classified controlled result. Another case family has not independently repeated it.",
      sourceLabel,
      gates,
    };
  }
  return {
    label: "Candidate test only",
    explanation: "The loaded data supports choosing this as the next controlled test. It does not yet confirm the explanation.",
    sourceLabel,
    gates,
  };
}
