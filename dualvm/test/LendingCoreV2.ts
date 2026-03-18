import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  CORE_DEFAULTS,
  ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  ORACLE_DEFAULTS,
  POOL_DEFAULTS,
  RISK_ENGINE_DEFAULTS,
  ROLE_IDS,
  WAD,
} from "../lib/config/marketConfig";

// ---------------------------------------------------------------------------
// Shared deployment helper
// ---------------------------------------------------------------------------

/**
 * Deploy a full LendingCoreV2 system.
 *
 * @param liquidationNotifierAddress  Address passed to LendingCoreV2 constructor.
 *                                    Defaults to address(0) (hook disabled).
 */
async function deployV2System(liquidationNotifierAddress: string = ethers.ZeroAddress) {
  const [deployer, lender, borrower, liquidator, outsider] = await ethers.getSigners();

  // AccessManager — deployer is admin (role 0)
  const accessManager = (await (
    await ethers.getContractFactory("DualVMAccessManager")
  ).deploy(deployer.address)) as any;
  await accessManager.waitForDeployment();

  // Tokens
  const wpas = (await (await ethers.getContractFactory("WPAS")).deploy()) as any;
  await wpas.waitForDeployment();

  const usdc = (await (
    await ethers.getContractFactory("USDCMock")
  ).deploy(await accessManager.getAddress())) as any;
  await usdc.waitForDeployment();

  // Oracle
  const oracle = (await (
    await ethers.getContractFactory("ManualOracle")
  ).deploy(
    await accessManager.getAddress(),
    ORACLE_DEFAULTS.initialPriceWad,
    ORACLE_DEFAULTS.maxAgeSeconds,
    ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
    ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
    ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
  )) as any;
  await oracle.waitForDeployment();

  // Risk engine (inline DeterministicRiskModel + RiskAdapter)
  const quoteEngine = (await (
    await ethers.getContractFactory("DeterministicRiskModel")
  ).deploy(
    RISK_ENGINE_DEFAULTS.baseRateBps,
    RISK_ENGINE_DEFAULTS.slope1Bps,
    RISK_ENGINE_DEFAULTS.slope2Bps,
    RISK_ENGINE_DEFAULTS.kinkBps,
    RISK_ENGINE_DEFAULTS.healthyMaxLtvBps,
    RISK_ENGINE_DEFAULTS.stressedMaxLtvBps,
    RISK_ENGINE_DEFAULTS.healthyLiquidationThresholdBps,
    RISK_ENGINE_DEFAULTS.stressedLiquidationThresholdBps,
    RISK_ENGINE_DEFAULTS.staleBorrowRatePenaltyBps,
    RISK_ENGINE_DEFAULTS.stressedCollateralRatioBps,
  )) as any;
  await quoteEngine.waitForDeployment();

  const riskEngine = (await (
    await ethers.getContractFactory("RiskAdapter")
  ).deploy(await accessManager.getAddress(), await quoteEngine.getAddress(), {
    baseRateBps: RISK_ENGINE_DEFAULTS.baseRateBps,
    slope1Bps: RISK_ENGINE_DEFAULTS.slope1Bps,
    slope2Bps: RISK_ENGINE_DEFAULTS.slope2Bps,
    kinkBps: RISK_ENGINE_DEFAULTS.kinkBps,
    healthyMaxLtvBps: RISK_ENGINE_DEFAULTS.healthyMaxLtvBps,
    stressedMaxLtvBps: RISK_ENGINE_DEFAULTS.stressedMaxLtvBps,
    healthyLiquidationThresholdBps: RISK_ENGINE_DEFAULTS.healthyLiquidationThresholdBps,
    stressedLiquidationThresholdBps: RISK_ENGINE_DEFAULTS.stressedLiquidationThresholdBps,
    staleBorrowRatePenaltyBps: RISK_ENGINE_DEFAULTS.staleBorrowRatePenaltyBps,
    stressedCollateralRatioBps: RISK_ENGINE_DEFAULTS.stressedCollateralRatioBps,
  })) as any;
  await riskEngine.waitForDeployment();

  // DebtPool
  const debtPool = (await (
    await ethers.getContractFactory("DebtPool")
  ).deploy(await usdc.getAddress(), await accessManager.getAddress(), POOL_DEFAULTS.supplyCap)) as any;
  await debtPool.waitForDeployment();

  // LendingCoreV2
  const coreV2 = (await (
    await ethers.getContractFactory("LendingCoreV2")
  ).deploy(
    await accessManager.getAddress(),
    await wpas.getAddress(),
    await usdc.getAddress(),
    await debtPool.getAddress(),
    await oracle.getAddress(),
    await riskEngine.getAddress(),
    CORE_DEFAULTS,
    liquidationNotifierAddress,
  )) as any;
  await coreV2.waitForDeployment();

  // Wire DebtPool → LendingCoreV2 (deployer is admin, so restricted setLendingCore works)
  await (await debtPool.setLendingCore(await coreV2.getAddress())).wait();

  // Wire LENDING_CORE role so coreV2 can call riskEngine.quoteViaTicket
  await (await accessManager.labelRole(ROLE_IDS.LENDING_CORE, "LENDING_CORE_ROLE")).wait();
  await (await accessManager.grantRole(ROLE_IDS.LENDING_CORE, await coreV2.getAddress(), 0)).wait();
  const quoteViaTicketSelector = riskEngine.interface.getFunction("quoteViaTicket")!.selector;
  await (
    await accessManager.setTargetFunctionRole(
      await riskEngine.getAddress(),
      [quoteViaTicketSelector],
      ROLE_IDS.LENDING_CORE,
    )
  ).wait();

  // Wire MINTER role so deployer can mint USDC in tests
  await (await accessManager.grantRole(ROLE_IDS.MINTER, deployer.address, 0)).wait();
  const mintSelector = usdc.interface.getFunction("mint")!.selector;
  await (
    await accessManager.setTargetFunctionRole(await usdc.getAddress(), [mintSelector], ROLE_IDS.MINTER)
  ).wait();

  // Seed liquidity
  const poolLiquidity = 50_000n * WAD;
  await (await usdc.mint(lender.address, poolLiquidity)).wait();
  await (await usdc.connect(lender).approve(await debtPool.getAddress(), ethers.MaxUint256)).wait();
  await (await debtPool.connect(lender).deposit(poolLiquidity, lender.address)).wait();

  // Seed liquidator USDC
  await (await usdc.mint(liquidator.address, 10_000n * WAD)).wait();
  await (await usdc.connect(liquidator).approve(await coreV2.getAddress(), ethers.MaxUint256)).wait();

  // Seed borrower collateral (deposited via normal depositCollateral)
  const collateralAmount = 20n * WAD;
  await (await wpas.connect(borrower).deposit({ value: collateralAmount })).wait();
  await (await wpas.connect(borrower).approve(await coreV2.getAddress(), ethers.MaxUint256)).wait();
  await (await usdc.connect(borrower).approve(await coreV2.getAddress(), ethers.MaxUint256)).wait();
  await (await coreV2.connect(borrower).depositCollateral(collateralAmount)).wait();

  return {
    deployer,
    lender,
    borrower,
    liquidator,
    outsider,
    wpas,
    usdc,
    debtPool,
    oracle,
    coreV2,
    accessManager,
    collateralAmount,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("LendingCoreV2", function () {
  // -------------------------------------------------------------------------
  // Fixture: no notifier (base system)
  // -------------------------------------------------------------------------
  async function deployNoNotifierFixture() {
    return deployV2System(ethers.ZeroAddress);
  }

  // =========================================================================
  // depositCollateralFor
  // =========================================================================

  describe("depositCollateralFor", function () {
    it("credits beneficiary position, not caller", async function () {
      const { deployer, borrower, wpas, coreV2, collateralAmount } = await loadFixture(deployNoNotifierFixture);

      // Deployer (admin) acts as a router — gives WPAS and deposits on behalf of borrower
      const depositAmount = 5n * WAD;
      await (await wpas.connect(deployer).deposit({ value: depositAmount })).wait();
      await (await wpas.connect(deployer).approve(await coreV2.getAddress(), ethers.MaxUint256)).wait();

      const beneficiaryBefore = (await coreV2.positions(borrower.address)).collateralAmount;
      const callerBefore = (await coreV2.positions(deployer.address)).collateralAmount;

      await expect(coreV2.connect(deployer).depositCollateralFor(borrower.address, depositAmount))
        .to.emit(coreV2, "CollateralDeposited")
        .withArgs(borrower.address, depositAmount);

      const beneficiaryAfter = (await coreV2.positions(borrower.address)).collateralAmount;
      const callerAfter = (await coreV2.positions(deployer.address)).collateralAmount;

      // Beneficiary (borrower) collateral increased
      expect(beneficiaryAfter).to.equal(beneficiaryBefore + depositAmount);
      // Caller (deployer/router) collateral unchanged
      expect(callerAfter).to.equal(callerBefore);
    });

    it("reverts for unauthorized caller (non-admin, no configured role)", async function () {
      const { outsider, borrower, wpas, coreV2 } = await loadFixture(deployNoNotifierFixture);

      const depositAmount = 1n * WAD;
      // Give outsider some WPAS so the only blocker is access control
      await (await wpas.connect(outsider).deposit({ value: depositAmount })).wait();
      await (await wpas.connect(outsider).approve(await coreV2.getAddress(), ethers.MaxUint256)).wait();

      await expect(
        coreV2.connect(outsider).depositCollateralFor(borrower.address, depositAmount),
      ).to.be.revertedWithCustomError(coreV2, "AccessManagedUnauthorized");
    });
  });

  // =========================================================================
  // Liquidation hook
  // =========================================================================

  describe("liquidation hook", function () {
    it("calls notifier and emits notification event when hook is set", async function () {
      // Deploy a recording mock notifier
      const mockNotifier = await (await ethers.getContractFactory("MockLiquidationNotifier")).deploy(false);
      await mockNotifier.waitForDeployment();

      const { borrower, liquidator, oracle, coreV2 } = await deployV2System(await mockNotifier.getAddress());

      // Borrow, then drop price sharply (bad-debt scenario: debt 5000 >> collateral value 420)
      const borrowAmount = 5_000n * WAD;
      await coreV2.connect(borrower).borrow(borrowAmount);
      await oracle.setCircuitBreaker(
        ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
        ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
        10_000n,
      );
      await oracle.setPrice(21n * WAD); // collateral value = 20*21 = 420 WAD << 5000 WAD debt
      expect(await coreV2.healthFactor(borrower.address)).to.be.lt(WAD);

      // Liquidate — hook should fire
      await expect(coreV2.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256))
        .to.emit(coreV2, "Liquidated")
        .and.to.emit(mockNotifier, "NotificationReceived")
        .withArgs(borrower.address, anyValue, anyValue);

      // Mock records were updated
      expect(await mockNotifier.callCount()).to.equal(1n);
      expect(await mockNotifier.lastBorrower()).to.equal(borrower.address);
      expect(await mockNotifier.lastDebtRepaid()).to.be.gt(0n);
      expect(await mockNotifier.lastCollateralSeized()).to.be.gt(0n);
    });

    it("liquidation succeeds even when notifier reverts (silent failure)", async function () {
      // Deploy a reverting mock notifier
      const revertingNotifier = await (await ethers.getContractFactory("MockLiquidationNotifier")).deploy(true);
      await revertingNotifier.waitForDeployment();

      const { borrower, liquidator, oracle, coreV2 } = await deployV2System(await revertingNotifier.getAddress());

      // Borrow a small amount so a price drop to 21 WAD leaves debt >> collateral value,
      // guaranteeing bad-debt liquidation and full position clearance.
      const borrowAmount = 5_000n * WAD;
      await coreV2.connect(borrower).borrow(borrowAmount);
      const debtBefore = await coreV2.currentDebt(borrower.address);

      // Drop price sharply so debt >> collateral value (guaranteed bad-debt scenario)
      await oracle.setCircuitBreaker(
        ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
        ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
        10_000n,
      );
      await oracle.setPrice(21n * WAD); // collateral value = 20*21 = 420 << 5000 debt
      expect(await coreV2.healthFactor(borrower.address)).to.be.lt(WAD);

      // Liquidation must succeed despite notifier reverting
      await expect(coreV2.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256)).to.emit(
        coreV2,
        "Liquidated",
      );

      // Debt decreased (liquidation committed); may or may not be zero depending on path
      expect(await coreV2.currentDebt(borrower.address)).to.be.lt(debtBefore);
    });

    it("liquidation with address(0) notifier succeeds with no hook call", async function () {
      const { borrower, liquidator, oracle, coreV2 } = await loadFixture(deployNoNotifierFixture);

      const borrowAmount = 5_000n * WAD;
      await coreV2.connect(borrower).borrow(borrowAmount);
      const debtBefore = await coreV2.currentDebt(borrower.address);

      await oracle.setCircuitBreaker(
        ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
        ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
        10_000n,
      );
      await oracle.setPrice(21n * WAD); // guaranteed bad-debt scenario

      await expect(coreV2.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256)).to.emit(
        coreV2,
        "Liquidated",
      );

      // Debt decreased (liquidation committed)
      expect(await coreV2.currentDebt(borrower.address)).to.be.lt(debtBefore);
    });
  });

  // =========================================================================
  // Smoke: existing LendingCore behaviours still work on V2
  // =========================================================================

  describe("existing LendingCore behaviours preserved", function () {
    it("supports deposit, borrow, repay, and liquidation", async function () {
      const { borrower, liquidator, usdc, debtPool, oracle, coreV2, collateralAmount } =
        await loadFixture(deployNoNotifierFixture);

      const borrowAmount = 5_000n * WAD;
      await expect(coreV2.connect(borrower).borrow(borrowAmount))
        .to.emit(coreV2, "Borrowed")
        .withArgs(borrower.address, borrowAmount, anyValue);

      expect(await usdc.balanceOf(borrower.address)).to.equal(borrowAmount);
      expect(await debtPool.outstandingPrincipal()).to.equal(borrowAmount);

      const partialRepay = 1_000n * WAD;
      await expect(coreV2.connect(borrower).repay(partialRepay)).to.emit(coreV2, "Repaid");

      await oracle.setCircuitBreaker(
        ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
        ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
        10_000n,
      );
      await oracle.setPrice(250n * WAD);
      expect(await coreV2.healthFactor(borrower.address)).to.be.lt(WAD);

      await expect(coreV2.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256)).to.emit(
        coreV2,
        "Liquidated",
      );
      expect(await coreV2.currentDebt(borrower.address)).to.equal(0n);
    });

    it("liquidationNotifier immutable is set correctly at construction", async function () {
      const { coreV2 } = await loadFixture(deployNoNotifierFixture);
      expect(await coreV2.liquidationNotifier()).to.equal(ethers.ZeroAddress);
    });
  });
});
