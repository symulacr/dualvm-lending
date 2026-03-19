/**
 * event-correlator.ts
 *
 * Subscribes to LendingCoreV2.Liquidated and XcmLiquidationNotifier.LiquidationNotified
 * events using viem, correlates them by borrower address + block number (within a
 * configurable block tolerance), and writes structured JSON log entries with
 * ms-resolution local timestamps to stdout.
 *
 * Usage:
 *   LENDING_CORE_V2=0x... XCM_NOTIFIER=0x... npx ts-node scripts/event-correlator.ts
 *
 * Or with defaults from the canonical manifest:
 *   npx ts-node scripts/event-correlator.ts
 *
 * Output (one JSON object per line, stdout):
 *   { correlatedAtMs, correlatedAtIso, borrower, blockNumber, liquidatedTx, notifiedTx, repaid, collateralSeized }
 *
 * Status/error messages go to stderr.
 */

import { createPublicClient, http, parseAbiItem } from "viem";
import * as fs from "node:fs";
import * as path from "node:path";
import { POLKADOT_HUB_TESTNET } from "../lib/config/marketConfig";

// ── ABI fragments ─────────────────────────────────────────────────────────

const LIQUIDATED_EVENT = parseAbiItem(
  "event Liquidated(address indexed borrower, address indexed liquidator, uint256 repaid, uint256 collateralSeized, uint256 badDebtWrittenOff)",
);

const LIQUIDATION_NOTIFIED_EVENT = parseAbiItem(
  "event LiquidationNotified(address indexed borrower, uint256 debtRepaid, uint256 collateralSeized)",
);

// ── Types ─────────────────────────────────────────────────────────────────

export interface LiquidatedEventData {
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
  borrower: string;
  debtRepaid: bigint;
  collateralSeized: bigint;
  blockNumber: bigint;
  txHash: string;
  localTimestampMs: number;
}

export interface CorrelatedPair {
  borrower: string;
  blockNumber: bigint;
  liquidated: LiquidatedEventData;
  notified: LiquidationNotifiedEventData;
  correlatedAtMs: number;
}

export interface CorrelatorLog {
  correlatedAtMs: number;
  correlatedAtIso: string;
  borrower: string;
  blockNumber: string;
  liquidatedTx: string;
  notifiedTx: string;
  repaid: string;
  collateralSeized: string;
}

// ── Pure correlation logic (exported for testing) ─────────────────────────

/**
 * Correlates Liquidated and LiquidationNotified events by borrower address and
 * block number. Matched pairs are returned; each event is matched at most once.
 *
 * Algorithm: build every candidate (liq, notif) pair within tolerance, sort by
 * ascending block distance (then by original liq index for stable tie-breaking),
 * and greedily assign the closest matches first.  This ensures that when the same
 * borrower is liquidated multiple times in nearby blocks the pairing favours the
 * exact/nearest block match rather than the first event encountered.
 *
 * Example: Liquidated(Alice@100), Liquidated(Alice@101), LiquidationNotified(Alice@101)
 * → the notification is assigned to Liquidated@101 (distance=0), not Liquidated@100
 *   (distance=1).
 *
 * @param liquidatedEvents   Buffer of Liquidated events received.
 * @param notifiedEvents     Buffer of LiquidationNotified events received.
 * @param blockTolerance     Maximum block-number difference to consider a match (default 2).
 * @returns                  Array of correlated pairs ordered by original liquidated index.
 */
export function correlateEvents(
  liquidatedEvents: LiquidatedEventData[],
  notifiedEvents: LiquidationNotifiedEventData[],
  blockTolerance = 2,
): CorrelatedPair[] {
  // Step 1: collect all candidate (liqIdx, notifIdx, dist) triples within tolerance.
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

  // Step 2: sort by distance ascending; break ties by liqIdx then notifIdx (stable FIFO).
  candidates.sort((a, b) => a.dist - b.dist || a.liqIdx - b.liqIdx || a.notifIdx - b.notifIdx);

  // Step 3: greedy assignment — closest pair wins, each event used at most once.
  const usedLiqIndices = new Set<number>();
  const usedNotifIndices = new Set<number>();
  const assigned: Array<{ liqIdx: number; notifIdx: number }> = [];

  for (const { liqIdx, notifIdx } of candidates) {
    if (usedLiqIndices.has(liqIdx) || usedNotifIndices.has(notifIdx)) continue;
    usedLiqIndices.add(liqIdx);
    usedNotifIndices.add(notifIdx);
    assigned.push({ liqIdx, notifIdx });
  }

  // Step 4: restore original liquidated-event order and build result pairs.
  assigned.sort((a, b) => a.liqIdx - b.liqIdx);

  return assigned.map(({ liqIdx, notifIdx }) => ({
    borrower: liquidatedEvents[liqIdx].borrower,
    blockNumber: liquidatedEvents[liqIdx].blockNumber,
    liquidated: liquidatedEvents[liqIdx],
    notified: notifiedEvents[notifIdx],
    correlatedAtMs: Date.now(),
  }));
}

