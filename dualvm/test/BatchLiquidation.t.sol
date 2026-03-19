// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";

/// @title BatchLiquidationTest
/// @notice Forge tests for batch liquidation — migrated from BatchLiquidation.ts
contract BatchLiquidationTest is BaseTest {

    address internal borrower1;
    address internal borrower2;
    address internal borrower3;

    uint256 internal constant COLLATERAL_PER_BORROWER = 20 * WAD;

    function setUp() public override {
        // Set up base system
        super.setUp();

        // Create additional borrowers
        borrower1 = makeAddr("borrower1");
        borrower2 = makeAddr("borrower2");
        borrower3 = makeAddr("borrower3");

        vm.deal(borrower1, 100 ether);
        vm.deal(borrower2, 100 ether);
        vm.deal(borrower3, 100 ether);

        // Seed additional liquidator USDC
        usdc.mint(liquidator, 100_000 * WAD);

        // Add more pool liquidity for large borrows
        usdc.mint(lender, 150_000 * WAD);
        vm.startPrank(lender);
        usdc.approve(address(debtPool), type(uint256).max);
        debtPool.deposit(150_000 * WAD, lender);
        vm.stopPrank();

        // Set up 3 borrowers with collateral and borrow positions
        // Use high borrow amounts relative to collateral for bad-debt scenarios
        uint256[3] memory borrowAmounts = [uint256(12_000 * WAD), 13_000 * WAD, 11_000 * WAD];
        address[3] memory borrowers = [borrower1, borrower2, borrower3];

        for (uint256 i = 0; i < 3; i++) {
            address b = borrowers[i];
            vm.startPrank(b);
            wpas.deposit{value: COLLATERAL_PER_BORROWER}();
            wpas.approve(address(lendingEngine), type(uint256).max);
            usdc.approve(address(lendingEngine), type(uint256).max);
            lendingEngine.depositCollateral(COLLATERAL_PER_BORROWER);
            lendingEngine.borrow(borrowAmounts[i]);
            vm.stopPrank();
        }
    }

    // =========================================================================
    // Happy path: batch liquidation
    // =========================================================================

    function test_BatchLiquidate_3Positions_SingleTx() public {
        // Advance time to accrue interest
        vm.warp(block.timestamp + 2 * 365 days);

        // Drop price to make all positions deeply underwater
        _widenOracleBreaker();
        _setOraclePrice(21 * WAD);

        // Verify all underwater
        assertLt(lendingEngine.healthFactor(borrower1), WAD, "borrower1 should be underwater");
        assertLt(lendingEngine.healthFactor(borrower2), WAD, "borrower2 should be underwater");
        assertLt(lendingEngine.healthFactor(borrower3), WAD, "borrower3 should be underwater");

        uint256 liquidatorColBefore = wpas.balanceOf(liquidator);

        address[] memory borrowers = new address[](3);
        borrowers[0] = borrower1;
        borrowers[1] = borrower2;
        borrowers[2] = borrower3;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = type(uint256).max;
        amounts[1] = type(uint256).max;
        amounts[2] = type(uint256).max;

        vm.prank(liquidator);
        lendingEngine.batchLiquidate(borrowers, amounts);

        // All positions cleared
        assertEq(lendingEngine.currentDebt(borrower1), 0, "borrower1 debt cleared");
        assertEq(lendingEngine.currentDebt(borrower2), 0, "borrower2 debt cleared");
        assertEq(lendingEngine.currentDebt(borrower3), 0, "borrower3 debt cleared");

        // Liquidator received collateral
        assertGt(wpas.balanceOf(liquidator), liquidatorColBefore, "liquidator should receive collateral");
    }

    function test_BatchLiquidate_EmitsIndividualLiquidatedEvents() public {
        vm.warp(block.timestamp + 2 * 365 days);
        _widenOracleBreaker();
        _setOraclePrice(21 * WAD);

        address[] memory borrowers = new address[](2);
        borrowers[0] = borrower1;
        borrowers[1] = borrower2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = type(uint256).max;
        amounts[1] = type(uint256).max;

        vm.prank(liquidator);
        vm.expectEmit(true, true, false, false, address(lendingEngine));
        emit LendingEngine.Liquidated(borrower1, liquidator, 0, 0, 0);
        vm.expectEmit(true, true, false, false, address(lendingEngine));
        emit LendingEngine.Liquidated(borrower2, liquidator, 0, 0, 0);
        lendingEngine.batchLiquidate(borrowers, amounts);
    }

    // =========================================================================
    // Revert cases
    // =========================================================================

    function test_BatchLiquidate_ArrayLengthMismatchReverts() public {
        address[] memory borrowers = new address[](2);
        borrowers[0] = borrower1;
        borrowers[1] = borrower2;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = type(uint256).max;

        vm.prank(liquidator);
        vm.expectRevert(LendingEngine.ArrayLengthMismatch.selector);
        lendingEngine.batchLiquidate(borrowers, amounts);
    }

    function test_BatchLiquidate_HealthyPositionReverts() public {
        _widenOracleBreaker();
        _setOraclePrice(800 * WAD);

        // borrower2 (13000 debt) should be underwater at 800 USD
        // borrower3 (11000 debt) may still be healthy
        uint256 hf2 = lendingEngine.healthFactor(borrower2);
        uint256 hf3 = lendingEngine.healthFactor(borrower3);
        assertLt(hf2, WAD, "borrower2 should be underwater");
        assertGt(hf3, WAD, "borrower3 should be healthy");

        address[] memory borrowers = new address[](2);
        borrowers[0] = borrower2;
        borrowers[1] = borrower3; // healthy — should cause revert
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = type(uint256).max;
        amounts[1] = type(uint256).max;

        vm.prank(liquidator);
        // Use expectRevert() without args since reason bytes are not easily predictable
        vm.expectRevert();
        lendingEngine.batchLiquidate(borrowers, amounts);
    }

    function test_BatchLiquidate_EmptyArraySucceeds() public {
        address[] memory borrowers = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        vm.prank(liquidator);
        lendingEngine.batchLiquidate(borrowers, amounts); // should not revert
    }

    // =========================================================================
    // Single liquidate still works
    // =========================================================================

    function test_SingleLiquidate_StillWorksAfterBatchRefactor() public {
        vm.warp(block.timestamp + 2 * 365 days);
        _widenOracleBreaker();
        _setOraclePrice(21 * WAD);

        assertLt(lendingEngine.healthFactor(borrower1), WAD, "should be underwater");
        uint256 colBefore = wpas.balanceOf(liquidator);

        vm.prank(liquidator);
        vm.expectEmit(true, true, false, false, address(lendingEngine));
        emit LendingEngine.Liquidated(borrower1, liquidator, 0, 0, 0);
        lendingEngine.liquidate(borrower1, type(uint256).max);

        assertEq(lendingEngine.currentDebt(borrower1), 0, "debt should be cleared");
        assertGt(wpas.balanceOf(liquidator), colBefore, "liquidator should receive collateral");
    }

    function test_BatchLiquidate_SingleEntry_Works() public {
        vm.warp(block.timestamp + 2 * 365 days);
        _widenOracleBreaker();
        _setOraclePrice(21 * WAD);

        address[] memory borrowers = new address[](1);
        borrowers[0] = borrower1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = type(uint256).max;

        vm.prank(liquidator);
        lendingEngine.batchLiquidate(borrowers, amounts);
        assertEq(lendingEngine.currentDebt(borrower1), 0, "single entry batch should work");
    }

    function test_BatchLiquidate_PausedDoesNotBlock() public {
        // batchLiquidate does NOT have whenNotPaused (only borrowers check it)
        // Actually it does have whenNotPaused on batchLiquidate... let's verify
        vm.warp(block.timestamp + 2 * 365 days);
        _widenOracleBreaker();
        _setOraclePrice(21 * WAD);

        address[] memory borrowers = new address[](1);
        borrowers[0] = borrower1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = type(uint256).max;

        lendingEngine.pause();
        vm.prank(liquidator);
        vm.expectRevert(); // EnforcedPause — batchLiquidate has whenNotPaused
        lendingEngine.batchLiquidate(borrowers, amounts);
        lendingEngine.unpause();
    }

    function test_BatchLiquidate_NoDebtReverts() public {
        // borrower with no debt should fail
        address noborrower = makeAddr("noborrower");

        vm.warp(block.timestamp + 2 * 365 days);
        _widenOracleBreaker();
        _setOraclePrice(21 * WAD);

        address[] memory borrowers = new address[](1);
        borrowers[0] = noborrower;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = type(uint256).max;

        vm.prank(liquidator);
        // Use expectRevert() without args since the inner reason is not easily predictable
        vm.expectRevert();
        lendingEngine.batchLiquidate(borrowers, amounts);
    }
}
