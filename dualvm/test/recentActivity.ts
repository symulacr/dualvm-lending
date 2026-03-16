import { expect } from "chai";
import { formatRecentActivityWindow, parseFallbackRecentActivity } from "../src/lib/recentActivity";

describe("recent activity helpers", () => {
  it("parses fallback snapshots into normalized strings", () => {
    const parsed = parseFallbackRecentActivity({
      generatedAt: "2026-03-16T00:00:00.000Z",
      fromBlock: 100,
      toBlock: 120,
      items: [
        {
          label: "Borrowed",
          detail: "0x1234 borrowed 5.00 USDC-test",
          txHash: "0xabc",
          blockNumber: "119",
        },
      ],
    });

    expect(parsed.fromBlock).to.equal("100");
    expect(parsed.toBlock).to.equal("120");
    expect(parsed.items).to.have.length(1);
  });

  it("rejects malformed fallback snapshots", () => {
    expect(() => parseFallbackRecentActivity({ generatedAt: "2026-03-16T00:00:00.000Z", fromBlock: 100, toBlock: 120, items: [{}] })).to.throw(
      "Recent-events snapshot contains invalid activity rows",
    );
  });

  it("formats recent activity windows consistently", () => {
    expect(formatRecentActivityWindow("100", "120")).to.equal("Blocks 100 → 120");
  });
});
