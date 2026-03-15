import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

const { ethers } = hre;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function waitFor(txPromise: Promise<{ wait(): Promise<{ hash?: string }>; hash?: string }>, label: string) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash ?? tx.hash ?? "mined"}`);
}

async function main() {
  const borrower = requireEnv("BORROWER_ADDRESS");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "deployments", "polkadot-hub-testnet.json"), "utf8"),
  );
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

  await waitFor(usdc.approve(await lendingCore.getAddress(), ethers.MaxUint256), "approve usdc for liquidation");
  await waitFor(lendingCore.liquidate(borrower, ethers.MaxUint256), "execute liquidation");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
