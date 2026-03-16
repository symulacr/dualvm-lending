import hre from "hardhat";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { requireEnv } from "../lib/runtime/env";
import { waitForTransaction } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

const { ethers } = hre;

export async function main() {
  const borrower = requireEnv("BORROWER_ADDRESS");
  const manifest = loadDeploymentManifest();
  const provider = ethers.provider;
  const liquidator = new ethers.Wallet(requireEnv("LIQUIDATOR_PRIVATE_KEY"), provider);

  const usdc = (await ethers.getContractFactory("USDCMock", liquidator)).attach(manifest.contracts.usdc) as any;
  const lendingCore = (await ethers.getContractFactory("LendingCore", liquidator)).attach(manifest.contracts.lendingCore) as any;

  const [debt, healthFactor] = await Promise.all([
    lendingCore.currentDebt(borrower),
    lendingCore.healthFactor(borrower),
  ]);

  if (debt === 0n || healthFactor >= 10n ** 18n) {
    console.log(JSON.stringify({ borrower, debt: debt.toString(), healthFactor: healthFactor.toString(), liquidatable: false }, null, 2));
    return;
  }

  await waitForTransaction(usdc.approve(await lendingCore.getAddress(), ethers.MaxUint256), "approve usdc for liquidation");
  await waitForTransaction(lendingCore.liquidate(borrower, ethers.MaxUint256), "execute liquidation");
}

runEntrypoint("scripts/executeLiquidation.ts", main);
