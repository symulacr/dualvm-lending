import { expect } from "chai";
import { managedMintUsdc, managedSetOracle } from "../../../lib/ops/managedAccess";

describe("lib/ops/managedAccess", () => {
  it("exports managed access helpers", () => {
    expect(managedMintUsdc).to.be.a("function");
    expect(managedSetOracle).to.be.a("function");
  });
});
