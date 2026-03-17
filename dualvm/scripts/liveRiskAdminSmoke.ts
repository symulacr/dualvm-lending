import { managedActivateVersion, managedRegisterVersion } from "../lib/ops/managedAccess";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";
import { createSmokeContext, buildManagedContext } from "../lib/runtime/smokeContext";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

function isGovernedDeployment(manifest: { contracts: { governor?: string; governanceTimelock?: string } }) {
  return !!manifest.contracts.governor && !!manifest.contracts.governanceTimelock;
}

async function governedRegisterAndActivate(
  marketRegistry: any, governor: any, proposer: any,
  lendingCoreAddr: string, debtPoolAddr: string, oracleAddr: string, riskEngineAddr: string,
  versionId: bigint, description: string,
) {
  const registryAddress = await marketRegistry.getAddress();
  const registerData = marketRegistry.interface.encodeFunctionData("registerVersion", [lendingCoreAddr, debtPoolAddr, oracleAddr, riskEngineAddr]);
  const activateData = marketRegistry.interface.encodeFunctionData("activateVersion", [versionId]);
  const { ethers } = await import("hardhat");
  const tx = await governor.connect(proposer).propose([registryAddress, registryAddress], [0n, 0n], [registerData, activateData], description);
  await tx.wait();
  const proposalId = await governor.hashProposal([registryAddress, registryAddress], [0n, 0n], [registerData, activateData], ethers.id(description));
  console.log(`Governance proposal created: ${proposalId.toString()} — "${description}"`);
  console.log("Proposal submitted. Voting + queue + execute must be completed through governance UI or script.");
}

export async function main() {
  const { manifest, actors, attach } = await createSmokeContext(["admin", "riskAdmin"] as const);
  if (!manifest.contracts.marketRegistry) {
    throw new Error("Deployment manifest does not include marketRegistry");
  }
  const { admin, riskAdmin } = actors;

  const [accessManager, marketRegistry, oracle, riskEngine] = await Promise.all([
    attach("accessManager", "DualVMAccessManager", riskAdmin),
    attach("marketRegistry", "MarketVersionRegistry", riskAdmin),
    attach("oracle", "ManualOracle", admin),
    attach("riskEngine", "RiskAdapter", admin),
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
    deployer: admin,
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
      baseRateBps: 9_999n, slope1Bps: 1_111n, slope2Bps: 2_222n, kinkBps: 8_000n,
      healthyMaxLtvBps: 7_500n, stressedMaxLtvBps: 6_500n,
      healthyLiquidationThresholdBps: 8_500n, stressedLiquidationThresholdBps: 7_800n,
      staleBorrowRatePenaltyBps: 333n, stressedCollateralRatioBps: 14_000n,
    },
  });

  const governed = isGovernedDeployment(manifest);
  let temporaryVersionId: bigint;

  if (governed) {
    const governor = await attach("governor", "DualVMGovernor", admin);
    const nextVersionId = (await marketRegistry.latestVersionId()) + 1n;
    await governedRegisterAndActivate(
      marketRegistry, governor, admin,
      await temporaryVersion.lendingCore.getAddress(), await temporaryVersion.debtPool.getAddress(),
      await temporaryVersion.oracle.getAddress(), await temporaryVersion.riskEngine.getAddress(),
      nextVersionId, "smoke: register and activate temporary market version",
    );
    temporaryVersionId = nextVersionId;
    console.log(JSON.stringify({
      governanceMode: "governor-proposal",
      note: "Registry operations submitted as governance proposals. Vote + queue + execute required.",
      roles: { admin: admin.address, riskAdmin: riskAdmin.address },
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
      checks: { baselineOraclePrice: formatWad(originalOracleState.price) },
    }, null, 2));
  } else {
    const riskCtx = buildManagedContext(manifest, accessManager, riskAdmin, "riskAdmin");
    await managedRegisterVersion(
      riskCtx, marketRegistry,
      await temporaryVersion.lendingCore.getAddress(), await temporaryVersion.debtPool.getAddress(),
      await temporaryVersion.oracle.getAddress(), await temporaryVersion.riskEngine.getAddress(),
      "risk admin register temporary market version",
    );
    temporaryVersionId = await marketRegistry.latestVersionId();
    await managedActivateVersion(riskCtx, marketRegistry, temporaryVersionId, "risk admin activate temporary market version");
    const activatedVersion = await marketRegistry.activeVersion();
    await managedActivateVersion(riskCtx, marketRegistry, originalVersionId, "risk admin restore original market version");
    const restoredVersion = await marketRegistry.activeVersion();
    console.log(JSON.stringify({
      governanceMode: "access-manager-role",
      roles: { admin: admin.address, riskAdmin: riskAdmin.address },
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
    }, null, 2));
  }
}

runEntrypoint("scripts/liveRiskAdminSmoke.ts", main);
