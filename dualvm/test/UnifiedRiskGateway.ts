import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { RISK_ENGINE_DEFAULTS, WAD, ROLE_IDS } from "../lib/config/marketConfig";
import { deployDualVmSystem } from "../lib/deployment/deploySystem";

describe("Unified Risk Gateway (RiskAdapter)", function () {
  async function deployFixture() {
    const [deployer, lender, borrower, outsider] = await ethers.getSigners();
    const deployment = await deployDualVmSystem();
    const { accessManager, wpas, usdc, debtPool, oracle, lendingCore, riskEngine, quoteEngine } =
      deployment.contracts as any;

    // Seed pool with liquidity
    const poolLiquidity = 50_000n * WAD;
    const collateralAmount = 20n * WAD;
    await usdc.mint(lender.address, poolLiquidity);
    await usdc.connect(lender).approve(await debtPool.getAddress(), ethers.MaxUint256);
    await debtPool.connect(lender).deposit(poolLiquidity, lender.address);

    await wpas.connect(borrower).deposit({ value: collateralAmount });
    await wpas.connect(borrower).approve(await lendingCore.getAddress(), ethers.MaxUint256);
    await lendingCore.connect(borrower).depositCollateral(collateralAmount);

    return {
      deployer,
      lender,
      borrower,
      outsider,
      accessManager,
      wpas,
      usdc,
      debtPool,
      oracle,
      lendingCore,
      riskEngine,
      quoteEngine,
    };
  }

  // VAL-ARCH-001: RiskAdapter inline math matches DeterministicRiskModel for 5 utilization levels
  it("inline math matches DeterministicRiskModel.quote() for 5 utilization levels", async function () {
    const { riskEngine, quoteEngine } = await loadFixture(deployFixture);

    // 5 input combinations at utilization 0%, 50%, 80%, 95%, 100%
    const testInputs = [
      { utilizationBps: 0n, collateralRatioBps: 20_000n, oracleAgeSeconds: 60n, oracleFresh: true },
      { utilizationBps: 5_000n, collateralRatioBps: 20_000n, oracleAgeSeconds: 60n, oracleFresh: true },
      { utilizationBps: 8_000n, collateralRatioBps: 20_000n, oracleAgeSeconds: 60n, oracleFresh: true },
      { utilizationBps: 9_500n, collateralRatioBps: 20_000n, oracleAgeSeconds: 60n, oracleFresh: true },
      { utilizationBps: 10_000n, collateralRatioBps: 20_000n, oracleAgeSeconds: 60n, oracleFresh: true },
    ];

    for (const input of testInputs) {
      const inlineResult = await riskEngine.quote(input);
      const pvmResult = await quoteEngine.quote(input);

      expect(inlineResult.borrowRateBps).to.equal(
        pvmResult.borrowRateBps,
        `borrowRateBps mismatch at utilization ${input.utilizationBps}`,
      );
      expect(inlineResult.maxLtvBps).to.equal(
        pvmResult.maxLtvBps,
        `maxLtvBps mismatch at utilization ${input.utilizationBps}`,
      );
      expect(inlineResult.liquidationThresholdBps).to.equal(
        pvmResult.liquidationThresholdBps,
        `liquidationThresholdBps mismatch at utilization ${input.utilizationBps}`,
      );
    }

    // Verify known expected values at key points using RISK_ENGINE_DEFAULTS:
    // At 0% utilization: borrowRate = baseRateBps = 200
    const result0 = await riskEngine.quote(testInputs[0]);
    expect(result0.borrowRateBps).to.equal(RISK_ENGINE_DEFAULTS.baseRateBps);
    expect(result0.maxLtvBps).to.equal(RISK_ENGINE_DEFAULTS.healthyMaxLtvBps);
    expect(result0.liquidationThresholdBps).to.equal(RISK_ENGINE_DEFAULTS.healthyLiquidationThresholdBps);

    // At 80% utilization (= kink): borrowRate = baseRate + slope1 = 200 + 800 = 1000
    const result80 = await riskEngine.quote(testInputs[2]);
    expect(result80.borrowRateBps).to.equal(RISK_ENGINE_DEFAULTS.baseRateBps + RISK_ENGINE_DEFAULTS.slope1Bps);

    // At 100% utilization: borrowRate = baseRate + slope1 + slope2 = 200 + 800 + 3000 = 4000
    const result100 = await riskEngine.quote(testInputs[4]);
    expect(result100.borrowRateBps).to.equal(
      RISK_ENGINE_DEFAULTS.baseRateBps + RISK_ENGINE_DEFAULTS.slope1Bps + RISK_ENGINE_DEFAULTS.slope2Bps,
    );
  });

  // VAL-ARCH-002: Unauthorized caller to quoteViaTicket reverts
  it("unauthorized caller to quoteViaTicket reverts with AccessManagedUnauthorized", async function () {
    const { riskEngine, outsider } = await loadFixture(deployFixture);

    const context = {
      oracleEpoch: 1n,
      configEpoch: 1n,
      oracleStateHash: ethers.ZeroHash,
      configHash: ethers.ZeroHash,
    };
    const input = {
      utilizationBps: 5_000n,
      collateralRatioBps: 20_000n,
      oracleAgeSeconds: 60n,
      oracleFresh: true,
    };

    // outsider is NOT granted the LENDING_CORE role, so this should revert
    await expect(riskEngine.connect(outsider).quoteViaTicket(context, input)).to.be.revertedWithCustomError(
      riskEngine,
      "AccessManagedUnauthorized",
    );

    // Also verify deployer (who has admin but NOT LENDING_CORE role) cannot call
    const { deployer } = await loadFixture(deployFixture);
    await expect(riskEngine.connect(deployer).quoteViaTicket(context, input)).to.be.revertedWithCustomError(
      riskEngine,
      "AccessManagedUnauthorized",
    );
  });

  // Verify cross-VM match emits QuoteVerified event
  it("cross-VM verification emits QuoteVerified when inline matches PVM engine", async function () {
    const { borrower, lendingCore, riskEngine } = await loadFixture(deployFixture);

    // Borrow triggers quoteViaTicket internally, which should verify cross-VM match
    const borrowAmount = 5_000n * WAD;
    await expect(lendingCore.connect(borrower).borrow(borrowAmount)).to.emit(riskEngine, "QuoteVerified");
  });
});
