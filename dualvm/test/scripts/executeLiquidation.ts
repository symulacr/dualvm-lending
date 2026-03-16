import { expect } from "chai";
import * as executeLiquidation from "../../scripts/executeLiquidation";

describe("scripts/executeLiquidation", () => {
  it("exports main", () => {
    expect(executeLiquidation.main).to.be.a("function");
  });
});
