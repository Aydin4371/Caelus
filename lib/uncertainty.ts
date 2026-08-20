export type AssessmentStatus =
  | "within-uncertainty"
  | "resolved-mismatch"
  | "inconclusive"
  | "within-limit"
  | "review"
  | "match"
  | "mismatch";

export type UncertaintyAssessment = {
  combined: number | null;
  status: AssessmentStatus;
  label: string;
  explanation: string;
};

function finiteNonnegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export function rss(...values: number[]) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

export function relativeAbsoluteUncertainty(value: number, uncertaintyPct: number) {
  if (!Number.isFinite(value) || !finiteNonnegative(uncertaintyPct)) return Number.NaN;
  return Math.abs(value) * uncertaintyPct / 100;
}

export function assessResolvedDifference(
  difference: number,
  experimentUncertainty: number,
  cfdUncertainty: number,
): UncertaintyAssessment {
  if (![difference, experimentUncertainty, cfdUncertainty].every(Number.isFinite)) {
    return {
      combined: null,
      status: "inconclusive",
      label: "Uncertainty incomplete",
      explanation: "Kythros can report the difference, but it needs both the experiment and CFD uncertainty values to decide whether that difference is meaningful.",
    };
  }
  const combined = rss(experimentUncertainty, cfdUncertainty);
  const resolved = Math.abs(difference) > combined;
  return resolved
    ? {
        combined,
        status: "resolved-mismatch",
        label: "Resolved mismatch",
        explanation: "The absolute CFD-to-experiment difference is larger than the combined one-standard-uncertainty estimate, so Kythros treats it as a resolved mismatch.",
      }
    : {
        combined,
        status: "within-uncertainty",
        label: "Within uncertainty",
        explanation: "The CFD-to-experiment difference is no larger than the combined one-standard-uncertainty estimate, so this case cannot distinguish the difference from the stated uncertainty.",
      };
}

export function frequencyUncertaintyKHz(
  frequencyKHz: number,
  durationMs: number,
  timingUncertaintyUs: number,
) {
  if (![frequencyKHz, durationMs, timingUncertaintyUs].every(Number.isFinite) || durationMs <= 0 || timingUncertaintyUs < 0) {
    return Number.NaN;
  }
  const halfSpectralBin = 0.5 / durationMs;
  const periodUs = 1000 / Math.max(frequencyKHz, 1e-12);
  const timingContribution = frequencyKHz * timingUncertaintyUs / periodUs;
  return rss(halfSpectralBin, timingContribution);
}

export function exactAssessment(matches: boolean): UncertaintyAssessment {
  return matches
    ? { combined: 0, status: "match", label: "Match", explanation: "The categorical CFD result matches the experiment." }
    : { combined: 0, status: "mismatch", label: "Mismatch", explanation: "The categorical CFD result differs from the experiment." };
}

export function statusTone(status: AssessmentStatus) {
  return status === "within-uncertainty" || status === "within-limit" || status === "match" ? "pass" : status === "inconclusive" ? "neutral" : "review";
}
