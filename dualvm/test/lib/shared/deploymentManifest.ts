import { expect } from "chai";
import { parseDeploymentManifest } from "../../../lib/shared/deploymentManifest";

describe("lib/shared/deploymentManifest", () => {
  it("exports parseDeploymentManifest", () => {
    expect(parseDeploymentManifest).to.be.a("function");
  });
});
