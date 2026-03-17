import { requireEnv } from "../lib/runtime/env";
import { waitForTransaction } from "../lib/runtime/transactions";
import { createSmokeContext } from "../lib/runtime/smokeContext";
import { runEntrypoint } from "../lib/runtime/entrypoint";
import hre from "hardhat";

const { ethers } = hre;

export async function main() {
  const borrower = requireEnv("BORROWER_ADDRESS");
  const { actors, attach } = await createSmokeContext(["liquidator"] as const);
  const { liquidator } = actors;

  const [usdc, lendingCore] = await Promise.all([
    attach("usdc", "USDCMock", liquidator),
    attach("lendingCore", "LendingCore", liquidator),
  ]);

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
