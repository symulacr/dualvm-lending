/**
 * event-correlator.ts  (M11 update)
 *
 * Correlates LendingEngine.Liquidated and XcmLiquidationNotifier.LiquidationNotified
 * events by correlationId (primary) or block proximity (legacy fallback).
 *
 * The M11 bilateral async system embeds a unique correlationId in:
 *   - LendingEngine.Liquidated (topic3)
 *   - XcmLiquidationNotifier.LiquidationNotified (topic2)
 *   - XcmInbox.ReceiptReceived (topic1)
 *
 * This enables exact matching across the three domains of the bilateral async pipeline.
 *
 * Usage:
 *   # Live mode (watches for new events):
 *   LENDING_ENGINE=0x... XCM_NOTIFIER=0x... npx ts-node scripts/event-correlator.ts
 *
 *   # Historical mode (queries past blocks, saves artifacts):
 *   LENDING_ENGINE=0x... XCM_NOTIFIER=0x... XCM_INBOX=0x... \
 *     FROM_BLOCK=1000000 TO_BLOCK=1000100 \
 *     npx ts-node scripts/event-correlator.ts --historical
 *
 *   # With defaults from canonical manifest:
 *   npx ts-node scripts/event-correlator.ts [--historical]
 *
 * Output (one JSON object per line, stdout):
 *   { correlatedAtMs, correlatedAtIso, correlationId, borrower, liquidatedTx, notifiedTx, ... }
 *
 * Status/error messages go to stderr.
 */

import { createPublicClient, http, parseAbiItem, decodeEventLog } from "viem";
import * as fs from "node:fs";
import * as path from "node:path";
import { POLKADOT_HUB_TESTNET } from "../lib/config/marketConfig";

// ── ABI fragments (M11: include correlationId in indexed fields) ────────────

const LIQUIDATED_EVENT = parseAbiItem(
  "event Liquidated(address indexed borrower, address indexed liquidator, uint256 repaid, uint256 collateralSeized, uint256 badDebtWrittenOff, bytes32 indexed correlationId)",
);

const LIQUIDATION_NOTIFIED_EVENT = parseAbiItem(
  "event LiquidationNotified(address indexed borrower, uint256 debtRepaid, uint256 collateralSeized, bytes32 indexed correlationId)",
);

const RECEIPT_RECEIVED_EVENT = parseAbiItem(
  "event ReceiptReceived(bytes32 indexed correlationId, address indexed sender, bytes data)",
);

// ── Types ─────────────────────────────────────────────────────────────────

export interface LiquidatedEventData {
  correlationId: string;
  borrower: string;
  liquidator: string;
  repaid: bigint;
  collateralSeized: bigint;
  badDebtWrittenOff: bigint;
  blockNumber: bigint;
  txHash: string;
  localTimestampMs: number;
}

export interface LiquidationNotifiedEventData {
  correlationId: string;
  borrower: string;
  debtRepaid: bigint;
  collateralSeized: bigint;
  blockNumber: bigint;
  txHash: string;
  localTimestampMs: number;
}

export interface ReceiptReceivedEventData {
  correlationId: string;
  sender: string;
  data: string;
  blockNumber: bigint;
  txHash: string;
  localTimestampMs: number;
}

export interface CorrelatedPair {
  correlationId: string;
  borrower: string;
  liquidated: LiquidatedEventData;
  notified: LiquidationNotifiedEventData;
  receipt?: ReceiptReceivedEventData;
  correlatedAtMs: number;
}

export interface CorrelatorLog {
  correlatedAtMs: number;
  correlatedAtIso: string;
  correlationId: string;
  borrower: string;
  liquidatedTx: string;
  notifiedTx: string;
  receiptTx?: string;
  repaid: string;
  collateralSeized: string;
  blockNumber: string;
  inboxConfirmed: boolean;
}

// ── Primary: correlate by exact correlationId ─────────────────────────────

