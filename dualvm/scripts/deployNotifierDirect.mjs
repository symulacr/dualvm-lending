/**
 * Deploy XcmLiquidationNotifier (with receive()) using raw ethers.js,
 * bypassing Hardhat's EIP-1559 gas handling that causes "Priority too low".
 * Uses explicit legacy transaction type with manual gasPrice.
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const RPC_URL = process.env.POLKADOT_HUB_TESTNET_RPC_URL || "https://eth-rpc-testnet.polkadot.io/";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("PRIVATE_KEY not set in .env");
  process.exit(1);
}

// Read compiled artifact
const artifactPath = join(__dirname, "..", "artifacts", "contracts", "precompiles", "XcmLiquidationNotifier.sol", "XcmLiquidationNotifier.json");
const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
const { abi, bytecode } = artifact;

const V5_RELAY_CHAIN_DEST = "0x050100";
const SAMPLE_BORROWER = "0x1234567890123456789012345678901234567890";
const EXPLORER_BASE = "https://blockscout-testnet.polkadot.io";
const PROOF_PATH = join(__dirname, "..", "deployments", "polkadot-hub-testnet-xcm-full-integration.json");

// Use 10x gas price to avoid "priority too low"
const GAS_PRICE = 10_000_000_000_000n; // 10^13 = 10x minimum

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const chainId = (await provider.getNetwork()).chainId;
  
  console.log("=== Direct Deploy with Raw Ethers.js ===");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`ChainId: ${chainId}`);
  console.log(`GasPrice: ${GAS_PRICE} (${GAS_PRICE / 10n ** 9n} gwei × 10^9)`);
  
  // Get current nonce
  const nonce = await provider.getTransactionCount(wallet.address, "latest");
  console.log(`Nonce: ${nonce}`);
  
  // Step 1: Deploy XcmLiquidationNotifier
  console.log("\nDeploying XcmLiquidationNotifier...");
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  
  try {
    const notifier = await factory.deploy({
      gasPrice: GAS_PRICE,
      type: 0, // Legacy transaction
    });
    const deployTx = notifier.deploymentTransaction();
    console.log(`  Deploy TX: ${deployTx?.hash}`);
    await notifier.waitForDeployment();
    const notifierAddress = await notifier.getAddress();
    console.log(`  Notifier address: ${notifierAddress}`);
    console.log(`  Explorer: ${EXPLORER_BASE}/address/${notifierAddress}`);
    
    // Step 2: Fund the notifier
    console.log(`\nFunding notifier with 1 PAS...`);
    const balance = await provider.getBalance(notifierAddress);
    if (balance === 0n) {
      const fundTx = await wallet.sendTransaction({
        to: notifierAddress,
        value: ethers.parseEther("1"),
        gasPrice: GAS_PRICE,
        type: 0,
      });
      console.log(`  Fund TX: ${fundTx.hash}`);
      await fundTx.wait();
      const newBalance = await provider.getBalance(notifierAddress);
      console.log(`  New balance: ${ethers.formatEther(newBalance)} PAS`);
    }
    
    // Step 3: Call notifyLiquidation
    console.log(`\nCalling notifyLiquidation...`);
    const iface = new ethers.Interface(abi);
    const callData = iface.encodeFunctionData("notifyLiquidation", [
      V5_RELAY_CHAIN_DEST,
      SAMPLE_BORROWER,
      ethers.parseEther("100"),
      ethers.parseEther("110"),
    ]);
    
    let notifyResult = { success: false, txHash: null, error: null };
    
    try {
      // Estimate gas first
      const gasEst = await provider.estimateGas({
        from: wallet.address,
        to: notifierAddress,
        data: callData,
      });
      console.log(`  Gas estimate: ${gasEst}`);
      
      const notifyTx = await wallet.sendTransaction({
        to: notifierAddress,
        data: callData,
        gasLimit: gasEst,
        gasPrice: GAS_PRICE,
        type: 0,
      });
      console.log(`  TX: ${notifyTx.hash}`);
      const receipt = await notifyTx.wait();
      console.log(`  Status: ${receipt.status}`);
      if (receipt.status === 1) {
        console.log(`  ✅ SUCCESS!`);
        console.log(`  Explorer: ${EXPLORER_BASE}/tx/${notifyTx.hash}`);
        notifyResult = { success: true, txHash: notifyTx.hash, error: null };
      } else {
        console.log(`  ⚠️  Reverted on-chain`);
        notifyResult = { success: false, txHash: notifyTx.hash, error: "reverted on-chain" };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  Gas estimation failed: ${msg.substring(0, 300)}`);
      // Force with manual gas
      try {
        const notifyTx = await wallet.sendTransaction({
          to: notifierAddress,
          data: callData,
          gasLimit: 500_000n,
          gasPrice: GAS_PRICE,
          type: 0,
        });
        console.log(`  Forced TX: ${notifyTx.hash}`);
        const receipt = await notifyTx.wait();
        notifyResult = { 
          success: receipt.status === 1, 
          txHash: notifyTx.hash, 
          error: receipt.status === 1 ? null : "reverted on-chain" 
        };
        console.log(`  Status: ${receipt.status} (${receipt.status === 1 ? "✅ success" : "⚠️ reverted"})`);
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        const hashMatch = msg2.match(/0x[0-9a-fA-F]{64}/);
        notifyResult = {
          success: false,
          txHash: hashMatch ? hashMatch[0] : null,
          error: msg2.substring(0, 200),
        };
        console.log(`  Could not submit: ${msg2.substring(0, 200)}`);
      }
    }
    
    // Update proof
    let proof = {};
    try { proof = JSON.parse(readFileSync(PROOF_PATH, "utf-8")); } catch {}
    
    proof.v3Contracts = {
      xcmLiquidationNotifier: {
        address: notifierAddress,
        deployTxHash: deployTx?.hash ?? "unknown",
        explorerUrl: `${EXPLORER_BASE}/address/${notifierAddress}`,
        note: "Deployed with receive() function, funded with 1 PAS",
      }
    };
    proof.notifyLiquidationFinal = {
      timestamp: new Date().toISOString(),
      notifierAddress,
      destination: V5_RELAY_CHAIN_DEST,
      ...notifyResult,
    };
    
    // Update top-level
    if (notifyResult.txHash && notifyResult.success) {
      proof.notifyLiquidationCall = {
        ...proof.notifyLiquidationCall,
        success: true,
        txHash: notifyResult.txHash,
        error: null,
      };
    }
    
    writeFileSync(PROOF_PATH, JSON.stringify(proof, null, 2) + "\n");
    console.log(`\nProof updated: ${PROOF_PATH}`);
    console.log("=== Done ===");
    
  } catch (deployErr) {
    const msg = deployErr instanceof Error ? deployErr.message : String(deployErr);
    console.error(`Deployment failed: ${msg.substring(0, 500)}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
