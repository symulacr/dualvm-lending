/**
 * Barrel test: consolidates all src/ module import-safety and basic smoke checks.
 * Replaces individual stub files in test/src/.
 */
import { expect } from "chai";
import { humanizeReadError } from "../src/appCopy";
import { debtPoolAbi, lendingCoreAbi, manualOracleAbi } from "../src/lib/abi";
import { formatAddress, formatTimestamp, formatTokenAmount } from "../src/lib/format";
import { deploymentManifest, hasLivePolkadotHubTestnetDeployment } from "../src/lib/manifest";
import { loadMarketSnapshot } from "../src/lib/readModel";
import { describeRecentActivityWindow, loadRecentActivityFeed } from "../src/lib/readModel/activity";
import { loadMarketSnapshot as loadMarketSnapshotDirect } from "../src/lib/readModel/marketSnapshot";
import { loadObserverSnapshot } from "../src/lib/readModel/observer";
import * as readModelTypes from "../src/lib/readModel/types";
import { formatRecentActivityWindow, isRecentActivity, parseFallbackRecentActivity } from "../src/lib/recentActivity";

describe("src barrel", () => {
  it("appCopy: humanizes rate-limit errors", () => {
    expect(humanizeReadError("HTTP 429 from public RPC")).to.include("rate-limited");
  });

  it("abi: exports non-empty ABI arrays", () => {
    expect(debtPoolAbi).to.not.be.empty;
    expect(lendingCoreAbi).to.not.be.empty;
    expect(manualOracleAbi).to.not.be.empty;
  });

  it("format: formats addresses, token amounts, timestamps", () => {
    expect(formatAddress("0x1234567890abcdef1234567890abcdef12345678")).to.equal("0x1234…5678");
    expect(formatTokenAmount(1234500000000000000n)).to.equal("1.23");
    expect(formatTimestamp("2026-03-16T00:00:00.000Z")).to.be.a("string").and.to.match(/2026|26|03|3/);
  });

  it("manifest: exports live Polkadot Hub Testnet manifest", () => {
    expect(deploymentManifest.networkName).to.equal("polkadotHubTestnet");
    expect(hasLivePolkadotHubTestnetDeployment).to.equal(true);
  });

  it("readModel: exports function-type helpers", () => {
    for (const fn of [loadMarketSnapshot, loadMarketSnapshotDirect, loadObserverSnapshot, describeRecentActivityWindow, loadRecentActivityFeed]) {
      expect(fn).to.be.a("function");
    }
    expect(readModelTypes).to.be.an("object");
  });

  it("recentActivity: parses and formats snapshots", () => {
    expect(isRecentActivity).to.be.a("function");
    expect(parseFallbackRecentActivity).to.be.a("function");
    expect(formatRecentActivityWindow).to.be.a("function");
    const parsed = parseFallbackRecentActivity({
      generatedAt: "2026-03-16T00:00:00.000Z", fromBlock: 1, toBlock: 2,
      items: [{ label: "Borrowed", detail: "demo", txHash: "0xabc", blockNumber: "2" }],
    });
    expect(parsed.fromBlock).to.equal("1");
    expect(parsed.toBlock).to.equal("2");
    expect(parsed.items).to.have.length(1);
    expect(formatRecentActivityWindow(parsed.fromBlock, parsed.toBlock)).to.equal("Blocks 1 → 2");
  });
});
