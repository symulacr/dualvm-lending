/**
 * Fresh probe collection v2.
 *
 * Deploys fresh instances of RevmQuoteCallerProbe and RevmRoundTripSettlementProbe,
 * then runs stage1 (echo+quote) and stage3 (roundtrip settlement) exactly once each.
 * Results are written to deployments/probe-results-v2.json.
 *
 * The PVM target is the deployed PvmQuoteProbe contract which implements both
 * echo() and quote() using the same deterministic risk model logic as
 * DeterministicRiskModel.sol. The DeterministicRiskModel (deployed separately
 * as the production PVM risk engine in RiskAdapterV2) exposes only quote(),
 * making it incompatible with the echo stage of this probe.
 *
 * Note: Do NOT modify probe contract code — only fresh deployments and single runs.
 */

import hre from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { AbiCoder, keccak256 } from "ethers";
import { loadProbeDeploymentManifest } from "../../lib/probes/probeStore";
import { PROBE_QUOTE_INPUT, createProbeSigner, txUrl } from "../../lib/probes/probeUtils";
import { runEntrypoint } from "../../lib/runtime/entrypoint";

const { ethers } = hre;

const DIRECT_SYNC_MODE = 1;
const abiCoder = AbiCoder.defaultAbiCoder();
const ECHO_INPUT = "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000" as const;
const QUOTE_INPUT = PROBE_QUOTE_INPUT;
const DEBT_DELTA = 1_000n;

function quoteInputHash() {
  return keccak256(
    abiCoder.encode(
      ["uint256", "uint256", "uint256", "bool"],
      [QUOTE_INPUT.utilizationBps, QUOTE_INPUT.collateralRatioBps, QUOTE_INPUT.oracleAgeSeconds, QUOTE_INPUT.oracleFresh],
    ),
  );
}

function quoteResultHash() {
  return keccak256(abiCoder.encode(["uint256", "uint256", "uint256"], [700n, 7_500n, 8_500n]));
}

