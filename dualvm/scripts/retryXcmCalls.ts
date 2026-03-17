import hre from "hardhat";
import { runEntrypoint } from "../lib/runtime/entrypoint";
import * as fs from "fs";
import * as path from "path";

/**
 * Retry script for XCM execute and send calls.
 *
 * Key insight from Polkadot docs gist (franciscoaguirre/a6dea0c55e81faba65bedf700033a1a2):
 * - Polkadot Hub TestNet uses XCM V5 (prefix `0x05`, not `0x03`/`0x04`)
 * - VersionedLocation (destination for send) also uses V5 codec index `0x05`
 * - For executeLocalXcm with WithdrawAsset: the contract must have PAS tokens
 *
 * Strategy:
 * 1. Fund CrossChainQuoteEstimator with some PAS
 * 2. Retry executeLocalXcm with the docs V5 sample message (now that contract has PAS)
 * 3. Try V5 destination format for sendCrossChainNotification
 * 4. Update the proof file with results
 */

/**
 * NOTE: These addresses will be updated by the script if new contracts are deployed
 * (i.e., the v2 contracts with receive() function).
 */
let ESTIMATOR_ADDRESS = "0xF07c4c32C10243Eb1b723cB5fDD68390213a8705";
let NOTIFIER_ADDRESS = "0x27eAaa3C1Eb98b8EF70a311414749219c6044e5A";

/** SCALE-encoded XCM V5 message: WithdrawAsset + BuyExecution + DepositAsset (Polkadot docs example) */
const SAMPLE_XCM_MESSAGE =
  "0x050c000401000003008c86471301000003008c8647000d010101000000010100368e8759910dab756d344995f1d3c79374ca8f70066d3a709e48029f6bf0ee7e";

/**
 * Minimal V5 XCM with a single ClearOrigin instruction.
 * V5 version byte: 0x05
 * 1 instruction compact: 0x04
 * ClearOrigin variant (index 10 = 0x0a in all XCM versions): 0x0a
 */
const MINIMAL_V5_XCM = "0x05040a";

/**
 * VersionedLocation V5 encoding of relay chain parent.
 * VersionedLocation::V5 codec index = 0x05 (follows XCM V5 pattern)
 * Location { parents: 1, interior: Here } = 0x01 0x00
 * Full: 0x050100
 */
const V5_RELAY_CHAIN_DEST = "0x050100";

/**
 * VersionedLocation V3 encoding of relay chain parent (fallback).
 * VersionedLocation::V3 codec index = 0x03
 * MultiLocation { parents: 1, interior: Here } = 0x01 0x00
 * Full: 0x030100
 */
const V3_RELAY_CHAIN_DEST = "0x030100";

/** Amount of PAS to fund the estimator contract (1 PAS in wei = 10^18) */
const FUND_AMOUNT = hre.ethers.parseEther("1");

/** Weight limits: use the actual weighMessage-derived weight from the previous run */
const EXEC_REF_TIME = 979_880_000n; // from previous weighMessage response
const EXEC_PROOF_SIZE = 10_943n; // from previous weighMessage response

const EXPLORER_BASE = "https://blockscout-testnet.polkadot.io";

interface RetryResult {
  success: boolean;
  txHash: string | null;
  error: string | null;
}

