import hre from "hardhat";
import { runEntrypoint } from "../lib/runtime/entrypoint";
import * as fs from "fs";
import * as path from "path";

/**
 * Directly call notifyLiquidation on the XcmLiquidationNotifier from run 5.
 * This avoids re-deployment (which is currently failing with "Priority is too low").
 *
 * The notifier at this address was compiled with ClearOrigin message.
 */

// From the timed-out run 5 (latest notifier with ClearOrigin msg):
const NOTIFIER_ADDRESS = "0xD3764F3e98A0f617f488a75467bfe28390e9f562";

// V5 relay chain parent destination
const V5_RELAY_CHAIN_DEST = "0x050100";

const SAMPLE_BORROWER = "0x1234567890123456789012345678901234567890";
const EXPLORER_BASE = "https://blockscout-testnet.polkadot.io";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  console.log("=== Direct notifyLiquidation Call ===");
  console.log(`Network: ${hre.network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Notifier: ${NOTIFIER_ADDRESS}`);

  // Check notifier code exists
  const code = await hre.ethers.provider.getCode(NOTIFIER_ADDRESS);
  if (code === "0x") {
    console.error("ERROR: No code at notifier address!");
    process.exit(1);
  }
  console.log(`Notifier has code: ${code.length} chars`);

  // Connect to notifier
  const notifier = await hre.ethers.getContractAt("XcmLiquidationNotifier", NOTIFIER_ADDRESS);

  // Try to call notifyLiquidation
  console.log(`\nCalling notifyLiquidation...`);
  console.log(`  destination: ${V5_RELAY_CHAIN_DEST}`);
  console.log(`  borrower: ${SAMPLE_BORROWER}`);

  try {
    // Try gas estimation first
    const gasEst = await hre.ethers.provider.estimateGas({
      from: deployer.address,
      to: NOTIFIER_ADDRESS,
      data: notifier.interface.encodeFunctionData("notifyLiquidation", [
        V5_RELAY_CHAIN_DEST,
        SAMPLE_BORROWER,
        hre.ethers.parseEther("100"),
        hre.ethers.parseEther("110"),
      ]),
    });
    console.log(`  Gas estimate: ${gasEst}`);

    const tx = await notifier.notifyLiquidation(
      V5_RELAY_CHAIN_DEST,
      SAMPLE_BORROWER,
      hre.ethers.parseEther("100"),
      hre.ethers.parseEther("110"),
    );
    const receipt = await tx.wait();
    console.log(`  ✅ SUCCESS: ${tx.hash}`);
    console.log(`  Status: ${receipt?.status}`);
    console.log(`  Explorer: ${EXPLORER_BASE}/tx/${tx.hash}`);

    updateProof("success", tx.hash);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  Gas estimation failed: ${msg.substring(0, 300)}`);

    // Force submit with manual gasLimit
    console.log(`\nForcing TX with manual gasLimit=500000...`);
    try {
      const tx = await notifier.notifyLiquidation(
        V5_RELAY_CHAIN_DEST,
        SAMPLE_BORROWER,
        hre.ethers.parseEther("100"),
        hre.ethers.parseEther("110"),
        { gasLimit: 500_000n },
      );
      const receipt = await tx.wait();
      const status = receipt?.status;
      console.log(`  TX: ${tx.hash}, status: ${status}`);
      if (status === 1) {
        console.log(`  ✅ SUCCESS (on-chain)`);
        updateProof("success", tx.hash);
      } else {
        console.log(`  ⚠️  TX included but reverted`);
        updateProof("reverted", tx.hash);
      }
    } catch (err2: unknown) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      const hashMatch = msg2.match(/0x[0-9a-fA-F]{64}/);
      const txHash = hashMatch ? hashMatch[0] : null;
      console.log(`  ⚠️  Could not submit: ${msg2.substring(0, 300)}`);
      if (txHash) {
        console.log(`  TX hash from error: ${txHash}`);
        updateProof("reverted", txHash);
      } else {
        updateProof("failed-no-hash", null);
      }
    }
  }
}

function updateProof(status: string, txHash: string | null) {
  const proofPath = path.join(__dirname, "..", "deployments", "polkadot-hub-testnet-xcm-full-integration.json");
  let proof: Record<string, unknown> = {};
  if (fs.existsSync(proofPath)) {
    proof = JSON.parse(fs.readFileSync(proofPath, "utf-8")) as Record<string, unknown>;
  }

  proof.directNotifyLiquidationCall = {
    timestamp: new Date().toISOString(),
    notifierAddress: NOTIFIER_ADDRESS,
    destination: V5_RELAY_CHAIN_DEST,
    status,
    txHash,
  };

  if (txHash) {
    // Update the top-level notifyLiquidationCall
    const existing = proof.notifyLiquidationCall as Record<string, unknown> | undefined;
    proof.notifyLiquidationCall = {
      ...existing,
      success: status === "success",
      txHash,
      error: status === "success" ? null : "XCM send format incompatibility",
    };
  }

  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + "\n");
  console.log(`\nProof updated: ${proofPath}`);
}

runEntrypoint("scripts/callNotifyLiquidation.ts", main);
