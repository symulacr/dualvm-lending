import { expect } from "chai";
import { managedActivateVersion, managedMintUsdc, managedRegisterVersion } from "../../../lib/ops/managedAccess";

describe("lib/ops/managedAccess", () => {
  it("exports managed access helpers", () => {
    expect(managedMintUsdc).to.be.a("function");
    expect(managedRegisterVersion).to.be.a("function");
    expect(managedActivateVersion).to.be.a("function");
  });
});
