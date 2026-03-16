import type { ManagedCallContext } from "../lib/ops/managedAccess";
import { managedMintUsdc } from "../lib/ops/managedAccess";
import { loadDeploymentManifest } from "../lib/deployment/manifestStore";
import { loadActors } from "../lib/runtime/actors";
import { attachManifestContract } from "../lib/runtime/contracts";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const manifest = loadDeploymentManifest();
  const { admin, minter, recipient } = loadActors(["admin", "minter", "recipient"] as const);

  const [accessManager, usdc] = await Promise.all([
    attachManifestContract(manifest, "accessManager", "DualVMAccessManager", minter),
    attachManifestContract(manifest, "usdc", "USDCMock", admin),
  ]);
  const managedMinterContext: ManagedCallContext = {
    accessManager,
    signer: minter,
    executionDelaySeconds: manifest.governance?.executionDelaySeconds?.minter ?? 0,
  };

  const mintAmount = 10n ** 18n;
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
