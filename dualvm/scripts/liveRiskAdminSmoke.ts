import { managedActivateVersion, managedRegisterVersion, type ManagedCallContext } from "../lib/ops/managedAccess";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachManifestContract } from "../lib/runtime/contracts";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const manifest = loadDeploymentManifest();
  if (!manifest.contracts.marketRegistry) {
    throw new Error("Deployment manifest does not include marketRegistry");
  }

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

runEntrypoint("scripts/liveRiskAdminSmoke.ts", main);
