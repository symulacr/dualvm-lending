import { expect } from "chai";
import * as verifyAll from "../../scripts/verifyAll";

describe("scripts/verifyAll", () => {
  it("exports main", () => {
    expect(verifyAll.main).to.be.a("function");
  });
});
