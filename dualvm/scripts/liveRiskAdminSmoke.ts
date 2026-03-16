import { managedActivateVersion, managedRegisterVersion, type ManagedCallContext } from "../lib/ops/managedAccess";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachManifestContract } from "../lib/runtime/contracts";
import { formatWad, waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

/**
 * Detects whether the deployment manifest describes a governed system
 * (Governor → Timelock → AccessManager chain) versus a plain EOA-managed deployment.
 */
function isGovernedDeployment(manifest: ReturnType<typeof loadDeploymentManifest>): boolean {
  return !!manifest.contracts.governor && !!manifest.contracts.governanceTimelock;
}

/**
 * Registers and activates a market version through the Governor proposal flow.
 * Used for governed deployments where registry operations require Governor→Timelock→AccessManager.
 */
async function governedRegisterAndActivate(
  manifest: ReturnType<typeof loadDeploymentManifest>,
  marketRegistry: any,
  governor: any,
  proposer: any,
  lendingCoreAddr: string,
  debtPoolAddr: string,
  oracleAddr: string,
  riskEngineAddr: string,
  versionId: bigint,
  description: string,
) {
  const registryAddress = await marketRegistry.getAddress();
  const registerData = marketRegistry.interface.encodeFunctionData("registerVersion", [
    lendingCoreAddr,
    debtPoolAddr,
    oracleAddr,
    riskEngineAddr,
  ]);
  const activateData = marketRegistry.interface.encodeFunctionData("activateVersion", [versionId]);

  const targets = [registryAddress, registryAddress];
  const values = [0n, 0n];
  const calldatas = [registerData, activateData];

  const { ethers } = await import("hardhat");

  const tx = await governor.connect(proposer).propose(targets, values, calldatas, description);
  await tx.wait();
  const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.id(description));
  console.log(`Governance proposal created: ${proposalId.toString()} — "${description}"`);
  console.log("Proposal submitted. Voting + queue + execute must be completed through governance UI or script.");
}

/**
 * Activates a market version through the Governor proposal flow.
 */
async function governedActivateVersion(
  manifest: ReturnType<typeof loadDeploymentManifest>,
  marketRegistry: any,
  governor: any,
  proposer: any,
  versionId: bigint,
  description: string,
) {
  const registryAddress = await marketRegistry.getAddress();
  const activateData = marketRegistry.interface.encodeFunctionData("activateVersion", [versionId]);
  const targets = [registryAddress];
  const values = [0n];
  const calldatas = [activateData];

  const { ethers } = await import("hardhat");

  const tx = await governor.connect(proposer).propose(targets, values, calldatas, description);
  await tx.wait();
  const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.id(description));
  console.log(`Governance proposal created: ${proposalId.toString()} — "${description}"`);
  console.log("Proposal submitted. Voting + queue + execute must be completed through governance UI or script.");
}

