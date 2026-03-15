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

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "deployments", "polkadot-hub-testnet.json"), "utf8"),
  );
  const provider = ethers.provider;

  const admin = new ethers.Wallet(requireEnv("ADMIN_PRIVATE_KEY"), provider);
  const minter = new ethers.Wallet(requireEnv("MINTER_PRIVATE_KEY"), provider);
  const recipient = new ethers.Wallet(requireEnv("RECIPIENT_PRIVATE_KEY"), provider);

  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", minter)).attach(manifest.contracts.accessManager) as any;
  const usdc = (await ethers.getContractFactory("USDCMock", admin)).attach(manifest.contracts.usdc) as any;
  const mintDelay = manifest.governance?.executionDelaySeconds?.minter ?? 0;
  const mintAmount = ethers.parseUnits("1", 18);

  const beforeBalance = await usdc.balanceOf(recipient.address);
  await executeManagedCall(accessManager, minter, usdc, "mint", [recipient.address, mintAmount], "minter mint observer amount", mintDelay);
  const afterBalance = await usdc.balanceOf(recipient.address);

  console.log(
    JSON.stringify(
      {
        roles: {
          admin: admin.address,
          minter: minter.address,
          recipient: recipient.address,
        },
        governance: manifest.governance,
        checks: {
          beforeBalance: formatUnits(beforeBalance),
          afterBalance: formatUnits(afterBalance),
          delta: formatUnits(BigInt(afterBalance) - BigInt(beforeBalance)),
          increased: afterBalance > beforeBalance,
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
