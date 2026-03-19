// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
import {MockLiquidationNotifier} from "../contracts/test/MockLiquidationNotifier.sol";

/// @title LendingEngineTest
/// @notice Foundry tests for LendingEngine — migrated from LendingCore.ts and LendingCoreV2.ts
contract LendingEngineTest is BaseTest {

    // =========================================================================
    // Basic deposit / borrow / repay / withdraw / liquidate
    // =========================================================================

    function test_DepositCollateral_RecordsPosition() public {
        // borrower already deposited 20 WAD in setUp
        (uint256 collateral,,,,) = lendingEngine.positions(borrower);
        assertEq(collateral, 20 * WAD, "collateral should be 20 WAD");
    }

    function test_DepositCollateral_ZeroReverts() public {
        vm.prank(borrower);
        vm.expectRevert(LendingEngine.ZeroAmount.selector);
        lendingEngine.depositCollateral(0);
    }

    function test_DepositCollateral_IncreasesPosition() public {
        (uint256 before,,,,) = lendingEngine.positions(borrower);

        uint256 extra = 5 * WAD;
        vm.startPrank(borrower);
        wpas.deposit{value: extra}();
        wpas.approve(address(lendingEngine), extra);
        lendingEngine.depositCollateral(extra);
        vm.stopPrank();

        (uint256 after_,,,,) = lendingEngine.positions(borrower);
        assertEq(after_, before + extra, "position should increase by deposit amount");
    }

    function test_Borrow_EmitsBorrowedEvent() public {
        uint256 amount = 5_000 * WAD;
        vm.prank(borrower);
        // Only check topic1 (borrower address); amount, rate, and correlationId are not checked
        vm.expectEmit(true, false, false, false, address(lendingEngine));
        emit LendingEngine.Borrowed(borrower, 0, 0, bytes32(0));
        lendingEngine.borrow(amount);
    }

    function test_Borrow_TransfersDebtAssetToBorrower() public {
        uint256 amount = 5_000 * WAD;
        uint256 balBefore = usdc.balanceOf(borrower);
        _borrowAs(borrower, amount);
        assertEq(usdc.balanceOf(borrower) - balBefore, amount, "borrower should receive borrowed USDC");
    }

    function test_Borrow_RecordsOutstandingPrincipal() public {
        uint256 amount = 5_000 * WAD;
        _borrowAs(borrower, amount);
        assertEq(debtPool.outstandingPrincipal(), amount, "outstanding principal should match borrow amount");
    }

    function test_Borrow_ZeroReverts() public {
        vm.prank(borrower);
        vm.expectRevert(LendingEngine.ZeroAmount.selector);
        lendingEngine.borrow(0);
    }

    function test_Borrow_NoCollateralReverts() public {
        address noCollateral = makeAddr("noCollateral");
        vm.prank(noCollateral);
        vm.expectRevert(LendingEngine.InsufficientCollateral.selector);
        lendingEngine.borrow(1_000 * WAD);
    }

    function test_Borrow_ExceedsBorrowCapReverts() public {
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(LendingEngine.BorrowCapExceeded.selector, BORROW_CAP + 1, BORROW_CAP));
        lendingEngine.borrow(BORROW_CAP + 1);
    }

    function test_Borrow_BelowMinimumReverts() public {
        vm.prank(borrower);
        vm.expectRevert(
            abi.encodeWithSelector(LendingEngine.DebtBelowMinimum.selector, MIN_BORROW_AMOUNT - 1, MIN_BORROW_AMOUNT)
        );
        lendingEngine.borrow(MIN_BORROW_AMOUNT - 1);
    }

    function test_Borrow_ExceedsLTVReverts() public {
        // borrow above 70% LTV of collateral value (20 WAD @ 1000 = 20000 USD)
        // max borrow = 20000 * 0.70 = 14000 (but RiskGateway may use healthyMaxLtvBps = 7500 for effective LTV)
        // healthyMaxLtvBps = 7500, maxLtvBps = 7000 → effective = min(7500, 7000) = 7000
        // max borrow = 20000 * 7000 / 10000 = 14000 WAD
        vm.prank(borrower);
        vm.expectRevert(LendingEngine.InsufficientCollateral.selector);
        lendingEngine.borrow(15_000 * WAD);
    }

    function test_Repay_EmitsRepaidEvent() public {
        _borrowAs(borrower, 5_000 * WAD);
        vm.prank(borrower);
        // Only check topic1 (borrower address); amount/principalPaid/interestPaid/correlationId not checked
        vm.expectEmit(true, false, false, false, address(lendingEngine));
        emit LendingEngine.Repaid(borrower, 0, 0, 0, bytes32(0));
        lendingEngine.repay(1_000 * WAD);
    }

    function test_Repay_ReducesDebt() public {
        _borrowAs(borrower, 5_000 * WAD);
        uint256 debtBefore = lendingEngine.currentDebt(borrower);

        vm.prank(borrower);
        lendingEngine.repay(1_000 * WAD);

        assertLt(lendingEngine.currentDebt(borrower), debtBefore, "debt should decrease after repay");
    }

    function test_Repay_AccumulatesReserves() public {
        _borrowAs(borrower, 5_000 * WAD);
        vm.warp(block.timestamp + 30 days);

        vm.prank(borrower);
        lendingEngine.repay(200 * WAD);

        assertGt(debtPool.reserveBalance(), 0, "reserve balance should be > 0 after repay with interest");
    }

    function test_Repay_ZeroReverts() public {
        _borrowAs(borrower, 1_000 * WAD);
        vm.prank(borrower);
        vm.expectRevert(LendingEngine.ZeroAmount.selector);
        lendingEngine.repay(0);
    }

    function test_Repay_NoDebtReverts() public {
        vm.prank(borrower);
        vm.expectRevert(LendingEngine.NoDebt.selector);
        lendingEngine.repay(1_000 * WAD);
    }

    function test_WithdrawCollateral_DecreasesPosition() public {
        (uint256 colBefore,,,,) = lendingEngine.positions(borrower);
        uint256 withdrawAmount = 5 * WAD;

        vm.prank(borrower);
        lendingEngine.withdrawCollateral(withdrawAmount);

        (uint256 colAfter,,,,) = lendingEngine.positions(borrower);
        assertEq(colAfter, colBefore - withdrawAmount, "collateral should decrease after withdrawal");
    }

    function test_WithdrawCollateral_ZeroReverts() public {
        vm.prank(borrower);
        vm.expectRevert(LendingEngine.ZeroAmount.selector);
        lendingEngine.withdrawCollateral(0);
    }

    function test_WithdrawCollateral_UnsafeReverts() public {
        _borrowAs(borrower, 5_000 * WAD);
        // Try to withdraw most collateral — should revert since it would push LTV above max
        vm.prank(borrower);
        vm.expectRevert(LendingEngine.InsufficientCollateral.selector);
        lendingEngine.withdrawCollateral(15 * WAD);
    }

    function test_WithdrawCollateral_StaleOracleReverts() public {
        vm.warp(block.timestamp + ORACLE_MAX_AGE_SECONDS + 1);
        vm.prank(borrower);
        vm.expectRevert(); // OraclePriceStale
        lendingEngine.withdrawCollateral(5 * WAD);
    }

    function test_Liquidate_BasicFlow() public {
        _borrowAs(borrower, 5_000 * WAD);
        // Use deeply bad price so debt >> collateral value → bad debt path → position fully cleared
        _makeLiquidatable(21 * WAD); // collateral value = 20*21 = 420 << 5000 debt

        uint256 liquidatorColBefore = wpas.balanceOf(liquidator);
        vm.prank(liquidator);
        // Only check topic1 (borrower) and topic2 (liquidator); correlationId (topic3) not checked
        vm.expectEmit(true, true, false, false, address(lendingEngine));
        emit LendingEngine.Liquidated(borrower, liquidator, 0, 0, 0, bytes32(0));
        lendingEngine.liquidate(borrower, type(uint256).max);

        assertEq(lendingEngine.currentDebt(borrower), 0, "debt should be cleared after full liquidation");
        assertGt(wpas.balanceOf(liquidator), liquidatorColBefore, "liquidator should receive collateral");
    }

    function test_Liquidate_HealthyPositionReverts() public {
        _borrowAs(borrower, 5_000 * WAD);
        // Position is still healthy at 1000 USD/WPAS
        vm.prank(liquidator);
        vm.expectRevert(); // PositionHealthy
        lendingEngine.liquidate(borrower, type(uint256).max);
    }

    function test_Liquidate_BadDebtCleared() public {
        _borrowAs(borrower, 13_000 * WAD);
        vm.warp(block.timestamp + 2 * 365 days); // accrue significant interest
        _makeLiquidatable(21 * WAD); // deep bad debt

        vm.expectEmit(true, false, false, false, address(lendingEngine));
        emit LendingEngine.BadDebtRealized(borrower, 0);
        vm.prank(liquidator);
        lendingEngine.liquidate(borrower, type(uint256).max);

        assertEq(lendingEngine.currentDebt(borrower), 0, "debt cleared after bad debt liquidation");
        assertEq(debtPool.outstandingPrincipal(), 0, "pool principal cleared after bad debt");
    }

    function test_Liquidate_LeavingDustDebtReverts() public {
        _borrowAs(borrower, 150 * WAD);
        _makeLiquidatable(4 * WAD);

        vm.prank(liquidator);
        // After partial repay of 60 WAD: remaining = ~90 WAD < minBorrowAmount (100 WAD)
        vm.expectRevert(
            abi.encodeWithSelector(LendingEngine.DebtBelowMinimum.selector, 90 * WAD, MIN_BORROW_AMOUNT)
        );
        lendingEngine.liquidate(borrower, 60 * WAD);
    }

    function test_Liquidate_ZeroAmountReverts() public {
        _borrowAs(borrower, 5_000 * WAD);
        _makeLiquidatable(250 * WAD);
        vm.prank(liquidator);
        vm.expectRevert(LendingEngine.ZeroAmount.selector);
        lendingEngine.liquidate(borrower, 0);
    }

    // =========================================================================
    // Oracle staleness
    // =========================================================================

    function test_Borrow_StaleOracleReverts() public {
        vm.warp(block.timestamp + ORACLE_MAX_AGE_SECONDS + 1);
        vm.prank(borrower);
        vm.expectRevert(); // OraclePriceStale
        lendingEngine.borrow(MIN_BORROW_AMOUNT);
    }

    function test_Repay_WorksWithStaleOracle() public {
        _borrowAs(borrower, 1_000 * WAD);
        vm.warp(block.timestamp + ORACLE_MAX_AGE_SECONDS + 1);
        // Repay should work even with stale oracle
        vm.prank(borrower);
        lendingEngine.repay(100 * WAD);
    }

    // =========================================================================
    // Pause behavior
    // =========================================================================

    function test_Pause_BlocksBorrow() public {
        _borrowAs(borrower, 1_000 * WAD);
        lendingEngine.pause();

        vm.prank(borrower);
        vm.expectRevert(); // EnforcedPause
        lendingEngine.borrow(MIN_BORROW_AMOUNT);
    }

    function test_Pause_AllowsRepay() public {
        _borrowAs(borrower, 1_000 * WAD);
        lendingEngine.pause();

        uint256 debtBefore = lendingEngine.currentDebt(borrower);
        vm.prank(borrower);
        lendingEngine.repay(100 * WAD);
        assertLt(lendingEngine.currentDebt(borrower), debtBefore, "repay should work while paused");
    }

    function test_Unpause_AllowsBorrowAgain() public {
        lendingEngine.pause();
        lendingEngine.unpause();

        vm.prank(borrower);
        lendingEngine.borrow(1_000 * WAD);
    }

    // =========================================================================
    // Reserve claims
    // =========================================================================

    function test_ClaimReserves_RequiresTreasuryRole() public {
        _borrowAs(borrower, 1_000 * WAD);
        vm.warp(block.timestamp + 30 days);
        vm.prank(borrower);
        lendingEngine.repay(200 * WAD);

        uint256 reserves = debtPool.reserveBalance();
        assertGt(reserves, 0, "should have reserves");

        vm.prank(outsider);
        vm.expectRevert(); // AccessManagedUnauthorized
        debtPool.claimReserves(outsider, reserves);

        // Admin (address(this) = deployer) has TREASURY role
        uint256 balBefore = usdc.balanceOf(deployer);
        debtPool.claimReserves(deployer, reserves);
        assertEq(usdc.balanceOf(deployer) - balBefore, reserves, "deployer should receive reserves");
    }

    // =========================================================================
    // USDC mint access
    // =========================================================================

    function test_USDCMint_RequiresMinterRole() public {
        vm.prank(outsider);
        vm.expectRevert(); // AccessManagedUnauthorized
        usdc.mint(outsider, WAD);
    }

    function test_USDCMint_AdminCanMint() public {
        uint256 balBefore = usdc.balanceOf(deployer);
        usdc.mint(deployer, 1_000 * WAD);
        assertEq(usdc.balanceOf(deployer) - balBefore, 1_000 * WAD, "minter should be able to mint");
    }

    // =========================================================================
    // depositCollateralFor (V2 feature, merged from LendingCoreV2.ts)
    // =========================================================================

    function test_DepositCollateralFor_CreditsBeneficiary() public {
        uint256 depositAmount = 5 * WAD;

        // Grant ROUTER role to deployer so we can test depositCollateralFor
        bytes4[] memory routerSelectors = new bytes4[](1);
        routerSelectors[0] = lendingEngine.depositCollateralFor.selector;
        accessManager.setTargetFunctionRole(address(lendingEngine), routerSelectors, ROLE_ROUTER);
        accessManager.grantRole(ROLE_ROUTER, deployer, 0);

        // Give deployer WPAS as the "router"
        wpas.deposit{value: depositAmount}();
        wpas.approve(address(lendingEngine), depositAmount);

        (uint256 beneficiaryBefore,,,,) = lendingEngine.positions(borrower);
        (uint256 callerBefore,,,,) = lendingEngine.positions(deployer);

        // Check topic1 (beneficiary) and data (amount); correlationId (topic2) not checked
        vm.expectEmit(true, false, false, true, address(lendingEngine));
        emit LendingEngine.CollateralDeposited(borrower, depositAmount, bytes32(0));
        lendingEngine.depositCollateralFor(borrower, depositAmount);

        (uint256 beneficiaryAfter,,,,) = lendingEngine.positions(borrower);
        (uint256 callerAfter,,,,) = lendingEngine.positions(deployer);

        assertEq(beneficiaryAfter, beneficiaryBefore + depositAmount, "beneficiary collateral should increase");
        assertEq(callerAfter, callerBefore, "caller collateral should be unchanged");
    }

    function test_DepositCollateralFor_UnauthorizedReverts() public {
        uint256 depositAmount = 1 * WAD;

        // Give outsider WPAS
        vm.deal(outsider, 10 ether);
        vm.startPrank(outsider);
        wpas.deposit{value: depositAmount}();
        wpas.approve(address(lendingEngine), depositAmount);

        vm.expectRevert(); // AccessManagedUnauthorized
        lendingEngine.depositCollateralFor(borrower, depositAmount);
        vm.stopPrank();
    }

    function test_DepositCollateralFor_ZeroBeneficiaryReverts() public {
        bytes4[] memory routerSelectors = new bytes4[](1);
        routerSelectors[0] = lendingEngine.depositCollateralFor.selector;
        accessManager.setTargetFunctionRole(address(lendingEngine), routerSelectors, ROLE_ROUTER);
        accessManager.grantRole(ROLE_ROUTER, deployer, 0);

        uint256 depositAmount = 1 * WAD;
        wpas.deposit{value: depositAmount}();
        wpas.approve(address(lendingEngine), depositAmount);

        vm.expectRevert(LendingEngine.InvalidConfiguration.selector);
        lendingEngine.depositCollateralFor(address(0), depositAmount);
    }

    // =========================================================================
    // Liquidation notifier hook (V2 feature)
    // =========================================================================

    function test_LiquidationHook_NotifierCalledOnLiquidation() public {
        MockLiquidationNotifier mockNotifier = new MockLiquidationNotifier(false);
        _deployWithNotifier(address(mockNotifier));

        _borrowAs(borrower, 5_000 * WAD);
        _makeLiquidatable(21 * WAD);

        vm.prank(liquidator);
        vm.expectEmit(true, false, false, false, address(mockNotifier));
        emit MockLiquidationNotifier.NotificationReceived(borrower, 0, 0, bytes32(0));
        lendingEngine.liquidate(borrower, type(uint256).max);

        assertEq(mockNotifier.callCount(), 1, "notifier should have been called once");
        assertEq(mockNotifier.lastBorrower(), borrower, "notifier should record borrower");
        assertGt(mockNotifier.lastDebtRepaid(), 0, "notifier should record debt repaid");
        assertGt(mockNotifier.lastCollateralSeized(), 0, "notifier should record collateral seized");
    }

    function test_LiquidationHook_RevertingNotifierDoesNotBlockLiquidation() public {
        MockLiquidationNotifier revertingNotifier = new MockLiquidationNotifier(true);
        _deployWithNotifier(address(revertingNotifier));

        _borrowAs(borrower, 5_000 * WAD);
        _makeLiquidatable(21 * WAD);

        uint256 debtBefore = lendingEngine.currentDebt(borrower);
        vm.prank(liquidator);
        lendingEngine.liquidate(borrower, type(uint256).max);
        assertLt(lendingEngine.currentDebt(borrower), debtBefore, "liquidation should succeed even when notifier reverts");
    }

    function test_LiquidationHook_ZeroAddressNotifierSucceeds() public {
        // Default setup has address(0) notifier
        _borrowAs(borrower, 5_000 * WAD);
        _makeLiquidatable(21 * WAD);

        vm.prank(liquidator);
        lendingEngine.liquidate(borrower, type(uint256).max);
        assertEq(lendingEngine.currentDebt(borrower), 0, "liquidation should succeed without notifier");
    }

    function test_LiquidationNotifier_IsSetAtConstruction() public {
        assertEq(lendingEngine.liquidationNotifier(), address(0), "notifier should be address(0) by default");

        MockLiquidationNotifier notifier = new MockLiquidationNotifier(false);
        _deployWithNotifier(address(notifier));
        assertEq(lendingEngine.liquidationNotifier(), address(notifier), "notifier should match constructor arg");
    }

    // =========================================================================
    // Health factor and available-to-borrow
    // =========================================================================

    function test_HealthFactor_NoDebtIsMaxUint() public view {
        uint256 hf = lendingEngine.healthFactor(borrower);
        assertEq(hf, type(uint256).max, "no-debt position should have max health factor");
    }

    function test_HealthFactor_UnderwaterIsLessThanOne() public {
        _borrowAs(borrower, 5_000 * WAD);
        _makeLiquidatable(250 * WAD);
        uint256 hf = lendingEngine.healthFactor(borrower);
        assertLt(hf, WAD, "underwater position should have health factor < 1");
    }

    function test_AvailableToBorrow_NoCollateralIsZero() public view {
        uint256 available = lendingEngine.availableToBorrow(outsider);
        assertEq(available, 0, "address with no collateral should have 0 available to borrow");
    }

    function test_AvailableToBorrow_DecreasesAfterBorrow() public {
        uint256 before = lendingEngine.availableToBorrow(borrower);
        _borrowAs(borrower, 1_000 * WAD);
        uint256 after_ = lendingEngine.availableToBorrow(borrower);
        assertLt(after_, before, "available to borrow should decrease after borrowing");
    }

    // =========================================================================
    // Interest accrual
    // =========================================================================

    function test_InterestAccrues_CurrentDebtGrowsOverTime() public {
        _borrowAs(borrower, 5_000 * WAD);
        uint256 debtAtBorrow = lendingEngine.currentDebt(borrower);
        vm.warp(block.timestamp + 30 days);
        assertGt(lendingEngine.currentDebt(borrower), debtAtBorrow, "debt should grow with interest");
    }
}
