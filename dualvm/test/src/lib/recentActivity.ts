import { expect } from "chai";
import {
  formatRecentActivityWindow,
  isRecentActivity,
  parseFallbackRecentActivity,
} from "../../../src/lib/recentActivity";

describe("recentActivity module", () => {
  it("exports parsers and formatters and parses a basic snapshot", () => {
    expect(isRecentActivity).to.be.a("function");
    expect(parseFallbackRecentActivity).to.be.a("function");
    expect(formatRecentActivityWindow).to.be.a("function");

    const parsed = parseFallbackRecentActivity({
      generatedAt: "2026-03-16T00:00:00.000Z",
      fromBlock: 1,
      toBlock: 2,
      items: [{ label: "Borrowed", detail: "demo", txHash: "0xabc", blockNumber: "2" }],
    });

    expect(parsed.fromBlock).to.equal("1");
    expect(parsed.toBlock).to.equal("2");
    expect(parsed.items).to.have.length(1);
    expect(formatRecentActivityWindow(parsed.fromBlock, parsed.toBlock)).to.equal("Blocks 1 → 2");
  });
});
