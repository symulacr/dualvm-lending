import { expect } from "chai";
import { loadMarketSnapshot } from "../../../src/lib/readModel";

describe("readModel module", () => {
  it("exports loadMarketSnapshot", () => {
    expect(loadMarketSnapshot).to.be.a("function");
  });
});
