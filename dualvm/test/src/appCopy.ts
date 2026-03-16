import { expect } from "chai";
import {
  demoModeNotes,
  humanizeReadError,
  judgeFlow,
  scopeGuardrails,
  writePathTruth,
} from "../../src/appCopy";

describe("appCopy module", () => {
  it("exports the frontend copy arrays and humanizes a rate-limit error", () => {
    expect(judgeFlow).to.be.an("array").and.to.not.be.empty;
    expect(scopeGuardrails).to.be.an("array").and.to.not.be.empty;
    expect(demoModeNotes).to.be.an("array").and.to.not.be.empty;
    expect(writePathTruth).to.be.an("array").and.to.not.be.empty;
    expect(humanizeReadError("HTTP 429 from public RPC")).to.include("rate-limited");
  });
});
