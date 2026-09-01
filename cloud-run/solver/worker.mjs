import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const id = process.env.KYTHROS_JOB_ID;
const bucket = process.env.KYTHROS_GCS_BUCKET;
const owner = process.env.KYTHROS_JOB_OWNER;
const template = process.env.KYTHROS_RDE_TEMPLATE || "/opt/kythros/template";
const solverCommand = process.env.KYTHROS_SOLVER_COMMAND;
const postprocessCommand = process.env.KYTHROS_POSTPROCESS_COMMAND;
const work = "/work/case";

if (!id || !bucket || !owner) throw new Error("Cloud Run did not supply the Kythros job identity.");

async function token() {
  const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
  if (!response.ok) throw new Error("Cloud service identity is unavailable.");
  return (await response.json()).access_token;
}

async function readObject(name) {
  const access = await token();
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`, { headers: { authorization: `Bearer ${access}` } });
  if (!response.ok) throw new Error(`Unable to read ${name} (${response.status}).`);
  return response.json();
}

async function writeObject(name, value) {
  const access = await token();
  const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`, { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`Unable to write ${name} (${response.status}).`);
}

let status = await readObject(`jobs/${id}.json`);
const started = Date.now();
async function update(patch, log) {
  const now = new Date().toISOString();
  status = { ...status, ...patch, owner, executionName: process.env.CLOUD_RUN_EXECUTION || status.executionName || null, updatedAt: now, logs: [...(status.logs || []), ...(log ? [{ at: now, source: "system", line: log }] : [])].slice(-500) };
  await writeObject(`jobs/${id}.json`, status);
}

async function run(label, command) {
  await update({ status: "running", stage: label, message: `${label} is running in Google Cloud.` }, `Started ${label}.`);
  const lines = [];
  await new Promise((resolvePromise, reject) => {
    const child = spawn("bash", ["-lc", command], { cwd: work, env: process.env });
    for (const [stream, source] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) stream.on("data", (chunk) => { for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) lines.push({ at: new Date().toISOString(), source, line: line.slice(0, 2000) }); });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${label} exited with ${signal ?? `code ${code}`}.`)));
  });
  status.logs = [...(status.logs || []), ...lines].slice(-500);
  await update({}, `Completed ${label}.`);
}

try {
  if (!solverCommand || !postprocessCommand) throw new Error("The managed solver image is missing its reviewed solver or result-adapter command.");
  await mkdir(work, { recursive: true });
  await cp(template, work, { recursive: true });
  const pkg = await readObject(`cases/${id}.json`);
  if (pkg.schema !== "kythros-rde-2d-case" || pkg.formatVersion !== 1) throw new Error("The stored case package is not a supported Kythros 2D case.");
  for (const file of pkg.files) {
    if (file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\")) throw new Error(`Unsafe case path: ${file.path}`);
    const target = resolve(work, file.path);
    if (!target.startsWith(`${resolve(work)}/`)) throw new Error(`Unsafe case path: ${file.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
  await run("mesh generation", "blockMesh");
  await run("mesh verification", "checkMesh");
  await run("reacting CFD", solverCommand);
  await run("result analysis", postprocessCommand);
  const result = JSON.parse(await readFile(join(work, "kythros-result.json"), "utf8"));
  if (result.schema !== "kythros-rde-2d-result" || result.formatVersion !== 1) throw new Error("The result adapter did not create a supported Kythros result.");
  await writeObject(`results/${id}.json`, result);
  const elapsedSeconds = Math.round((Date.now() - started) / 1000);
  const hourly = Number(process.env.KYTHROS_ESTIMATED_USD_PER_HOUR);
  await update({ status: "completed", stage: "complete", message: "OpenFOAM result returned to Kythros.", result, usage: { elapsedSeconds, estimatedUsd: Number.isFinite(hourly) ? Number((elapsedSeconds / 3600 * hourly).toFixed(4)) : null } }, "Cloud execution completed.");
} catch (error) {
  await update({ status: "failed", stage: status.stage || "solver", message: error instanceof Error ? error.message : "Cloud OpenFOAM execution failed." }, "Cloud execution failed.");
  process.exitCode = 1;
}
