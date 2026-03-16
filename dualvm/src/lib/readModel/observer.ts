import { createPublicClient, isAddress } from "viem";
import { lendingCoreAbi } from "../abi";
import { formatTokenAmount } from "../format";
import { deploymentManifest } from "../manifest";
import type { ObserverSnapshot } from "./types";

function formatHealthFactor(value: bigint): string {
  if (value === 0n) return "0.00";
  if (value > 10n ** 30n) return "∞";
  return formatTokenAmount(value, 18);
}

export async function loadObserverSnapshot(
  client: ReturnType<typeof createPublicClient>,
  observerAddress: string | null | undefined,
): Promise<ObserverSnapshot | null> {
  if (!observerAddress || !isAddress(observerAddress)) {
    return null;
  }

  const trackedAddress = observerAddress as `0x${string}`;
  const [currentDebt, availableToBorrow, healthFactor] = await Promise.all([
    client.readContract({
      address: deploymentManifest.contracts.lendingCore,
      abi: lendingCoreAbi,
      functionName: "currentDebt",
      args: [trackedAddress],
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore,
      abi: lendingCoreAbi,
      functionName: "availableToBorrow",
      args: [trackedAddress],
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore,
      abi: lendingCoreAbi,
      functionName: "healthFactor",
      args: [trackedAddress],
    }),
  ]);

  return {
    address: trackedAddress,
    currentDebt: `${formatTokenAmount(currentDebt)} USDC-test`,
    availableToBorrow: `${formatTokenAmount(availableToBorrow)} USDC-test`,
    healthFactor: formatHealthFactor(healthFactor),
  };
}
