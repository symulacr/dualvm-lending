import { expect } from "chai";
import * as liveOracleSmoke from "../../scripts/liveOracleSmoke";

describe("liveOracleSmoke script", () => {
  it("exports main", () => {
    expect(liveOracleSmoke.main).to.be.a("function");
  });
});
