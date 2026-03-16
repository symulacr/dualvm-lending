import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bigintReplacer, parseDeploymentManifest, type DeploymentManifest } from "../shared/deploymentManifest";

export const DEPLOYMENT_MANIFEST_FILENAME = "polkadot-hub-testnet.json";

export function getDeploymentManifestPath(cwd = process.cwd()) {
  const override = process.env.DEPLOYMENT_MANIFEST_PATH;
  if (override) {
    return path.isAbsolute(override) ? override : path.join(cwd, override);
  }
  return path.join(cwd, "deployments", DEPLOYMENT_MANIFEST_FILENAME);
}

export function loadDeploymentManifest(cwd = process.cwd()): DeploymentManifest {
  const manifestPath = getDeploymentManifestPath(cwd);
  try {
    return parseDeploymentManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch (error) {
    throw new Error(`Failed to load deployment manifest at ${manifestPath}`, {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

export function writeDeploymentManifest(manifest: DeploymentManifest, cwd = process.cwd()) {
  const outPath = getDeploymentManifestPath(cwd);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(manifest, bigintReplacer, 2));
  return outPath;
}
