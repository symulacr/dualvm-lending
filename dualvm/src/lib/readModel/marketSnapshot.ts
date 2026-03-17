import { createPublicClient, http } from "viem";
import { debtPoolAbi, lendingCoreAbi, manualOracleAbi, marketRegistryAbi } from "../abi";
import { formatTokenAmount, formatTimestamp } from "../format";
import { deploymentManifest, hasLivePolkadotHubTestnetDeployment } from "../manifest";
import { loadRecentActivityFeed, describeRecentActivityWindow } from "./activity";
import { loadObserverSnapshot } from "./observer";
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

export async function loadMarketSnapshot(observerAddress?: string | null): Promise<MarketSnapshot | null> {
  if (!hasLivePolkadotHubTestnetDeployment) {
    return null;
  }

  const cacheKey = observerAddress ?? "__none__";
  if (snapshotCache && snapshotCache.key === cacheKey && snapshotCache.expiresAt > Date.now()) {
    return snapshotCache.value;
  }

  const client = createPublicClient({
    transport: http(deploymentManifest.polkadotHubTestnet.rpcUrl),
  });

  const registryAddress = deploymentManifest.contracts.marketRegistry;

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
    client.readContract({
      address: deploymentManifest.contracts.debtPool,
      abi: debtPoolAbi,
      functionName: "totalAssets",
    }),
    client.readContract({
      address: deploymentManifest.contracts.debtPool,
      abi: debtPoolAbi,
      functionName: "availableLiquidity",
    }),
    client.readContract({
      address: deploymentManifest.contracts.debtPool,
      abi: debtPoolAbi,
      functionName: "outstandingPrincipal",
    }),
    client.readContract({
      address: deploymentManifest.contracts.debtPool,
      abi: debtPoolAbi,
      functionName: "reserveBalance",
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore,
      abi: lendingCoreAbi,
      functionName: "borrowCap",
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore,
      abi: lendingCoreAbi,
      functionName: "minBorrowAmount",
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore,
      abi: lendingCoreAbi,
      functionName: "liquidationBonusBps",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle,
      abi: manualOracleAbi,
      functionName: "priceWad",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle,
      abi: manualOracleAbi,
      functionName: "isFresh",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle,
      abi: manualOracleAbi,
      functionName: "lastUpdatedAt",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle,
      abi: manualOracleAbi,
      functionName: "maxAge",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle,
      abi: manualOracleAbi,
      functionName: "minPriceWad",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle,
      abi: manualOracleAbi,
      functionName: "maxPriceWad",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle,
      abi: manualOracleAbi,
      functionName: "maxPriceChangeBps",
    }),
    loadObserverSnapshot(client, observerAddress),
    loadRecentActivityFeed(client),
    registryAddress
      ? Promise.all([
          client.readContract({
            address: registryAddress,
            abi: marketRegistryAbi,
            functionName: "activeVersionId",
          }),
          client.readContract({
            address: registryAddress,
            abi: marketRegistryAbi,
            functionName: "latestVersionId",
          }),
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

  return snapshot;
}
