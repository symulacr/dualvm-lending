import hre from "hardhat";
import { type ProbeStageRecord, loadProbeDeploymentManifest, loadProbeResultsManifest, writeProbeResultsManifest } from "../../lib/probes/probeStore";
import { PROBE_QUOTE_INPUT, createProbeSigner, txUrl } from "../../lib/probes/probeUtils";
import { runEntrypoint } from "../../lib/runtime/entrypoint";

const { ethers } = hre;
const QUOTE_INPUT = PROBE_QUOTE_INPUT;
const DEBT_DELTA = 1_000n;

export async function main() {
  const manifest = loadProbeDeploymentManifest();
  const results = loadProbeResultsManifest();
  if (!manifest.revm.roundTripSettlement?.address) {
    throw new Error("REVM roundtrip settlement probe is not deployed");
  }

  if (results.stages.stage1Quote?.status !== "passed") {
    results.stages.stage3 = {
      status: "skipped",
      summary: "Stage 3 skipped because Stage 1 did not prove a live REVM->PVM quote path.",
    };
    const outPath = writeProbeResultsManifest(results);
    console.log(JSON.stringify({ outPath, stage3: results.stages.stage3 }, null, 2));
    return;
  }

  const { signer } = await createProbeSigner(manifest.polkadotHubTestnet.faucetUrl);
  const settlementProbe = (await ethers.getContractFactory("RevmRoundTripSettlementProbe", signer)).attach(
    manifest.revm.roundTripSettlement.address,
  ) as any;

  const explorerBaseUrl = manifest.polkadotHubTestnet.explorerUrl;
  const expectedPrincipalDebt = DEBT_DELTA + (DEBT_DELTA * 700n) / 10_000n;

  let borrowStage: ProbeStageRecord;
  try {
    const tx = await settlementProbe.settleBorrow(QUOTE_INPUT, DEBT_DELTA);
    const receipt = await tx.wait();
    const readbacks = {
      principalDebt: (await settlementProbe.principalDebt()).toString(),
      lastBorrowRateBps: (await settlementProbe.lastBorrowRateBps()).toString(),
      lastMaxLtvBps: (await settlementProbe.lastMaxLtvBps()).toString(),
      lastLiquidationThresholdBps: (await settlementProbe.lastLiquidationThresholdBps()).toString(),
      lastQuoteHash: await settlementProbe.lastQuoteHash(),
      settlementCount: (await settlementProbe.settlementCount()).toString(),
    };
    const passed =
      readbacks.principalDebt === expectedPrincipalDebt.toString() &&
      readbacks.lastBorrowRateBps === "700" &&
      readbacks.lastMaxLtvBps === "7500" &&
      readbacks.lastLiquidationThresholdBps === "8500";
    borrowStage = {
      status: passed ? "passed" : "failed",
      summary: passed
        ? "Roundtrip settlement stored debt and quote state that depends on the PVM-derived borrow rate."
        : "Roundtrip settlement transaction landed, but stored settlement state did not match the expected PVM-dependent values.",
      txHash: receipt.hash,
      explorerUrl: txUrl(explorerBaseUrl, receipt.hash),
      expected: {
        principalDebt: expectedPrincipalDebt.toString(),
        borrowRateBps: "700",
        maxLtvBps: "7500",
        liquidationThresholdBps: "8500",
      },
      observed: readbacks,
      readbacks,
    };
  } catch (error) {
    borrowStage = {
      status: "failed",
      summary: "Roundtrip settleBorrow did not complete successfully.",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let liquidationStage: ProbeStageRecord;
  try {
    const tx = await settlementProbe.settleLiquidationCheck(QUOTE_INPUT);
    const receipt = await tx.wait();
    liquidationStage = {
      status: "passed",
      summary: "Roundtrip settleLiquidationCheck executed through the same quote adapter path.",
      txHash: receipt.hash,
      explorerUrl: txUrl(explorerBaseUrl, receipt.hash),
      readbacks: {
        settlementCount: (await settlementProbe.settlementCount()).toString(),
        lastBorrowRateBps: (await settlementProbe.lastBorrowRateBps()).toString(),
        lastMaxLtvBps: (await settlementProbe.lastMaxLtvBps()).toString(),
        lastLiquidationThresholdBps: (await settlementProbe.lastLiquidationThresholdBps()).toString(),
      },
    };
  } catch (error) {
    liquidationStage = {
      status: "failed",
      summary: "Roundtrip settleLiquidationCheck did not complete successfully.",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  results.stages.stage3 = {
    status: borrowStage.status === "passed" ? "passed" : "failed",
    summary:
      borrowStage.status === "passed"
        ? "A REVM settlement probe stored state that depends on a PVM-derived quote result."
        : "No defensible REVM settlement state mutation depending on a PVM-derived quote was proven.",
    subresults: {
      settleBorrow: borrowStage,
      settleLiquidationCheck: liquidationStage,
    },
  };

  const outPath = writeProbeResultsManifest(results);
  console.log(JSON.stringify({ outPath, stage3: results.stages.stage3 }, null, 2));
}

runEntrypoint("scripts/probes/run-roundtrip-settlement.ts", main);
