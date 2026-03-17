import hre from "hardhat";
import { runEntrypoint } from "../lib/runtime/entrypoint";

/**
 * Deploy CrossChainQuoteEstimator to the testnet and call estimateCrossChainQuoteCost
 * with a sample XCM message. Records the weighMessage response (refTime, proofSize)
 * or documents the limitation if the XCM precompile is unavailable.
 */

/** SCALE-encoded XCM message example from the Polkadot docs (WithdrawAsset + BuyExecution + DepositAsset) */
const SAMPLE_XCM_MESSAGE =
  "0x050c000401000003008c86471301000003008c8647000d010101000000010100368e8759910dab756d344995f1d3c79374ca8f70066d3a709e48029f6bf0ee7e";

const XCM_PRECOMPILE_ADDRESS = "0x00000000000000000000000000000000000A0000";

interface XcmProofResult {
  timestamp: string;
  network: string;
  chainId: number;
  deployer: string;
  estimatorAddress: string;
  explorerUrl: string;
  deployTxHash: string;
  xcmPrecompileAddress: string;
  xcmPrecompileHasCode: boolean;
  sampleXcmMessage: string;
  weighMessageAttempt: {
    success: boolean;
    refTime: string | null;
    proofSize: string | null;
    error: string | null;
  };
  knownLimitation: string | null;
}

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const { network } = hre;

  console.log("=== CrossChainQuoteEstimator Testnet Deployment & XCM Proof ===");
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Chain ID: ${(await hre.ethers.provider.getNetwork()).chainId}`);
  console.log();

  // Step 1: Check if XCM precompile has code at the canonical address
  console.log(`Checking XCM precompile at ${XCM_PRECOMPILE_ADDRESS}...`);
  const precompileCode = await hre.ethers.provider.getCode(XCM_PRECOMPILE_ADDRESS);
  const precompileHasCode = precompileCode !== "0x" && precompileCode !== "0x0" && precompileCode.length > 2;
  console.log(`XCM precompile has code: ${precompileHasCode} (bytecode length: ${precompileCode.length})`);
  console.log();

  // Step 2: Deploy CrossChainQuoteEstimator
  console.log("Deploying CrossChainQuoteEstimator...");
  const factory = await hre.ethers.getContractFactory("CrossChainQuoteEstimator");
  const estimator = await factory.deploy();
  const deployTx = estimator.deploymentTransaction();
  await estimator.waitForDeployment();
  const estimatorAddress = await estimator.getAddress();
  console.log(`CrossChainQuoteEstimator deployed at: ${estimatorAddress}`);
  console.log(`Deploy TX: ${deployTx?.hash}`);
  console.log();

  // Step 3: Verify the contract's XCM constant points to the right address
  const xcmAddress = await estimator.XCM();
  console.log(`Contract XCM precompile reference: ${xcmAddress}`);
  console.log();

  // Step 4: Attempt to call estimateCrossChainQuoteCost with sample message
  console.log("Calling estimateCrossChainQuoteCost with sample XCM message...");
  console.log(`Sample message: ${SAMPLE_XCM_MESSAGE}`);
  console.log();

  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const explorerUrl = `https://blockscout-testnet.polkadot.io/address/${estimatorAddress}`;

  const result: XcmProofResult = {
    timestamp: new Date().toISOString(),
    network: network.name,
    chainId,
    deployer: deployer.address,
    estimatorAddress,
    explorerUrl,
    deployTxHash: deployTx?.hash ?? "unknown",
    xcmPrecompileAddress: XCM_PRECOMPILE_ADDRESS,
    xcmPrecompileHasCode: precompileHasCode,
    sampleXcmMessage: SAMPLE_XCM_MESSAGE,
    weighMessageAttempt: {
      success: false,
      refTime: null,
      proofSize: null,
      error: null,
    },
    knownLimitation: null,
  };

  try {
    const [refTime, proofSize] = await estimator.estimateCrossChainQuoteCost(SAMPLE_XCM_MESSAGE);
    result.weighMessageAttempt = {
      success: true,
      refTime: refTime.toString(),
      proofSize: proofSize.toString(),
      error: null,
    };
    console.log("✅ weighMessage succeeded!");
    console.log(`   refTime:   ${refTime}`);
    console.log(`   proofSize: ${proofSize}`);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Truncate long error messages for readability
    const truncated = errorMessage.length > 500 ? errorMessage.substring(0, 500) + "..." : errorMessage;
    result.weighMessageAttempt = {
      success: false,
      refTime: null,
      proofSize: null,
      error: truncated,
    };

    if (!precompileHasCode) {
      result.knownLimitation =
        "The XCM precompile at 0x000...0a0000 does not expose EVM bytecode on the REVM execution path. " +
        "The precompile may only be accessible via the PVM/substrate path or may not yet be enabled on the testnet. " +
        "The contract deployed successfully and its interface is correct, but weighMessage cannot be invoked " +
        "through the REVM route. This is a known testnet limitation, not a contract bug.";
      console.log("⚠️  weighMessage call reverted (XCM precompile has no code via REVM path)");
      console.log(`   Known limitation: ${result.knownLimitation}`);
    } else {
      result.knownLimitation =
        "The XCM precompile has code but the weighMessage call reverted. " +
        "This may indicate an issue with the SCALE-encoded message format or a precompile restriction.";
      console.log("⚠️  weighMessage call reverted despite precompile having code");
      console.log(`   Error: ${truncated}`);
    }
  }

  // Step 5: Write results file
  const fs = await import("fs");
  const path = await import("path");
  const outPath = path.join(__dirname, "..", "deployments", "polkadot-hub-testnet-xcm-proof.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log();
  console.log(`Results written to: ${outPath}`);
  console.log();
  console.log("=== XCM Precompile Live Test Complete ===");
}

runEntrypoint("scripts/deployXcmEstimator.ts", main);
