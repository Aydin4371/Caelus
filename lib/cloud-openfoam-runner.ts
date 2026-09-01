import type { Rde2dPackage, Rde2dResultSummary } from "@/lib/rde-2d-workflow";

export type CloudComputeTier = {
  id: "quick" | "balanced" | "refined";
  label: string;
  vcpu: number;
  memoryGiB: number;
  available: boolean;
  estimatedUsdPerHour: number | null;
};

export type CloudRunnerHealth = {
  status: "ready" | "unavailable";
  provider: "Google Cloud Run";
  region: string | null;
  message: string;
  tiers: CloudComputeTier[];
};

export type CloudRunnerJob = {
  id: string;
  mode: "reacting-cfd";
  tier: CloudComputeTier["id"];
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "cancelling";
  stage: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  executionName?: string | null;
  logs: Array<{ at: string; source: "system" | "stdout" | "stderr"; line: string }>;
  result?: Rde2dResultSummary | null;
  usage?: { elapsedSeconds: number; estimatedUsd: number | null } | null;
};

const CLOUD_RUNNER_API = "/api/cloud-cfd";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${CLOUD_RUNNER_API}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("Kythros could not reach its cloud execution service.");
  }
  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? payload?.message ?? `Cloud execution returned HTTP ${response.status}.`);
  return payload as T;
}

export function getCloudRunnerHealth(): Promise<CloudRunnerHealth> {
  return requestJson<CloudRunnerHealth>("/health", { method: "GET" });
}

export function createCloudRunnerJob(tier: CloudComputeTier["id"], casePackage: Rde2dPackage): Promise<CloudRunnerJob> {
  return requestJson<CloudRunnerJob>("/jobs", { method: "POST", body: JSON.stringify({ mode: "reacting-cfd", tier, casePackage }) });
}

export function getCloudRunnerJob(id: string): Promise<CloudRunnerJob> {
  return requestJson<CloudRunnerJob>(`/jobs/${encodeURIComponent(id)}`, { method: "GET" });
}

export function cancelCloudRunnerJob(id: string): Promise<CloudRunnerJob> {
  return requestJson<CloudRunnerJob>(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
}
