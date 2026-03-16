import { expect } from "chai";
import { loadDeploymentManifest } from "../../../lib/deployment/manifestStore";

describe("lib/deployment/manifestStore", () => {
  it("exports loadDeploymentManifest", () => {
    expect(loadDeploymentManifest).to.be.a("function");
  });
});
