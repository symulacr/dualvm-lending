import { expect } from "chai";
import { assetRegistry } from "../../../src/lib/assetRegistry";

describe("assetRegistry module", () => {
  it("includes the expected asset symbols", () => {
    const symbols = assetRegistry.map((asset) => asset.symbol);

    expect(symbols).to.include("WPAS");
    expect(symbols).to.include("USDC-test");
  });
});
