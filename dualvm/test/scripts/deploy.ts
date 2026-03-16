import { expect } from "chai";
import * as deploy from "../../scripts/deploy";

describe("scripts/deploy", () => {
  it("exports main", () => {
    expect(deploy.main).to.be.a("function");
  });
});