export async function main() {
  const manifest = loadProbeDeploymentManifest();

  if (!manifest.pvm.quoteProbe?.address || !manifest.pvm.quoteProbe.codeHash) {
    throw new Error("PVM quote probe must be deployed first (run deploy:pvm:probes:testnet)");
  }

  // Use PvmQuoteProbe as the PVM target since it has both echo() and quote().
  // DeterministicRiskModel (pvm.deterministicRiskModel) only has quote() and
  // cannot serve the echo stage.
  const pvmTarget = manifest.pvm.quoteProbe.address;
  const pvmTargetId = manifest.pvm.quoteProbe.codeHash;
  const pvmDeterministicRiskModel = manifest.pvm.deterministicRiskModel?.address ?? null;

  const { signer } = await createProbeSigner(manifest.polkadotHubTestnet.faucetUrl);
  const explorerBaseUrl = manifest.polkadotHubTestnet.explorerUrl;

  console.log(`\n=== Fresh Probe Deployment (v2) ===`);
  console.log(`Deployer: ${await signer.getAddress()}`);
  console.log(`PVM target (PvmQuoteProbe): ${pvmTarget}`);
  console.log(`PVM target code hash: ${pvmTargetId}`);
  if (pvmDeterministicRiskModel) {
    console.log(`PVM DeterministicRiskModel (production, quote-only): ${pvmDeterministicRiskModel}`);
  }

  // ─── Phase 1: Deploy fresh REVM probe contracts ───

  console.log("\n[1/2] Deploying RevmQuoteCallerProbe...");
  const quoteCallerFactory = await ethers.getContractFactory("RevmQuoteCallerProbe", signer);
  const quoteCaller = await quoteCallerFactory.deploy(pvmTarget, pvmTargetId, DIRECT_SYNC_MODE);
  await quoteCaller.waitForDeployment();
  const quoteCallerTx = quoteCaller.deploymentTransaction();
  if (!quoteCallerTx) throw new Error("Missing RevmQuoteCallerProbe deployment tx");
  const quoteCallerAddress = (await quoteCaller.getAddress()) as `0x${string}`;
  console.log(`  → ${quoteCallerAddress} (tx: ${quoteCallerTx.hash})`);

  console.log("\n[2/2] Deploying RevmRoundTripSettlementProbe...");
  const settlementFactory = await ethers.getContractFactory("RevmRoundTripSettlementProbe", signer);
  const settlement = await settlementFactory.deploy(quoteCallerAddress);
  await settlement.waitForDeployment();
  const settlementTx = settlement.deploymentTransaction();
  if (!settlementTx) throw new Error("Missing RevmRoundTripSettlementProbe deployment tx");
  const settlementAddress = (await settlement.getAddress()) as `0x${string}`;
  console.log(`  → ${settlementAddress} (tx: ${settlementTx.hash})`);

  // ─── Build results skeleton ───

  const results: {
    generatedAt: string;
    description: string;
    pvmTarget: string;
    pvmTargetId: string;
    pvmDeterministicRiskModel: string | null;
    deployedProbes: {
      revmQuoteCallerProbeV2: {
        address: `0x${string}`;
        deployTxHash: string;
        explorerUrl: string;
        pvmTarget: string;
        pvmTargetId: string;
        transportMode: string;
      };
      revmRoundTripSettlementProbeV2: {
        address: `0x${string}`;
        deployTxHash: string;
        explorerUrl: string;
        quoteAdapter: `0x${string}`;
      };
    };
    stages: {
      stage1?: {
        status: "passed" | "failed" | "skipped";
        echo?: Record<string, unknown>;
        quote?: Record<string, unknown>;
      };
      stage3?: Record<string, unknown>;
    };
  } = {
    generatedAt: new Date().toISOString(),
    description:
      "Fresh probe-results-v2: RevmQuoteCallerProbe and RevmRoundTripSettlementProbe deployed fresh, " +
      "stage1 (echo+quote) and stage3 (settlement) each run exactly once against the PvmQuoteProbe PVM target.",
    pvmTarget,
    pvmTargetId,
    pvmDeterministicRiskModel,
    deployedProbes: {
      revmQuoteCallerProbeV2: {
        address: quoteCallerAddress,
        deployTxHash: quoteCallerTx.hash,
        explorerUrl: `${explorerBaseUrl}address/${quoteCallerAddress}`,
        pvmTarget,
        pvmTargetId,
        transportMode: "DirectSync",
      },
      revmRoundTripSettlementProbeV2: {
        address: settlementAddress,
        deployTxHash: settlementTx.hash,
        explorerUrl: `${explorerBaseUrl}address/${settlementAddress}`,
        quoteAdapter: quoteCallerAddress,
      },
    },
    stages: {},
  };

  // ─── Phase 2: Stage 1 — Echo ───

  console.log("\n=== Stage 1: Echo ===");
  let echoResult: { status: "passed" | "failed"; txHash?: string; readbacks?: Record<string, unknown>; error?: string };
  try {
    const tx = await quoteCaller.runEcho(ECHO_INPUT);
    const receipt = await tx.wait();
    const lastEchoInput = await quoteCaller.lastEchoInput();
    const lastEchoOutput = await quoteCaller.lastEchoOutput();
    const pvmTargetIdRead = await quoteCaller.pvmTargetId();
    const passed = lastEchoOutput.toLowerCase() === ECHO_INPUT.toLowerCase();
    echoResult = {
      status: passed ? "passed" : "failed",
      txHash: receipt.hash,
      readbacks: { lastEchoInput, lastEchoOutput, pvmTargetId: pvmTargetIdRead },
    };
    console.log(`  Echo status: ${echoResult.status}`);
    console.log(`  TX: ${receipt.hash}`);
    console.log(`  Explorer: ${txUrl(explorerBaseUrl, receipt.hash)}`);
  } catch (error) {
    echoResult = {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    console.error(`  Echo FAILED: ${echoResult.error}`);
  }

  // ─── Phase 3: Stage 1 — Quote ───

  console.log("\n=== Stage 1: Quote ===");
  let quoteResult: { status: "passed" | "failed"; txHash?: string; readbacks?: Record<string, unknown>; error?: string };
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
    };
    const passed =
      readbacks.lastInputHash.toLowerCase() === quoteInputHash().toLowerCase() &&
      readbacks.lastResultHash.toLowerCase() === quoteResultHash().toLowerCase() &&
      readbacks.lastBorrowRateBps === "700" &&
      readbacks.lastMaxLtvBps === "7500" &&
      readbacks.lastLiquidationThresholdBps === "8500";
    quoteResult = {
      status: passed ? "passed" : "failed",
      txHash: receipt.hash,
      readbacks,
    };
    console.log(`  Quote status: ${quoteResult.status}`);
    console.log(`  TX: ${receipt.hash}`);
    console.log(`  borrowRateBps=${readbacks.lastBorrowRateBps}, maxLtvBps=${readbacks.lastMaxLtvBps}, liqThresholdBps=${readbacks.lastLiquidationThresholdBps}`);
  } catch (error) {
    quoteResult = {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    console.error(`  Quote FAILED: ${quoteResult.error}`);
  }

  const stage1Passed = echoResult.status === "passed" && quoteResult.status === "passed";
  results.stages.stage1 = {
    status: stage1Passed ? "passed" : "failed",
    echo: echoResult,
    quote: quoteResult,
  };
  console.log(`\nStage 1 overall: ${results.stages.stage1.status}`);

  // ─── Phase 4: Stage 3 — Roundtrip Settlement (single run) ───

  if (!stage1Passed) {
    results.stages.stage3 = {
      status: "skipped",
      summary: "Stage 3 skipped because Stage 1 did not pass.",
    };
    console.log("\nStage 3: SKIPPED (stage 1 did not pass)");
  } else {
    console.log("\n=== Stage 3: Roundtrip Settlement (single run) ===");
    // Expected: DEBT_DELTA + DEBT_DELTA * borrowRateBps / BPS = 1000 + 1000 * 700 / 10000 = 1070
    const expectedPrincipalDebt = DEBT_DELTA + (DEBT_DELTA * 700n) / 10_000n; // 1070

    try {
      const tx = await settlement.settleBorrow(QUOTE_INPUT, DEBT_DELTA);
      const receipt = await tx.wait();
      const readbacks = {
        principalDebt: (await settlement.principalDebt()).toString(),
        lastBorrowRateBps: (await settlement.lastBorrowRateBps()).toString(),
        lastMaxLtvBps: (await settlement.lastMaxLtvBps()).toString(),
        lastLiquidationThresholdBps: (await settlement.lastLiquidationThresholdBps()).toString(),
        lastQuoteHash: await settlement.lastQuoteHash(),
        settlementCount: (await settlement.settlementCount()).toString(),
      };

      const passed =
        readbacks.principalDebt === expectedPrincipalDebt.toString() &&
        readbacks.lastBorrowRateBps === "700" &&
        readbacks.lastMaxLtvBps === "7500" &&
        readbacks.lastLiquidationThresholdBps === "8500";

      results.stages.stage3 = {
        status: passed ? "passed" : "failed",
        txHash: receipt.hash,
        explorerUrl: txUrl(explorerBaseUrl, receipt.hash),
        expected: {
          principalDebt: expectedPrincipalDebt.toString(),
          borrowRateBps: "700",
          maxLtvBps: "7500",
          liquidationThresholdBps: "8500",
        },
        readbacks,
      };

      console.log(`  Stage 3 status: ${results.stages.stage3.status}`);
      console.log(`  TX: ${receipt.hash}`);
      console.log(`  principalDebt=${readbacks.principalDebt} (expected ${expectedPrincipalDebt})`);
      console.log(`  settlementCount=${readbacks.settlementCount}`);
    } catch (error) {
      results.stages.stage3 = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      console.error(`  Stage 3 FAILED: ${(results.stages.stage3 as { error?: string }).error}`);
    }
  }

  // ─── Write results ───

  const outDir = path.join(process.cwd(), "deployments");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "probe-results-v2.json");
  results.generatedAt = new Date().toISOString();
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  const stage3Status = (results.stages.stage3 as { status?: string })?.status;
  console.log(`\n=== Summary ===`);
  console.log(`Stage 1 (echo+quote): ${results.stages.stage1?.status}`);
  console.log(`Stage 3 (settlement): ${stage3Status}`);
  console.log(`\nResults written to ${outPath}`);

  if (results.stages.stage1?.status !== "passed" || stage3Status !== "passed") {
    throw new Error("Probe collection did not fully pass — check results above.");
  }
}

runEntrypoint("scripts/probes/run-fresh-probe-collection-v2.ts", main);