/**
 * Formats a correlated pair as a structured JSON log entry with ms-resolution timestamp.
 */
export function formatLogEntry(pair: CorrelatedPair): CorrelatorLog {
  return {
    correlatedAtMs: pair.correlatedAtMs,
    correlatedAtIso: new Date(pair.correlatedAtMs).toISOString(),
    borrower: pair.borrower,
    blockNumber: pair.blockNumber.toString(),
    liquidatedTx: pair.liquidated.txHash,
    notifiedTx: pair.notified.txHash,
    repaid: pair.liquidated.repaid.toString(),
    collateralSeized: pair.liquidated.collateralSeized.toString(),
  };
}

// ── Runtime (standalone only) ─────────────────────────────────────────────

/** Resolve contract addresses from env or canonical manifest. */
function resolveAddresses(): { lendingCoreV2: `0x${string}`; xcmNotifier: `0x${string}` } {
  const envCore = process.env["LENDING_CORE_V2"];
  const envNotifier = process.env["XCM_NOTIFIER"];

  if (envCore && envNotifier) {
    return { lendingCoreV2: envCore as `0x${string}`, xcmNotifier: envNotifier as `0x${string}` };
  }

  // Fall back to canonical manifest
  const manifestPath = path.resolve(__dirname, "../deployments/polkadot-hub-testnet-v2-contracts.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(JSON.stringify({ error: "No manifest found. Set LENDING_CORE_V2 and XCM_NOTIFIER env vars." }));
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    contracts: { lendingCoreV2: { address: string }; [k: string]: unknown };
  };
  const coreAddress = manifest.contracts.lendingCoreV2?.address;
  // XcmLiquidationNotifier stored as liquidationNotifier on lendingCoreV2 entry
  const notifierAddress = (manifest.contracts.lendingCoreV2 as { liquidationNotifier?: string })?.liquidationNotifier;

  if (!coreAddress || !notifierAddress) {
    console.error(JSON.stringify({ error: "Cannot resolve addresses from manifest. Set LENDING_CORE_V2 and XCM_NOTIFIER env vars." }));
    process.exit(1);
  }

  return { lendingCoreV2: coreAddress as `0x${string}`, xcmNotifier: notifierAddress as `0x${string}` };
}

const liquidatedBuffer: LiquidatedEventData[] = [];
const notifiedBuffer: LiquidationNotifiedEventData[] = [];
const emittedTxPairs = new Set<string>(); // prevent duplicate output on re-polls

function correlateAndEmit(): void {
  const pairs = correlateEvents(liquidatedBuffer, notifiedBuffer);
  for (const pair of pairs) {
    const key = `${pair.liquidated.txHash}::${pair.notified.txHash}`;
    if (emittedTxPairs.has(key)) continue;
    emittedTxPairs.add(key);
    process.stdout.write(JSON.stringify(formatLogEntry(pair)) + "\n");
  }
}

async function main(): Promise<void> {
  const { lendingCoreV2, xcmNotifier } = resolveAddresses();

  const client = createPublicClient({
    transport: http(POLKADOT_HUB_TESTNET.rpcUrl),
  });

  console.error(
    JSON.stringify({
      status: "starting",
      rpc: POLKADOT_HUB_TESTNET.rpcUrl,
      lendingCoreV2,
      xcmNotifier,
      startedAtMs: Date.now(),
    }),
  );

  const unwatch1 = client.watchContractEvent({
    address: lendingCoreV2,
    abi: [LIQUIDATED_EVENT],
    eventName: "Liquidated",
    onLogs: (logs) => {
      const now = Date.now();
      for (const log of logs) {
        const args = log.args as {
          borrower: string;
          liquidator: string;
          repaid: bigint;
          collateralSeized: bigint;
          badDebtWrittenOff: bigint;
        };
        liquidatedBuffer.push({
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
    onError: (err) => {
      console.error(JSON.stringify({ error: "Liquidated watch error", message: String(err) }));
    },
  });

  const unwatch2 = client.watchContractEvent({
    address: xcmNotifier,
    abi: [LIQUIDATION_NOTIFIED_EVENT],
    eventName: "LiquidationNotified",
    onLogs: (logs) => {
      const now = Date.now();
      for (const log of logs) {
        const args = log.args as {
          borrower: string;
          debtRepaid: bigint;
          collateralSeized: bigint;
        };
        notifiedBuffer.push({
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
    onError: (err) => {
      console.error(JSON.stringify({ error: "LiquidationNotified watch error", message: String(err) }));
    },
  });

  console.error(JSON.stringify({ status: "watching", lendingCoreV2, xcmNotifier }));

  const cleanup = (): void => {
    console.error(JSON.stringify({ status: "stopping", stoppedAtMs: Date.now() }));
    unwatch1();
    unwatch2();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Run until terminated
  await new Promise<never>(() => {});
}

// Run when executed directly (CommonJS entry point guard)
if (require.main === module) {
  void main();
}
