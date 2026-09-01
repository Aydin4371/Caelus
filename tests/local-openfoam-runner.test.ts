import assert from "node:assert/strict";
import test from "node:test";
import { validateJobRequest } from "../runner/server.mjs";

const validPackage = {
  schema: "kythros-rde-2d-case",
  formatVersion: 1,
  files: [
    { path: "system/blockMeshDict", content: "FoamFile {}" },
    { path: "system/controlDict.mesh", content: "FoamFile {}" },
  ],
};

test("local runner accepts only versioned Kythros job modes", () => {
  const value = validateJobRequest({ mode: "mesh-verification", casePackage: validPackage });
  assert.equal(value.mode, "mesh-verification");
  assert.equal(value.casePackage.files.length, 2);
  assert.throws(() => validateJobRequest({ mode: "pretend-cfd", casePackage: validPackage }), /mesh-verification or reacting-cfd/);
});

test("local runner rejects absolute and traversing case paths", () => {
  assert.throws(() => validateJobRequest({ mode: "mesh-verification", casePackage: { ...validPackage, files: [{ path: "../outside", content: "x" }] } }), /invalid file path/);
  assert.throws(() => validateJobRequest({ mode: "mesh-verification", casePackage: { ...validPackage, files: [{ path: "/tmp/outside", content: "x" }] } }), /invalid file path/);
});
