import fallbackEventsJson from "../../../deployments/polkadot-hub-testnet-recent-events.json";
import { createPublicClient, parseAbiItem } from "viem";
import { formatAddress, formatTokenAmount } from "../format";
import { deploymentManifest } from "../manifest";
import { perf } from "../perf";
import {
  formatRecentActivityWindow,
  parseFallbackRecentActivity,
  type RecentActivity,
  type RecentActivityFeed,
} from "../recentActivity";

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

const fallbackRecentActivity = parseFallbackRecentActivity(fallbackEventsJson);

export function describeRecentActivityWindow(fromBlock: string, toBlock: string): string {
  return formatRecentActivityWindow(fromBlock, toBlock);
}

export async function loadRecentActivityFeed(
  client: ReturnType<typeof createPublicClient>,
): Promise<RecentActivityFeed> {
  const actId = perf.activity.start();
  const toBlock = await client.getBlockNumber();
  const fromBlock = toBlock > 50_000n ? toBlock - 50_000n : 0n;
  const address = deploymentManifest.contracts.lendingEngine;

  try {
    const logId = perf.rpc.start("getLogs_4_events", { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() });
    const [collateralLogs, borrowedLogs, repaidLogs, liquidatedLogs] = await Promise.all([
      client.getLogs({ address, event: collateralDepositedEvent, fromBlock, toBlock }),
      client.getLogs({ address, event: borrowedEvent, fromBlock, toBlock }),
      client.getLogs({ address, event: repaidEvent, fromBlock, toBlock }),
      client.getLogs({ address, event: liquidatedEvent, fromBlock, toBlock }),
    ]);
    perf.rpc.end(logId, { collateral: collateralLogs.length, borrowed: borrowedLogs.length, repaid: repaidLogs.length, liquidated: liquidatedLogs.length });

    const items: RecentActivity[] = [
      ...collateralLogs.map((log) => ({
        label: "Collateral deposited",
        detail: `${formatAddress(log.args.account ?? "0x0")} deposited ${formatTokenAmount(log.args.amount ?? 0n)} WPAS`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? "n/a",
        involvedAddresses: [(log.args.account ?? "0x0").toLowerCase()],
      })),
      ...borrowedLogs.map((log) => ({
        label: "Borrowed",
        detail: `${formatAddress(log.args.account ?? "0x0")} borrowed ${formatTokenAmount(log.args.amount ?? 0n)} USDC-test`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? "n/a",
        involvedAddresses: [(log.args.account ?? "0x0").toLowerCase()],
      })),
      ...repaidLogs.map((log) => ({
        label: "Repaid",
        detail: `${formatAddress(log.args.account ?? "0x0")} repaid ${formatTokenAmount(log.args.amount ?? 0n)} USDC-test`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? "n/a",
        involvedAddresses: [(log.args.account ?? "0x0").toLowerCase()],
      })),
      ...liquidatedLogs.map((log) => ({
        label: "Liquidated",
        detail: `${formatAddress(log.args.borrower ?? "0x0")} liquidated by ${formatAddress(log.args.liquidator ?? "0x0")}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? "n/a",
        involvedAddresses: [(log.args.borrower ?? "0x0").toLowerCase(), (log.args.liquidator ?? "0x0").toLowerCase()],
      })),
    ];

    const feed: RecentActivityFeed = {
      source: "live",
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      warning: null,
      items: items.sort((left, right) => Number(right.blockNumber) - Number(left.blockNumber)).slice(0, 10),
    };
    perf.activity.end(actId, { count: feed.items.length, source: "live" });
    return feed;
  } catch (error) {
    perf.activity.fail(actId, error);
    const message = error instanceof Error ? error.message : String(error);
    return {
      source: "snapshot",
      fromBlock: fallbackRecentActivity.fromBlock,
      toBlock: fallbackRecentActivity.toBlock,
      generatedAt: fallbackRecentActivity.generatedAt,
      warning: `Live recent-activity query failed (${message}). Showing bundled snapshot captured at ${fallbackRecentActivity.generatedAt}.`,
      items: fallbackRecentActivity.items.slice(0, 10),
    };
  }
}
