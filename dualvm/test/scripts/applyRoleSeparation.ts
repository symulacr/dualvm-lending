import { expect } from "chai";
import * as applyRoleSeparation from "../../scripts/applyRoleSeparation";

describe("applyRoleSeparation script", () => {
  it("exports main", () => {
    expect(applyRoleSeparation.main).to.be.a("function");
  });
});
