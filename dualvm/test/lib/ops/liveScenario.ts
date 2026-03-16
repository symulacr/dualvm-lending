import { expect } from "chai";
import { openBorrowPosition, seedDebtPoolLiquidity, waitForDebtToAccrue } from "../../../lib/ops/liveScenario";

describe("lib/ops/liveScenario", () => {
  it("exports live scenario helpers", () => {
    expect(seedDebtPoolLiquidity).to.be.a("function");
    expect(openBorrowPosition).to.be.a("function");
    expect(waitForDebtToAccrue).to.be.a("function");
  });
});
