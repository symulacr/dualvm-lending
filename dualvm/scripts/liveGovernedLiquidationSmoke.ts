/**
 * Governed liquidation smoke: triggers a liquidation within the existing governed market version.
 * Instead of deploying a temporary high-rate version (which requires GOVERNANCE role),
 * this script drops the oracle price to make an existing position underwater and liquidates it.
 */
import { managedMintUsdc, managedSetOraclePrice, managedSetOracleCircuitBreaker, type ManagedCallContext } from "../lib/ops/managedAccess";
import { openBorrowPosition, seedDebtPoolLiquidity } from "../lib/ops/liveScenario";
import { ORACLE_DEFAULTS, WAD } from "../lib/config/marketConfig";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachManifestContract } from "../lib/runtime/contracts";
import { formatWad, waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

import hre from "hardhat";
const { ethers } = hre;

export async function main() {
  const manifest = loadDeploymentManifest();
  const { admin, minter, riskAdmin, lender, borrower, liquidator } = loadActors(
    ["admin", "minter", "riskAdmin", "lender", "borrower", "liquidator"] as const,
  );

  const [accessManagerMinter, accessManagerRisk, wpas, usdcAdmin, debtPoolLender, lendingCoreAdmin] = await Promise.all([
    attachManifestContract(manifest, "accessManager", "DualVMAccessManager", minter),
    attachManifestContract(manifest, "accessManager", "DualVMAccessManager", riskAdmin),
    attachManifestContract(manifest, "wpas", "WPAS", borrower),
    attachManifestContract(manifest, "usdc", "USDCMock", admin),
    attachManifestContract(manifest, "debtPool", "DebtPool", lender),
    attachManifestContract(manifest, "lendingCore", "LendingCore", admin),
  ]);

  const usdcLender = usdcAdmin.connect(lender) as any;
  const usdcLiquidator = usdcAdmin.connect(liquidator) as any;
  const lendingCoreBorrower = lendingCoreAdmin.connect(borrower) as any;
  const lendingCoreLiquidator = lendingCoreAdmin.connect(liquidator) as any;
  const oracle = await attachManifestContract(manifest, "oracle", "ManualOracle", riskAdmin);

  const managedMinterContext: ManagedCallContext = {
    accessManager: accessManagerMinter,
    signer: minter,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.minter ?? 0,
  };
  const managedRiskContext: ManagedCallContext = {
    accessManager: accessManagerRisk,
    signer: riskAdmin,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.riskAdmin ?? 0,
  };

  // Seed pool with liquidity
  const poolSeed = 20_000n * WAD;
  const liquidatorSeed = 10_000n * WAD;
  await seedDebtPoolLiquidity(managedMinterContext, usdcAdmin, usdcLender, debtPoolLender, lender.address, poolSeed, "lender");
  await managedMintUsdc(managedMinterContext, usdcAdmin, liquidator.address, liquidatorSeed, "mint liquidator usdc-test");

  // Open a borrower position
  const collateralPas = 10n * WAD; // 10 WPAS
  const borrowAmount = 5_000n * WAD; // 5000 USDC at 1000 USDC/PAS price → 10 PAS * 1000 = 10000 collateral value, 70% LTV → max 7000, borrow 5000
  await openBorrowPosition({
    wpas,
    lendingCore: lendingCoreBorrower,
    collateralPas,
    borrowAmount,
    labelPrefix: "borrower",
  });

  // Widen circuit breaker to allow large price drops
  console.log("Widening circuit breaker...");
  await managedSetOracleCircuitBreaker(
    managedRiskContext,
    oracle,
    1n * WAD,           // min 1 USDC/PAS
    20_000n * WAD,       // max 20000
    9_900n,              // 99% change allowed
    "widen circuit breaker",
  );

  // Drop oracle price dramatically: from 1000 to 100 USDC/PAS
  // This makes collateral value = 10 * 100 = 1000, debt = 5000 → health factor < 1
  console.log("Dropping oracle price to trigger undercollateralization...");
  await managedSetOraclePrice(
    managedRiskContext,
    oracle,
    100n * WAD,  // Drop from 1000 to 100
    "drop oracle price for liquidation",
  );

  // Now approve and liquidate
  await waitForTransaction(
    usdcLiquidator.approve(await lendingCoreAdmin.getAddress(), 2n ** 256n - 1n),
    "liquidator approve core",
  );

  const [debtBefore, liquidatorCollateralBefore] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    wpas.balanceOf(liquidator.address),
  ]);

  await waitForTransaction(
    lendingCoreLiquidator.liquidate(borrower.address, 2n ** 256n - 1n),
    "liquidator execute liquidation",
  );

  const [debtAfter, liquidatorCollateralAfter] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    wpas.balanceOf(liquidator.address),
  ]);

  // Restore oracle price back to original
  console.log("Restoring oracle price...");
  await managedSetOraclePrice(
    managedRiskContext,
    oracle,
    ORACLE_DEFAULTS.initialPriceWad,
    "restore oracle price",
  );

  console.log(
    JSON.stringify(
      {
        roles: {
          admin: admin.address,
          minter: minter.address,
          riskAdmin: riskAdmin.address,
          lender: lender.address,
          borrower: borrower.address,
          liquidator: liquidator.address,
        },
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
