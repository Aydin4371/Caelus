import type { LocalCfdJobStatus, LocalCfdRunRequest, LocalRunnerStatus } from "./local-cfd.ts";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: {
      core?: {
        invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
      };
    };
  }
}

const WEB_STATUS: LocalRunnerStatus = {
  apiVersion: 1,
  desktop: false,
  runtimeInstalled: false,
  runtimeVersion: null,
  solverInstalled: false,
  solverName: null,
  solverVersion: null,
  solverAccelerator: null,
  hardware: {
    platform: "unknown",
    architecture: "unknown",
    logicalCpuCount: 0,
    memoryGb: null,
    gpuName: null,
    gpuMemoryGb: null,
    cudaAvailable: false,
  },
  details: ["Full 3D runs inside the installed Kythros desktop app."],
};

export function isKythrosDesktop() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  if (!isKythrosDesktop()) throw new Error("Open this workspace in the installed Kythros desktop app to run Full 3D locally.");
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error("The Kythros desktop command bridge is unavailable. Restart or update the desktop app.");
  return invoke<T>(command, args);
}

export async function getLocalRunnerStatus(): Promise<LocalRunnerStatus> {
  if (!isKythrosDesktop()) return WEB_STATUS;
  return invokeDesktop<LocalRunnerStatus>("local_runtime_status");
}

export async function installLocalSolverRuntime(): Promise<LocalRunnerStatus> {
  return invokeDesktop<LocalRunnerStatus>("install_local_solver_runtime");
}

export async function startLocalCfd(request: LocalCfdRunRequest): Promise<LocalCfdJobStatus> {
  return invokeDesktop<LocalCfdJobStatus>("start_local_cfd", { request });
}

export async function getLocalCfdJobStatus(runId: string): Promise<LocalCfdJobStatus> {
  return invokeDesktop<LocalCfdJobStatus>("local_cfd_job_status", { runId });
}

export async function cancelLocalCfd(runId: string): Promise<LocalCfdJobStatus> {
  return invokeDesktop<LocalCfdJobStatus>("cancel_local_cfd", { runId });
}
