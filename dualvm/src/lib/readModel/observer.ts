import { createPublicClient, formatUnits, isAddress } from "viem";
import { lendingCoreAbi } from "../abi";
import { formatHealthFactor, formatTokenAmount } from "../format";
import { deploymentManifest } from "../manifest";
import { perf } from "../perf";
import type { ObserverSnapshot } from "./types";

const WAD = 10n ** 18n;
const BPS = 10_000n;

function healthFactorNumeric(value: bigint): number | null {
  if (value === 0n) return 0;
  if (value > 10n ** 30n) return null; // infinite → null means "safe/no debt"
  return Number.parseFloat(formatUnits(value, 18));
}

function computeLiquidationPrice(
  debtRaw: bigint,
  collateralRaw: bigint,
  liquidationThresholdBps: bigint,
): string | null {
  if (debtRaw === 0n || collateralRaw === 0n || liquidationThresholdBps === 0n) {
    return null;
  }
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

  const obsId = perf.observer.start(observerAddress);
  const trackedAddress = observerAddress as `0x${string}`;
  const lendingCore = deploymentManifest.contracts.lendingEngine;

  async function traced<T>(fn: string, call: () => Promise<T>): Promise<T> {
    const id = perf.contractRead.start(fn, "LendingEngine");
    try {
      const result = await call();
      perf.contractRead.end(id, { result: typeof result === "bigint" ? result.toString() : typeof result === "object" ? "struct" : result });
      return result;
    } catch (err) {
      perf.contractRead.fail(id, err);
      throw err;
    }
  }

  try {
    const [currentDebt, availableToBorrow, healthFactor, position, liquidationThresholdBps] = await Promise.all([
      traced("currentDebt", () => client.readContract({
        address: lendingCore, abi: lendingCoreAbi, functionName: "currentDebt", args: [trackedAddress],
      })),
      traced("availableToBorrow", () => client.readContract({
        address: lendingCore, abi: lendingCoreAbi, functionName: "availableToBorrow", args: [trackedAddress],
      })),
      traced("healthFactor", () => client.readContract({
        address: lendingCore, abi: lendingCoreAbi, functionName: "healthFactor", args: [trackedAddress],
      })),
      traced("positions", () => client.readContract({
        address: lendingCore, abi: lendingCoreAbi, functionName: "positions", args: [trackedAddress],
      })),
      traced("maxConfiguredLiquidationThresholdBps", () => client.readContract({
        address: lendingCore, abi: lendingCoreAbi, functionName: "maxConfiguredLiquidationThresholdBps",
      })),
    ]);

    const collateralAmount = position[0];

    const result: ObserverSnapshot = {
      address: trackedAddress,
      currentDebt: `${formatTokenAmount(currentDebt)} USDC-test`,
      availableToBorrow: `${formatTokenAmount(availableToBorrow)} USDC-test`,
      healthFactor: formatHealthFactor(healthFactor),
      healthFactorNumeric: healthFactorNumeric(healthFactor),
      liquidationPrice: computeLiquidationPrice(currentDebt, collateralAmount, liquidationThresholdBps),
    };

    perf.observer.end(obsId, {
      debt: currentDebt.toString(),
      collateral: collateralAmount.toString(),
      healthFactor: result.healthFactor,
    });
    return result;
  } catch (err) {
    perf.observer.fail(obsId, err);
    throw err;
  }
}