export async function main() {
  const manifest = loadDeploymentManifest();
  if (!manifest.contracts.marketRegistry) {
    throw new Error("Deployment manifest does not include marketRegistry");
  }

  const governed = isGovernedDeployment(manifest);
  const baseActors = loadActors(["admin", "riskAdmin"] as const);
  const [accessManager, marketRegistry, oracle, riskEngine] = await Promise.all([
    attachManifestContract(manifest, "accessManager", "DualVMAccessManager", baseActors.riskAdmin),
    attachManifestContract(manifest, "marketRegistry", "MarketVersionRegistry", baseActors.riskAdmin),
    attachManifestContract(manifest, "oracle", "ManualOracle", baseActors.admin),
    attachManifestContract(manifest, "riskEngine", "RiskAdapter", baseActors.admin),
  ]);

  const originalVersionId = await marketRegistry.activeVersionId();
  const originalVersion = await marketRegistry.activeVersion();
  const originalOracleState = {
    price: await oracle.priceWad(),
    minPriceWad: await oracle.minPriceWad(),
    maxPriceWad: await oracle.maxPriceWad(),
    maxPriceChangeBps: await oracle.maxPriceChangeBps(),
    maxAge: await oracle.maxAge(),
  };
  const currentQuoteEngine = manifest.contracts.quoteEngine ?? (await riskEngine.quoteEngine());

  const temporaryVersion = await deployMarketVersion({
    deployer: baseActors.admin,
    authority: manifest.contracts.accessManager,
    collateralAsset: manifest.contracts.wpas,
    debtAsset: manifest.contracts.usdc,
    autoWireLendingCore: false,
    oraclePriceWad: originalOracleState.price,
    oracleMaxAgeSeconds: Number(originalOracleState.maxAge),
    oracleMinPriceWad: originalOracleState.minPriceWad,
    oracleMaxPriceWad: originalOracleState.maxPriceWad,
    oracleMaxPriceChangeBps: originalOracleState.maxPriceChangeBps,
    riskEngineConfig: {
      baseRateBps: 9_999n,
      slope1Bps: 1_111n,
      slope2Bps: 2_222n,
      kinkBps: 8_000n,
      healthyMaxLtvBps: 7_500n,
      stressedMaxLtvBps: 6_500n,
      healthyLiquidationThresholdBps: 8_500n,
      stressedLiquidationThresholdBps: 7_800n,
      staleBorrowRatePenaltyBps: 333n,
      stressedCollateralRatioBps: 14_000n,
    },
  });

  let temporaryVersionId: bigint;

  if (governed) {
    // ── Governed path: registry operations go through Governor → Timelock → AccessManager ──
    const governor = await attachManifestContract(manifest, "governor", "DualVMGovernor", baseActors.admin);

    // Submit governance proposal to register + activate the temporary version.
    // In a live governed system, the full lifecycle (vote → queue → execute) is completed
    // externally. This script only submits the proposal and reports.
    const nextVersionId = (await marketRegistry.latestVersionId()) + 1n;
    await governedRegisterAndActivate(
      manifest,
      marketRegistry,
      governor,
      baseActors.admin,
      await temporaryVersion.lendingCore.getAddress(),
      await temporaryVersion.debtPool.getAddress(),
      await temporaryVersion.oracle.getAddress(),
      await temporaryVersion.riskEngine.getAddress(),
      nextVersionId,
      "smoke: register and activate temporary market version",
    );
    temporaryVersionId = nextVersionId;

    console.log(
      JSON.stringify(
        {
          governanceMode: "governor-proposal",
          note: "Registry operations submitted as governance proposals. Vote + queue + execute required.",
          roles: {
            admin: baseActors.admin.address,
            riskAdmin: baseActors.riskAdmin.address,
          },
          governor: manifest.contracts.governor,
          timelock: manifest.contracts.governanceTimelock,
          originalVersionId: originalVersionId.toString(),
          proposedVersionId: temporaryVersionId.toString(),
          currentQuoteEngine,
          temporaryDeployment: {
            oracle: await temporaryVersion.oracle.getAddress(),
            quoteEngine: await temporaryVersion.quoteEngine.getAddress(),
            riskEngine: await temporaryVersion.riskEngine.getAddress(),
            debtPool: await temporaryVersion.debtPool.getAddress(),
            lendingCore: await temporaryVersion.lendingCore.getAddress(),
          },
          checks: {
            baselineOraclePrice: formatWad(originalOracleState.price),
          },
        },
        null,
        2,
      ),
    );
  } else {
    // ── Non-governed path: direct AccessManager-managed role calls (EOA) ──
    const managedRiskContext: ManagedCallContext = {
      accessManager,
      signer: baseActors.riskAdmin,
      executionDelaySeconds: manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0,
    };

    await managedRegisterVersion(
      managedRiskContext,
      marketRegistry,
      await temporaryVersion.lendingCore.getAddress(),
      await temporaryVersion.debtPool.getAddress(),
      await temporaryVersion.oracle.getAddress(),
      await temporaryVersion.riskEngine.getAddress(),
      "risk admin register temporary market version",
    );
    temporaryVersionId = await marketRegistry.latestVersionId();
    await managedActivateVersion(
      managedRiskContext,
      marketRegistry,
      temporaryVersionId,
      "risk admin activate temporary market version",
    );

    const activatedVersion = await marketRegistry.activeVersion();
    await managedActivateVersion(managedRiskContext, marketRegistry, originalVersionId, "risk admin restore original market version");
    const restoredVersion = await marketRegistry.activeVersion();

    console.log(
      JSON.stringify(
        {
          governanceMode: "access-manager-role",
          roles: {
            admin: baseActors.admin.address,
            riskAdmin: baseActors.riskAdmin.address,
          },
          originalVersionId: originalVersionId.toString(),
          temporaryVersionId: temporaryVersionId.toString(),
          currentQuoteEngine,
          temporaryDeployment: {
            oracle: await temporaryVersion.oracle.getAddress(),
            quoteEngine: await temporaryVersion.quoteEngine.getAddress(),
            riskEngine: await temporaryVersion.riskEngine.getAddress(),
            debtPool: await temporaryVersion.debtPool.getAddress(),
            lendingCore: await temporaryVersion.lendingCore.getAddress(),
          },
          checks: {
            originalLendingCore: originalVersion.lendingCore,
            activatedLendingCore: activatedVersion.lendingCore,
            restoredLendingCore: restoredVersion.lendingCore,
            activationWorked: activatedVersion.lendingCore.toLowerCase() === (await temporaryVersion.lendingCore.getAddress()).toLowerCase(),
            restoreWorked: restoredVersion.lendingCore.toLowerCase() === originalVersion.lendingCore.toLowerCase(),
            baselineOraclePrice: formatWad(originalOracleState.price),
          },
        },
        null,
        2,
      ),
    );
  }
}

runEntrypoint("scripts/liveRiskAdminSmoke.ts", main);
