import type { Rde2dPackage, Rde2dResultSummary } from "./rde-2d-workflow.ts";

export type LocalRunnerHealth = {
  schema: "kythros-local-runner-health";
  formatVersion: 1;
  runnerVersion: string;
  status: "ready" | "partial" | "unavailable";
  bindAddress: string;
  openfoam: {
    blockMesh: boolean;
    checkMesh: boolean;
    templateConfigured: boolean;
    solverConfigured: boolean;
    solverName: string | null;
    postprocessorConfigured: boolean;
  };
  capabilities: {
    meshVerification: boolean;
    reactingCfd: boolean;
  };
  message: string;
};

export type LocalRunnerLog = {
  at: string;
  source: "runner" | "stdout" | "stderr";
  line: string;
};

export type LocalRunnerJob = {
  schema: "kythros-local-runner-job";
  formatVersion: 1;
  id: string;
  mode: "mesh-verification" | "reacting-cfd";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  resultAvailable: boolean;
  result: Rde2dResultSummary | null;
  logs: LocalRunnerLog[];
};

export const LOCAL_RUNNER_URL = (process.env.NEXT_PUBLIC_KYTHROS_RUNNER_URL || "http://127.0.0.1:8788").replace(/\/$/, "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${LOCAL_RUNNER_URL}${path}`, { ...init, cache: "no-store" });
  } catch {
    throw new Error(`Local runner not found at ${LOCAL_RUNNER_URL}. Start Kythros and the runner on the same computer.`);
  }
  const value = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(value?.error || `Local runner returned HTTP ${response.status}.`);
  return value as T;
}

export function getLocalRunnerHealth() {
  return requestJson<LocalRunnerHealth>("/health");
}

export function createLocalRunnerJob(mode: LocalRunnerJob["mode"], casePackage: Rde2dPackage) {
  return requestJson<LocalRunnerJob>("/v1/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, casePackage }),
  });
}

export function getLocalRunnerJob(id: string) {
  return requestJson<LocalRunnerJob>(`/v1/jobs/${encodeURIComponent(id)}`);
}

export function cancelLocalRunnerJob(id: string) {
  return requestJson<LocalRunnerJob>(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}
