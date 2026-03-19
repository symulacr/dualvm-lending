import { expect } from "chai";
import {
  correlateEvents,
  formatLogEntry,
  type LiquidatedEventData,
  type LiquidationNotifiedEventData,
  type CorrelatedPair,
} from "../scripts/event-correlator";

/**
 * Unit tests for the event-correlator correlation logic.
 *
 * These tests exercise the pure correlateEvents() and formatLogEntry()
 * functions using mocked event data — no viem, no RPC, no contract deployment.
 *
 * Run: cd dualvm && npm test -- --grep "event-correlator"
 */
describe("event-correlator", function () {
  // ── Shared helpers ────────────────────────────────────────────────────────

  const ALICE = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
  const BOB = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
  const LIQUIDATOR = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";

  const TX_LIQ_ALICE = "0xaaaa000000000000000000000000000000000000000000000000000000000001";
  const TX_NOTIF_ALICE = "0xaaaa000000000000000000000000000000000000000000000000000000000002";
  const TX_LIQ_BOB = "0xbbbb000000000000000000000000000000000000000000000000000000000001";
  const TX_NOTIF_BOB = "0xbbbb000000000000000000000000000000000000000000000000000000000002";

  const WAD = 10n ** 18n;
  const BLOCK_100 = 100n;

  function makeLiquidated(overrides: Partial<LiquidatedEventData> = {}): LiquidatedEventData {
    return {
      borrower: ALICE,
      liquidator: LIQUIDATOR,
      repaid: 500n * WAD,
      collateralSeized: 550n * WAD,
      badDebtWrittenOff: 0n,
      blockNumber: BLOCK_100,
      txHash: TX_LIQ_ALICE,
      localTimestampMs: 1_700_000_000_000,
      ...overrides,
    };
  }

  function makeNotified(overrides: Partial<LiquidationNotifiedEventData> = {}): LiquidationNotifiedEventData {
    return {
      borrower: ALICE,
      debtRepaid: 500n * WAD,
      collateralSeized: 550n * WAD,
      blockNumber: BLOCK_100,
      txHash: TX_NOTIF_ALICE,
      localTimestampMs: 1_700_000_000_050,
      ...overrides,
    };
  }

  // ── correlateEvents: basic matching ──────────────────────────────────────

  it("returns empty array when both buffers are empty", function () {
    const pairs = correlateEvents([], []);
    expect(pairs).to.deep.equal([]);
  });

  it("returns empty array when Liquidated buffer is empty", function () {
    const pairs = correlateEvents([], [makeNotified()]);
    expect(pairs).to.deep.equal([]);
  });

  it("returns empty array when LiquidationNotified buffer is empty", function () {
    const pairs = correlateEvents([makeLiquidated()], []);
    expect(pairs).to.deep.equal([]);
  });

  it("correlates matching borrower + exact block", function () {
    const liq = makeLiquidated();
    const notif = makeNotified();

    const pairs = correlateEvents([liq], [notif]);

    expect(pairs).to.have.length(1);
    expect(pairs[0].borrower).to.equal(ALICE);
    expect(pairs[0].blockNumber).to.equal(BLOCK_100);
    expect(pairs[0].liquidated).to.deep.equal(liq);
    expect(pairs[0].notified).to.deep.equal(notif);
  });

  it("is case-insensitive on borrower address", function () {
    const liq = makeLiquidated({ borrower: ALICE.toLowerCase() });
    const notif = makeNotified({ borrower: ALICE.toUpperCase() });

    const pairs = correlateEvents([liq], [notif]);
    expect(pairs).to.have.length(1);
  });

  it("does not correlate when borrower addresses differ", function () {
    const liq = makeLiquidated({ borrower: ALICE });
    const notif = makeNotified({ borrower: BOB });

    const pairs = correlateEvents([liq], [notif]);
    expect(pairs).to.have.length(0);
  });

  // ── correlateEvents: block tolerance ────────────────────────────────────

  it("correlates when LiquidationNotified is 1 block after Liquidated (within default tolerance)", function () {
    const liq = makeLiquidated({ blockNumber: 100n });
    const notif = makeNotified({ blockNumber: 101n });

    const pairs = correlateEvents([liq], [notif]);
    expect(pairs).to.have.length(1);
  });

  it("correlates when LiquidationNotified is 2 blocks after Liquidated (at default tolerance)", function () {
    const liq = makeLiquidated({ blockNumber: 100n });
    const notif = makeNotified({ blockNumber: 102n });

    const pairs = correlateEvents([liq], [notif]);
    expect(pairs).to.have.length(1);
  });

  it("does NOT correlate when block gap exceeds default tolerance of 2", function () {
    const liq = makeLiquidated({ blockNumber: 100n });
    const notif = makeNotified({ blockNumber: 103n });

    const pairs = correlateEvents([liq], [notif]);
    expect(pairs).to.have.length(0);
  });

  it("respects a custom blockTolerance parameter", function () {
    const liq = makeLiquidated({ blockNumber: 100n });
    const notif = makeNotified({ blockNumber: 110n });

    const strictPairs = correlateEvents([liq], [notif], 5);
    expect(strictPairs).to.have.length(0);

    const loosePairs = correlateEvents([liq], [notif], 15);
    expect(loosePairs).to.have.length(1);
  });

  // ── correlateEvents: multi-borrower ─────────────────────────────────────

  it("correlates two independent borrowers in the same batch", function () {
    const liqAlice = makeLiquidated({ borrower: ALICE, txHash: TX_LIQ_ALICE });
    const liqBob = makeLiquidated({ borrower: BOB, txHash: TX_LIQ_BOB });
    const notifAlice = makeNotified({ borrower: ALICE, txHash: TX_NOTIF_ALICE });
    const notifBob = makeNotified({ borrower: BOB, txHash: TX_NOTIF_BOB });

    const pairs = correlateEvents([liqAlice, liqBob], [notifAlice, notifBob]);

    expect(pairs).to.have.length(2);
    const borrowers = pairs.map((p) => p.borrower.toLowerCase());
    expect(borrowers).to.include(ALICE.toLowerCase());
    expect(borrowers).to.include(BOB.toLowerCase());
  });

  it("correlates only matching borrower when other borrower has no notification", function () {
    const liqAlice = makeLiquidated({ borrower: ALICE });
    const liqBob = makeLiquidated({ borrower: BOB, txHash: TX_LIQ_BOB });
    // Only Alice has a matching notification
    const notifAlice = makeNotified({ borrower: ALICE });

    const pairs = correlateEvents([liqAlice, liqBob], [notifAlice]);

    expect(pairs).to.have.length(1);
    expect(pairs[0].borrower.toLowerCase()).to.equal(ALICE.toLowerCase());
  });

  // ── correlateEvents: each notified event used at most once ───────────────

  it("does not match the same LiquidationNotified event to two different Liquidated events", function () {
    // Two Liquidated events for Alice, but only one LiquidationNotified
    const liq1 = makeLiquidated({ txHash: TX_LIQ_ALICE });
    const liq2 = makeLiquidated({ txHash: TX_LIQ_BOB });
    const notif = makeNotified();

    const pairs = correlateEvents([liq1, liq2], [notif]);

    // Only one match allowed
    expect(pairs).to.have.length(1);
  });

  // ── correlateEvents: output fields ──────────────────────────────────────

  it("preserves correlatedAtMs as a number in the result", function () {
    const pairs = correlateEvents([makeLiquidated()], [makeNotified()]);
    expect(pairs[0].correlatedAtMs).to.be.a("number");
    expect(pairs[0].correlatedAtMs).to.be.greaterThan(0);
  });

  // ── formatLogEntry ──────────────────────────────────────────────────────

  it("produces JSON log with all required fields and ms-resolution timestamp", function () {
    const now = Date.now();
    const pair: CorrelatedPair = {
      borrower: ALICE,
      blockNumber: BLOCK_100,
      correlatedAtMs: now,
      liquidated: makeLiquidated(),
      notified: makeNotified(),
    };

    const entry = formatLogEntry(pair);

    expect(entry.correlatedAtMs).to.equal(now);
    expect(entry.correlatedAtIso).to.be.a("string");
    // ISO string encodes ms precision (e.g. "2024-01-01T00:00:00.000Z")
    expect(entry.correlatedAtIso).to.match(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(entry.borrower).to.equal(ALICE);
    expect(entry.blockNumber).to.equal("100");
    expect(entry.liquidatedTx).to.equal(TX_LIQ_ALICE);
    expect(entry.notifiedTx).to.equal(TX_NOTIF_ALICE);
    expect(entry.repaid).to.equal((500n * WAD).toString());
    expect(entry.collateralSeized).to.equal((550n * WAD).toString());
  });

  it("serialises bigint fields as decimal strings (JSON-safe)", function () {
    const pair: CorrelatedPair = {
      borrower: ALICE,
      blockNumber: BLOCK_100,
      correlatedAtMs: 1_700_000_000_000,
      liquidated: makeLiquidated({ repaid: 123456789012345678901234567890n }),
      notified: makeNotified(),
    };

    const entry = formatLogEntry(pair);
    // Must be representable as a string — not truncated by JS number precision
    expect(entry.repaid).to.equal("123456789012345678901234567890");
    expect(() => JSON.stringify(entry)).not.to.throw();
  });
});
