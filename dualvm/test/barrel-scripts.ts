/**
 * Barrel test: consolidates all script entrypoint import-safety checks.
 * Replaces individual stub files in test/scripts/, test/scriptImports.ts, test/hardhatConfigExports.ts, test/hardhatConfig.ts.
 */
import { expect } from "chai";
import defaultConfig, { buildAccounts, createHardhatConfig } from "../hardhat.config";
import * as applyRoleSeparation from "../scripts/applyRoleSeparation";
import * as deploy from "../scripts/deploy";
import * as executeLiquidation from "../scripts/executeLiquidation";
import * as liveGovernedLiquidationSmoke from "../scripts/liveGovernedLiquidationSmoke";
import * as liveLiquidationSmoke from "../scripts/liveLiquidationSmoke";
import * as liveMigrationProof from "../scripts/liveMigrationProof";
import * as liveMinterSmoke from "../scripts/liveMinterSmoke";
import * as liveOracleSmoke from "../scripts/liveOracleSmoke";
import * as liveRepaySmoke from "../scripts/liveRepaySmoke";
import * as liveRiskAdminSmoke from "../scripts/liveRiskAdminSmoke";
import * as liveSmoke from "../scripts/liveSmoke";
import * as upgradeOracle from "../scripts/upgradeOracle";
import * as verifyAll from "../scripts/verifyAll";

describe("script barrel", () => {
  it("all scripts export import-safe main functions", () => {
    for (const mod of [applyRoleSeparation, deploy, executeLiquidation, liveGovernedLiquidationSmoke,
      liveLiquidationSmoke, liveMigrationProof, liveMinterSmoke, liveOracleSmoke,
      liveRepaySmoke, liveRiskAdminSmoke, liveSmoke, upgradeOracle, verifyAll]) {
      expect(mod.main).to.be.a("function");
    }
  });

  it("hardhat config: exports helpers and builds accounts", () => {
    expect(buildAccounts).to.be.a("function");
    expect(createHardhatConfig).to.be.a("function");
    expect(buildAccounts({ PRIVATE_KEY: "0xabc" } as NodeJS.ProcessEnv)).to.deep.equal(["0xabc"]);
    expect(buildAccounts({} as NodeJS.ProcessEnv)).to.deep.equal([]);
  });

  it("hardhat config: creates config with environment overrides", () => {
    const config = createHardhatConfig({
      PRIVATE_KEY: "0xabc", POLKADOT_HUB_TESTNET_RPC_URL: "https://example-rpc",
      POLKADOT_HUB_TESTNET_RPC_FALLBACK_URL: "https://example-fallback", BLOCKSCOUT_API_KEY: "key",
    } as NodeJS.ProcessEnv);
    expect(config.networks?.polkadotHubTestnet).to.deep.include({ url: "https://example-rpc", chainId: 420420417 });
    expect(config.networks?.polkadotHubTestnetFallback).to.deep.include({ url: "https://example-fallback", chainId: 420420417 });
    expect(defaultConfig.networks?.polkadotHubTestnet).to.not.equal(undefined);
  });
});