/**
 * Correlates Liquidated and LiquidationNotified events by their shared correlationId.
 * This is the M11 primary matching mode: each event carries an identical correlationId
 * generated in LendingEngine._nextCorrelationId() and propagated through the hook chain.
 *
 * If XcmInbox ReceiptReceived events are provided, they are also correlated
 * by correlationId to complete the bilateral async proof loop.
 *
 * @param liquidatedEvents    Buffer of Liquidated events.
 * @param notifiedEvents      Buffer of LiquidationNotified events.
 * @param receiptEvents       Optional buffer of XcmInbox.ReceiptReceived events.
 * @returns                   Array of correlated triples, ordered by liquidation.
 */
export function correlateByCorrelationId(
  liquidatedEvents: LiquidatedEventData[],
  notifiedEvents: LiquidationNotifiedEventData[],
  receiptEvents?: ReceiptReceivedEventData[],
): CorrelatedPair[] {
  // Build lookup maps by correlationId
  const notifiedMap = new Map<string, LiquidationNotifiedEventData>();
  for (const n of notifiedEvents) {
    notifiedMap.set(n.correlationId.toLowerCase(), n);
  }

  const receiptMap = new Map<string, ReceiptReceivedEventData>();
  if (receiptEvents) {
    for (const r of receiptEvents) {
      receiptMap.set(r.correlationId.toLowerCase(), r);
    }
  }

  const pairs: CorrelatedPair[] = [];
  for (const liq of liquidatedEvents) {
    const key = liq.correlationId.toLowerCase();
    const notified = notifiedMap.get(key);
    if (!notified) continue;

    pairs.push({
      correlationId: liq.correlationId,
      borrower: liq.borrower,
      liquidated: liq,
      notified,
      receipt: receiptMap.get(key),
      correlatedAtMs: Date.now(),
    });
  }

  return pairs;
}

/**
 * Legacy: Correlate Liquidated and LiquidationNotified by borrower address + block proximity.
 * Used as fallback for pre-M11 events without correlationId.
 *
 * @param liquidatedEvents   Buffer of Liquidated events.
 * @param notifiedEvents     Buffer of LiquidationNotified events.
 * @param blockTolerance     Max block distance to consider a match (default 2).
 */
export function correlateEvents(
  liquidatedEvents: LiquidatedEventData[],
  notifiedEvents: LiquidationNotifiedEventData[],
  blockTolerance = 2,
): CorrelatedPair[] {
  // If correlationIds are present in both sides, use them
  const hasCorrelationIds =
    liquidatedEvents.every((e) => e.correlationId && e.correlationId !== "0x" + "0".repeat(64)) &&
    notifiedEvents.every((e) => e.correlationId && e.correlationId !== "0x" + "0".repeat(64));

  if (hasCorrelationIds) {
    return correlateByCorrelationId(liquidatedEvents, notifiedEvents);
  }

  // Fall back to block proximity matching
  interface Candidate {
    liqIdx: number;
    notifIdx: number;
    dist: number;
  }

  const candidates: Candidate[] = [];
  for (let li = 0; li < liquidatedEvents.length; li++) {
    const liq = liquidatedEvents[li];
    for (let ni = 0; ni < notifiedEvents.length; ni++) {
      const notif = notifiedEvents[ni];
      if (notif.borrower.toLowerCase() !== liq.borrower.toLowerCase()) continue;
      const dist = Math.abs(Number(notif.blockNumber) - Number(liq.blockNumber));
      if (dist > blockTolerance) continue;
      candidates.push({ liqIdx: li, notifIdx: ni, dist });
    }
  }

  candidates.sort((a, b) => a.dist - b.dist || a.liqIdx - b.liqIdx || a.notifIdx - b.notifIdx);

  const usedLiqIndices = new Set<number>();
  const usedNotifIndices = new Set<number>();
  const assigned: Array<{ liqIdx: number; notifIdx: number }> = [];

  for (const { liqIdx, notifIdx } of candidates) {
    if (usedLiqIndices.has(liqIdx) || usedNotifIndices.has(notifIdx)) continue;
    usedLiqIndices.add(liqIdx);
    usedNotifIndices.add(notifIdx);
    assigned.push({ liqIdx, notifIdx });
  }

  assigned.sort((a, b) => a.liqIdx - b.liqIdx);

  return assigned.map(({ liqIdx, notifIdx }) => ({
    correlationId: liquidatedEvents[liqIdx].correlationId ?? "",
    borrower: liquidatedEvents[liqIdx].borrower,
    liquidated: liquidatedEvents[liqIdx],
    notified: notifiedEvents[notifIdx],
    correlatedAtMs: Date.now(),
  }));
}

