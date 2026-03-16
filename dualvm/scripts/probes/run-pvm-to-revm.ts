import hre from "hardhat";
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import {
  type ProbeStageRecord,
  loadProbeDeploymentManifest,
  loadProbeResultsManifest,
  writeProbeResultsManifest,
} from "../../lib/probes/probeStore";
import { requireEnv } from "../../lib/runtime/env";
import { runEntrypoint } from "../../lib/runtime/entrypoint";

const { ethers } = hre;
const abiCoder = AbiCoder.defaultAbiCoder();
const QUOTE_INPUT = {
  utilizationBps: 5_000n,
  collateralRatioBps: 20_000n,
  oracleAgeSeconds: 60n,
  oracleFresh: true,
};
const CALLBACK_NAMESPACE = keccak256(toUtf8Bytes("DUALVM_PVM_CALLBACK_PROBE_V1"));

function txUrl(baseUrl: string, hash: string) {
  return `${baseUrl}tx/${hash}`;
}

function fingerprintHash(receiver: string, callId: string) {
  return keccak256(abiCoder.encode(["bytes32", "address", "bytes32"], [CALLBACK_NAMESPACE, receiver, callId]));
}


async function executeCallback(label: string, txPromise: Promise<any>, explorerBaseUrl: string): Promise<ProbeStageRecord> {
  try {
    const tx = await txPromise;
    const receipt = await tx.wait();
    return {
      status: "passed",
      summary: `${label} completed on-chain through the live PVM contract path.`,
      txHash: receipt.hash,
      explorerUrl: txUrl(explorerBaseUrl, receipt.hash),
    };
  } catch (error) {
    return {
      status: "failed",
      summary: `${label} submission failed on-chain.`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function main() {
  const privateKey = requireEnv("PRIVATE_KEY");
  const manifest = loadProbeDeploymentManifest();
  if (!manifest.pvm.callbackProbe?.address || !manifest.revm.callbackReceiver?.address) {
    throw new Error("PVM callback probe and REVM callback receiver must be deployed before Stage 2");
  }

  const provider = ethers.provider;
  const signer = new ethers.Wallet(privateKey, provider);
  const balanceWei = await provider.getBalance(signer.address);
  if (balanceWei === 0n) {
    throw new Error(`Probe deployer ${signer.address} has 0 PAS. Fund it before running Stage 2.`);
  }

  const callbackProbe = (await ethers.getContractFactory("PvmCallbackProbe", signer)).attach(
    manifest.pvm.callbackProbe.address,
  ) as any;
  const receiver = (await ethers.getContractFactory("RevmCallbackReceiver", signer)).attach(
    manifest.revm.callbackReceiver.address,
  ) as any;
  const results = loadProbeResultsManifest();
  const explorerBaseUrl = manifest.polkadotHubTestnet.explorerUrl;

  const fingerprintCallId = keccak256(toUtf8Bytes("dualvm-stage2-fingerprint"));
  const fingerprintResult = await executeCallback(
    "PVM callbackFingerprint",
    callbackProbe.callbackFingerprint(manifest.revm.callbackReceiver.address, fingerprintCallId),
    explorerBaseUrl,
  );
  if (fingerprintResult.status === "passed") {
    const readbacks = {
      seenCallId: await receiver.seenCallIds(fingerprintCallId),
      lastCallId: await receiver.lastCallId(),
      lastResultHash: await receiver.lastResultHash(),
      lastA: (await receiver.lastA()).toString(),
      lastB: (await receiver.lastB()).toString(),
    };
    const expectedFingerprintHash = fingerprintHash(manifest.revm.callbackReceiver.address, fingerprintCallId);
    fingerprintResult.expected = {
      lastCallId: fingerprintCallId,
      lastResultHash: expectedFingerprintHash,
      lastA: "1",
      lastB: "2",
    };
    fingerprintResult.readbacks = readbacks;
    if (
      !readbacks.seenCallId ||
      readbacks.lastCallId.toLowerCase() !== fingerprintCallId.toLowerCase() ||
      readbacks.lastResultHash.toLowerCase() !== expectedFingerprintHash.toLowerCase() ||
      readbacks.lastA !== "1" ||
      readbacks.lastB !== "2"
    ) {
      fingerprintResult.status = "failed";
      fingerprintResult.summary = "callbackFingerprint transaction landed, but the REVM receiver state did not match the expected PVM callback payload.";
    }
  }

  const quoteCallId = keccak256(toUtf8Bytes("dualvm-stage2-quote"));
  const quoteResult = await executeCallback(
    "PVM callbackQuote",
    callbackProbe.callbackQuote(manifest.revm.callbackReceiver.address, quoteCallId, QUOTE_INPUT),
    explorerBaseUrl,
  );
  if (quoteResult.status === "passed") {
    const readbacks = {
      seenCallId: await receiver.seenCallIds(quoteCallId),
      lastCallId: await receiver.lastCallId(),
      lastResultHash: await receiver.lastResultHash(),
      lastA: (await receiver.lastA()).toString(),
      lastB: (await receiver.lastB()).toString(),
    };
    const expectedQuoteResultHash = keccak256(abiCoder.encode(["uint256", "uint256", "uint256"], [700n, 7_500n, 8_500n]));
    quoteResult.expected = {
      lastCallId: quoteCallId,
      lastResultHash: expectedQuoteResultHash,
      lastA: "700",
      lastB: "7500",
    };
    quoteResult.readbacks = readbacks;
    if (
      !readbacks.seenCallId ||
      readbacks.lastCallId.toLowerCase() !== quoteCallId.toLowerCase() ||
      readbacks.lastResultHash.toLowerCase() !== expectedQuoteResultHash.toLowerCase() ||
      readbacks.lastA !== "700" ||
      readbacks.lastB !== "7500"
    ) {
      quoteResult.status = "failed";
      quoteResult.summary = "callbackQuote transaction landed, but the REVM receiver state did not match the expected PVM quote payload.";
    }
  }

  const stagePassed = fingerprintResult.status === "passed" || quoteResult.status === "passed";
  results.stages.stage2 = {
    status: stagePassed ? "passed" : "failed",
    summary: stagePassed
      ? "A live PVM-originated path changed REVM receiver state without any off-chain relay."
      : "No defensible live PVM->REVM callback was proven on-chain.",
    subresults: {
      callbackFingerprint: fingerprintResult,
      callbackQuote: quoteResult,
    },
    readbacks: {
      callbackReceiver: manifest.revm.callbackReceiver.address,
      callbackProbe: manifest.pvm.callbackProbe.address,
      operator: signer.address,
    },
  };

  const outPath = writeProbeResultsManifest(results);
  console.log(JSON.stringify({ outPath, stage2: results.stages.stage2 }, null, 2));
}

runEntrypoint("scripts/probes/run-pvm-to-revm.ts", main);
