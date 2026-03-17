/**
 * Governed liquidation smoke: triggers a liquidation within the existing governed market version.
 * Instead of deploying a temporary high-rate version (which requires GOVERNANCE role),
 * this script drops the oracle price to make an existing position underwater and liquidates it.
 */
import { managedMintUsdc, managedSetOraclePrice, managedSetOracleCircuitBreaker } from "../lib/ops/managedAccess";
import { openBorrowPosition, seedDebtPoolLiquidity } from "../lib/ops/liveScenario";
import { ORACLE_DEFAULTS, WAD } from "../lib/config/marketConfig";
import { createSmokeContext, buildManagedContext } from "../lib/runtime/smokeContext";
import { formatWad, waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const { manifest, actors, attach } = await createSmokeContext(
    ["admin", "minter", "riskAdmin", "lender", "borrower", "liquidator"] as const,
  );
  const { admin, minter, riskAdmin, lender, borrower, liquidator } = actors;

  const [accessManagerMinter, accessManagerRisk, wpas, usdcAdmin, debtPoolLender, lendingCoreAdmin] = await Promise.all([
    attach("accessManager", "DualVMAccessManager", minter),
    attach("accessManager", "DualVMAccessManager", riskAdmin),
    attach("wpas", "WPAS", borrower),
    attach("usdc", "USDCMock", admin),
    attach("debtPool", "DebtPool", lender),
    attach("lendingCore", "LendingCore", admin),
  ]);

  const usdcLender = usdcAdmin.connect(lender) as any;
  const usdcLiquidator = usdcAdmin.connect(liquidator) as any;
  const lendingCoreBorrower = lendingCoreAdmin.connect(borrower) as any;
  const lendingCoreLiquidator = lendingCoreAdmin.connect(liquidator) as any;
  const oracle = await attach("oracle", "ManualOracle", riskAdmin);

  const minterCtx = buildManagedContext(manifest, accessManagerMinter, minter, "minter");
  const riskCtx = buildManagedContext(manifest, accessManagerRisk, riskAdmin, "riskAdmin");

  const poolSeed = 20_000n * WAD;
  const liquidatorSeed = 10_000n * WAD;
  await seedDebtPoolLiquidity(minterCtx, usdcAdmin, usdcLender, debtPoolLender, lender.address, poolSeed, "lender");
  await managedMintUsdc(minterCtx, usdcAdmin, liquidator.address, liquidatorSeed, "mint liquidator usdc-test");

  const collateralPas = 10n * WAD;
  const borrowAmount = 5_000n * WAD;
  await openBorrowPosition({ wpas, lendingCore: lendingCoreBorrower, collateralPas, borrowAmount, labelPrefix: "borrower" });

  console.log("Widening circuit breaker...");
  await managedSetOracleCircuitBreaker(riskCtx, oracle, 1n * WAD, 20_000n * WAD, 9_900n, "widen circuit breaker");

  console.log("Dropping oracle price to trigger undercollateralization...");
  await managedSetOraclePrice(riskCtx, oracle, 100n * WAD, "drop oracle price for liquidation");

  await waitForTransaction(usdcLiquidator.approve(await lendingCoreAdmin.getAddress(), 2n ** 256n - 1n), "liquidator approve core");

  const [debtBefore, liquidatorCollateralBefore] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    wpas.balanceOf(liquidator.address),
  ]);

  await waitForTransaction(lendingCoreLiquidator.liquidate(borrower.address, 2n ** 256n - 1n), "liquidator execute liquidation");

  const [debtAfter, liquidatorCollateralAfter] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    wpas.balanceOf(liquidator.address),
  ]);

  console.log("Restoring oracle price...");
  await managedSetOraclePrice(riskCtx, oracle, ORACLE_DEFAULTS.initialPriceWad, "restore oracle price");

  console.log(
    JSON.stringify(
      {
        roles: { admin: admin.address, minter: minter.address, riskAdmin: riskAdmin.address, lender: lender.address, borrower: borrower.address, liquidator: liquidator.address },
        deployment: manifest.contracts,
        checks: {
          debtBefore: formatWad(debtBefore),
          debtAfter: formatWad(debtAfter),
          liquidationOccurred: debtAfter < debtBefore,
          liquidatorCollateralGain: formatWad(BigInt(liquidatorCollateralAfter) - BigInt(liquidatorCollateralBefore)),
        },
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/liveGovernedLiquidationSmoke.ts", main);
