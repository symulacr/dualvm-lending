import hre from "hardhat";
import { runEntrypoint } from "../lib/runtime/entrypoint";

/**
 * Deploy the updated CrossChainQuoteEstimator (with execute + send) and the new
 * XcmLiquidationNotifier to Polkadot Hub TestNet.
 *
 * After deployment, calls:
 *  1. executeLocalXcm() with the SCALE-encoded sample message from the Polkadot docs.
 *  2. sendCrossChainNotification() with a minimal relay-chain destination.
 *  3. XcmLiquidationNotifier.notifyLiquidation() with sample data.
 *
 * Live calls may revert due to insufficient funds or destination configuration —
 * that is OK. The goal is to demonstrate the contract correctly calls the precompile.
 * Results (success or revert with TX hash) are written to the proof file.
 *
 * SCALE encoding notes:
 * - VersionedXcm::V3 codec index = 0x03 (complex); V4 = 0x04
 * - VersionedMultiLocation::V3 codec index = 0x03
 * - MultiLocation { parents: 1, interior: Here } = 0x01 0x00
 * - So V3 relay-chain parent destination = 0x030100
 * - Minimal V3 XCM: 0x03 (V3) + 0x04 (1 instruction compact) + 0x0a (ClearOrigin variant)
 */

/** SCALE-encoded XCM message: WithdrawAsset + BuyExecution + DepositAsset (Polkadot docs example) */
const SAMPLE_XCM_MESSAGE =
  "0x050c000401000003008c86471301000003008c8647000d010101000000010100368e8759910dab756d344995f1d3c79374ca8f70066d3a709e48029f6bf0ee7e";

/**
 * Minimal V3 XCM with a single ClearOrigin instruction.
 * Encoding: 0x03 (V3 version) + 0x04 (compact len=1) + 0x0a (ClearOrigin variant)
 * ClearOrigin just removes the XCM origin — no assets required.
 */
const MINIMAL_XCM_MESSAGE = "0x03040a";

/**
 * SCALE-encoded VersionedMultiLocation for the relay-chain parent.
 * V3 variant (codec index 3): 0x03
 * MultiLocation { parents: 1, interior: Here }: 0x01 0x00
 * Full: 0x030100
 */
const RELAY_CHAIN_DESTINATION = "0x030100";

const XCM_PRECOMPILE_ADDRESS = "0x00000000000000000000000000000000000A0000";

/** Weight limits for executeLocalXcm */
const EXEC_REF_TIME = 1_000_000n;
const EXEC_PROOF_SIZE = 65_536n;

/** Sample liquidation data for XcmLiquidationNotifier */
const SAMPLE_BORROWER = "0x1234567890123456789012345678901234567890";
const SAMPLE_DEBT_REPAID = hre.ethers.parseUnits("100", 18);
const SAMPLE_COLLATERAL_SEIZED = hre.ethers.parseUnits("110", 18);

interface CallAttempt {
  txHash: string | null;
  success: boolean;
  error: string | null;
}

interface XcmFullIntegrationResult {
  timestamp: string;
  network: string;
  chainId: number;
  deployer: string;
  xcmPrecompileAddress: string;
  xcmPrecompileHasCode: boolean;
  crossChainQuoteEstimator: {
    address: string;
    deployTxHash: string;
    explorerUrl: string;
  };
  xcmLiquidationNotifier: {
    address: string;
    deployTxHash: string;
    explorerUrl: string;
  };
  executeLocalXcmCall: CallAttempt & { refTime: string; proofSize: string };
  sendCrossChainNotificationCall: CallAttempt & { destination: string };
  notifyLiquidationCall: CallAttempt & { borrower: string; destination: string };
}

/**
 * Attempt a call. If gas estimation fails, retry with a manual gasLimit override
 * so the TX is still submitted on-chain and a TX hash is recorded — even if
 * the call reverts. This satisfies the "record TX hash either way" requirement.
 */
