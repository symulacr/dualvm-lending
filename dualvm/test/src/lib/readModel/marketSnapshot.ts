import { expect } from "chai";
import { loadMarketSnapshot } from "../../../../src/lib/readModel/marketSnapshot";

describe("readModel/marketSnapshot module", () => {
  it("exports loadMarketSnapshot", () => {
    expect(loadMarketSnapshot).to.be.a("function");
  });
});
