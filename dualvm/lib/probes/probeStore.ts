import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { POLKADOT_HUB_TESTNET } from "../config/marketConfig";

export type HexValue = `0x${string}`;
export type ProbeTransportMode = "Unknown" | "DirectSync" | "AsyncOnchain" | "OffchainRelay";
export type ProbeStageStatus = "passed" | "failed" | "skipped";
export type ProbeStageKey = "stage0" | "stage1Echo" | "stage1Quote" | "stage2" | "stage3";
export type ProbeScalar = string | number | boolean | null;

export interface ProbeContractDeployment {
  address: HexValue;
  deployTxHash: HexValue;
  explorerUrl: string;
  codeHash?: HexValue;
  pvmTargetId?: HexValue;
  transportMode?: ProbeTransportMode;
}

export interface ProbeOperatorIdentity {
  evmAddress: HexValue;
  fallbackAccountHex: HexValue;
  paseoSs58: string;
  balanceWei?: string;
  balancePas?: string;
}

export interface ProbeDeploymentManifest {
  generatedAt: string;
  networkName: string;
  polkadotHubTestnet: typeof POLKADOT_HUB_TESTNET & { wssUrl: string };
  operator?: ProbeOperatorIdentity;
  pvm: {
    quoteProbe?: ProbeContractDeployment;
    callbackProbe?: ProbeContractDeployment;
    deterministicRiskModel?: ProbeContractDeployment;
  };
  revm: {
    callbackReceiver?: ProbeContractDeployment;
    quoteCaller?: ProbeContractDeployment;
    roundTripSettlement?: ProbeContractDeployment;
  };
  notes: string[];
}

export interface ProbeStageRecord {
  status: ProbeStageStatus;
  summary: string;
  txHash?: HexValue;
  explorerUrl?: string;
  error?: string;
  expected?: Record<string, ProbeScalar>;
  observed?: Record<string, ProbeScalar>;
  readbacks?: Record<string, ProbeScalar>;
  subresults?: Record<string, ProbeStageRecord>;
}

export interface ProbeResultsManifest {
  generatedAt: string;
  verdicts: {
    A: boolean;
    B: boolean;
    C: boolean;
    D: boolean;
  };
  finalSummary: string;
  stages: Partial<Record<ProbeStageKey, ProbeStageRecord>>;
}

export const PROBE_DEPLOYMENT_FILENAME = "polkadot-hub-testnet-probes.json";
export const PROBE_RESULTS_FILENAME = "polkadot-hub-testnet-probe-results.json";
export const POLKADOT_HUB_TESTNET_WSS_URL =
  process.env.POLKADOT_HUB_TESTNET_WSS_URL ?? "wss://asset-hub-paseo-rpc.n.dwellir.com";

export function getProbeDeploymentPath(cwd = process.cwd()) {
  return path.join(cwd, "deployments", PROBE_DEPLOYMENT_FILENAME);
}

export function getProbeResultsPath(cwd = process.cwd()) {
  return path.join(cwd, "deployments", PROBE_RESULTS_FILENAME);
}

export function createEmptyProbeDeploymentManifest(): ProbeDeploymentManifest {
  return {
    generatedAt: new Date().toISOString(),
    networkName: "polkadotHubTestnet",
    polkadotHubTestnet: {
      ...POLKADOT_HUB_TESTNET,
      wssUrl: POLKADOT_HUB_TESTNET_WSS_URL,
    },
    pvm: {},
    revm: {},
    notes: [],
  };
}

export function createEmptyProbeResultsManifest(): ProbeResultsManifest {
  return {
    generatedAt: new Date().toISOString(),
    verdicts: {
      A: false,
      B: false,
      C: false,
      D: false,
    },
    finalSummary: "",
    stages: {},
  };
}

export function loadProbeDeploymentManifest(cwd = process.cwd()): ProbeDeploymentManifest {
  const manifestPath = getProbeDeploymentPath(cwd);
  if (!existsSync(manifestPath)) {
    return createEmptyProbeDeploymentManifest();
  }

  return JSON.parse(readFileSync(manifestPath, "utf8")) as ProbeDeploymentManifest;
}

export function writeProbeDeploymentManifest(manifest: ProbeDeploymentManifest, cwd = process.cwd()) {
  const outDir = path.join(cwd, "deployments");
  mkdirSync(outDir, { recursive: true });
  manifest.generatedAt = new Date().toISOString();
  const outPath = getProbeDeploymentPath(cwd);
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  return outPath;
}

export function loadProbeResultsManifest(cwd = process.cwd()): ProbeResultsManifest {
  const manifestPath = getProbeResultsPath(cwd);
  if (!existsSync(manifestPath)) {
    return createEmptyProbeResultsManifest();
  }

  return JSON.parse(readFileSync(manifestPath, "utf8")) as ProbeResultsManifest;
}

export function writeProbeResultsManifest(manifest: ProbeResultsManifest, cwd = process.cwd()) {
  const outDir = path.join(cwd, "deployments");
  mkdirSync(outDir, { recursive: true });
  manifest.generatedAt = new Date().toISOString();
  const outPath = getProbeResultsPath(cwd);
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  return outPath;
}
