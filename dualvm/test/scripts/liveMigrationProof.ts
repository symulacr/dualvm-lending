import { expect } from "chai";
import * as liveMigrationProof from "../../scripts/liveMigrationProof";

describe("liveMigrationProof script", () => {
  it("exports main", () => {
    expect(liveMigrationProof.main).to.be.a("function");
  });
});
