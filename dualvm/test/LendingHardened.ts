import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  CORE_DEFAULTS,
  ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  ORACLE_DEFAULTS,
  POOL_DEFAULTS,
  RISK_ENGINE_DEFAULTS,
  WAD,
} from "../lib/config/marketConfig";
import { deployDualVmSystem } from "../lib/deployment/deploySystem";

describe("Lending hardened coverage", function () {
  async function deployFixture() {
    const [deployer, lender, borrower, liquidator, outsider] = await ethers.getSigners();
    const deployment = await deployDualVmSystem();
    const { wpas, usdc, debtPool: pool, oracle, lendingCore: core } = deployment.contracts as any;

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

  // VAL-LEND-016: ERC4626 share exchange rate increases after interest repayment
  it("ERC4626 share exchange rate increases after interest repayment", async function () {
    const { borrower, usdc, pool, core } = await loadFixture(deployFixture);

    // Before any interest, 1e18 shares should convert to ~1e18 assets
    const assetsBefore = await pool.convertToAssets(WAD);

    // Borrow to create debt
    const borrowAmount = 5_000n * WAD;
    await core.connect(borrower).borrow(borrowAmount);

    // Advance time to accrue interest
    await time.increase(90 * 24 * 60 * 60); // 90 days

    // Repay with interest — debt is now larger than principal
    const debt = await core.currentDebt(borrower.address);
    expect(debt).to.be.gt(borrowAmount);

    // Mint enough USDC to repay full debt (borrower only has borrowAmount)
    const shortfall = debt - borrowAmount;
    await usdc.mint(borrower.address, shortfall);
    await core.connect(borrower).repay(debt);

    // After interest is repaid, exchange rate should have increased
    const assetsAfter = await pool.convertToAssets(WAD);
    expect(assetsAfter).to.be.gt(assetsBefore);
  });

  // VAL-LEND-017: Supply cap enforcement on DebtPool deposits
  it("supply cap enforcement on DebtPool deposits", async function () {
    const { deployer, outsider, usdc, pool } = await loadFixture(deployFixture);

    // The supply cap is POOL_DEFAULTS.supplyCap = 5_000_000 * WAD
    // Current pool has 50_000 * WAD from the lender deposit
    const supplyCap = POOL_DEFAULTS.supplyCap;
    const currentAssets = await pool.totalAssets();
    const remaining = supplyCap - currentAssets;

    // Mint just enough to exceed the cap
    const exceedAmount = remaining + 1n;
    await usdc.mint(outsider.address, exceedAmount);
    await usdc.connect(outsider).approve(await pool.getAddress(), ethers.MaxUint256);

    // Depositing more than remaining capacity should revert
    await expect(pool.connect(outsider).deposit(exceedAmount, outsider.address))
      .to.be.revertedWithCustomError(pool, "SupplyCapExceeded");

    // Depositing exactly remaining capacity should succeed
    await usdc.mint(deployer.address, remaining);
    await usdc.connect(deployer).approve(await pool.getAddress(), ethers.MaxUint256);
    await expect(pool.connect(deployer).deposit(remaining, deployer.address)).to.not.be.reverted;
  });

  // VAL-LEND-018: Collateral withdrawal blocked when unsafe
  it("collateral withdrawal blocked when it would push LTV above maxLtvBps", async function () {
    const { borrower, core, collateralAmount } = await loadFixture(deployFixture);

    // Borrow to create debt
    await core.connect(borrower).borrow(5_000n * WAD);

    // Try to withdraw most collateral — should revert
    await expect(core.connect(borrower).withdrawCollateral(collateralAmount - 1n * WAD))
      .to.be.revertedWithCustomError(core, "InsufficientCollateral");

    // Zero-debt borrower can withdraw freely after repaying
    // (Already tested in existing tests but this is the explicit unsafe scenario)
  });

  // VAL-LEND-019: Interest accrues over time
  it("interest accrues over time and currentDebt exceeds principal", async function () {
    const { borrower, core } = await loadFixture(deployFixture);

    const borrowAmount = 5_000n * WAD;
    await core.connect(borrower).borrow(borrowAmount);

    // Capture debt right after borrowing (may include tiny accrual from deploy time)
    const debtAtBorrow = await core.currentDebt(borrower.address);
    expect(debtAtBorrow).to.be.gte(borrowAmount);

    // Advance time by 30 days
    await time.increase(30 * 24 * 60 * 60);

    // Debt should now meaningfully exceed the post-borrow snapshot
    const debtAfter30Days = await core.currentDebt(borrower.address);
    expect(debtAfter30Days).to.be.gt(debtAtBorrow);

    // Advance more time — debt should keep growing
    await time.increase(60 * 24 * 60 * 60);
    const debtAfter90Days = await core.currentDebt(borrower.address);
    expect(debtAfter90Days).to.be.gt(debtAfter30Days);
  });

  // VAL-LEND-020: freezeNewDebt blocks new borrows
  it("freezeNewDebt blocks new borrows but repay and liquidate still work", async function () {
    const { deployer, borrower, liquidator, oracle, core, usdc } = await loadFixture(deployFixture);

    // Borrow first while debt is allowed
    await core.connect(borrower).borrow(1_000n * WAD);

    // Freeze new debt
    await core.connect(deployer).freezeNewDebt();

    // New borrows should revert
    await expect(core.connect(borrower).borrow(CORE_DEFAULTS.minBorrowAmount))
      .to.be.revertedWithCustomError(core, "NewDebtDisabled");

    // Repay should still work
    const debtBefore = await core.currentDebt(borrower.address);
    await core.connect(borrower).repay(100n * WAD);
    expect(await core.currentDebt(borrower.address)).to.be.lt(debtBefore);

    // Liquidation should still work (make position underwater)
    await oracle.setCircuitBreaker(
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      10_000n,
    );
    await oracle.setPrice(4n * WAD);
    await expect(core.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256))
      .to.emit(core, "Liquidated");
  });

  // VAL-ORACLE-001: Oracle circuit breaker rejects out-of-bounds prices
  it("oracle circuit breaker rejects out-of-bounds prices", async function () {
    const { oracle } = await loadFixture(deployFixture);

    // Current bounds: minPriceWad=1*WAD, maxPriceWad=10_000*WAD
    // Current price: 1_000*WAD, maxPriceChangeBps=2_500 (25%)

    // First, tighten bounds so that we can test out-of-bounds within normal delta
    // Set bounds to [500*WAD, 1_200*WAD] — current price 1_000 is inside
    await oracle.setCircuitBreaker(
      500n * WAD,   // minPriceWad
      1_200n * WAD, // maxPriceWad
      2_500n,       // keep 25% delta
    );

    // Price below minimum bound but within delta: 400*WAD is 60% drop, exceeds delta
    // So let's test with a price that is below min but within delta range
    // minPriceWad = 500*WAD, so try 499*WAD — that's ~50% below 1000, exceeds delta
    // Instead, move price down in steps to approach the lower bound
    await oracle.setPrice(800n * WAD); // -20%, within 25% delta, within bounds
    // Now try below lower bound: 499*WAD from 800 = ~37.6% drop — hits delta first
    // We need the bounds check to fire before delta, but setPrice checks bounds first
    // Actually, looking at the contract code: bounds check is BEFORE delta check
    // So even if delta would also fail, bounds error fires first

    // From 800, try 490*WAD: below min (500), should revert with OraclePriceOutOfBounds
    await expect(oracle.setPrice(490n * WAD))
      .to.be.revertedWithCustomError(oracle, "OraclePriceOutOfBounds");

    // Now test above max: widen delta to allow large jumps, keep narrow bounds
    await oracle.setCircuitBreaker(
      500n * WAD,
      1_200n * WAD,
      10_000n, // 100% delta allowed
    );

    // From 800, try 1_201*WAD: above max price
    await expect(oracle.setPrice(1_201n * WAD))
      .to.be.revertedWithCustomError(oracle, "OraclePriceOutOfBounds");

    // 1_200*WAD should succeed (at the upper bound)
    await expect(oracle.setPrice(1_200n * WAD)).to.not.be.reverted;
  });

  // VAL-ORACLE-002: Oracle circuit breaker rejects too-large price deltas
  it("oracle circuit breaker rejects too-large price deltas", async function () {
    const { oracle } = await loadFixture(deployFixture);

    // Default maxPriceChangeBps = 2_500 (25%)
    // Current price = 1_000 * WAD
    // A 30% jump to 1_300 * WAD should be rejected
    await expect(oracle.setPrice(1_300n * WAD))
      .to.be.revertedWithCustomError(oracle, "OraclePriceDeltaTooLarge");

    // A 20% jump to 1_200 * WAD should succeed (within 25% tolerance)
    await expect(oracle.setPrice(1_200n * WAD)).to.not.be.reverted;

    // From 1_200 → 800 = ~33% drop, should be rejected
    await expect(oracle.setPrice(800n * WAD))
      .to.be.revertedWithCustomError(oracle, "OraclePriceDeltaTooLarge");
  });

  // VAL-OZ-001: ReentrancyGuard active on LendingCore and DebtPool
  it("ReentrancyGuard is active on LendingCore and DebtPool", async function () {
    const { deployer } = await loadFixture(deployFixture);

    // Deploy a MaliciousERC20 that re-enters DebtPool.deposit() during transferFrom().
    // This proves ReentrancyGuard blocks the reentrant call.
    const maliciousFactory = await ethers.getContractFactory("MaliciousERC20", deployer);
    const maliciousToken = (await maliciousFactory.deploy()) as any;
    await maliciousToken.waitForDeployment();

    // Deploy a fresh AccessManager for the test pool
    const amFactory = await ethers.getContractFactory("DualVMAccessManager", deployer);
    const testAm = await amFactory.deploy(deployer.address);
    await testAm.waitForDeployment();

    // Deploy a DebtPool backed by the malicious token
    const poolFactory = await ethers.getContractFactory("DebtPool", deployer);
    const testPool = (await poolFactory.deploy(
      await maliciousToken.getAddress(),
      await testAm.getAddress(),
      ethers.MaxUint256, // large supply cap
    )) as any;
    await testPool.waitForDeployment();

    // Mint tokens to the deployer and approve the pool
    const depositAmount = 1_000n * WAD;
    const reentrantAmount = 500n * WAD;
    await maliciousToken.mint(deployer.address, depositAmount + reentrantAmount);
    await maliciousToken.connect(deployer).approve(await testPool.getAddress(), ethers.MaxUint256);

    // Arm the attack: when the pool calls transferFrom (during deposit),
    // the malicious token tries to call deposit() again
    await maliciousToken.armAttack(await testPool.getAddress(), reentrantAmount);

    // The outer deposit triggers transferFrom → MaliciousERC20._update → re-enters deposit()
    // ReentrancyGuard should cause the entire transaction to revert with ReentrancyGuardReentrantCall
    await expect(testPool.connect(deployer).deposit(depositAmount, deployer.address))
      .to.be.revertedWithCustomError(testPool, "ReentrancyGuardReentrantCall");
  });

  // VAL-OZ-001 (LendingCore path): ReentrancyGuard blocks reentrant borrow during depositCollateral
  it("ReentrancyGuard blocks reentrant borrow via malicious collateral during depositCollateral", async function () {
    const { deployer } = await loadFixture(deployFixture);

    // Deploy a fresh AccessManager for the isolated test
    const amFactory = await ethers.getContractFactory("DualVMAccessManager", deployer);
    const testAm = await amFactory.deploy(deployer.address);
    await testAm.waitForDeployment();

    // Deploy a malicious collateral token (ReentrantCollateral)
    const maliciousCollateralFactory = await ethers.getContractFactory("ReentrantCollateral", deployer);
    const maliciousCollateral = (await maliciousCollateralFactory.deploy()) as any;
    await maliciousCollateral.waitForDeployment();

    // Deploy real USDC mock for debt asset
    const usdcFactory = await ethers.getContractFactory("USDCMock", deployer);
    const testUsdc = (await usdcFactory.deploy(await testAm.getAddress())) as any;
    await testUsdc.waitForDeployment();

    // Grant deployer MINTER role on USDC
    const mintSelector = testUsdc.interface.getFunction("mint")!.selector;
    await testAm.setTargetFunctionRole(await testUsdc.getAddress(), [mintSelector], 4); // ROLE_IDS.MINTER = 4
    await testAm.grantRole(4, deployer.address, 0);

    // Deploy oracle
    const oracleFactory = await ethers.getContractFactory("ManualOracle", deployer);
    const testOracle = await oracleFactory.deploy(
      await testAm.getAddress(),
      ORACLE_DEFAULTS.initialPriceWad,
      ORACLE_DEFAULTS.maxAgeSeconds,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.minPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceWad,
      ORACLE_CIRCUIT_BREAKER_DEFAULTS.maxPriceChangeBps,
    );
    await testOracle.waitForDeployment();

    // Grant deployer RISK_ADMIN for oracle
    const oracleSelectors = ["setPrice", "setMaxAge", "setCircuitBreaker"].map(
      (name) => testOracle.interface.getFunction(name)!.selector,
    );
    await testAm.setTargetFunctionRole(await testOracle.getAddress(), oracleSelectors, 2); // ROLE_IDS.RISK_ADMIN = 2
    await testAm.grantRole(2, deployer.address, 0);

    // Deploy risk engine (DeterministicRiskModel as quote engine)
    const quoteEngineFactory = await ethers.getContractFactory("DeterministicRiskModel", deployer);
    const quoteEngine = await quoteEngineFactory.deploy(
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
    );
    await quoteEngine.waitForDeployment();
    const riskAdapterFactory = await ethers.getContractFactory("RiskAdapter", deployer);
    const testRiskEngine = await riskAdapterFactory.deploy(
      await testAm.getAddress(),
      await quoteEngine.getAddress(),
      {
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
      },
    );
    await testRiskEngine.waitForDeployment();

    // Deploy DebtPool backed by USDC
    const poolFactory = await ethers.getContractFactory("DebtPool", deployer);
    const testPool = (await poolFactory.deploy(
      await testUsdc.getAddress(),
      await testAm.getAddress(),
      POOL_DEFAULTS.supplyCap,
    )) as any;
    await testPool.waitForDeployment();

    // Deploy LendingCore with malicious collateral
    const coreFactory = await ethers.getContractFactory("LendingCore", deployer);
    const testCore = (await coreFactory.deploy(
      await testAm.getAddress(),
      await maliciousCollateral.getAddress(),
      await testUsdc.getAddress(),
      await testPool.getAddress(),
      await testOracle.getAddress(),
      await testRiskEngine.getAddress(),
      CORE_DEFAULTS,
    )) as any;
    await testCore.waitForDeployment();

    // Wire lending core to debt pool
    await testPool.setLendingCore(await testCore.getAddress());

    // Grant LendingCore the LENDING_CORE role to call quoteViaTicket on RiskAdapter
    const quoteViaTicketSelector = testRiskEngine.interface.getFunction("quoteViaTicket")!.selector;
    await testAm.grantRole(7, await testCore.getAddress(), 0); // ROLE_IDS.LENDING_CORE = 7
    await testAm.setTargetFunctionRole(await testRiskEngine.getAddress(), [quoteViaTicketSelector], 7);

    // Seed pool with liquidity so borrow is possible
    const poolLiquidity = 50_000n * WAD;
    await testUsdc.mint(deployer.address, poolLiquidity);
    await testUsdc.connect(deployer).approve(await testPool.getAddress(), ethers.MaxUint256);
    await testPool.connect(deployer).deposit(poolLiquidity, deployer.address);

    // Mint malicious collateral to deployer and approve LendingCore
    const collateralAmount = 20n * WAD;
    await maliciousCollateral.mint(deployer.address, collateralAmount);
    await maliciousCollateral.connect(deployer).approve(await testCore.getAddress(), ethers.MaxUint256);

    // Arm the attack: when depositCollateral triggers transferFrom,
    // the malicious token will try to call borrow() on LendingCore
    const borrowAmount = 1_000n * WAD;
    await maliciousCollateral.armAttack(await testCore.getAddress(), borrowAmount);

    // depositCollateral → transferFrom → ReentrantCollateral._update → borrow()
    // The reentrant borrow() call should be blocked by ReentrancyGuard,
    // causing the entire transaction to revert with ReentrancyGuardReentrantCall
    await expect(testCore.connect(deployer).depositCollateral(collateralAmount))
      .to.be.revertedWithCustomError(testCore, "ReentrancyGuardReentrantCall");
  });

  // VAL-OZ-002: ERC4626 inflation attack protection on first deposit
  it("ERC4626 inflation attack protection on first deposit", async function () {
    // Simulate the classic ERC4626 inflation attack and verify OZ's virtual offset
    // protection (with _decimalsOffset() = 0, the vault uses +1 virtual share / +1 virtual asset).
    //
    // Attack steps:
    // 1. Attacker deposits 1 wei to become the sole shareholder
    // 2. Attacker donates a large amount directly to the vault (inflating assets/share)
    // 3. Victim deposits a moderate amount
    //
    // With OZ's +1 virtual offset:
    // - victim shares = victimDeposit * (totalSupply + 1) / (totalAssets + 1)
    // - The +1 terms ensure the victim gets non-zero shares even after donation,
    //   provided the victim's deposit is at least as large as the donation.
    // - The attack becomes unprofitable: the attacker's donation cost exceeds
    //   the value they can extract from rounding.

    const [deployer, attacker, victim] = await ethers.getSigners();
    const freshDeployment = await deployDualVmSystem();
    const { usdc, debtPool: pool } = freshDeployment.contracts as any;
    const poolAddress = await pool.getAddress();

    // Pool should be empty
    expect(await pool.totalSupply()).to.equal(0n);
    expect(await pool.totalAssets()).to.equal(0n);

    // Step 1: Attacker deposits 1 wei to become sole shareholder
    await usdc.mint(attacker.address, 1n);
    await usdc.connect(attacker).approve(poolAddress, ethers.MaxUint256);
    await pool.connect(attacker).deposit(1n, attacker.address);

    const attackerShares = await pool.balanceOf(attacker.address);
    expect(attackerShares).to.be.gt(0n);

    // Step 2: Attacker donates directly to the vault to inflate the exchange rate.
    // With offset 0, the attacker can at most steal ~(donation) from the victim via rounding,
    // but they LOSE the donated tokens, making the attack net-negative.
    // Use a donation equal to the victim's intended deposit to maximize the attack.
    const victimDeposit = 1_000n * WAD;
    const donationAmount = victimDeposit; // Same size as victim deposit for maximum attack
    await usdc.mint(attacker.address, donationAmount);
    await usdc.connect(attacker).transfer(poolAddress, donationAmount);

    // State: totalAssets = donationAmount + 1, totalSupply = 1
    // Victim shares = victimDeposit * (1 + 1) / (donationAmount + 1 + 1)
    // = victimDeposit * 2 / (victimDeposit + 2) ≈ 2 (for large victimDeposit)

    // Step 3: Victim deposits
    await usdc.mint(victim.address, victimDeposit);
    await usdc.connect(victim).approve(poolAddress, ethers.MaxUint256);
    await pool.connect(victim).deposit(victimDeposit, victim.address);

    // Step 4: Verify victim received non-zero shares
    const victimShares = await pool.balanceOf(victim.address);
    expect(victimShares).to.be.gt(0n);

    // Step 5: Compute the maximum value the attacker could extract.
    // The attacker has `attackerShares` which now represent a portion of the enlarged pool.
    // The attacker's redeemable assets should be LESS than (donation + 1 wei),
    // proving the attack is not profitable.
    const attackerRedeemable = await pool.convertToAssets(attackerShares);
    const attackerCost = donationAmount + 1n; // 1 wei initial deposit + donation
    // The attacker cannot profit: redeemable ≤ cost (they lose the donation)
    expect(attackerRedeemable).to.be.lte(attackerCost);

    // Step 6: Verify victim can redeem a meaningful fraction of their deposit.
    // With the +1 virtual offset, the victim loses at most ~50% in the worst case
    // (donation == victim deposit), but critically the shares are non-zero.
    // This makes the attack unprofitable for the attacker (they donated victimDeposit
    // to steal at most ~victimDeposit/2 from the victim, net loss ≈ victimDeposit/2).
    const victimRedeemable = await pool.convertToAssets(victimShares);
    expect(victimRedeemable).to.be.gt(0n);
  });
});
