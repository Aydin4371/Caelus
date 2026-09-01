import assert from "node:assert/strict";
import test from "node:test";
import { validateGatewayJobRequest } from "../cloud-run/gateway/server.mjs";
import { handleCloudCfdProxy } from "../lib/cloud-cfd-proxy.ts";

const env = {
  KYTHROS_JOB_QUICK: "kythros-rde-quick",
  KYTHROS_JOB_BALANCED: "kythros-rde-balanced",
  KYTHROS_JOB_REFINED: "kythros-rde-refined",
};

const validPackage = {
  schema: "kythros-rde-2d-case",
  formatVersion: 1,
  readiness: { exportReady: true },
  files: [{ path: "system/blockMeshDict", content: "FoamFile {}" }],
};

test("cloud gateway accepts only configured Kythros reacting jobs", () => {
  const value = validateGatewayJobRequest({ mode: "reacting-cfd", tier: "balanced", casePackage: validPackage }, env);
  assert.equal(value.tier.vcpu, 4);
  assert.equal(value.casePackage.files.length, 1);
  assert.throws(() => validateGatewayJobRequest({ mode: "pretend-cfd", tier: "balanced", casePackage: validPackage }, env), /reacting-cfd/);
});

test("cloud gateway rejects absolute and traversing case paths", () => {
  assert.throws(() => validateGatewayJobRequest({ mode: "reacting-cfd", tier: "balanced", casePackage: { ...validPackage, files: [{ path: "../outside", content: "x" }] } }, env), /invalid file path/);
  assert.throws(() => validateGatewayJobRequest({ mode: "reacting-cfd", tier: "balanced", casePackage: { ...validPackage, files: [{ path: "/tmp/outside", content: "x" }] } }, env), /invalid file path/);
});

test("site proxy keeps cloud credentials server-side and requires identity", async () => {
  const unavailable = await handleCloudCfdProxy(new Request("https://example.com/api/cloud-cfd/health"), {});
  assert.equal(unavailable.status, 503);

  const proxyEnv = { KYTHROS_CFD_GATEWAY_URL: "https://gateway.example", KYTHROS_CFD_GATEWAY_TOKEN: "secret" };
  const unauthorized = await handleCloudCfdProxy(new Request("https://example.com/api/cloud-cfd/jobs", { method: "POST", body: "{}" }), proxyEnv);
  assert.equal(unauthorized.status, 401);

  let forwardedUrl = "";
  let forwardedHeaders = new Headers();
  const response = await handleCloudCfdProxy(new Request("https://example.com/api/cloud-cfd/jobs", { method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-email": "pilot@example.com" }, body: "{}" }), proxyEnv, async (request, init) => {
    forwardedUrl = request instanceof Request ? request.url : request.toString();
    forwardedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ id: "rde-test" }), { status: 202, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 202);
  assert.equal(forwardedHeaders.get("authorization"), "Bearer secret");
  assert.equal(forwardedHeaders.get("x-kythros-user"), "pilot@example.com");
  assert.equal(new URL(forwardedUrl).pathname, "/v1/jobs");
});
