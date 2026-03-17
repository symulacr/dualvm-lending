import { managedMintUsdc } from "../lib/ops/managedAccess";
import { createSmokeContext, buildManagedContext } from "../lib/runtime/smokeContext";
import { formatWad } from "../lib/runtime/transactions";
import { runEntrypoint } from "../lib/runtime/entrypoint";

export async function main() {
  const { manifest, actors, attach } = await createSmokeContext(["admin", "minter", "recipient"] as const);
  const { admin, minter, recipient } = actors;

  const [accessManager, usdc] = await Promise.all([
    attach("accessManager", "DualVMAccessManager", minter),
    attach("usdc", "USDCMock", admin),
  ]);
  const ctx = buildManagedContext(manifest, accessManager, minter, "minter");

  const mintAmount = 10n ** 18n;
  const beforeBalance = await usdc.balanceOf(recipient.address);
  await managedMintUsdc(ctx, usdc, recipient.address, mintAmount, "minter mint observer amount");
  const afterBalance = await usdc.balanceOf(recipient.address);

  console.log(
    JSON.stringify(
      {
        roles: { admin: admin.address, minter: minter.address, recipient: recipient.address },
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
