import { expect } from "chai";
import * as liveRepaySmoke from "../../scripts/liveRepaySmoke";

describe("scripts/liveRepaySmoke", () => {
  it("exports main", () => {
    expect(liveRepaySmoke.main).to.be.a("function");
  });
});
