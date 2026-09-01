import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER_VERSION = "1.0.0";
const DEFAULT_PORT = 8788;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 32;
const MAX_LOG_LINES = 300;

const host = process.env.KYTHROS_RUNNER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.KYTHROS_RUNNER_PORT || DEFAULT_PORT);
const jobRoot = resolve(process.env.KYTHROS_RUNNER_JOB_ROOT || join(process.cwd(), "runner", ".jobs"));
const templateRoot = process.env.KYTHROS_RDE_CASE_TEMPLATE ? resolve(process.env.KYTHROS_RDE_CASE_TEMPLATE) : null;
const solverExecutable = process.env.KYTHROS_RDE_SOLVER?.trim() || null;
const postprocessorExecutable = process.env.KYTHROS_RDE_POSTPROCESSOR?.trim() || null;
const allowedOrigins = new Set((process.env.KYTHROS_RUNNER_ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173").split(",").map((value) => value.trim()).filter(Boolean));

const jobs = new Map();
const activeProcesses = new Map();

function parseArgs(name) {
  const raw = process.env[name];
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) throw new Error(`${name} must be a JSON array of strings.`);
  return parsed;
}

const solverArgs = parseArgs("KYTHROS_RDE_SOLVER_ARGS");
const postprocessorArgs = parseArgs("KYTHROS_RDE_POSTPROCESSOR_ARGS");

function commandAvailable(command) {
  if (!command) return false;
  const probe = spawnSync("which", [command], { stdio: "ignore" });
  return probe.status === 0;
}

export function buildHealth() {
  const meshCommands = { blockMesh: commandAvailable("blockMesh"), checkMesh: commandAvailable("checkMesh") };
  const templateConfigured = Boolean(templateRoot && existsSync(templateRoot));
  const solverConfigured = Boolean(solverExecutable && commandAvailable(solverExecutable));
  const postprocessorConfigured = Boolean(postprocessorExecutable && commandAvailable(postprocessorExecutable));
  const meshVerification = meshCommands.blockMesh && meshCommands.checkMesh;
  const reactingCfd = meshVerification && templateConfigured && solverConfigured && postprocessorConfigured;
  return {
    schema: "kythros-local-runner-health",
    formatVersion: 1,
    runnerVersion: RUNNER_VERSION,
    status: reactingCfd ? "ready" : meshVerification ? "partial" : "unavailable",
    bindAddress: `${host}:${port}`,
    openfoam: {
      ...meshCommands,
      templateConfigured,
      solverConfigured,
      solverName: solverExecutable,
      postprocessorConfigured,
    },
    capabilities: { meshVerification, reactingCfd },
    message: reactingCfd
      ? "OpenFOAM mesh, reacting solver, case template, and Kythros result adapter are ready."
      : meshVerification
        ? "OpenFOAM can verify the generated mesh. Configure the reviewed RDE case template, solver, and result adapter before reacting CFD can run."
        : "OpenFOAM blockMesh and checkMesh are not available in this runner process.",
  };
}

function responseJson(response, status, value, origin) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...(origin && allowedOrigins.has(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  });
  response.end(body);
}

function publicJob(job) {
  return {
    schema: "kythros-local-runner-job",
    formatVersion: 1,
    id: job.id,
    mode: job.mode,
    status: job.status,
    stage: job.stage,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    resultAvailable: Boolean(job.result),
    result: job.result,
    logs: job.logs.slice(-MAX_LOG_LINES),
  };
}

