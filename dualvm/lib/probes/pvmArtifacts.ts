import { readFileSync } from "node:fs";
import path from "node:path";
import type { HexValue } from "./probeStore";

export interface PvmProbeArtifact {
  contractName: string;
  sourcePath: string;
  abi: readonly unknown[];
  bytecode: HexValue;
  compiler?: {
    reviveVersion?: string;
    objectFormat?: string;
  };
}

export function getPvmProbeArtifactPath(name: string, cwd = process.cwd()) {
  return path.join(cwd, "pvm-artifacts", "probes", `${name}.json`);
}

export function loadPvmProbeArtifact(name: string, cwd = process.cwd()): PvmProbeArtifact {
  const artifactPath = getPvmProbeArtifactPath(name, cwd);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as PvmProbeArtifact;
  if (!artifact.bytecode || !artifact.contractName || !Array.isArray(artifact.abi)) {
    throw new Error(`Invalid PVM probe artifact at ${artifactPath}`);
  }
  return artifact;
}
