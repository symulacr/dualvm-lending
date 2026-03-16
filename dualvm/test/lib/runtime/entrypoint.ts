import { expect } from "chai";
import { isDirectExecution, runEntrypoint } from "../../../lib/runtime/entrypoint";

describe("lib/runtime/entrypoint", () => {
  it("exports entrypoint helpers", () => {
    expect(isDirectExecution).to.be.a("function");
    expect(runEntrypoint).to.be.a("function");
  });
});
