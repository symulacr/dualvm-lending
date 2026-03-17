import { managedActivateVersion, managedRegisterVersion, managedMintUsdc } from "../lib/ops/managedAccess";
import { openBorrowPosition, seedDebtPoolLiquidity, waitForDebtToAccrue } from "../lib/ops/liveScenario";
import { ORACLE_CIRCUIT_BREAKER_DEFAULTS, ORACLE_DEFAULTS, WAD } from "../lib/config/marketConfig";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";
import { createSmokeContext, buildManagedContext } from "../lib/runtime/smokeContext";
import { formatWad, waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const HIGH_RATE_CONFIG = {
  baseRateBps: 15_000_000_000n,
  slope1Bps: 0n,
  slope2Bps: 0n,
  kinkBps: 8_000n,
  healthyMaxLtvBps: 7_500n,
  stressedMaxLtvBps: 6_500n,
  healthyLiquidationThresholdBps: 8_500n,
  stressedLiquidationThresholdBps: 7_800n,
  staleBorrowRatePenaltyBps: 0n,
  stressedCollateralRatioBps: 14_000n,
} as const;

export async function main() {
  const { manifest, actors, attach } = await createSmokeContext(
    ["admin", "minter", "riskAdmin", "lender", "borrower", "liquidator"] as const,
  );
  if (!manifest.contracts.marketRegistry) {
    throw new Error("Deployment manifest does not include marketRegistry");
  }
  const { admin, minter, riskAdmin, lender, borrower, liquidator } = actors;

  const [accessManagerMinter, accessManagerRisk, marketRegistry, wpas, usdcAdmin] = await Promise.all([
    attach("accessManager", "DualVMAccessManager", minter),
    attach("accessManager", "DualVMAccessManager", riskAdmin),
    attach("marketRegistry", "MarketVersionRegistry", riskAdmin),
    attach("wpas", "WPAS", borrower),
    attach("usdc", "USDCMock", admin),
  ]);
  const usdcLiquidator = usdcAdmin.connect(liquidator) as any;
  const usdcLender = usdcAdmin.connect(lender) as any;

  const minterCtx = buildManagedContext(manifest, accessManagerMinter, minter, "minter");
  const riskCtx = buildManagedContext(manifest, accessManagerRisk, riskAdmin, "riskAdmin");

  const originalVersionId = await marketRegistry.activeVersionId();
  const temporaryVersion = await deployMarketVersion({
    deployer: admin,
    authority: manifest.contracts.accessManager,
    collateralAsset: manifest.contracts.wpas,
    debtAsset: manifest.contracts.usdc,
    autoWireLendingCore: false,
    oraclePriceWad: ORACLE_DEFAULTS.initialPriceWad,
    oracleMaxAgeSeconds: manifest.config.oracleMaxAgeSeconds,
    oracleMinPriceWad: ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
    oracleMaxPriceWad: 20_000n * WAD,
    oracleMaxPriceChangeBps: 10_000n,
    riskEngineConfig: HIGH_RATE_CONFIG,
  });

  await managedRegisterVersion(
    riskCtx, marketRegistry,
    await temporaryVersion.lendingCore.getAddress(), await temporaryVersion.debtPool.getAddress(),
    await temporaryVersion.oracle.getAddress(), await temporaryVersion.riskEngine.getAddress(),
    "register temporary liquidation market version",
  );
  const temporaryVersionId = await marketRegistry.latestVersionId();
  await managedActivateVersion(riskCtx, marketRegistry, temporaryVersionId, "activate temporary liquidation market version");

  const debtPoolLender = temporaryVersion.debtPool.connect(lender) as any;
  const debtPoolAdmin = temporaryVersion.debtPool.connect(admin) as any;
  const lendingCoreBorrower = temporaryVersion.lendingCore.connect(borrower) as any;
  const lendingCoreLiquidator = temporaryVersion.lendingCore.connect(liquidator) as any;
  const lendingCoreAdmin = temporaryVersion.lendingCore.connect(admin) as any;
  const oracle = temporaryVersion.oracle.connect(riskAdmin) as any;

  const lenderSeed = 20_000n * WAD;
  const liquidatorSeed = 10_000n * WAD;
  const collateralPas = 20n * WAD;
  const borrowAmount = 10_000n * WAD;

  await seedDebtPoolLiquidity(minterCtx, usdcAdmin, usdcLender, debtPoolLender, lender.address, lenderSeed, "lender");
  await managedMintUsdc(minterCtx, usdcAdmin, liquidator.address, liquidatorSeed, "mint liquidator usdc-test");
  await openBorrowPosition({ wpas, lendingCore: lendingCoreBorrower, collateralPas, borrowAmount, labelPrefix: "borrower" });
  await waitForDebtToAccrue(lendingCoreAdmin, borrower.address, borrowAmount, "wait for liquidation scenario debt growth");

  const dropOracleTx = await oracle.setPrice(21n * WAD);
  await dropOracleTx.wait();
  await waitForTransaction(usdcLiquidator.approve(await lendingCoreAdmin.getAddress(), 2n ** 256n - 1n), "liquidator approve core");

  const [debtBefore, principalBefore, liquidatorCollateralBefore] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    debtPoolAdmin.outstandingPrincipal(),
    wpas.balanceOf(liquidator.address),
  ]);

  await waitForTransaction(lendingCoreLiquidator.liquidate(borrower.address, 2n ** 256n - 1n), "liquidator execute liquidation");

  const [debtAfter, principalAfter, liquidatorCollateralAfter] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    debtPoolAdmin.outstandingPrincipal(),
    wpas.balanceOf(liquidator.address),
  ]);

  await managedActivateVersion(riskCtx, marketRegistry, originalVersionId, "restore original market version");
  const restoredVersion = await marketRegistry.activeVersion();

  console.log(
    JSON.stringify(
      {
        roles: { admin: admin.address, minter: minter.address, riskAdmin: riskAdmin.address, lender: lender.address, borrower: borrower.address, liquidator: liquidator.address },
        deployment: manifest.contracts,
        governance: manifest.governance,
        temporaryVersionId: temporaryVersionId.toString(),
        temporaryDeployment: {
          oracle: await temporaryVersion.oracle.getAddress(),
          quoteEngine: await temporaryVersion.quoteEngine.getAddress(),
          riskEngine: await temporaryVersion.riskEngine.getAddress(),
          debtPool: await temporaryVersion.debtPool.getAddress(),
          lendingCore: await temporaryVersion.lendingCore.getAddress(),
        },
        checks: {
          debtBefore: formatWad(debtBefore),
          principalBefore: formatWad(principalBefore),
          debtExceedsPrincipalBefore: debtBefore > principalBefore,
          debtAfter: formatWad(debtAfter),
          principalAfter: formatWad(principalAfter),
          liquidatorCollateralGain: formatWad(BigInt(liquidatorCollateralAfter) - BigInt(liquidatorCollateralBefore)),
          restoredVersionId: (await marketRegistry.activeVersionId()).toString(),
          restoreWorked: restoredVersion.lendingCore.toLowerCase() === manifest.contracts.lendingCore.toLowerCase(),
        },
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/liveLiquidationSmoke.ts", main);
