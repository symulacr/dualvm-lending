import { expect } from "chai";
import * as liveMinterSmoke from "../../scripts/liveMinterSmoke";

describe("scripts/liveMinterSmoke", () => {
  it("exports main", () => {
    expect(liveMinterSmoke.main).to.be.a("function");
  });
});
