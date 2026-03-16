import { expect } from "chai";
import * as liveSmoke from "../../scripts/liveSmoke";

describe("scripts/liveSmoke", () => {
  it("exports main", () => {
    expect(liveSmoke.main).to.be.a("function");
  });
});
