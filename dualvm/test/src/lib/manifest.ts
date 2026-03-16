import { expect } from "chai";
import { deploymentManifest, hasLivePolkadotHubTestnetDeployment } from "../../../src/lib/manifest";

describe("manifest module", () => {
  it("exports the live Polkadot Hub Testnet manifest", () => {
    expect(deploymentManifest.networkName).to.equal("polkadotHubTestnet");
    expect(hasLivePolkadotHubTestnetDeployment).to.equal(true);
  });
});
