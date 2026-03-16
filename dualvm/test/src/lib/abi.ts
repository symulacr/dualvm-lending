import { expect } from "chai";
import { debtPoolAbi, lendingCoreAbi, manualOracleAbi } from "../../../src/lib/abi";

describe("abi module", () => {
  it("exports non-empty ABI arrays", () => {
    expect(debtPoolAbi).to.not.be.empty;
    expect(lendingCoreAbi).to.not.be.empty;
    expect(manualOracleAbi).to.not.be.empty;
  });
});
