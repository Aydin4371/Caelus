import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = 2_000_000;
const JOB_ID = /^[a-z0-9-]{8,80}$/;

function configuredTiers(env = process.env) {
  return [
    { id: "quick", label: "Quick", vcpu: 2, memoryGiB: 8, jobName: env.KYTHROS_JOB_QUICK, timeoutSeconds: 3600 },
    { id: "balanced", label: "Balanced", vcpu: 4, memoryGiB: 16, jobName: env.KYTHROS_JOB_BALANCED, timeoutSeconds: 10800 },
    { id: "refined", label: "Refined", vcpu: 8, memoryGiB: 32, jobName: env.KYTHROS_JOB_REFINED, timeoutSeconds: 21600 },
  ].map((tier) => ({ ...tier, available: Boolean(tier.jobName), estimatedUsdPerHour: numberOrNull(env[`KYTHROS_${tier.id.toUpperCase()}_USD_PER_HOUR`]) }));
}

function numberOrNull(value) {
  if (value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function validateGatewayJobRequest(value, env = process.env) {
  if (!value || typeof value !== "object") throw new Error("Cloud job request must be a JSON object.");
  if (value.mode !== "reacting-cfd") throw new Error("Cloud execution currently accepts reacting-cfd jobs only.");
  const tier = configuredTiers(env).find((item) => item.id === value.tier);
  if (!tier) throw new Error("Cloud compute tier must be quick, balanced, or refined.");
  if (!tier.available) throw new Error(`${tier.label} cloud compute is not configured.`);
  const pkg = value.casePackage;
  if (!pkg || pkg.schema !== "kythros-rde-2d-case" || pkg.formatVersion !== 1 || !Array.isArray(pkg.files)) throw new Error("A versioned Kythros 2D case package is required.");
  if (!pkg.readiness?.exportReady) throw new Error("The 2D case package is not ready to execute.");
  for (const file of pkg.files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") throw new Error("Every case file needs a path and text content.");
    if (file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\")) throw new Error(`Case package contains an invalid file path: ${file.path}`);
  }
  return { mode: "reacting-cfd", tier, casePackage: pkg };
}

function json(response, status = 200) {
  return { status, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(response) };
}

function publicJob(job) {
  const visible = { ...job };
  delete visible.owner;
  delete visible.operationName;
  return visible;
}

async function accessToken(fetchImpl = fetch) {
  const response = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
  if (!response.ok) throw new Error("Google Cloud service identity is unavailable.");
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Google Cloud did not return an access token.");
  return payload.access_token;
}

async function googleFetch(url, init = {}, fetchImpl = fetch) {
  const token = await accessToken(fetchImpl);
  const response = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google Cloud request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : "."}`);
  }
  return response;
}

function objectUrl(bucket, name, media = false) {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}${media ? "?alt=media" : ""}`;
}

async function writeObject(bucket, name, value, fetchImpl = fetch) {
  const token = await accessToken(fetchImpl);
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`;
  const response = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`Cloud Storage write failed (${response.status}).`);
}

async function readObject(bucket, name, fetchImpl = fetch, optional = false) {
  const token = await accessToken(fetchImpl);
  const response = await fetchImpl(objectUrl(bucket, name, true), { headers: { authorization: `Bearer ${token}` } });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`Cloud Storage read failed (${response.status}).`);
  return response.json();
}

function findExecutionName(value) {
  if (typeof value === "string" && /\/executions\/[a-z0-9-]+$/.test(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const nested of Object.values(value)) {
    const found = findExecutionName(nested);
    if (found) return found;
  }
  return null;
}

function baseConfig(env = process.env) {
  const config = { project: env.GCP_PROJECT_ID, region: env.GCP_REGION, bucket: env.KYTHROS_GCS_BUCKET, token: env.KYTHROS_GATEWAY_TOKEN };
  return { ...config, ready: Boolean(config.project && config.region && config.bucket && config.token && configuredTiers(env).some((tier) => tier.available)) };
}

async function launchCloudRun(config, id, tier, owner, fetchImpl = fetch) {
  const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(config.project)}/locations/${encodeURIComponent(config.region)}/jobs/${encodeURIComponent(tier.jobName)}:run`;
  const response = await googleFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: "KYTHROS_JOB_ID", value: id }, { name: "KYTHROS_GCS_BUCKET", value: config.bucket }, { name: "KYTHROS_JOB_OWNER", value: owner }] }], taskCount: 1, timeout: `${tier.timeoutSeconds}s` } }),
  }, fetchImpl);
  return response.json();
}

async function refreshOperation(job, config, fetchImpl = fetch) {
  if (!job.operationName || !["queued", "running", "cancelling"].includes(job.status)) return job;
  const response = await googleFetch(`https://run.googleapis.com/v2/${job.operationName}`, {}, fetchImpl);
  const operation = await response.json();
  const executionName = job.executionName ?? findExecutionName(operation);
  let next = { ...job, executionName, status: job.status === "queued" ? "running" : job.status, stage: job.status === "queued" ? "cloud-run" : job.stage, message: job.status === "queued" ? "Google Cloud allocated the OpenFOAM job." : job.message, updatedAt: new Date().toISOString() };
  if (operation.error) next = job.status === "cancelling"
    ? { ...next, status: "cancelled", stage: "cancelled", message: "The Google Cloud job was cancelled." }
    : { ...next, status: "failed", stage: "cloud-run", message: operation.error.message ?? "Google Cloud Run reported a failed execution." };
  await writeObject(config.bucket, `jobs/${job.id}.json`, next, fetchImpl);
  return next;
}

