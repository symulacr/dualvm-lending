import { expect } from "chai";
import { formatWad, waitForCondition, waitForTransaction } from "../../../lib/runtime/transactions";

describe("lib/runtime/transactions", () => {
  it("exports transaction helpers", () => {
    expect(formatWad).to.be.a("function");
    expect(waitForTransaction).to.be.a("function");
    expect(waitForCondition).to.be.a("function");
  });
});
