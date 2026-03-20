import { createPublicClient, http } from "viem";
import { debtPoolAbi, lendingCoreAbi, manualOracleAbi, marketRegistryAbi } from "../abi";
import { formatTokenAmount, formatTimestamp } from "../format";
import { deploymentManifest, hasLivePolkadotHubTestnetDeployment } from "../manifest";
import { loadRecentActivityFeed, describeRecentActivityWindow } from "./activity";
import { loadObserverSnapshot } from "./observer";
import { perf } from "../perf";
import type { MarketSnapshot } from "./types";

const CACHE_TTL_MS = 10_000;
let snapshotCache: { key: string; expiresAt: number; value: MarketSnapshot } | null = null;

function formatUtilization(principal: bigint, totalAssets: bigint): string {
  if (totalAssets === 0n) {
    return "0.00%";
  }
  const ratioWad = (principal * 10_000n) / totalAssets;
  return `${(Number(ratioWad) / 100).toFixed(2)}%`;
}

export async function loadMarketSnapshot(
  observerAddress?: string | null,
  options?: { forceRefresh?: boolean },
): Promise<MarketSnapshot | null> {
  if (!hasLivePolkadotHubTestnetDeployment) {
    return null;
  }

  const cacheKey = observerAddress ?? "__none__";
  if (
    !options?.forceRefresh &&
    snapshotCache &&
    snapshotCache.key === cacheKey &&
    snapshotCache.expiresAt > Date.now()
  ) {
    return snapshotCache.value;
  }

  const snapId = perf.snapshot.start(observerAddress ?? undefined);

  const client = createPublicClient({
    transport: http(deploymentManifest.polkadotHubTestnet.rpcUrl),
  });

  const registryAddress = deploymentManifest.contracts.marketRegistry;
  const activeDebtPool = deploymentManifest.contracts.debtPool;
  const activeLendingCore = deploymentManifest.contracts.lendingEngine;

  // Instrumented contract read helper
  async function tracedRead<T>(contract: string, fn: string, call: () => Promise<T>): Promise<T> {
    const id = perf.contractRead.start(fn, contract);
    try {
      const result = await call();
      perf.contractRead.end(id, { result: typeof result === "bigint" ? result.toString() : result });
      return result;
    } catch (err) {
      perf.contractRead.fail(id, err);
      throw err;
    }
  }

  const [
    totalAssets,
    availableLiquidity,
    outstandingPrincipal,
    reserveBalance,
    borrowCap,
    minBorrowAmount,
    liquidationBonusBps,
    oraclePrice,
    oracleFresh,
    oracleLastUpdated,
    oracleMaxAge,
    oracleMinPrice,
    oracleMaxPrice,
    oracleMaxPriceChange,
    observer,
    recentActivity,
    versionInfo,
  ] = await Promise.all([
    tracedRead("DebtPool", "totalAssets", () => client.readContract({
      address: activeDebtPool, abi: debtPoolAbi, functionName: "totalAssets",
    })),
    tracedRead("DebtPool", "availableLiquidity", () => client.readContract({
      address: activeDebtPool, abi: debtPoolAbi, functionName: "availableLiquidity",
    })),
    tracedRead("DebtPool", "outstandingPrincipal", () => client.readContract({
      address: activeDebtPool, abi: debtPoolAbi, functionName: "outstandingPrincipal",
    })),
    tracedRead("DebtPool", "reserveBalance", () => client.readContract({
      address: activeDebtPool, abi: debtPoolAbi, functionName: "reserveBalance",
    })),
    tracedRead("LendingEngine", "borrowCap", () => client.readContract({
      address: activeLendingCore, abi: lendingCoreAbi, functionName: "borrowCap",
    })),
    tracedRead("LendingEngine", "minBorrowAmount", () => client.readContract({
      address: activeLendingCore, abi: lendingCoreAbi, functionName: "minBorrowAmount",
    })),
    tracedRead("LendingEngine", "liquidationBonusBps", () => client.readContract({
      address: activeLendingCore, abi: lendingCoreAbi, functionName: "liquidationBonusBps",
    })),
    tracedRead("Oracle", "priceWad", () => client.readContract({
      address: deploymentManifest.contracts.oracle, abi: manualOracleAbi, functionName: "priceWad",
    })),
    tracedRead("Oracle", "isFresh", () => client.readContract({
      address: deploymentManifest.contracts.oracle, abi: manualOracleAbi, functionName: "isFresh",
    })),
    tracedRead("Oracle", "lastUpdatedAt", () => client.readContract({
      address: deploymentManifest.contracts.oracle, abi: manualOracleAbi, functionName: "lastUpdatedAt",
    })),
    tracedRead("Oracle", "maxAge", () => client.readContract({
      address: deploymentManifest.contracts.oracle, abi: manualOracleAbi, functionName: "maxAge",
    })),
    tracedRead("Oracle", "minPriceWad", () => client.readContract({
      address: deploymentManifest.contracts.oracle, abi: manualOracleAbi, functionName: "minPriceWad",
    })),
    tracedRead("Oracle", "maxPriceWad", () => client.readContract({
      address: deploymentManifest.contracts.oracle, abi: manualOracleAbi, functionName: "maxPriceWad",
    })),
    tracedRead("Oracle", "maxPriceChangeBps", () => client.readContract({
      address: deploymentManifest.contracts.oracle, abi: manualOracleAbi, functionName: "maxPriceChangeBps",
    })),
    loadObserverSnapshot(client, observerAddress),
    loadRecentActivityFeed(client),
    registryAddress
      ? Promise.all([
          tracedRead("MarketRegistry", "activeVersionId", () => client.readContract({
            address: registryAddress, abi: marketRegistryAbi, functionName: "activeVersionId",
          })),
          tracedRead("MarketRegistry", "latestVersionId", () => client.readContract({
            address: registryAddress, abi: marketRegistryAbi, functionName: "latestVersionId",
          })),
        ]).catch(() => null)
      : Promise.resolve(null),
  ]);

  const snapshot: MarketSnapshot = {
    totalAssets: `${formatTokenAmount(totalAssets)} USDC-test`,
    availableLiquidity: `${formatTokenAmount(availableLiquidity)} USDC-test`,
    outstandingPrincipal: `${formatTokenAmount(outstandingPrincipal)} USDC-test`,
    reserveBalance: `${formatTokenAmount(reserveBalance)} USDC-test`,
    utilization: formatUtilization(outstandingPrincipal, totalAssets),
    borrowCap: `${formatTokenAmount(borrowCap)} USDC-test`,
    minBorrowAmount: `${formatTokenAmount(minBorrowAmount)} USDC-test`,
    liquidationBonusBps: `${liquidationBonusBps.toString()} bps`,
    oraclePrice: `${formatTokenAmount(oraclePrice)} USDC-test / WPAS`,
    oracleFresh: oracleFresh ? "fresh" : "stale",
    oracleMaxAge: `${oracleMaxAge.toString()} seconds`,
    oracleLastUpdated: formatTimestamp(Number(oracleLastUpdated) * 1000),
    oracleMinPrice: `${formatTokenAmount(oracleMinPrice)} USDC-test / WPAS`,
    oracleMaxPrice: `${formatTokenAmount(oracleMaxPrice)} USDC-test / WPAS`,
    oracleMaxPriceChange: `${oracleMaxPriceChange.toString()} bps`,
    activeVersionId: versionInfo ? `v${versionInfo[0].toString()}` : null,
    latestVersionId: versionInfo ? `v${versionInfo[1].toString()}` : null,
    observer,
    recentActivity: recentActivity.items,
    recentActivitySource: recentActivity.source,
    recentActivityWindow: describeRecentActivityWindow(recentActivity.fromBlock, recentActivity.toBlock),
    recentActivityWarning: recentActivity.warning,
  };

  snapshotCache = {
    key: cacheKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: snapshot,
  };

  perf.snapshot.end(snapId, {
    totalAssets: snapshot.totalAssets,
    utilization: snapshot.utilization,
    oracleFresh: snapshot.oracleFresh,
    hasObserver: !!snapshot.observer,
    activityCount: snapshot.recentActivity.length,
    activitySource: snapshot.recentActivitySource,
  });

  return snapshot;
}