async function handle(request, env = process.env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const config = baseConfig(env);
  const bearer = request.headers.get("authorization");
  if (!config.token || bearer !== `Bearer ${config.token}`) return json({ error: "Unauthorized." }, 401);

  if (request.method === "GET" && url.pathname === "/v1/health") {
    const tiers = configuredTiers(env).map((tier) => ({ id: tier.id, label: tier.label, vcpu: tier.vcpu, memoryGiB: tier.memoryGiB, available: tier.available, estimatedUsdPerHour: tier.estimatedUsdPerHour }));
    return json({ status: config.ready ? "ready" : "unavailable", provider: "Google Cloud Run", region: config.region ?? null, message: config.ready ? "Managed OpenFOAM compute is ready." : "The Google Cloud project, storage bucket, or Cloud Run jobs are not fully configured.", tiers });
  }

  const owner = request.headers.get("x-kythros-user");
  if (!owner) return json({ error: "A Kythros user identity is required." }, 401);
  if (!config.ready) return json({ error: "Cloud execution is not fully configured." }, 503);

  if (request.method === "POST" && url.pathname === "/v1/jobs") {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return json({ error: "The 2D case package is too large for this cloud gateway." }, 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json({ error: "The 2D case package is too large for this cloud gateway." }, 413);
    let value;
    try { value = JSON.parse(raw); } catch { return json({ error: "Cloud job request must be valid JSON." }, 400); }
    let valid;
    try { valid = validateGatewayJobRequest(value, env); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid cloud job request." }, 400); }
    const id = `rde-${crypto.randomUUID().toLowerCase()}`;
    const now = new Date().toISOString();
    let job = { id, owner, mode: "reacting-cfd", tier: valid.tier.id, status: "queued", stage: "upload", message: "Case secured for Google Cloud execution.", createdAt: now, updatedAt: now, executionName: null, operationName: null, logs: [{ at: now, source: "system", line: "Kythros accepted the cloud job." }], result: null, usage: null };
    try {
      await writeObject(config.bucket, `cases/${id}.json`, valid.casePackage, fetchImpl);
      await writeObject(config.bucket, `jobs/${id}.json`, job, fetchImpl);
      const operation = await launchCloudRun(config, id, valid.tier, owner, fetchImpl);
      const latest = await readObject(config.bucket, `jobs/${id}.json`, fetchImpl, true);
      const workerStarted = latest && latest.status !== "queued";
      job = {
        ...job,
        ...(latest ?? {}),
        operationName: operation.name,
        stage: workerStarted ? latest.stage : "queued",
        message: workerStarted ? latest.message : "Waiting for Google Cloud Run capacity.",
        updatedAt: new Date().toISOString(),
      };
      await writeObject(config.bucket, `jobs/${id}.json`, job, fetchImpl);
      return json(publicJob(job), 202);
    } catch (error) {
      job = { ...job, status: "failed", stage: "submit", message: error instanceof Error ? error.message : "Cloud job submission failed.", updatedAt: new Date().toISOString() };
      await writeObject(config.bucket, `jobs/${id}.json`, job, fetchImpl).catch(() => undefined);
      return json(publicJob(job), 502);
    }
  }

  const match = url.pathname.match(/^\/v1\/jobs\/([a-z0-9-]+)$/);
  if (!match || !JOB_ID.test(match[1])) return json({ error: "Unknown cloud job route." }, 404);
  let job;
  try { job = await readObject(config.bucket, `jobs/${match[1]}.json`, fetchImpl); } catch { return json({ error: "Cloud job not found." }, 404); }
  if (job.owner !== owner) return json({ error: "Cloud job not found." }, 404);

  if (request.method === "GET") {
    try { job = await refreshOperation(job, config, fetchImpl); } catch { /* The job's last durable state remains authoritative. */ }
    const result = await readObject(config.bucket, `results/${job.id}.json`, fetchImpl, true).catch(() => null);
    if (result && !job.result) {
      job = { ...job, result, status: "completed", stage: "complete", message: "OpenFOAM result returned to Kythros.", updatedAt: new Date().toISOString() };
      await writeObject(config.bucket, `jobs/${job.id}.json`, job, fetchImpl);
    }
    return json(publicJob(job));
  }

  if (request.method === "DELETE") {
    if (!["queued", "running"].includes(job.status)) return json(publicJob(job));
    try { job = await refreshOperation(job, config, fetchImpl); } catch { /* Keep last state. */ }
    if (!job.executionName) return json({ error: "The execution is still being allocated. Try cancellation again in a few seconds." }, 409);
    await googleFetch(`https://run.googleapis.com/v2/${job.executionName}:cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, fetchImpl);
    job = { ...job, status: "cancelling", stage: "cancelling", message: "Google Cloud is stopping the OpenFOAM job.", updatedAt: new Date().toISOString() };
    await writeObject(config.bucket, `jobs/${job.id}.json`, job, fetchImpl);
    return json(publicJob(job));
  }
  return json({ error: "Unsupported cloud job request." }, 405);
}

export function createGatewayHandler(env = process.env, fetchImpl = fetch) {
  return async (request) => handle(request, env, fetchImpl);
}

function nodeRequest(req) {
  const controller = new AbortController();
  req.on("aborted", () => controller.abort());
  return new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : req, duplex: "half", signal: controller.signal });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handler = createGatewayHandler();
  createServer(async (req, res) => {
    try {
      const response = await handler(nodeRequest(req));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Gateway failure." }));
    }
  }).listen(PORT, "0.0.0.0", () => console.log(`Kythros cloud gateway listening on ${PORT}`));
}
