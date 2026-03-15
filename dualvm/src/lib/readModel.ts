import fallbackEventsJson from "../../deployments/polkadot-hub-testnet-recent-events.json";
import { createPublicClient, http, isAddress, parseAbiItem } from "viem";
import { debtPoolAbi, lendingCoreAbi, manualOracleAbi } from "./abi";
import { formatAddress, formatTokenAmount, formatTimestamp } from "./format";
import { deploymentManifest, hasLivePolkadotHubTestnetDeployment } from "./manifest";

const collateralDepositedEvent = parseAbiItem(
  "event CollateralDeposited(address indexed account, uint256 amount)",
);
const borrowedEvent = parseAbiItem(
  "event Borrowed(address indexed account, uint256 amount, uint256 borrowRateBps)",
);
const repaidEvent = parseAbiItem(
  "event Repaid(address indexed account, uint256 amount, uint256 principalPaid, uint256 interestPaid)",
);
const liquidatedEvent = parseAbiItem(
  "event Liquidated(address indexed borrower, address indexed liquidator, uint256 repaid, uint256 collateralSeized, uint256 badDebtWrittenOff)",
);

const CACHE_TTL_MS = 10_000;
let snapshotCache: { key: string; expiresAt: number; value: MarketSnapshot } | null = null;

export interface RecentActivity {
  label: string;
  detail: string;
  txHash: string;
  blockNumber: string;
}

export interface ObserverSnapshot {
  address: string;
  currentDebt: string;
  availableToBorrow: string;
  healthFactor: string;
}

export interface MarketSnapshot {
  totalAssets: string;
  availableLiquidity: string;
  outstandingPrincipal: string;
  reserveBalance: string;
  utilization: string;
  borrowCap: string;
  minBorrowAmount: string;
  liquidationBonusBps: string;
  oraclePrice: string;
  oracleFresh: string;
  oracleMaxAge: string;
  oracleLastUpdated: string;
  oracleMinPrice: string;
  oracleMaxPrice: string;
  oracleMaxPriceChange: string;
  observer: ObserverSnapshot | null;
  recentActivity: RecentActivity[];
}

function formatHealthFactor(value: bigint) {
  if (value === 0n) return "0.00";
  if (value > 10n ** 30n) return "∞";
  return formatTokenAmount(value, 18);
}

function formatUtilization(principal: bigint, totalAssets: bigint) {
  if (totalAssets === 0n) {
    return "0.00%";
  }
  const ratioWad = (principal * 10_000n) / totalAssets;
  return `${(Number(ratioWad) / 100).toFixed(2)}%`;
}

async function loadObserver(
  client: ReturnType<typeof createPublicClient>,
  observerAddress: string | null | undefined,
): Promise<ObserverSnapshot | null> {
  if (!observerAddress || !isAddress(observerAddress)) {
    return null;
  }

  const [currentDebt, availableToBorrow, healthFactor] = await Promise.all([
    client.readContract({
      address: deploymentManifest.contracts.lendingCore as `0x${string}`,
      abi: lendingCoreAbi,
      functionName: "currentDebt",
      args: [observerAddress as `0x${string}`],
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore as `0x${string}`,
      abi: lendingCoreAbi,
      functionName: "availableToBorrow",
      args: [observerAddress as `0x${string}`],
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore as `0x${string}`,
      abi: lendingCoreAbi,
      functionName: "healthFactor",
      args: [observerAddress as `0x${string}`],
    }),
  ]);

  return {
    address: observerAddress,
    currentDebt: `${formatTokenAmount(currentDebt)} USDC-test`,
    availableToBorrow: `${formatTokenAmount(availableToBorrow)} USDC-test`,
    healthFactor: formatHealthFactor(healthFactor),
  };
}

