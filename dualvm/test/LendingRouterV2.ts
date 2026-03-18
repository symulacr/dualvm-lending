import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  CORE_DEFAULTS,
  ORACLE_CIRCUIT_BREAKER_DEFAULTS,
  ORACLE_DEFAULTS,
  POOL_DEFAULTS,
  RISK_ENGINE_DEFAULTS,
  ROLE_IDS,
} from "../lib/config/marketConfig";

// Role ID for approved router contracts — must not collide with ROLE_IDS constants.
const ROUTER_ROLE_ID = 8n;

describe("LendingRouterV2", function () {
  /**
   * Deploy a full LendingCoreV2 system plus LendingRouterV2.
   * Wires the router with a dedicated ROUTER role so it can call
   * LendingCoreV2.depositCollateralFor.
   */
  async function deployRouterV2Fixture() {
    const [deployer, user, secondUser] = await ethers.getSigners();

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

    // LendingCoreV2 (no liquidation notifier for this suite)
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
      ethers.ZeroAddress,
    )) as any;
    await coreV2.waitForDeployment();

    // Wire DebtPool → LendingCoreV2
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

    // Deploy LendingRouterV2
    const router = (await (
      await ethers.getContractFactory("LendingRouterV2")
    ).deploy(await wpas.getAddress(), await coreV2.getAddress())) as any;
    await router.waitForDeployment();

    // Wire ROUTER role: grant router the role and allow it to call depositCollateralFor
    await (await accessManager.labelRole(ROUTER_ROLE_ID, "ROUTER_ROLE")).wait();
    await (await accessManager.grantRole(ROUTER_ROLE_ID, await router.getAddress(), 0)).wait();
    const depositCollateralForSelector = coreV2.interface.getFunction("depositCollateralFor")!.selector;
    await (
      await accessManager.setTargetFunctionRole(
        await coreV2.getAddress(),
        [depositCollateralForSelector],
        ROUTER_ROLE_ID,
      )
    ).wait();

    return { deployer, user, secondUser, wpas, usdc, debtPool, oracle, riskEngine, coreV2, router };
  }

  it("depositCollateralFromPAS credits caller position, not router", async function () {
    const { user, coreV2, router } = await loadFixture(deployRouterV2Fixture);

    const depositAmount = ethers.parseEther("1");
    const userAddress = user.address;
    const routerAddress = await router.getAddress();

    const userPositionBefore = await coreV2.positions(userAddress);
    const routerPositionBefore = await coreV2.positions(routerAddress);
    expect(userPositionBefore.collateralAmount).to.equal(0n);
    expect(routerPositionBefore.collateralAmount).to.equal(0n);

    await expect(router.connect(user).depositCollateralFromPAS({ value: depositAmount }))
      .to.emit(router, "DepositedCollateralFromPAS")
      .withArgs(user.address, depositAmount);

    const userPositionAfter = await coreV2.positions(userAddress);
    const routerPositionAfter = await coreV2.positions(routerAddress);

    // User's position is credited with the full deposit amount
    expect(userPositionAfter.collateralAmount).to.equal(depositAmount);
    // Router's position remains zero after the operation
    expect(routerPositionAfter.collateralAmount).to.equal(0n);
  });

  it("router contract has zero collateral after multiple operations", async function () {
    const { user, secondUser, coreV2, router } = await loadFixture(deployRouterV2Fixture);

    const depositAmount = ethers.parseEther("2");
    const routerAddress = await router.getAddress();

    // Multiple deposits from different users
    await router.connect(user).depositCollateralFromPAS({ value: depositAmount });
    await router.connect(secondUser).depositCollateralFromPAS({ value: depositAmount });

    // Router position must always be zero regardless of how many users deposited
    const routerPosition = await coreV2.positions(routerAddress);
    expect(routerPosition.collateralAmount).to.equal(0n);

    // Each user's position should reflect their individual deposit
    const userPosition = await coreV2.positions(user.address);
    const secondUserPosition = await coreV2.positions(secondUser.address);
    expect(userPosition.collateralAmount).to.equal(depositAmount);
    expect(secondUserPosition.collateralAmount).to.equal(depositAmount);
  });

  it("reverts on zero-value call", async function () {
    const { user, router } = await loadFixture(deployRouterV2Fixture);

    await expect(router.connect(user).depositCollateralFromPAS({ value: 0n })).to.be.revertedWithCustomError(
      router,
      "ZeroAmount",
    );
  });

  it("emits DepositedCollateralFromPAS with correct depositor and amount", async function () {
    const { user, router } = await loadFixture(deployRouterV2Fixture);

    const depositAmount = ethers.parseEther("0.5");
    await expect(router.connect(user).depositCollateralFromPAS({ value: depositAmount }))
      .to.emit(router, "DepositedCollateralFromPAS")
      .withArgs(user.address, depositAmount);
  });
});
