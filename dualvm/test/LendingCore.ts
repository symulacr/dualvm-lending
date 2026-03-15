import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { CORE_DEFAULTS, ORACLE_CIRCUIT_BREAKER_DEFAULTS, ORACLE_DEFAULTS, WAD } from "../scripts/marketConfig";
import { deployDualVmSystem } from "../scripts/deploySystem";

describe("DualVM isolated market", function () {
  async function deployFixture() {
    const [deployer, lender, borrower, liquidator, outsider] = await ethers.getSigners();
    const deployment = await deployDualVmSystem();
    const { wpas, usdc, pool, oracle, core } = deployment.contracts as any;

    const poolLiquidity = 50_000n * WAD;
    const liquidatorLiquidity = 10_000n * WAD;
    const collateralAmount = 20n * WAD;

    await usdc.mint(lender.address, poolLiquidity);
    await usdc.mint(liquidator.address, liquidatorLiquidity);

    await usdc.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(lender).deposit(poolLiquidity, lender.address);

    await wpas.connect(borrower).deposit({ value: collateralAmount });
    await wpas.connect(borrower).approve(await core.getAddress(), ethers.MaxUint256);
    await usdc.connect(borrower).approve(await core.getAddress(), ethers.MaxUint256);
    await usdc.connect(liquidator).approve(await core.getAddress(), ethers.MaxUint256);
    await core.connect(borrower).depositCollateral(collateralAmount);

    return {
      deployer,
      lender,
      borrower,
      liquidator,
      outsider,
      wpas,
      usdc,
      pool,
      oracle,
      core,
      collateralAmount,
      poolLiquidity,
    };
  }

  it("supports deposit, borrow, repay, and liquidation", async function () {
    const { borrower, liquidator, wpas, usdc, pool, oracle, core } = await loadFixture(deployFixture);

    const borrowAmount = 5_000n * WAD;
    await expect(core.connect(borrower).borrow(borrowAmount))
      .to.emit(core, "Borrowed")
      .withArgs(borrower.address, borrowAmount, anyValue);

    expect(await usdc.balanceOf(borrower.address)).to.equal(borrowAmount);
    expect(await pool.outstandingPrincipal()).to.equal(borrowAmount);

    await time.increase(30 * 24 * 60 * 60);

    const debtBeforeRepay = await core.currentDebt(borrower.address);
    expect(debtBeforeRepay).to.be.gt(borrowAmount);

    const partialRepay = 1_000n * WAD;
    await expect(core.connect(borrower).repay(partialRepay)).to.emit(core, "Repaid");
    expect(await pool.reserveBalance()).to.be.gt(0n);

    const debtAfterRepay = await core.currentDebt(borrower.address);
    expect(debtAfterRepay).to.be.lt(debtBeforeRepay);

    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await oracle.setPrice(250n * WAD);
    const healthFactor = await core.healthFactor(borrower.address);
    expect(healthFactor).to.be.lt(WAD);

    const liquidatorCollateralBefore = await wpas.balanceOf(liquidator.address);
    await expect(core.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256)).to.emit(core, "Liquidated");

    expect(await core.currentDebt(borrower.address)).to.equal(0n);
    expect(await wpas.balanceOf(liquidator.address)).to.be.gt(liquidatorCollateralBefore);
  });

  it("liquidation clears bad debt when accrued interest remains", async function () {
    const { borrower, liquidator, wpas, usdc, pool, oracle, core, collateralAmount } = await loadFixture(
      deployFixture,
    );

    const borrowAmount = 13_000n * WAD;
    await core.connect(borrower).borrow(borrowAmount);

    await time.increase(2 * 365 * 24 * 60 * 60);
    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await oracle.setPrice(21n * WAD);

    const debtBeforeLiquidation = await core.currentDebt(borrower.address);
    expect(debtBeforeLiquidation).to.be.gt(await pool.outstandingPrincipal());

    const liquidatorCollateralBefore = await wpas.balanceOf(liquidator.address);
    await expect(core.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256))
      .to.emit(core, "BadDebtRealized")
      .withArgs(borrower.address, anyValue);

    expect(await core.currentDebt(borrower.address)).to.equal(0n);
    expect(await pool.outstandingPrincipal()).to.equal(0n);
    expect(await usdc.balanceOf(liquidator.address)).to.be.lt(10_000n * WAD);
    expect(await wpas.balanceOf(liquidator.address)).to.equal(liquidatorCollateralBefore + collateralAmount);
  });

  it("rejects excessive oracle jumps until the circuit breaker is widened", async function () {
    const { oracle } = await loadFixture(deployFixture);

    await expect(oracle.setPrice(250n * WAD)).to.be.revertedWithCustomError(oracle, "OraclePriceDeltaTooLarge");

    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await expect(oracle.setPrice(250n * WAD)).to.not.be.reverted;
  });

  it("rejects borrow attempts when the oracle is stale", async function () {
    const { borrower, oracle, core } = await loadFixture(deployFixture);

    await time.increase(ORACLE_DEFAULTS.maxAgeSeconds + 1);
    await expect(core.connect(borrower).borrow(CORE_DEFAULTS.minBorrowAmount)).to.be.revertedWithCustomError(
      oracle,
      "OraclePriceStale",
    );
  });

  it("rejects stale-oracle collateral withdrawals", async function () {
    const { borrower, oracle, core, collateralAmount } = await loadFixture(deployFixture);

    await time.increase(ORACLE_DEFAULTS.maxAgeSeconds + 1);
    await expect(core.connect(borrower).withdrawCollateral(collateralAmount / 2n)).to.be.revertedWithCustomError(
      oracle,
      "OraclePriceStale",
    );
  });

  it("rejects unsafe collateral withdrawals", async function () {
    const { borrower, core } = await loadFixture(deployFixture);

    await core.connect(borrower).borrow(5_000n * WAD);

    await expect(core.connect(borrower).withdrawCollateral(15n * WAD)).to.be.revertedWithCustomError(
      core,
      "InsufficientCollateral",
    );
  });

  it("blocks new borrows while paused but still allows repayment", async function () {
    const { deployer, borrower, core } = await loadFixture(deployFixture);

    await core.connect(borrower).borrow(1_000n * WAD);
    await core.connect(deployer).pause();

    await expect(core.connect(borrower).borrow(CORE_DEFAULTS.minBorrowAmount)).to.be.revertedWithCustomError(
      core,
      "EnforcedPause",
    );

    const debtBeforeRepay = await core.currentDebt(borrower.address);
    await expect(core.connect(borrower).repay(100n * WAD)).to.emit(core, "Repaid");
    expect(await core.currentDebt(borrower.address)).to.be.lt(debtBeforeRepay);
  });

  it("rejects liquidations that would leave dust debt below the minimum borrow amount", async function () {
    const { borrower, liquidator, oracle, core } = await loadFixture(deployFixture);

    await core.connect(borrower).borrow(150n * WAD);
    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await oracle.setPrice(4n * WAD);

    await expect(core.connect(liquidator).liquidate(borrower.address, 60n * WAD))
      .to.be.revertedWithCustomError(core, "DebtBelowMinimum")
      .withArgs(anyValue, CORE_DEFAULTS.minBorrowAmount);
  });

  it("restricts reserve claims to the treasury role", async function () {
    const { deployer, outsider, borrower, usdc, pool, core } = await loadFixture(deployFixture);

    await core.connect(borrower).borrow(1_000n * WAD);
    await time.increase(30 * 24 * 60 * 60);
    await core.connect(borrower).repay(200n * WAD);

    const reserveBalance = await pool.reserveBalance();
    expect(reserveBalance).to.be.gt(0n);

    await expect(pool.connect(outsider).claimReserves(outsider.address, reserveBalance)).to.be.reverted;

    const treasuryBalanceBefore = await usdc.balanceOf(deployer.address);
    await expect(pool.connect(deployer).claimReserves(deployer.address, reserveBalance))
      .to.emit(pool, "ReservesClaimed")
      .withArgs(deployer.address, reserveBalance);
    expect(await usdc.balanceOf(deployer.address)).to.equal(treasuryBalanceBefore + reserveBalance);
    expect(await pool.reserveBalance()).to.equal(0n);
  });

  it("prevents non-admin minting of the debt asset", async function () {
    const { outsider, usdc } = await loadFixture(deployFixture);

    await expect(usdc.connect(outsider).mint(outsider.address, WAD)).to.be.reverted;
  });
});
