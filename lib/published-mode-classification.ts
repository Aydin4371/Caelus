export type PublishedWaveResponseClass = "Stable" | "Transitional" | "Unstable";

/**
 * Display-only grouping of a source author's reported propagation mode.
 * This function never analyzes a pressure trace and must not be presented as
 * an independently measured Kythros result.
 */
export function classifyPublishedPropagationMode(reportedMode: string): PublishedWaveResponseClass {
  const normalized = reportedMode.trim().toLowerCase();
  if (normalized === "single wave") return "Stable";
  if (normalized === "failure") return "Unstable";
  if (/intermittent|sporadic|collision|mixed|transition/.test(normalized)) return "Transitional";
  throw new Error(`Published propagation mode is not mapped: ${reportedMode}`);
}
