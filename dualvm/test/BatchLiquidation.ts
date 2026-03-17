import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { CORE_DEFAULTS, ORACLE_CIRCUIT_BREAKER_DEFAULTS, ORACLE_DEFAULTS, WAD } from "../lib/config/marketConfig";
import { deployDualVmSystem } from "../lib/deployment/deploySystem";

describe("Batch liquidation", function () {
  async function deployBatchFixture() {
    const [deployer, lender, borrower1, borrower2, borrower3, liquidator] = await ethers.getSigners();
    const deployment = await deployDualVmSystem();
    const { wpas, usdc, debtPool: pool, oracle, lendingCore: core } = deployment.contracts as any;

    const poolLiquidity = 200_000n * WAD;
    const liquidatorLiquidity = 100_000n * WAD;
    const collateralPerBorrower = 20n * WAD;

    // Fund lender and liquidator
    await usdc.mint(lender.address, poolLiquidity);
    await usdc.mint(liquidator.address, liquidatorLiquidity);

    // Lender deposits liquidity
    await usdc.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(lender).deposit(poolLiquidity, lender.address);

    // Liquidator approves LendingCore for debt asset
    await usdc.connect(liquidator).approve(await core.getAddress(), ethers.MaxUint256);

    // Set up 3 borrowers with collateral and borrow positions
    // Use high borrow amounts relative to collateral so that after price crash,
    // collateral value is much less than debt, ensuring full collateral seizure + bad debt path
    const borrowers = [borrower1, borrower2, borrower3];
    const borrowAmounts = [12_000n * WAD, 13_000n * WAD, 11_000n * WAD];

    for (let i = 0; i < borrowers.length; i++) {
      const b = borrowers[i];
      await wpas.connect(b).deposit({ value: collateralPerBorrower });
      await wpas.connect(b).approve(await core.getAddress(), ethers.MaxUint256);
      await usdc.connect(b).approve(await core.getAddress(), ethers.MaxUint256);
      await core.connect(b).depositCollateral(collateralPerBorrower);
      await core.connect(b).borrow(borrowAmounts[i]);
    }

    return {
      deployer,
      lender,
      borrower1,
      borrower2,
      borrower3,
      liquidator,
      wpas,
      usdc,
      pool,
      oracle,
      core,
      collateralPerBorrower,
      borrowAmounts,
    };
  }

  it("batch liquidates 3 underwater positions in a single TX", async function () {
    const { borrower1, borrower2, borrower3, liquidator, wpas, usdc, pool, oracle, core } =
      await loadFixture(deployBatchFixture);

    // Advance time to accrue significant interest
    await time.increase(2 * 365 * 24 * 60 * 60);

    // Drop oracle price aggressively to make all positions deeply underwater
    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n, // allow large price changes
    );
    await oracle.setPrice(21n * WAD);

    // Verify all 3 are underwater
    const hf1 = await core.healthFactor(borrower1.address);
    const hf2 = await core.healthFactor(borrower2.address);
    const hf3 = await core.healthFactor(borrower3.address);
    expect(hf1).to.be.lt(WAD);
    expect(hf2).to.be.lt(WAD);
    expect(hf3).to.be.lt(WAD);

    // Record pre-liquidation state
    const liquidatorCollateralBefore = await wpas.balanceOf(liquidator.address);
    const debt1Before = await core.currentDebt(borrower1.address);
    const debt2Before = await core.currentDebt(borrower2.address);
    const debt3Before = await core.currentDebt(borrower3.address);
    expect(debt1Before).to.be.gt(0n);
    expect(debt2Before).to.be.gt(0n);
    expect(debt3Before).to.be.gt(0n);

    // Execute batch liquidation
    const tx = await core.connect(liquidator).batchLiquidate(
      [borrower1.address, borrower2.address, borrower3.address],
      [ethers.MaxUint256, ethers.MaxUint256, ethers.MaxUint256],
    );

    const receipt = await tx.wait();

    // Verify 3 Liquidated events emitted
    const liquidatedEvents = receipt!.logs.filter((log: any) => {
      try {
        const parsed = core.interface.parseLog({ topics: log.topics as string[], data: log.data });
        return parsed?.name === "Liquidated";
      } catch {
        return false;
      }
    });
    expect(liquidatedEvents.length).to.equal(3);

    // Verify all positions cleared (debt = 0)
    expect(await core.currentDebt(borrower1.address)).to.equal(0n);
    expect(await core.currentDebt(borrower2.address)).to.equal(0n);
    expect(await core.currentDebt(borrower3.address)).to.equal(0n);

    // Verify liquidator received collateral
    expect(await wpas.balanceOf(liquidator.address)).to.be.gt(liquidatorCollateralBefore);
  });

  it("existing liquidate() still works unchanged after refactor", async function () {
    const { borrower1, liquidator, wpas, oracle, core } = await loadFixture(deployBatchFixture);

    await time.increase(2 * 365 * 24 * 60 * 60);

    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await oracle.setPrice(21n * WAD);

    const hf = await core.healthFactor(borrower1.address);
    expect(hf).to.be.lt(WAD);

    const liquidatorCollateralBefore = await wpas.balanceOf(liquidator.address);

    await expect(core.connect(liquidator).liquidate(borrower1.address, ethers.MaxUint256))
      .to.emit(core, "Liquidated");

    // With very low price and high accrued interest, full collateral seized + bad debt cleared
    expect(await core.currentDebt(borrower1.address)).to.equal(0n);
    expect(await wpas.balanceOf(liquidator.address)).to.be.gt(liquidatorCollateralBefore);
  });

  it("reverts with ArrayLengthMismatch when arrays differ in length", async function () {
    const { borrower1, borrower2, liquidator, core } = await loadFixture(deployBatchFixture);

    await expect(
      core.connect(liquidator).batchLiquidate(
        [borrower1.address, borrower2.address],
        [ethers.MaxUint256],
      ),
    ).to.be.revertedWithCustomError(core, "ArrayLengthMismatch");
  });

  it("reverts with BatchLiquidationFailed when one position is healthy", async function () {
    const { deployer, lender, borrower1, borrower2, borrower3, liquidator, wpas, usdc, pool, oracle, core } =
      await loadFixture(deployBatchFixture);

    // borrower1 borrowed 12000, borrower2 borrowed 13000, borrower3 borrowed 11000
    // All with 20 ETH at $1000 = $20000 collateral value
    // At $850: collateral value = $17000
    // borrower2 (13000 debt): HF = 17000*8000/(13000*10000) ≈ 1.046 → just above 1 → healthy
    // Actually with liquidationThresholdBps=8000:
    // HF = (20*850*8000) / (13000*10000) = 136000000/130000000 ≈ 1.046 — still healthy
    // borrower2 (13000 debt) at $800: HF = (20*800*8000)/(13000*10000) = 128000000/130000000 ≈ 0.985 — underwater
    // borrower3 (11000 debt) at $800: HF = (20*800*8000)/(11000*10000) = 128000000/110000000 ≈ 1.164 — still healthy

    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await oracle.setPrice(800n * WAD);

    // borrower2 should be underwater, borrower3 should be healthy
    const hf2 = await core.healthFactor(borrower2.address);
    const hf3 = await core.healthFactor(borrower3.address);
    expect(hf2).to.be.lt(WAD);
    expect(hf3).to.be.gt(WAD);

    // Batch with healthy borrower3 should revert with BatchLiquidationFailed at index 1
    // (borrower2 at index 0 is underwater and succeeds; borrower3 at index 1 is healthy and fails)
    await expect(
      core.connect(liquidator).batchLiquidate(
        [borrower2.address, borrower3.address],
        [ethers.MaxUint256, ethers.MaxUint256],
      ),
    )
      .to.be.revertedWithCustomError(core, "BatchLiquidationFailed")
      .withArgs(1n, anyValue);
  });

  it("emits individual Liquidated events per position in batch", async function () {
    const { borrower1, borrower2, liquidator, oracle, core } = await loadFixture(deployBatchFixture);

    await time.increase(2 * 365 * 24 * 60 * 60);
    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await oracle.setPrice(21n * WAD);

    // Batch liquidate 2 positions
    await expect(
      core.connect(liquidator).batchLiquidate(
        [borrower1.address, borrower2.address],
        [ethers.MaxUint256, ethers.MaxUint256],
      ),
    )
      .to.emit(core, "Liquidated")
      .withArgs(borrower1.address, liquidator.address, anyValue, anyValue, anyValue)
      .to.emit(core, "Liquidated")
      .withArgs(borrower2.address, liquidator.address, anyValue, anyValue, anyValue);
  });
});