async function loadRecentActivity(client: ReturnType<typeof createPublicClient>): Promise<RecentActivity[]> {
  const toBlock = await client.getBlockNumber();
  const fromBlock = toBlock > 5_000n ? toBlock - 5_000n : 0n;
  const address = deploymentManifest.contracts.lendingCore as `0x${string}`;

  try {
    const [collateralLogs, borrowedLogs, repaidLogs, liquidatedLogs] = await Promise.all([
      client.getLogs({ address, event: collateralDepositedEvent, fromBlock, toBlock }),
      client.getLogs({ address, event: borrowedEvent, fromBlock, toBlock }),
      client.getLogs({ address, event: repaidEvent, fromBlock, toBlock }),
      client.getLogs({ address, event: liquidatedEvent, fromBlock, toBlock }),
    ]);

    const events: RecentActivity[] = [
      ...collateralLogs.map((log) => ({
        label: "Collateral deposited",
        detail: `${formatAddress(log.args.account ?? "0x0")} deposited ${formatTokenAmount(log.args.amount ?? 0n)} WPAS`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? "n/a",
      })),
      ...borrowedLogs.map((log) => ({
        label: "Borrowed",
        detail: `${formatAddress(log.args.account ?? "0x0")} borrowed ${formatTokenAmount(log.args.amount ?? 0n)} USDC-test`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? "n/a",
      })),
      ...repaidLogs.map((log) => ({
        label: "Repaid",
        detail: `${formatAddress(log.args.account ?? "0x0")} repaid ${formatTokenAmount(log.args.amount ?? 0n)} USDC-test`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? "n/a",
      })),
      ...liquidatedLogs.map((log) => ({
        label: "Liquidated",
        detail: `${formatAddress(log.args.borrower ?? "0x0")} liquidated by ${formatAddress(log.args.liquidator ?? "0x0")}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? "n/a",
      })),
    ];

    return events
      .sort((left, right) => Number(right.blockNumber) - Number(left.blockNumber))
      .slice(0, 8);
  } catch {
    return fallbackEventsJson.items.slice(0, 8) as RecentActivity[];
  }
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
  ] = await Promise.all([
    client.readContract({
      address: deploymentManifest.contracts.debtPool as `0x${string}`,
      abi: debtPoolAbi,
      functionName: "totalAssets",
    }),
    client.readContract({
      address: deploymentManifest.contracts.debtPool as `0x${string}`,
      abi: debtPoolAbi,
      functionName: "availableLiquidity",
    }),
    client.readContract({
      address: deploymentManifest.contracts.debtPool as `0x${string}`,
      abi: debtPoolAbi,
      functionName: "outstandingPrincipal",
    }),
    client.readContract({
      address: deploymentManifest.contracts.debtPool as `0x${string}`,
      abi: debtPoolAbi,
      functionName: "reserveBalance",
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore as `0x${string}`,
      abi: lendingCoreAbi,
      functionName: "borrowCap",
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore as `0x${string}`,
      abi: lendingCoreAbi,
      functionName: "minBorrowAmount",
    }),
    client.readContract({
      address: deploymentManifest.contracts.lendingCore as `0x${string}`,
      abi: lendingCoreAbi,
      functionName: "liquidationBonusBps",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle as `0x${string}`,
      abi: manualOracleAbi,
      functionName: "priceWad",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle as `0x${string}`,
      abi: manualOracleAbi,
      functionName: "isFresh",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle as `0x${string}`,
      abi: manualOracleAbi,
      functionName: "lastUpdatedAt",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle as `0x${string}`,
      abi: manualOracleAbi,
      functionName: "maxAge",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle as `0x${string}`,
      abi: manualOracleAbi,
      functionName: "minPriceWad",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle as `0x${string}`,
      abi: manualOracleAbi,
      functionName: "maxPriceWad",
    }),
    client.readContract({
      address: deploymentManifest.contracts.oracle as `0x${string}`,
      abi: manualOracleAbi,
      functionName: "maxPriceChangeBps",
    }),
    loadObserver(client, observerAddress),
    loadRecentActivity(client),
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
    observer,
    recentActivity,
  };

  snapshotCache = {
    key: cacheKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: snapshot,
  };

  return snapshot;
}
