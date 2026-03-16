import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";
import { deployDualVmSystem } from "../lib/deployment/deploySystem";

describe("MarketVersionRegistry", function () {
  async function deployFixture() {
    const [deployer] = await ethers.getSigners();
    const deployment = await deployDualVmSystem();
    const contracts = deployment.contracts as any;

    return {
      deployer,
      accessManager: contracts.accessManager,
      wpas: contracts.wpas,
      usdc: contracts.usdc,
      oracle: contracts.oracle,
      quoteEngine: contracts.quoteEngine,
      riskEngine: contracts.riskEngine,
      debtPool: contracts.debtPool,
      lendingCore: contracts.lendingCore,
      marketRegistry: contracts.marketRegistry,
    };
  }

  it("registers and activates the initial immutable market version", async function () {
    const { marketRegistry, lendingCore, debtPool, oracle, riskEngine, quoteEngine, wpas, usdc } = await loadFixture(deployFixture);

    expect(await marketRegistry.latestVersionId()).to.equal(1n);
    expect(await marketRegistry.activeVersionId()).to.equal(1n);

    const activeVersion = await marketRegistry.activeVersion();
    expect(activeVersion.lendingCore).to.equal(await lendingCore.getAddress());
    expect(activeVersion.debtPool).to.equal(await debtPool.getAddress());
    expect(activeVersion.oracle).to.equal(await oracle.getAddress());
    expect(activeVersion.riskEngine).to.equal(await riskEngine.getAddress());
    expect(activeVersion.quoteEngine).to.equal(await quoteEngine.getAddress());
    expect(activeVersion.collateralAsset).to.equal(await wpas.getAddress());
    expect(activeVersion.debtAsset).to.equal(await usdc.getAddress());
    expect(activeVersion.configHash).to.equal(await lendingCore.currentRiskConfigHash());
  });

  it("switches active versions through the registry instead of kernel setters", async function () {
    const { deployer, accessManager, wpas, usdc, marketRegistry, lendingCore } = await loadFixture(deployFixture);

    const temporaryVersion = await deployMarketVersion({
      deployer,
      authority: await accessManager.getAddress(),
      collateralAsset: await wpas.getAddress(),
      debtAsset: await usdc.getAddress(),
      riskEngineConfig: {
        baseRateBps: 9_999n,
        slope1Bps: 1_111n,
        slope2Bps: 2_222n,
        kinkBps: 8_000n,
        healthyMaxLtvBps: 7_500n,
        stressedMaxLtvBps: 6_500n,
        healthyLiquidationThresholdBps: 8_500n,
        stressedLiquidationThresholdBps: 7_800n,
        staleBorrowRatePenaltyBps: 333n,
        stressedCollateralRatioBps: 14_000n,
      },
    });

    await marketRegistry.registerVersion(
      await temporaryVersion.lendingCore.getAddress(),
      await temporaryVersion.debtPool.getAddress(),
      await temporaryVersion.oracle.getAddress(),
      await temporaryVersion.riskEngine.getAddress(),
    );
    expect(await marketRegistry.latestVersionId()).to.equal(2n);

    await marketRegistry.activateVersion(2n);
    const activatedVersion = await marketRegistry.activeVersion();
    expect(activatedVersion.lendingCore).to.equal(await temporaryVersion.lendingCore.getAddress());
    expect(activatedVersion.riskEngine).to.equal(await temporaryVersion.riskEngine.getAddress());
    expect(activatedVersion.lendingCore).to.not.equal(await lendingCore.getAddress());

    await marketRegistry.activateVersion(1n);
    const restoredVersion = await marketRegistry.activeVersion();
    expect(restoredVersion.lendingCore).to.equal(await lendingCore.getAddress());
  });
});
