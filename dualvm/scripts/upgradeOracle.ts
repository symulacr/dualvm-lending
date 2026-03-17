import { managedActivateVersion, managedRegisterVersion } from "../lib/ops/managedAccess";
import { ORACLE_CIRCUIT_BREAKER_DEFAULTS } from "../lib/config/marketConfig";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";
import { writeDeploymentManifest } from "../lib/deployment/manifestStore";
import type { HexAddress } from "../lib/shared/deploymentManifest";
import { createSmokeContext, buildManagedContext } from "../lib/runtime/smokeContext";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const { manifest, actors, attach } = await createSmokeContext(["admin", "riskAdmin"] as const);
  if (!manifest.contracts.marketRegistry) {
    throw new Error("Deployment manifest does not include marketRegistry");
  }
  const { admin, riskAdmin } = actors;

  const [accessManagerRisk, marketRegistry, oldOracle, riskAdapter] = await Promise.all([
    attach("accessManager", "DualVMAccessManager", riskAdmin),
    attach("marketRegistry", "MarketVersionRegistry", riskAdmin),
    attach("oracle", "ManualOracle", admin),
    attach("riskEngine", "RiskAdapter", admin),
  ]);

  const [currentPrice, currentMaxAge] = await Promise.all([oldOracle.priceWad(), oldOracle.maxAge()]);
  const quoteEngineAddress = (manifest.contracts.quoteEngine ?? (await riskAdapter.quoteEngine())) as HexAddress;
  const managedRiskContext = buildManagedContext(manifest, accessManagerRisk, riskAdmin, "riskAdmin");

  const upgradedVersion = await deployMarketVersion({
    deployer: admin,
    authority: manifest.contracts.accessManager,
    collateralAsset: manifest.contracts.wpas,
    debtAsset: manifest.contracts.usdc,
    riskQuoteEngineAddress: quoteEngineAddress,
    oraclePriceWad: currentPrice,
    oracleMaxAgeSeconds: Number(currentMaxAge),
    oracleMinPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
    oracleMaxPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
    oracleMaxPriceChangeBps: ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
  });

  await managedRegisterVersion(
    managedRiskContext,
    marketRegistry,
    await upgradedVersion.lendingCore.getAddress(),
    await upgradedVersion.debtPool.getAddress(),
    await upgradedVersion.oracle.getAddress(),
    await upgradedVersion.riskEngine.getAddress(),
    "register upgraded oracle market version",
  );
  const newVersionId = await marketRegistry.latestVersionId();
  await managedActivateVersion(managedRiskContext, marketRegistry, newVersionId, "activate upgraded oracle market version");

  manifest.contracts.oracle = (await upgradedVersion.oracle.getAddress()) as HexAddress;
  manifest.contracts.riskEngine = (await upgradedVersion.riskEngine.getAddress()) as HexAddress;
  manifest.contracts.quoteEngine = quoteEngineAddress;
  manifest.contracts.debtPool = (await upgradedVersion.debtPool.getAddress()) as HexAddress;
  manifest.contracts.lendingCore = (await upgradedVersion.lendingCore.getAddress()) as HexAddress;
  manifest.config.oracle = {
    ...(manifest.config.oracle ?? {}),
    circuitBreaker: {
      minPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad.toString(),
      maxPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad.toString(),
      maxPriceChangeBps: ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps.toString(),
    },
  };
  const manifestPath = writeDeploymentManifest(manifest);

  console.log(
    JSON.stringify(
      {
        newVersionId: newVersionId.toString(),
        newOracle: manifest.contracts.oracle,
        lendingCore: manifest.contracts.lendingCore,
        debtPool: manifest.contracts.debtPool,
        riskEngine: manifest.contracts.riskEngine,
        manifest: manifestPath,
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/upgradeOracle.ts", main);
