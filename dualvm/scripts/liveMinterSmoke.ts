import hre from "hardhat";
import { managedMintUsdc, type ManagedCallContext } from "../lib/ops/managedAccess";
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
  const recipient = new ethers.Wallet(requireEnv("RECIPIENT_PRIVATE_KEY"), provider);

  const accessManager = (await ethers.getContractFactory("DualVMAccessManager", minter)).attach(manifest.contracts.accessManager) as any;
  const usdc = (await ethers.getContractFactory("USDCMock", admin)).attach(manifest.contracts.usdc) as any;
  const managedMinterContext: ManagedCallContext = {
    accessManager,
    signer: minter,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.minter ?? 0,
  };

  const mintAmount = ethers.parseUnits("1", 18);
  const beforeBalance = await usdc.balanceOf(recipient.address);
  await managedMintUsdc(managedMinterContext, usdc, recipient.address, mintAmount, "minter mint observer amount");
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
          beforeBalance: formatWad(beforeBalance),
          afterBalance: formatWad(afterBalance),
          delta: formatWad(BigInt(afterBalance) - BigInt(beforeBalance)),
          increased: afterBalance > beforeBalance,
        },
      },
      null,
      2,
    ),
  );
}

runEntrypoint("scripts/liveMinterSmoke.ts", main);
