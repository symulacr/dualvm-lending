import { expect } from "chai";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";

describe("deployment manifest store", () => {
  it("includes the manifest path when the file is missing", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "dualvm-manifest-missing-"));
    try {
      expect(() => loadDeploymentManifest(tempDir)).to.throw("Failed to load deployment manifest at");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("includes the manifest path when json is malformed", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "dualvm-manifest-invalid-"));
    const deploymentsDir = path.join(tempDir, "deployments");
    mkdirSync(deploymentsDir, { recursive: true });
    writeFileSync(path.join(deploymentsDir, "polkadot-hub-testnet.json"), "{not-json");


    try {
      expect(() => loadDeploymentManifest(tempDir)).to.throw("Failed to load deployment manifest at");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
