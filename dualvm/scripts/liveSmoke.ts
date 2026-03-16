import hre from "hardhat";
import type { ManagedCallContext } from "../lib/ops/managedAccess";
import { openBorrowPosition, seedDebtPoolLiquidity } from "../lib/ops/liveScenario";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { requireEnv } from "../lib/runtime/env";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

export async function main() {
  const manifest = loadDeploymentManifest();
  const provider = ethers.provider;

  const admin = new ethers.Wallet(requireEnv("ADMIN_PRIVATE_KEY"), provider);
  const minter = new ethers.Wallet(requireEnv("MINTER_PRIVATE_KEY"), provider);
  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", minter)).attach(manifest.contracts.accessManager) as any;
  const wpas = (await ethers.getContractFactory("WPAS", admin)).attach(manifest.contracts.wpas) as any;
  const usdcAdmin = (await ethers.getContractFactory("USDCMock", admin)).attach(manifest.contracts.usdc) as any;
  const debtPool = (await ethers.getContractFactory("DebtPool", admin)).attach(manifest.contracts.debtPool) as any;
  const lendingCore = (await ethers.getContractFactory("LendingCore", admin)).attach(manifest.contracts.lendingCore) as any;

  const managedMinterContext: ManagedCallContext = {
    accessManager,
    signer: minter,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.minter ?? 0,
  };

  const poolSeed = ethers.parseUnits("1000", 18);
  const collateralPas = ethers.parseUnits("2", 18);
  const borrowAmount = ethers.parseUnits("100", 18);

  await seedDebtPoolLiquidity(managedMinterContext, usdcAdmin, debtPool, admin.address, poolSeed, "deployer");
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