async function tryCall(label: string, fn: (opts?: { gasLimit: bigint }) => Promise<string>): Promise<RetryResult> {
  console.log(`\n[${label}]`);
  try {
    const hash = await fn();
    console.log(`  ✅ SUCCESS: ${hash}`);
    return { success: true, txHash: hash, error: null };
  } catch (e1: unknown) {
    const msg1 = e1 instanceof Error ? e1.message : String(e1);
    const short1 = msg1.substring(0, 200);
    console.log(`  Gas estimation failed: ${short1}`);
    console.log(`  Retrying with manual gasLimit...`);
    try {
      const hash = await fn({ gasLimit: 800_000n });
      console.log(`  ⚠️  TX submitted (may have reverted on-chain): ${hash}`);
      return { success: false, txHash: hash, error: short1 };
    } catch (e2: unknown) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      const hashMatch = msg2.match(/0x[0-9a-fA-F]{64}/);
      const txHash = hashMatch ? hashMatch[0] : null;
      const short2 = msg2.substring(0, 300);
      console.log(`  ⚠️  Could not submit: ${short2}`);
      if (txHash) console.log(`  TX hash: ${txHash}`);
      return { success: false, txHash, error: short2 };
    }
  }
}

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  console.log("=== XCM Calls Retry ===");
  console.log(`Network: ${hre.network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Estimator: ${ESTIMATOR_ADDRESS}`);
  console.log(`Notifier: ${NOTIFIER_ADDRESS}`);

  // Step 0: Deploy fresh contracts with receive() function
  // (The previously deployed contracts at the addresses above don't have receive())
  console.log("\nDeploying fresh CrossChainQuoteEstimator (with receive())...");
  const estimatorFactory = await hre.ethers.getContractFactory("CrossChainQuoteEstimator");
  const freshEstimator = await estimatorFactory.deploy();
  await freshEstimator.waitForDeployment();
  ESTIMATOR_ADDRESS = await freshEstimator.getAddress();
  console.log(`  Fresh estimator: ${ESTIMATOR_ADDRESS}`);
  console.log(`  Deploy TX: ${freshEstimator.deploymentTransaction()?.hash}`);

  console.log("\nDeploying fresh XcmLiquidationNotifier...");
  const notifierFactory = await hre.ethers.getContractFactory("XcmLiquidationNotifier");
  const freshNotifier = await notifierFactory.deploy();
  await freshNotifier.waitForDeployment();
  NOTIFIER_ADDRESS = await freshNotifier.getAddress();
  console.log(`  Fresh notifier: ${NOTIFIER_ADDRESS}`);
  console.log(`  Deploy TX: ${freshNotifier.deploymentTransaction()?.hash}`);

  const estimator = await hre.ethers.getContractAt("CrossChainQuoteEstimator", ESTIMATOR_ADDRESS);
  const notifier = await hre.ethers.getContractAt("XcmLiquidationNotifier", NOTIFIER_ADDRESS);

  // Step 1: Check and fund estimator
  let estimatorBalance = await hre.ethers.provider.getBalance(ESTIMATOR_ADDRESS);
  console.log(`\nEstimator balance: ${hre.ethers.formatEther(estimatorBalance)} PAS`);

  if (estimatorBalance < FUND_AMOUNT) {
    console.log(`\nFunding estimator with ${hre.ethers.formatEther(FUND_AMOUNT)} PAS...`);
    const fundTx = await deployer.sendTransaction({ to: ESTIMATOR_ADDRESS, value: FUND_AMOUNT });
    const fundReceipt = await fundTx.wait();
    console.log(`  Fund TX: ${fundTx.hash} (block: ${fundReceipt?.blockNumber})`);
    estimatorBalance = await hre.ethers.provider.getBalance(ESTIMATOR_ADDRESS);
    console.log(`  New estimator balance: ${hre.ethers.formatEther(estimatorBalance)} PAS`);
  }

  // Step 1b: Fund notifier too (XCM send may require balance)
  let notifierBalance = await hre.ethers.provider.getBalance(NOTIFIER_ADDRESS);
  console.log(`\nNotifier balance: ${hre.ethers.formatEther(notifierBalance)} PAS`);
  if (notifierBalance < FUND_AMOUNT) {
    console.log(`\nFunding notifier with ${hre.ethers.formatEther(FUND_AMOUNT)} PAS...`);
    const fundTx2 = await deployer.sendTransaction({ to: NOTIFIER_ADDRESS, value: FUND_AMOUNT });
    const fundReceipt2 = await fundTx2.wait();
    console.log(`  Fund TX: ${fundTx2.hash} (block: ${fundReceipt2?.blockNumber})`);
    notifierBalance = await hre.ethers.provider.getBalance(NOTIFIER_ADDRESS);
    console.log(`  New notifier balance: ${hre.ethers.formatEther(notifierBalance)} PAS`);
  }

  // Step 3: Try V5 ClearOrigin execute
  console.log("\n--- Attempt 1: executeLocalXcm with V5 ClearOrigin ---");
  const exec1 = await tryCall("V5 ClearOrigin execute", async (opts) => {
    console.log(`  message: ${MINIMAL_V5_XCM}`);
    const tx = await estimator.executeLocalXcm(MINIMAL_V5_XCM, EXEC_REF_TIME, EXEC_PROOF_SIZE, opts ?? {});
    const receipt = await tx.wait();
    if (receipt?.status === 0) throw new Error(`TX reverted on-chain: ${tx.hash}`);
    return tx.hash;
  });

  // Step 4: If V5 ClearOrigin failed, try with the funded docs sample
  let exec2: RetryResult = { success: false, txHash: null, error: "not attempted" };
  if (!exec1.success) {
    console.log("\n--- Attempt 2: executeLocalXcm with funded V5 docs sample ---");
    exec2 = await tryCall("V5 docs sample execute (funded)", async (opts) => {
      console.log(`  message: ${SAMPLE_XCM_MESSAGE} (V5 WithdrawAsset+BuyExecution+DepositAsset)`);
      console.log(`  refTime: ${EXEC_REF_TIME}, proofSize: ${EXEC_PROOF_SIZE}`);
      const tx = await estimator.executeLocalXcm(SAMPLE_XCM_MESSAGE, EXEC_REF_TIME, EXEC_PROOF_SIZE, opts ?? {});
      const receipt = await tx.wait();
      if (receipt?.status === 0) throw new Error(`TX reverted on-chain: ${tx.hash}`);
      return tx.hash;
    });
  }

  // Step 5: Try V5 destination for sendCrossChainNotification
  console.log("\n--- Attempt 3: sendCrossChainNotification with V5 destination ---");
  const send1 = await tryCall("V5 relay-chain send", async (opts) => {
    console.log(`  destination: ${V5_RELAY_CHAIN_DEST} (V5 relay chain parent)`);
    console.log(`  message: ${MINIMAL_V5_XCM} (V5 ClearOrigin)`);
    const tx = await estimator.sendCrossChainNotification(V5_RELAY_CHAIN_DEST, MINIMAL_V5_XCM, opts ?? {});
    const receipt = await tx.wait();
    if (receipt?.status === 0) throw new Error(`TX reverted on-chain: ${tx.hash}`);
    return tx.hash;
  });

  // Step 6: Try V3 destination fallback
  let send2: RetryResult = { success: false, txHash: null, error: "not attempted" };
  if (!send1.success) {
    console.log("\n--- Attempt 4: sendCrossChainNotification with V3 destination ---");
    send2 = await tryCall("V3 relay-chain send", async (opts) => {
      console.log(`  destination: ${V3_RELAY_CHAIN_DEST} (V3 relay chain parent)`);
      console.log(`  message: ${MINIMAL_V5_XCM}`);
      const tx = await estimator.sendCrossChainNotification(V3_RELAY_CHAIN_DEST, MINIMAL_V5_XCM, opts ?? {});
      const receipt = await tx.wait();
      if (receipt?.status === 0) throw new Error(`TX reverted on-chain: ${tx.hash}`);
      return tx.hash;
    });
  }

  // Step 7: Try V5 destination for notifyLiquidation
  console.log("\n--- Attempt 5: notifyLiquidation with V5 destination ---");
  const notify1 = await tryCall("V5 notifyLiquidation", async (opts) => {
    const tx = await notifier.notifyLiquidation(
      V5_RELAY_CHAIN_DEST,
      "0x1234567890123456789012345678901234567890",
      hre.ethers.parseEther("100"),
      hre.ethers.parseEther("110"),
      opts ?? {},
    );
    const receipt = await tx.wait();
    if (receipt?.status === 0) throw new Error(`TX reverted on-chain: ${tx.hash}`);
    return tx.hash;
  });

  // Determine best results
  const bestExec = exec1.success ? exec1 : exec2.success ? exec2 : exec1;
  const bestSend = send1.success ? send1 : send2.success ? send2 : send1;

  // Update proof file
  const proofPath = path.join(__dirname, "..", "deployments", "polkadot-hub-testnet-xcm-full-integration.json");
  let proof: Record<string, unknown> = {};
  if (fs.existsSync(proofPath)) {
    proof = JSON.parse(fs.readFileSync(proofPath, "utf-8")) as Record<string, unknown>;
  }

  proof.retryTimestamp = new Date().toISOString();
  proof.v2Contracts = {
    crossChainQuoteEstimator: {
      address: ESTIMATOR_ADDRESS,
      deployTxHash: freshEstimator.deploymentTransaction()?.hash ?? "unknown",
      explorerUrl: `${EXPLORER_BASE}/address/${ESTIMATOR_ADDRESS}`,
      note: "Updated with receive() function to accept PAS for XCM WithdrawAsset",
    },
    xcmLiquidationNotifier: {
      address: NOTIFIER_ADDRESS,
      deployTxHash: freshNotifier.deploymentTransaction()?.hash ?? "unknown",
      explorerUrl: `${EXPLORER_BASE}/address/${NOTIFIER_ADDRESS}`,
    },
  };
  proof.executeLocalXcmRetry = {
    attempt1_clearOrigin: exec1,
    attempt2_docsSample: exec2,
    bestResult: bestExec,
  };
  proof.sendCrossChainNotificationRetry = {
    attempt1_v5dest: send1,
    attempt2_v3dest: send2,
    bestResult: bestSend,
  };
  proof.notifyLiquidationRetry = {
    attempt_v5dest: notify1,
    bestResult: notify1,
  };

  // Update the top-level results
  proof.executeLocalXcmCall = {
    ...(proof.executeLocalXcmCall as Record<string, unknown>),
    ...bestExec,
    refTime: EXEC_REF_TIME.toString(),
    proofSize: EXEC_PROOF_SIZE.toString(),
  };
  proof.sendCrossChainNotificationCall = {
    ...(proof.sendCrossChainNotificationCall as Record<string, unknown>),
    ...bestSend,
    destination: bestSend.success ? (send1.success ? V5_RELAY_CHAIN_DEST : V3_RELAY_CHAIN_DEST) : V5_RELAY_CHAIN_DEST,
  };
  proof.notifyLiquidationCall = {
    ...(proof.notifyLiquidationCall as Record<string, unknown>),
    ...notify1,
    destination: V5_RELAY_CHAIN_DEST,
  };

  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + "\n");

  console.log("\n=== Summary ===");
  console.log(`executeLocalXcm:         ${bestExec.success ? "✅ success" : "⚠️  reverted"} TX: ${bestExec.txHash ?? "none"}`);
  console.log(`sendCrossChainNotif:     ${bestSend.success ? "✅ success" : "⚠️  reverted"} TX: ${bestSend.txHash ?? "none"}`);
  console.log(`notifyLiquidation:       ${notify1.success ? "✅ success" : "⚠️  reverted"} TX: ${notify1.txHash ?? "none"}`);
  if (bestExec.txHash) console.log(`  Execute TX: ${EXPLORER_BASE}/tx/${bestExec.txHash}`);
  if (bestSend.txHash) console.log(`  Send TX: ${EXPLORER_BASE}/tx/${bestSend.txHash}`);
  if (notify1.txHash) console.log(`  Notify TX: ${EXPLORER_BASE}/tx/${notify1.txHash}`);
  console.log(`\nProof updated: ${proofPath}`);
  console.log("=== Retry Complete ===");
}

runEntrypoint("scripts/retryXcmCalls.ts", main);