/**
 * Formats a correlated pair as a structured JSON log entry.
 */
export function formatLogEntry(pair: CorrelatedPair): CorrelatorLog {
  return {
    correlatedAtMs: pair.correlatedAtMs,
    correlatedAtIso: new Date(pair.correlatedAtMs).toISOString(),
    correlationId: pair.correlationId,
    borrower: pair.borrower,
    liquidatedTx: pair.liquidated.txHash,
    notifiedTx: pair.notified.txHash,
    receiptTx: pair.receipt?.txHash,
    repaid: pair.liquidated.repaid.toString(),
    collateralSeized: pair.liquidated.collateralSeized.toString(),
    blockNumber: pair.liquidated.blockNumber.toString(),
    inboxConfirmed: pair.receipt !== undefined,
  };
}

// ── Address resolver ──────────────────────────────────────────────────────

function resolveAddresses(): {
  lendingEngine: `0x${string}`;
  xcmNotifier: `0x${string}`;
  xcmInbox?: `0x${string}`;
} {
  const envEngine   = process.env["LENDING_ENGINE"]  ?? process.env["LENDING_CORE_V2"];
  const envNotifier = process.env["XCM_NOTIFIER"];
  const envInbox    = process.env["XCM_INBOX"];

  if (envEngine && envNotifier) {
    return {
      lendingEngine: envEngine as `0x${string}`,
      xcmNotifier:   envNotifier as `0x${string}`,
      xcmInbox:      envInbox ? (envInbox as `0x${string}`) : undefined,
    };
  }

  // Fall back to canonical M11 manifest
  const manifestPath = path.resolve(__dirname, "../deployments/deploy-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(JSON.stringify({ error: "No manifest found. Set LENDING_ENGINE and XCM_NOTIFIER env vars." }));
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, string>;
  const engine   = manifest["lendingEngine"];
  const notifier = manifest["xcmLiquidationNotifier"];
  const inbox    = manifest["xcmInbox"];

  if (!engine || !notifier) {
    console.error(JSON.stringify({ error: "Cannot resolve addresses from manifest." }));
    process.exit(1);
  }

  return {
    lendingEngine: engine   as `0x${string}`,
    xcmNotifier:   notifier as `0x${string}`,
    xcmInbox:      inbox    ? (inbox as `0x${string}`) : undefined,
  };
}

// ── Historical query mode ─────────────────────────────────────────────────

async function runHistorical(
  lendingEngine: `0x${string}`,
  xcmNotifier: `0x${string}`,
  xcmInbox: `0x${string}` | undefined,
  fromBlock: bigint,
  toBlock: bigint | "latest",
): Promise<void> {
  const client = createPublicClient({ transport: http(POLKADOT_HUB_TESTNET.rpcUrl) });

  console.error(JSON.stringify({
    status: "historical-query",
    lendingEngine, xcmNotifier, xcmInbox,
    fromBlock: fromBlock.toString(),
    toBlock: typeof toBlock === "bigint" ? toBlock.toString() : toBlock,
    startedAtMs: Date.now(),
  }));

  const [liquidatedLogs, notifiedLogs] = await Promise.all([
    client.getLogs({
      address: lendingEngine,
      event:   LIQUIDATED_EVENT,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: xcmNotifier,
      event:   LIQUIDATION_NOTIFIED_EVENT,
      fromBlock,
      toBlock,
    }),
  ]);

  const receiptLogs = xcmInbox ? await client.getLogs({
    address: xcmInbox,
    event:   RECEIPT_RECEIVED_EVENT,
    fromBlock,
    toBlock,
  }) : [];

  const now = Date.now();

  const liquidatedEvents: LiquidatedEventData[] = liquidatedLogs.map((log) => {
    const args = log.args as {
      borrower: string; liquidator: string; repaid: bigint;
      collateralSeized: bigint; badDebtWrittenOff: bigint; correlationId: string;
    };
    return {
      correlationId: args.correlationId ?? "0x" + "0".repeat(64),
      borrower: args.borrower,
      liquidator: args.liquidator,
      repaid: args.repaid,
      collateralSeized: args.collateralSeized,
      badDebtWrittenOff: args.badDebtWrittenOff,
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash ?? "",
      localTimestampMs: now,
    };
  });

  const notifiedEvents: LiquidationNotifiedEventData[] = notifiedLogs.map((log) => {
    const args = log.args as { borrower: string; debtRepaid: bigint; collateralSeized: bigint; correlationId: string };
    return {
      correlationId: args.correlationId ?? "0x" + "0".repeat(64),
      borrower: args.borrower,
      debtRepaid: args.debtRepaid,
      collateralSeized: args.collateralSeized,
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash ?? "",
      localTimestampMs: now,
    };
  });

  const receiptEvents: ReceiptReceivedEventData[] = receiptLogs.map((log) => {
    const args = log.args as { correlationId: string; sender: string; data: string };
    return {
      correlationId: args.correlationId ?? "0x" + "0".repeat(64),
      sender: args.sender,
      data: args.data,
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash ?? "",
      localTimestampMs: now,
    };
  });

  console.error(JSON.stringify({
    status: "events-fetched",
    liquidatedCount: liquidatedEvents.length,
    notifiedCount: notifiedEvents.length,
    receiptCount: receiptEvents.length,
  }));

  const pairs = correlateByCorrelationId(liquidatedEvents, notifiedEvents, receiptEvents);

  console.error(JSON.stringify({ status: "correlations-found", count: pairs.length }));

  for (const pair of pairs) {
    process.stdout.write(JSON.stringify(formatLogEntry(pair)) + "\n");
  }

  // Save artifacts if output file specified
  const artifactsPath = process.env["ARTIFACTS_OUTPUT"];
  if (artifactsPath && pairs.length > 0) {
    const artifacts = {
      generatedAt: new Date().toISOString(),
      mode: "historical",
      fromBlock: fromBlock.toString(),
      toBlock: typeof toBlock === "bigint" ? toBlock.toString() : toBlock,
      lendingEngine, xcmNotifier, xcmInbox,
      correlationsFound: pairs.length,
      pairs: pairs.map(formatLogEntry),
    };
    fs.writeFileSync(artifactsPath, JSON.stringify(artifacts, null, 2));
    console.error(JSON.stringify({ status: "artifacts-saved", path: artifactsPath }));
  }

  console.error(JSON.stringify({ status: "done", totalCorrelated: pairs.length }));
}

// ── Live subscription mode ────────────────────────────────────────────────

const liquidatedBuffer: LiquidatedEventData[] = [];
const notifiedBuffer:   LiquidationNotifiedEventData[] = [];
const receiptBuffer:    ReceiptReceivedEventData[] = [];
const emittedKeys = new Set<string>();

function correlateAndEmit(): void {
  const pairs = correlateByCorrelationId(liquidatedBuffer, notifiedBuffer, receiptBuffer);
  for (const pair of pairs) {
    const key = `${pair.liquidated.txHash}::${pair.notified.txHash}`;
    if (emittedKeys.has(key)) continue;
    emittedKeys.add(key);
    process.stdout.write(JSON.stringify(formatLogEntry(pair)) + "\n");
  }
}

async function runLive(
  lendingEngine: `0x${string}`,
  xcmNotifier: `0x${string}`,
  xcmInbox: `0x${string}` | undefined,
): Promise<void> {
  const client = createPublicClient({ transport: http(POLKADOT_HUB_TESTNET.rpcUrl) });

  console.error(JSON.stringify({
    status: "starting-live",
    rpc: POLKADOT_HUB_TESTNET.rpcUrl,
    lendingEngine, xcmNotifier, xcmInbox,
    startedAtMs: Date.now(),
  }));

  const unwatch1 = client.watchContractEvent({
    address: lendingEngine,
    abi: [LIQUIDATED_EVENT],
    eventName: "Liquidated",
    onLogs: (logs) => {
      const now = Date.now();
      for (const log of logs) {
        const args = log.args as {
          borrower: string; liquidator: string; repaid: bigint;
          collateralSeized: bigint; badDebtWrittenOff: bigint; correlationId: string;
        };
        liquidatedBuffer.push({
          correlationId: args.correlationId ?? "0x" + "0".repeat(64),
          borrower: args.borrower,
          liquidator: args.liquidator,
          repaid: args.repaid,
          collateralSeized: args.collateralSeized,
          badDebtWrittenOff: args.badDebtWrittenOff,
          blockNumber: log.blockNumber ?? 0n,
          txHash: log.transactionHash ?? "",
          localTimestampMs: now,
        });
        correlateAndEmit();
      }
    },
    onError: (err) => console.error(JSON.stringify({ error: "Liquidated watch error", message: String(err) })),
  });

  const unwatch2 = client.watchContractEvent({
    address: xcmNotifier,
    abi: [LIQUIDATION_NOTIFIED_EVENT],
    eventName: "LiquidationNotified",
    onLogs: (logs) => {
      const now = Date.now();
      for (const log of logs) {
        const args = log.args as { borrower: string; debtRepaid: bigint; collateralSeized: bigint; correlationId: string };
        notifiedBuffer.push({
          correlationId: args.correlationId ?? "0x" + "0".repeat(64),
          borrower: args.borrower,
          debtRepaid: args.debtRepaid,
          collateralSeized: args.collateralSeized,
          blockNumber: log.blockNumber ?? 0n,
          txHash: log.transactionHash ?? "",
          localTimestampMs: now,
        });
        correlateAndEmit();
      }
    },
    onError: (err) => console.error(JSON.stringify({ error: "LiquidationNotified watch error", message: String(err) })),
  });

  // Optionally watch XcmInbox
  let unwatch3: (() => void) | undefined;
  if (xcmInbox) {
    unwatch3 = client.watchContractEvent({
      address: xcmInbox,
      abi: [RECEIPT_RECEIVED_EVENT],
      eventName: "ReceiptReceived",
      onLogs: (logs) => {
        const now = Date.now();
        for (const log of logs) {
          const args = log.args as { correlationId: string; sender: string; data: string };
          receiptBuffer.push({
            correlationId: args.correlationId ?? "0x" + "0".repeat(64),
            sender: args.sender,
            data: args.data,
            blockNumber: log.blockNumber ?? 0n,
            txHash: log.transactionHash ?? "",
            localTimestampMs: now,
          });
          correlateAndEmit();
        }
      },
      onError: (err) => console.error(JSON.stringify({ error: "ReceiptReceived watch error", message: String(err) })),
    });
  }

  console.error(JSON.stringify({ status: "watching", lendingEngine, xcmNotifier, xcmInbox }));

  const cleanup = (): void => {
    console.error(JSON.stringify({ status: "stopping", stoppedAtMs: Date.now() }));
    unwatch1();
    unwatch2();
    unwatch3?.();
    process.exit(0);
  };

  process.on("SIGINT",  cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise<never>(() => {});
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const historical = args.includes("--historical");

  const { lendingEngine, xcmNotifier, xcmInbox } = resolveAddresses();

  if (historical) {
    const fromBlock = BigInt(process.env["FROM_BLOCK"] ?? "0");
    const toBlockEnv = process.env["TO_BLOCK"];
    const toBlock: bigint | "latest" = toBlockEnv ? BigInt(toBlockEnv) : "latest";
    await runHistorical(lendingEngine, xcmNotifier, xcmInbox, fromBlock, toBlock);
  } else {
    await runLive(lendingEngine, xcmNotifier, xcmInbox);
  }
}

if (require.main === module) {
  void main();
}