async function attemptCall(
  label: string,
  fn: (opts?: { gasLimit: bigint }) => Promise<string>,
): Promise<CallAttempt> {
  console.log(`\nAttempting ${label}...`);
  // First try: normal call (may fail during gas estimation)
  try {
    const txHash = await fn();
    console.log(`  ✅ ${label} succeeded! TX: ${txHash}`);
    return { txHash, success: true, error: null };
  } catch (firstErr: unknown) {
    const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    console.log(`  Gas estimation failed, retrying with manual gasLimit...`);
    // Second try: manual gasLimit to force TX submission and get a TX hash
    try {
      const txHash = await fn({ gasLimit: 500_000n });
      console.log(`  ⚠️  ${label} submitted but may have failed on-chain. TX: ${txHash}`);
      return { txHash, success: false, error: `Gas estimation: ${firstMsg.substring(0, 300)}` };
    } catch (secondErr: unknown) {
      const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
      // Try to extract TX hash from revert error if present
      const hashMatch = msg.match(/0x[0-9a-fA-F]{64}/);
      const txHash = hashMatch ? hashMatch[0] : null;
      const truncated = msg.length > 600 ? msg.substring(0, 600) + "..." : msg;
      console.log(`  ⚠️  ${label} could not be submitted (OK for hackathon)`);
      if (txHash) console.log(`  TX hash: ${txHash}`);
      console.log(`  Error: ${truncated}`);
      return { txHash, success: false, error: truncated };
    }
  }
}

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  console.log("=== XCM Full Integration Deployment ===");
  console.log(`Network:  ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log();

  // Check XCM precompile
  const precompileCode = await hre.ethers.provider.getCode(XCM_PRECOMPILE_ADDRESS);
  const precompileHasCode = precompileCode !== "0x" && precompileCode.length > 2;
  console.log(`XCM precompile at ${XCM_PRECOMPILE_ADDRESS}: hasCode=${precompileHasCode}`);
  console.log();

  // ── Deploy CrossChainQuoteEstimator ──────────────────────────────────────────
  console.log("Deploying CrossChainQuoteEstimator (updated with execute + send)...");
  const estimatorFactory = await hre.ethers.getContractFactory("CrossChainQuoteEstimator");
  const estimator = await estimatorFactory.deploy();
  const estimatorDeployTx = estimator.deploymentTransaction();
  await estimator.waitForDeployment();
  const estimatorAddress = await estimator.getAddress();
  console.log(`  CrossChainQuoteEstimator: ${estimatorAddress}`);
  console.log(`  Deploy TX: ${estimatorDeployTx?.hash}`);

  // ── Deploy XcmLiquidationNotifier ────────────────────────────────────────────
  console.log("\nDeploying XcmLiquidationNotifier...");
  const notifierFactory = await hre.ethers.getContractFactory("XcmLiquidationNotifier");
  const notifier = await notifierFactory.deploy();
  const notifierDeployTx = notifier.deploymentTransaction();
  await notifier.waitForDeployment();
  const notifierAddress = await notifier.getAddress();
  console.log(`  XcmLiquidationNotifier: ${notifierAddress}`);
  console.log(`  Deploy TX: ${notifierDeployTx?.hash}`);

  // ── executeLocalXcm ───────────────────────────────────────────────────────────
  // Use minimal V3 XCM (ClearOrigin) as primary attempt; fall back to the docs
  // sample if minimal fails. ClearOrigin requires no assets.
  const execResult = await attemptCall("executeLocalXcm", async (opts) => {
    // Try minimal ClearOrigin first, then fall back to sample from Polkadot docs
    const msg = MINIMAL_XCM_MESSAGE;
    console.log(`  message: ${msg} (minimal V3 ClearOrigin)`);
    console.log(`  refTime: ${EXEC_REF_TIME}, proofSize: ${EXEC_PROOF_SIZE}`);
    const tx = await estimator.executeLocalXcm(msg, EXEC_REF_TIME, EXEC_PROOF_SIZE, opts ?? {});
    const receipt = await tx.wait();
    if (receipt?.status === 0) {
      throw new Error(`TX reverted on-chain: ${tx.hash}`);
    }
    return tx.hash;
  });

  // If minimal failed, try with the Polkadot docs sample message
  let execResultFinal = execResult;
  if (!execResult.success) {
    console.log("\nRetrying executeLocalXcm with full Polkadot docs sample message...");
    execResultFinal = await attemptCall("executeLocalXcm (docs sample)", async (opts) => {
      console.log(`  message: ${SAMPLE_XCM_MESSAGE}`);
      const tx = await estimator.executeLocalXcm(SAMPLE_XCM_MESSAGE, EXEC_REF_TIME, EXEC_PROOF_SIZE, opts ?? {});
      const receipt = await tx.wait();
      if (receipt?.status === 0) {
        throw new Error(`TX reverted on-chain: ${tx.hash}`);
      }
      return tx.hash;
    });
  }

  // ── sendCrossChainNotification ────────────────────────────────────────────────
  const sendResult = await attemptCall("sendCrossChainNotification (via CrossChainQuoteEstimator)", async (opts) => {
    console.log(`  destination: ${RELAY_CHAIN_DESTINATION} (V3 relay chain parent)`);
    console.log(`  message:     ${MINIMAL_XCM_MESSAGE} (minimal V3 ClearOrigin)`);
    const tx = await estimator.sendCrossChainNotification(RELAY_CHAIN_DESTINATION, MINIMAL_XCM_MESSAGE, opts ?? {});
    const receipt = await tx.wait();
    if (receipt?.status === 0) {
      throw new Error(`TX reverted on-chain: ${tx.hash}`);
    }
    return tx.hash;
  });

  // ── notifyLiquidation ────────────────────────────────────────────────────────
  const notifyResult = await attemptCall("notifyLiquidation (via XcmLiquidationNotifier)", async (opts) => {
    console.log(`  destination:       ${RELAY_CHAIN_DESTINATION}`);
    console.log(`  borrower:          ${SAMPLE_BORROWER}`);
    console.log(`  debtRepaid:        ${SAMPLE_DEBT_REPAID}`);
    console.log(`  collateralSeized:  ${SAMPLE_COLLATERAL_SEIZED}`);
    const tx = await notifier.notifyLiquidation(
      RELAY_CHAIN_DESTINATION,
      SAMPLE_BORROWER,
      SAMPLE_DEBT_REPAID,
      SAMPLE_COLLATERAL_SEIZED,
      opts ?? {},
    );
    const receipt = await tx.wait();
    if (receipt?.status === 0) {
      throw new Error(`TX reverted on-chain: ${tx.hash}`);
    }
    return tx.hash;
  });

  // Use the best execute result
  const bestExecResult = execResultFinal.success ? execResultFinal : execResult;

  // ── Build result ─────────────────────────────────────────────────────────────
  const explorerBase = "https://blockscout-testnet.polkadot.io";
  const result: XcmFullIntegrationResult = {
    timestamp: new Date().toISOString(),
    network: network.name,
    chainId,
    deployer: deployer.address,
    xcmPrecompileAddress: XCM_PRECOMPILE_ADDRESS,
    xcmPrecompileHasCode: precompileHasCode,
    crossChainQuoteEstimator: {
      address: estimatorAddress,
      deployTxHash: estimatorDeployTx?.hash ?? "unknown",
      explorerUrl: `${explorerBase}/address/${estimatorAddress}`,
    },
    xcmLiquidationNotifier: {
      address: notifierAddress,
      deployTxHash: notifierDeployTx?.hash ?? "unknown",
      explorerUrl: `${explorerBase}/address/${notifierAddress}`,
    },
    executeLocalXcmCall: {
      ...bestExecResult,
      refTime: EXEC_REF_TIME.toString(),
      proofSize: EXEC_PROOF_SIZE.toString(),
    },
    sendCrossChainNotificationCall: {
      ...sendResult,
      destination: RELAY_CHAIN_DESTINATION,
    },
    notifyLiquidationCall: {
      ...notifyResult,
      borrower: SAMPLE_BORROWER,
      destination: RELAY_CHAIN_DESTINATION,
    },
  };

  // ── Write results ─────────────────────────────────────────────────────────────
  const fs = await import("fs");
  const path = await import("path");
  const outPath = path.join(__dirname, "..", "deployments", "polkadot-hub-testnet-xcm-full-integration.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");

  console.log("\n=== Summary ===");
  console.log(`CrossChainQuoteEstimator: ${estimatorAddress}`);
  console.log(`XcmLiquidationNotifier:  ${notifierAddress}`);
  console.log(`executeLocalXcm:         ${bestExecResult.success ? "✅ success" : "⚠️  reverted"} (TX: ${bestExecResult.txHash ?? "n/a"})`);
  console.log(`sendCrossChainNotification: ${sendResult.success ? "✅ success" : "⚠️  reverted"} (TX: ${sendResult.txHash ?? "n/a"})`);
  console.log(`notifyLiquidation:       ${notifyResult.success ? "✅ success" : "⚠️  reverted"} (TX: ${notifyResult.txHash ?? "n/a"})`);
  console.log(`\nResults written to: ${outPath}`);
  console.log("=== XCM Full Integration Complete ===");
}

runEntrypoint("scripts/deployXcmFullIntegration.ts", main);
