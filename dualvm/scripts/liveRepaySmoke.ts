import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { executeManagedCall } from "./accessManagerOps";

const { ethers } = hre;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function formatUnits(value: bigint) {
  return ethers.formatUnits(value, 18);
}

async function waitFor(txPromise: Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>, label: string) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash ?? tx.hash ?? "mined"}`);
}

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "deployments", "polkadot-hub-testnet.json"), "utf8"),
  );
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

  const mintDelay = manifest.governance?.executionDelaySeconds?.minter ?? 0;
  const poolSeed = ethers.parseUnits("1000", 18);
  const collateralPas = ethers.parseUnits("2", 18);
  const borrowAmount = ethers.parseUnits("200", 18);
  const repayAmount = ethers.parseUnits("50", 18);

  await executeManagedCall(accessManager, minter, usdcAdmin, "mint", [admin.address, poolSeed], "mint lender usdc-test", mintDelay);
  await waitFor(usdcAdmin.approve(await debtPoolAdmin.getAddress(), ethers.MaxUint256), "approve debt pool");
  await waitFor(debtPoolAdmin.deposit(poolSeed, admin.address), "deposit pool liquidity");

  await waitFor(wpas.deposit({ value: collateralPas }), "borrower wrap pas into wpas");
  await waitFor(wpas.approve(await lendingCoreAdmin.getAddress(), ethers.MaxUint256), "borrower approve collateral");
  await waitFor(lendingCoreBorrower.depositCollateral(collateralPas), "borrower deposit collateral");
  await waitFor(lendingCoreBorrower.borrow(borrowAmount), "borrower draw stable debt");

  await new Promise(resolve => setTimeout(resolve, 5000));

  const [debtBefore, borrowerUsdcBefore] = await Promise.all([
    lendingCoreAdmin.currentDebt(borrower.address),
    usdcAdmin.balanceOf(borrower.address),
  ]);

  await waitFor(usdcBorrower.approve(await lendingCoreAdmin.getAddress(), ethers.MaxUint256), "borrower approve core");
  await waitFor(lendingCoreBorrower.repay(repayAmount), "borrower repay partial debt");

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
          debtBefore: formatUnits(debtBefore),
          debtAfter: formatUnits(debtAfter),
          debtReduced: debtAfter < debtBefore,
          borrowerUsdcBefore: formatUnits(borrowerUsdcBefore),
          borrowerUsdcAfter: formatUnits(borrowerUsdcAfter),
          poolOutstandingPrincipalAfter: formatUnits(poolPrincipalAfter),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
