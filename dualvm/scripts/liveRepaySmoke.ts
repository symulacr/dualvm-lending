import hre from "hardhat";
import type { ManagedCallContext } from "../lib/ops/managedAccess";
import { openBorrowPosition, seedDebtPoolLiquidity, waitForDebtToAccrue } from "../lib/ops/liveScenario";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { requireEnv } from "../lib/runtime/env";
import { formatWad, waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

export async function main() {
  const manifest = loadDeploymentManifest();
  const provider = ethers.provider;

  const admin = new ethers.Wallet(requireEnv("ADMIN_PRIVATE_KEY"), provider);
  const minter = new ethers.Wallet(requireEnv("MINTER_PRIVATE_KEY"), provider);
  const borrower = new ethers.Wallet(requireEnv("BORROWER_PRIVATE_KEY"), provider);

  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", minter)).attach(manifest.contracts.accessManager) as any;
  const wpas = (await ethers.getContractFactory("WPAS", borrower)).attach(manifest.contracts.wpas) as any;
  const usdcAdmin = (await ethers.getContractFactory("USDCMock", admin)).attach(manifest.contracts.usdc) as any;
  const usdcBorrower = usdcAdmin.connect(borrower) as any;
  const debtPoolAdmin = (await ethers.getContractFactory("DebtPool", admin)).attach(manifest.contracts.debtPool) as any;
  const lendingCoreAdmin = (await ethers.getContractFactory("LendingCore", admin)).attach(manifest.contracts.lendingCore) as any;
  const lendingCoreBorrower = lendingCoreAdmin.connect(borrower) as any;

  const managedMinterContext: ManagedCallContext = {
    accessManager,
    signer: minter,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.minter ?? 0,
  };

  const poolSeed = ethers.parseUnits("1000", 18);
  const collateralPas = ethers.parseUnits("2", 18);
  const borrowAmount = ethers.parseUnits("200", 18);
  const repayAmount = ethers.parseUnits("50", 18);

  await seedDebtPoolLiquidity(managedMinterContext, usdcAdmin, debtPoolAdmin, admin.address, poolSeed, "repay scenario");
  await openBorrowPosition({
    wpas,
    lendingCore: lendingCoreBorrower,
    collateralPas,
    borrowAmount,
    labelPrefix: "borrower",
  });

  await waitForDebtToAccrue(
    lendingCoreAdmin,
    borrower.address,
    borrowAmount,
    "wait for repay scenario debt growth",
    15_000,
  );
  const [debtBefore, borrowerUsdcBefore] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    usdcAdmin.balanceOf(borrower.address),
  ]);

  await waitForTransaction(usdcBorrower.approve(await lendingCoreAdmin.getAddress(), ethers.MaxUint256), "borrower approve core");
  await waitForTransaction(lendingCoreBorrower.repay(repayAmount), "borrower repay partial debt");

  const [debtAfter, borrowerUsdcAfter, poolPrincipalAfter] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    usdcAdmin.balanceOf(borrower.address),
    debtPoolAdmin.outstandingPrincipal(),
  ]);

  console.log(
    JSON.stringify(
      {
        roles: {
          admin: admin.address,
          minter: minter.address,
          borrower: borrower.address,
        },
        deployment: manifest.contracts,
        governance: manifest.governance,
        checks: {
          debtBefore: formatWad(debtBefore),
          debtAfter: formatWad(debtAfter),
          debtReduced: debtAfter < debtBefore,
          borrowerUsdcBefore: formatWad(borrowerUsdcBefore),
          borrowerUsdcAfter: formatWad(borrowerUsdcAfter),
          poolOutstandingPrincipalAfter: formatWad(poolPrincipalAfter),
        },
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/liveRepaySmoke.ts", main);
