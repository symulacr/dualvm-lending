import { expect } from "chai";
import * as liveLiquidationSmoke from "../../scripts/liveLiquidationSmoke";

describe("liveLiquidationSmoke script", () => {
  it("exports main", () => {
    expect(liveLiquidationSmoke.main).to.be.a("function");
  });
});
