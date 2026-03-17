import hre from "hardhat";
import { createSmokeContext, buildManagedContext } from "../lib/runtime/smokeContext";
import { openBorrowPosition, seedDebtPoolLiquidity } from "../lib/ops/liveScenario";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

export async function main() {
  const { manifest, actors, attach } = await createSmokeContext(["admin", "minter"] as const);
  const { admin, minter } = actors;

  const [accessManager, wpas, usdcAdmin, debtPool, lendingCore] = await Promise.all([
    attach("accessManager", "DualVMAccessManager", minter),
    attach("wpas", "WPAS", admin),
    attach("usdc", "USDCMock", admin),
    attach("debtPool", "DebtPool", admin),
    attach("lendingCore", "LendingCore", admin),
  ]);

  const ctx = buildManagedContext(manifest, accessManager, minter, "minter");
  const poolSeed = ethers.parseUnits("1000", 18);
  const collateralPas = ethers.parseUnits("2", 18);
  const borrowAmount = ethers.parseUnits("100", 18);

  await seedDebtPoolLiquidity(ctx, usdcAdmin, usdcAdmin, debtPool, admin.address, poolSeed, "deployer");
  await openBorrowPosition({ wpas, lendingCore, collateralPas, borrowAmount, labelPrefix: "deployer" });

  const [usdcBalance, poolAssets, outstandingPrincipal, deployerDebt, collateralBalance] = await Promise.all([
    usdcAdmin.balanceOf(admin.address),
    debtPool.totalAssets(),
    debtPool.outstandingPrincipal(),
    lendingCore.currentDebt(admin.address),
    wpas.balanceOf(admin.address),
  ]);

  console.log(
    JSON.stringify(
      {
        deployer: admin.address,
        minter: minter.address,
        contracts: manifest.contracts,
        governance: manifest.governance,
        results: {
          usdcBalance: formatWad(usdcBalance),
          poolAssets: formatWad(poolAssets),
          outstandingPrincipal: formatWad(outstandingPrincipal),
          deployerDebt: formatWad(deployerDebt),
          deployerWpasBalance: formatWad(collateralBalance),
        },
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/liveSmoke.ts", main);
