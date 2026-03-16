import hre from "hardhat";
import { AbiCoder, keccak256 } from "ethers";
import {
  type ProbeResultsManifest,
  loadProbeDeploymentManifest,
  loadProbeResultsManifest,
  writeProbeResultsManifest,
} from "../../lib/probes/probeStore";
import { requireEnv } from "../../lib/runtime/env";
import { runEntrypoint } from "../../lib/runtime/entrypoint";

const { ethers } = hre;
const abiCoder = AbiCoder.defaultAbiCoder();

const ECHO_INPUT = "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000";
const QUOTE_INPUT = {
  utilizationBps: 5_000n,
  collateralRatioBps: 20_000n,
  oracleAgeSeconds: 60n,
  oracleFresh: true,
};

function txUrl(baseUrl: string, hash: string) {
  return `${baseUrl}tx/${hash}`;
}

function transportModeName(value: number) {
  switch (value) {
    case 1:
      return "DirectSync";
    case 2:
      return "AsyncOnchain";
    case 3:
      return "OffchainRelay";
    default:
      return "Unknown";
  }
}

function quoteInputHash() {
  return keccak256(abiCoder.encode(["uint256", "uint256", "uint256", "bool"], Object.values(QUOTE_INPUT)));
}

function quoteResultHash() {
  return keccak256(abiCoder.encode(["uint256", "uint256", "uint256"], [700n, 7_500n, 8_500n]));
}

function ensureResults(results: ProbeResultsManifest) {
  if (!results.stages.stage0 && !results.stages.stage1Echo && !results.stages.stage1Quote) {
    results.finalSummary = "";
  }
  return results;
}

export async function main() {
  const privateKey = requireEnv("PRIVATE_KEY");
  const manifest = loadProbeDeploymentManifest();
  if (!manifest.revm.quoteCaller?.address) {
    throw new Error("REVM quote caller probe is not deployed");
  }

  const results = ensureResults(loadProbeResultsManifest());
  const provider = ethers.provider;
  const signer = new ethers.Wallet(privateKey, provider);
  const quoteCaller = (await ethers.getContractFactory("RevmQuoteCallerProbe", signer)).attach(
    manifest.revm.quoteCaller.address,
  ) as any;

  const explorerBaseUrl = manifest.polkadotHubTestnet.explorerUrl;
  const transportMode = transportModeName(Number(await quoteCaller.transportMode()));
  const pvmTargetId = await quoteCaller.pvmTargetId();

  try {
    const tx = await quoteCaller.runEcho(ECHO_INPUT);
    const receipt = await tx.wait();
    const lastEchoOutput = await quoteCaller.lastEchoOutput();
    const passed = lastEchoOutput.toLowerCase() === ECHO_INPUT.toLowerCase();
    results.stages.stage1Echo = {
      status: passed ? "passed" : "failed",
      summary: passed
        ? "REVM caller stored the exact bytes32 returned from the direct sync VM path."
        : "REVM caller transaction succeeded, but stored echo output did not match the expected bytes32.",
      txHash: receipt.hash,
      explorerUrl: txUrl(explorerBaseUrl, receipt.hash),
      expected: {
        echoOutput: ECHO_INPUT,
        transportMode: "DirectSync",
      },
      observed: {
        echoOutput: lastEchoOutput,
        transportMode,
      },
      readbacks: {
        lastEchoInput: await quoteCaller.lastEchoInput(),
        lastEchoOutput,
        pvmTargetId,
      },
    };
  } catch (error) {
    results.stages.stage1Echo = {
      status: "failed",
      summary: "Direct sync REVM->PVM echo call did not complete successfully.",
      error: error instanceof Error ? error.message : String(error),
      observed: {
        transportMode,
        pvmTargetId,
      },
    };
  }

  try {
    const tx = await quoteCaller.runQuote(QUOTE_INPUT);
    const receipt = await tx.wait();
    const readbacks = {
      callCount: (await quoteCaller.callCount()).toString(),
      lastInputHash: await quoteCaller.lastInputHash(),
      lastResultHash: await quoteCaller.lastResultHash(),
      lastBorrowRateBps: (await quoteCaller.lastBorrowRateBps()).toString(),
      lastMaxLtvBps: (await quoteCaller.lastMaxLtvBps()).toString(),
      lastLiquidationThresholdBps: (await quoteCaller.lastLiquidationThresholdBps()).toString(),
      pvmTargetId,
      transportMode,
    };

    const passed =
      readbacks.lastInputHash.toLowerCase() === quoteInputHash().toLowerCase() &&
      readbacks.lastResultHash.toLowerCase() === quoteResultHash().toLowerCase() &&
      readbacks.lastBorrowRateBps === "700" &&
      readbacks.lastMaxLtvBps === "7500" &&
      readbacks.lastLiquidationThresholdBps === "8500";

    results.stages.stage1Quote = {
      status: passed ? "passed" : "failed",
      summary: passed
        ? "REVM caller stored and emitted the exact deterministic risk quote via the direct sync VM path."
        : "REVM caller transaction succeeded, but stored quote values did not match the expected deterministic output.",
      txHash: receipt.hash,
      explorerUrl: txUrl(explorerBaseUrl, receipt.hash),
      expected: {
        utilizationBps: "5000",
        collateralRatioBps: "20000",
        oracleAgeSeconds: "60",
        oracleFresh: true,
        lastInputHash: quoteInputHash(),
        lastResultHash: quoteResultHash(),
        borrowRateBps: "700",
        maxLtvBps: "7500",
        liquidationThresholdBps: "8500",
        transportMode: "DirectSync",
      },
      observed: readbacks,
      readbacks,
    };
  } catch (error) {
    results.stages.stage1Quote = {
      status: "failed",
      summary: "Direct sync REVM->PVM risk quote call did not complete successfully.",
      error: error instanceof Error ? error.message : String(error),
      observed: {
        transportMode,
        pvmTargetId,
      },
    };
  }

  const outPath = writeProbeResultsManifest(results);
  console.log(JSON.stringify({ outPath, stage1Echo: results.stages.stage1Echo, stage1Quote: results.stages.stage1Quote }, null, 2));
}

runEntrypoint("scripts/probes/run-revm-to-pvm.ts", main);
