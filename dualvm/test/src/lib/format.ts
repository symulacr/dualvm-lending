import { expect } from "chai";
import { formatAddress, formatTimestamp, formatTokenAmount } from "../../../src/lib/format";

describe("format module", () => {
  it("formats simple values into display-friendly shapes", () => {
    expect(formatAddress("0x1234567890abcdef1234567890abcdef12345678")).to.equal("0x1234…5678");
    expect(formatTokenAmount(1234500000000000000n)).to.equal("1.23");
    expect(formatTimestamp("2026-03-16T00:00:00.000Z")).to.be.a("string").and.to.match(/2026|26|03|3/);
  });
});
