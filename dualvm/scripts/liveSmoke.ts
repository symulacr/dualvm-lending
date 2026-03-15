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
  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", minter)).attach(manifest.contracts.accessManager) as any;
  const wpas = (await ethers.getContractFactory("WPAS", admin)).attach(manifest.contracts.wpas) as any;
  const usdcAdmin = (await ethers.getContractFactory("USDCMock", admin)).attach(manifest.contracts.usdc) as any;
  const debtPool = (await ethers.getContractFactory("DebtPool", admin)).attach(manifest.contracts.debtPool) as any;
  const lendingCore = (await ethers.getContractFactory("LendingCore", admin)).attach(manifest.contracts.lendingCore) as any;

  const mintDelay = manifest.governance?.executionDelaySeconds?.minter ?? 0;
  const poolSeed = ethers.parseUnits("1000", 18);
  const collateralPas = ethers.parseUnits("2", 18);
  const borrowAmount = ethers.parseUnits("100", 18);

  await executeManagedCall(accessManager, minter, usdcAdmin, "mint", [admin.address, poolSeed], "mint usdc-test", mintDelay);
  await waitFor(usdcAdmin.approve(await debtPool.getAddress(), ethers.MaxUint256), "approve debt pool");
  await waitFor(debtPool.deposit(poolSeed, admin.address), "deposit pool liquidity");

  await waitFor(wpas.deposit({ value: collateralPas }), "wrap pas into wpas");
  await waitFor(wpas.approve(await lendingCore.getAddress(), ethers.MaxUint256), "approve collateral");
  await waitFor(lendingCore.depositCollateral(collateralPas), "deposit collateral");
  await waitFor(lendingCore.borrow(borrowAmount), "borrow usdc-test");

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
          usdcBalance: formatUnits(usdcBalance),
          poolAssets: formatUnits(poolAssets),
          outstandingPrincipal: formatUnits(outstandingPrincipal),
          deployerDebt: formatUnits(deployerDebt),
          deployerWpasBalance: formatUnits(collateralBalance),
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
