import { expect } from "chai";
import { buildAccounts, createHardhatConfig } from "../hardhat.config";

describe("hardhat.config", () => {
  it("exports config helpers", () => {
    expect(buildAccounts).to.be.a("function");
    expect(createHardhatConfig).to.be.a("function");
  });
});