function safeRelativePath(value) {
  if (typeof value !== "string" || !value || value.length > 240 || isAbsolute(value) || value.includes("\0")) return false;
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

export function validateJobRequest(value) {
  if (!value || typeof value !== "object") throw new Error("The job request must be a JSON object.");
  if (!["mesh-verification", "reacting-cfd"].includes(value.mode)) throw new Error("Choose mesh-verification or reacting-cfd mode.");
  const packageData = value.casePackage;
  if (!packageData || packageData.schema !== "kythros-rde-2d-case" || packageData.formatVersion !== 1) throw new Error("Choose a Kythros 2D case package.");
  if (!Array.isArray(packageData.files) || packageData.files.length === 0 || packageData.files.length > MAX_FILES) throw new Error(`The case package must contain 1-${MAX_FILES} files.`);
  let totalBytes = 0;
  for (const file of packageData.files) {
    if (!file || !safeRelativePath(file.path) || typeof file.content !== "string") throw new Error("The case package contains an invalid file path or content value.");
    totalBytes += Buffer.byteLength(file.content);
  }
  if (totalBytes > MAX_BODY_BYTES) throw new Error("The case package is too large for the local runner.");
  return { mode: value.mode, casePackage: packageData };
}

async function readRequestJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("Request body exceeds 5 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function appendLog(job, source, line) {
  const text = String(line).trimEnd();
  if (!text) return;
  for (const item of text.split(/\r?\n/)) job.logs.push({ at: new Date().toISOString(), source, line: item.slice(0, 2000) });
  if (job.logs.length > MAX_LOG_LINES * 2) job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  job.updatedAt = new Date().toISOString();
}

function setStage(job, stage, message) {
  job.stage = stage;
  job.message = message;
  job.updatedAt = new Date().toISOString();
}

async function runCommand(job, executable, args, cwd, stage, message) {
  if (job.cancelRequested) throw new Error("Job cancelled.");
  setStage(job, stage, message);
  appendLog(job, "runner", `$ ${executable} ${args.join(" ")}`);
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { cwd, env: { ...process.env, KYTHROS_JOB_ID: job.id, KYTHROS_CASE_DIR: cwd }, stdio: ["ignore", "pipe", "pipe"] });
    activeProcesses.set(job.id, child);
    child.stdout.on("data", (chunk) => appendLog(job, "stdout", chunk));
    child.stderr.on("data", (chunk) => appendLog(job, "stderr", chunk));
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      activeProcesses.delete(job.id);
      if (job.cancelRequested || signal === "SIGTERM" || signal === "SIGKILL") rejectPromise(new Error("Job cancelled."));
      else if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${executable} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function materializeCase(job) {
  const caseDir = resolve(jobRoot, job.id);
  await mkdir(jobRoot, { recursive: true });
  if (job.mode === "reacting-cfd" && templateRoot) await cp(templateRoot, caseDir, { recursive: true, force: false, errorOnExist: false });
  else await mkdir(caseDir, { recursive: true });
  for (const file of job.casePackage.files) {
    const target = resolve(caseDir, file.path);
    const relation = relative(caseDir, target);
    if (!relation || relation.startsWith(`..${sep}`) || relation === ".." || isAbsolute(relation)) throw new Error("A generated case path escaped the job directory.");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
  if (job.mode === "mesh-verification") {
    const meshControl = join(caseDir, "system", "controlDict.mesh");
    if (!existsSync(meshControl)) throw new Error("The case package does not include system/controlDict.mesh.");
    await copyFile(meshControl, join(caseDir, "system", "controlDict"));
  }
  return caseDir;
}

async function executeJob(job) {
  job.status = "running";
  try {
    const health = buildHealth();
    if (!health.capabilities.meshVerification) throw new Error("OpenFOAM blockMesh and checkMesh are not available. Start the runner inside an initialized OpenFOAM shell.");
    if (job.mode === "reacting-cfd" && !health.capabilities.reactingCfd) throw new Error("Reacting CFD is not configured. Supply a reviewed case template, solver executable, and Kythros postprocessor to the runner.");
    const caseDir = await materializeCase(job);
    await runCommand(job, "blockMesh", [], caseDir, "meshing", "Generating the periodic 2D mesh");
    await runCommand(job, "checkMesh", [], caseDir, "checking-mesh", "Checking mesh topology and geometry");
    if (job.mode === "mesh-verification") {
      job.status = "completed";
      setStage(job, "completed", "OpenFOAM generated and checked the mesh. No flow solution was calculated.");
      return;
    }
    await runCommand(job, solverExecutable, solverArgs, caseDir, "solving", `Running ${solverExecutable}`);
    await runCommand(job, postprocessorExecutable, postprocessorArgs, caseDir, "post-processing", "Creating the Kythros result summary from solver outputs");
    const resultPath = join(caseDir, "kythros-result.json");
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    if (result.schema !== "kythros-rde-2d-result" || result.formatVersion !== 1) throw new Error("The postprocessor did not create a valid kythros-result.json file.");
    job.result = result;
    job.status = "completed";
    setStage(job, "completed", "The solver and result adapter completed. Kythros can now analyze the returned summary.");
  } catch (error) {
    const cancelled = job.cancelRequested || (error instanceof Error && error.message === "Job cancelled.");
    job.status = cancelled ? "cancelled" : "failed";
    setStage(job, job.status, cancelled ? "The local job was cancelled." : error instanceof Error ? error.message : "The local job failed.");
    appendLog(job, "runner", job.message);
  }
}

function createJob(request) {
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    mode: request.mode,
    casePackage: request.casePackage,
    status: "queued",
    stage: "queued",
    message: "Waiting for the local runner",
    createdAt: now,
    updatedAt: now,
    logs: [],
    result: null,
    cancelRequested: false,
  };
  jobs.set(job.id, job);
  queueMicrotask(() => void executeJob(job));
  return job;
}

function cancelJob(job) {
  if (["completed", "failed", "cancelled"].includes(job.status)) return false;
  job.cancelRequested = true;
  const child = activeProcesses.get(job.id);
  if (child) {
    child.kill("SIGTERM");
    setTimeout(() => { if (activeProcesses.has(job.id)) child.kill("SIGKILL"); }, 5000).unref();
  }
  return true;
}

export function createRunnerServer() {
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return responseJson(response, 403, { error: "This browser origin is not allowed by the local runner." });
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": origin || "",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
      return response.end();
    }
    try {
      const url = new URL(request.url || "/", `http://${host}:${port}`);
      if (request.method === "GET" && url.pathname === "/health") return responseJson(response, 200, buildHealth(), origin);
      if (request.method === "POST" && url.pathname === "/v1/jobs") {
        const running = [...jobs.values()].some((job) => ["queued", "running"].includes(job.status));
        if (running) return responseJson(response, 409, { error: "The local runner is already executing a job." }, origin);
        const job = createJob(validateJobRequest(await readRequestJson(request)));
        return responseJson(response, 202, publicJob(job), origin);
      }
      const match = url.pathname.match(/^\/v1\/jobs\/([a-f0-9-]+)(\/cancel)?$/);
      if (match) {
        const job = jobs.get(match[1]);
        if (!job) return responseJson(response, 404, { error: "Local job not found." }, origin);
        if (request.method === "GET" && !match[2]) return responseJson(response, 200, publicJob(job), origin);
        if (request.method === "POST" && match[2] === "/cancel") {
          const accepted = cancelJob(job);
          return responseJson(response, accepted ? 202 : 409, accepted ? publicJob(job) : { error: "This job has already finished." }, origin);
        }
      }
      return responseJson(response, 404, { error: "Route not found." }, origin);
    } catch (error) {
      return responseJson(response, 400, { error: error instanceof Error ? error.message : "Invalid local-runner request." }, origin);
    }
  });
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const server = createRunnerServer();
  server.listen(port, host, () => {
    const health = buildHealth();
    console.log(`Kythros local runner ${RUNNER_VERSION} listening at http://${host}:${port}`);
    console.log(health.message);
  });
}
