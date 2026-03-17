import { createPublicClient, formatUnits, isAddress } from "viem";
import { lendingCoreAbi } from "../abi";
import { formatTokenAmount } from "../format";
import { deploymentManifest } from "../manifest";
import type { ObserverSnapshot } from "./types";

const WAD = 10n ** 18n;
const BPS = 10_000n;

function formatHealthFactor(value: bigint): string {
  if (value === 0n) return "0.00";
  if (value > 10n ** 30n) return "∞";
  return formatTokenAmount(value, 18);
}

function healthFactorNumeric(value: bigint): number | null {
  if (value === 0n) return 0;
  if (value > 10n ** 30n) return null; // infinite → null means "safe/no debt"
  return Number.parseFloat(formatUnits(value, 18));
}

/**
 * Compute the PAS price at which the position becomes liquidatable.
 * Formula: liquidationPrice = (debt * WAD * BPS) / (collateral * liquidationThresholdBps)
 * Returns a formatted string like "1.23" or null if position is empty.
 */
function computeLiquidationPrice(
  debtRaw: bigint,
  collateralRaw: bigint,
  liquidationThresholdBps: bigint,
): string | null {
  if (debtRaw === 0n || collateralRaw === 0n || liquidationThresholdBps === 0n) {
    return null;
  }
  // liquidationPrice (WAD) = (debt * WAD * BPS) / (collateral * liquidationThresholdBps)
  const numerator = debtRaw * WAD * BPS;
  const denominator = collateralRaw * liquidationThresholdBps;
  const priceWad = numerator / denominator;
  return formatTokenAmount(priceWad, 18);
}

export async function loadObserverSnapshot(
  client: ReturnType<typeof createPublicClient>,
  observerAddress: string | null | undefined,
): Promise<ObserverSnapshot | null> {
  if (!observerAddress || !isAddress(observerAddress)) {
    return null;
  }

  const trackedAddress = observerAddress as `0x${string}`;
  const lendingCore = deploymentManifest.contracts.lendingCore;

  const [currentDebt, availableToBorrow, healthFactor, position, liquidationThresholdBps] = await Promise.all([
    client.readContract({
      address: lendingCore,
      abi: lendingCoreAbi,
      functionName: "currentDebt",
      args: [trackedAddress],
    }),
    client.readContract({
      address: lendingCore,
      abi: lendingCoreAbi,
      functionName: "availableToBorrow",
      args: [trackedAddress],
    }),
    client.readContract({
      address: lendingCore,
      abi: lendingCoreAbi,
      functionName: "healthFactor",
      args: [trackedAddress],
    }),
    client.readContract({
      address: lendingCore,
      abi: lendingCoreAbi,
      functionName: "positions",
      args: [trackedAddress],
    }),
    client.readContract({
      address: lendingCore,
      abi: lendingCoreAbi,
      functionName: "maxConfiguredLiquidationThresholdBps",
    }),
  ]);

  const collateralAmount = position[0]; // collateralAmount is the first field

  return {
    address: trackedAddress,
    currentDebt: `${formatTokenAmount(currentDebt)} USDC-test`,
    availableToBorrow: `${formatTokenAmount(availableToBorrow)} USDC-test`,
    healthFactor: formatHealthFactor(healthFactor),
    healthFactorNumeric: healthFactorNumeric(healthFactor),
    liquidationPrice: computeLiquidationPrice(currentDebt, collateralAmount, liquidationThresholdBps),
  };
}
