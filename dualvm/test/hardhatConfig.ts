import { expect } from "chai";
import defaultConfig, { buildAccounts, createHardhatConfig } from "../hardhat.config";

describe("hardhat config", () => {
  it("builds accounts from PRIVATE_KEY", () => {
    expect(buildAccounts({ PRIVATE_KEY: "0xabc" } as NodeJS.ProcessEnv)).to.deep.equal(["0xabc"]);
    expect(buildAccounts({} as NodeJS.ProcessEnv)).to.deep.equal([]);
  });

  it("creates config with environment overrides", () => {
    const config = createHardhatConfig({
      PRIVATE_KEY: "0xabc",
      POLKADOT_HUB_TESTNET_RPC_URL: "https://example-rpc",
      POLKADOT_HUB_TESTNET_RPC_FALLBACK_URL: "https://example-fallback",
      BLOCKSCOUT_API_KEY: "key",
    } as NodeJS.ProcessEnv);

    expect(config.networks?.polkadotHubTestnet).to.deep.include({ url: "https://example-rpc", chainId: 420420417 });
    expect(config.networks?.polkadotHubTestnetFallback).to.deep.include({ url: "https://example-fallback", chainId: 420420417 });
  });

  it("exports the default config", () => {
    expect(defaultConfig.networks?.polkadotHubTestnet).to.not.equal(undefined);
  });
});
