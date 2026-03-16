import { expect } from "chai";
import * as liveRiskAdminSmoke from "../../scripts/liveRiskAdminSmoke";

describe("liveRiskAdminSmoke script", () => {
  it("exports main", () => {
    expect(liveRiskAdminSmoke.main).to.be.a("function");
  });
});
