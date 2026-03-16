import { expect } from "chai";
import * as upgradeOracle from "../../scripts/upgradeOracle";

describe("upgradeOracle script", () => {
  it("exports main", () => {
    expect(upgradeOracle.main).to.be.a("function");
  });
});
