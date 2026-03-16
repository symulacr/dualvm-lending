import hre from "hardhat";
import type { ManagedCallContext } from "../lib/ops/managedAccess";
import { openBorrowPosition, seedDebtPoolLiquidity } from "../lib/ops/liveScenario";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachManifestContract } from "../lib/runtime/contracts";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

export async function main() {
  const manifest = loadDeploymentManifest();
  const { admin, minter } = loadActors(["admin", "minter"] as const);

  const [accessManager, wpas, usdcAdmin, debtPool, lendingCore] = await Promise.all([
    attachManifestContract(manifest, "accessManager", "DualVMAccessManager", minter),
    attachManifestContract(manifest, "wpas", "WPAS", admin),
    attachManifestContract(manifest, "usdc", "USDCMock", admin),
    attachManifestContract(manifest, "debtPool", "DebtPool", admin),
    attachManifestContract(manifest, "lendingCore", "LendingCore", admin),
  ]);

  const managedMinterContext: ManagedCallContext = {
    accessManager,
    signer: minter,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.minter ?? 0,
  };

  const poolSeed = ethers.parseUnits("1000", 18);
  const collateralPas = ethers.parseUnits("2", 18);
  const borrowAmount = ethers.parseUnits("100", 18);

  await seedDebtPoolLiquidity(managedMinterContext, usdcAdmin, usdcAdmin, debtPool, admin.address, poolSeed, "deployer");
  await openBorrowPosition({
    wpas,
    lendingCore,
    collateralPas,
    borrowAmount,
    labelPrefix: "deployer",
  });

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
