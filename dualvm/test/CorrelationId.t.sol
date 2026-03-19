// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
import {LiquidationHookRegistry} from "../contracts/LiquidationHookRegistry.sol";
import {MockLiquidationNotifier} from "../contracts/test/MockLiquidationNotifier.sol";
import {XcmNotifierAdapter} from "../contracts/XcmNotifierAdapter.sol";
import {XcmLiquidationNotifier} from "../contracts/precompiles/XcmLiquidationNotifier.sol";
import {IXcm, XCM_PRECOMPILE_ADDRESS} from "../contracts/precompiles/IXcm.sol";

/// @notice Tests for correlationId propagation through the bilateral async event trace.
///
/// Verifies:
///   1. CorrelationId appears in all LendingEngine operation events (borrow, repay, deposit, withdraw, liquidate)
///   2. CorrelationId is propagated from LendingEngine → ILiquidationNotifier.notifyLiquidation
///   3. CorrelationId is forwarded through LiquidationHookRegistry to handlers
///   4. CorrelationId reaches MockLiquidationNotifier.lastCorrelationId
///   5. CorrelationIds are unique per operation (different for successive calls)
contract CorrelationIdTest is BaseTest {
    MockLiquidationNotifier internal mockNotifier;
    LiquidationHookRegistry internal hookRegistry;

    function setUp() public override {
        mockNotifier = new MockLiquidationNotifier(false);
        super.setUp();
    }

    // Override to deploy with hook registry as notifier
    function _deploySystem() internal override {
        // Deploy base system first (without notifier)
        super._deploySystem();

        // Deploy hook registry wired to mockNotifier
        hookRegistry = new LiquidationHookRegistry(address(accessManager));
    }

    function _wireRoles() internal override {
        super._wireRoles();

        // Grant GOVERNANCE role to deployer for hook registry
        bytes4[] memory hookSelectors = new bytes4[](2);
        hookSelectors[0] = hookRegistry.registerHook.selector;
        hookSelectors[1] = hookRegistry.deregisterHook.selector;
        accessManager.setTargetFunctionRole(address(hookRegistry), hookSelectors, ROLE_GOVERNANCE);
        accessManager.grantRole(ROLE_GOVERNANCE, deployer, 0);

        // Register mockNotifier as the DEFAULT_HOOK_TYPE handler
        hookRegistry.registerHook(hookRegistry.DEFAULT_HOOK_TYPE(), address(mockNotifier));
    }

    // -------------------------------------------------------------------------
    // CollateralDeposited correlationId
    // -------------------------------------------------------------------------

    function test_CorrelationId_InDepositEvent() public {
        uint256 depositAmount = 5 * 1e18;
        address testBorrower = makeAddr("depositTestBorrower");
        vm.deal(testBorrower, 100 ether);

        vm.startPrank(testBorrower);
        wpas.deposit{value: depositAmount}();
        wpas.approve(address(lendingEngine), type(uint256).max);

        // Listen for CollateralDeposited event with correlationId in topic2
        vm.expectEmit(true, false, false, true, address(lendingEngine));
        emit LendingEngine.CollateralDeposited(testBorrower, depositAmount, bytes32(0));
        lendingEngine.depositCollateral(depositAmount);
        vm.stopPrank();
    }

    function test_CorrelationId_InWithdrawEvent() public {
        // borrower already has collateral from setUp
        uint256 withdrawAmount = 1 * 1e18;
        vm.prank(borrower);
        vm.expectEmit(true, false, false, true, address(lendingEngine));
        emit LendingEngine.CollateralWithdrawn(borrower, withdrawAmount, bytes32(0));
        lendingEngine.withdrawCollateral(withdrawAmount);
    }

    // -------------------------------------------------------------------------
    // Borrowed correlationId
    // -------------------------------------------------------------------------

    function test_CorrelationId_InBorrowEvent() public {
        uint256 amount = 5_000 * 1e18;
        vm.prank(borrower);
        // Only check topic1 (account); correlationId (topic2) not checked (unknown)
        vm.expectEmit(true, false, false, false, address(lendingEngine));
        emit LendingEngine.Borrowed(borrower, amount, 0, bytes32(0));
        lendingEngine.borrow(amount);
    }

    function test_CorrelationId_IsNonZeroInBorrowEvent() public {
        // Record the actual event to verify correlationId != 0
        uint256 amount = 5_000 * 1e18;
        vm.recordLogs();
        vm.prank(borrower);
        lendingEngine.borrow(amount);

        // Find the Borrowed event and verify correlationId is non-zero
        // Borrowed event: (address indexed account, uint256 amount, uint256 borrowRateBps, bytes32 indexed correlationId)
        // topics[0] = selector, topics[1] = account, topics[2] = correlationId
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool foundBorrowed = false;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(lendingEngine)
                && logs[i].topics[0] == LendingEngine.Borrowed.selector)
            {
                bytes32 correlationId = logs[i].topics[2]; // 2nd indexed param
                assertNotEq(correlationId, bytes32(0), "correlationId should be non-zero");
                foundBorrowed = true;
            }
        }
        assertTrue(foundBorrowed, "Borrowed event should be emitted");
    }

    function test_CorrelationId_IsUniquePerOperation() public {
        uint256 amount = 1_000 * 1e18;

        vm.recordLogs();
        vm.prank(borrower);
        lendingEngine.borrow(amount);
        Vm.Log[] memory logs1 = vm.getRecordedLogs();

        vm.recordLogs();
        vm.prank(borrower);
        lendingEngine.borrow(amount);
        Vm.Log[] memory logs2 = vm.getRecordedLogs();

        // Extract correlationIds from both Borrowed events
        // Borrowed: (address indexed account, uint256, uint256, bytes32 indexed correlationId)
        // topics[0]=selector, topics[1]=account, topics[2]=correlationId
        bytes32 corrId1;
        bytes32 corrId2;
        for (uint256 i = 0; i < logs1.length; i++) {
            if (logs1[i].topics[0] == LendingEngine.Borrowed.selector) {
                corrId1 = logs1[i].topics[2];
            }
        }
        for (uint256 i = 0; i < logs2.length; i++) {
            if (logs2[i].topics[0] == LendingEngine.Borrowed.selector) {
                corrId2 = logs2[i].topics[2];
            }
        }

        assertNotEq(corrId1, bytes32(0), "first correlationId non-zero");
        assertNotEq(corrId2, bytes32(0), "second correlationId non-zero");
        assertNotEq(corrId1, corrId2, "successive operations have different correlationIds");
    }

    // -------------------------------------------------------------------------
    // Repaid correlationId
    // -------------------------------------------------------------------------

    function test_CorrelationId_InRepayEvent() public {
        _borrowAs(borrower, 5_000 * 1e18);

        vm.prank(borrower);
        vm.expectEmit(true, false, false, false, address(lendingEngine));
        emit LendingEngine.Repaid(borrower, 0, 0, 0, bytes32(0));
        lendingEngine.repay(1_000 * 1e18);
    }

    // -------------------------------------------------------------------------
    // Liquidated correlationId + hook propagation
    // -------------------------------------------------------------------------

    function test_CorrelationId_InLiquidatedEvent() public {
        _borrowAs(borrower, 5_000 * 1e18);
        _makeLiquidatable(21 * 1e18);

        vm.prank(liquidator);
        // Check topics 1 (borrower) and 2 (liquidator); correlationId (topic3) not checked
        vm.expectEmit(true, true, false, false, address(lendingEngine));
        emit LendingEngine.Liquidated(borrower, liquidator, 0, 0, 0, bytes32(0));
        lendingEngine.liquidate(borrower, type(uint256).max);
    }

    function test_CorrelationId_PropagatedToLiquidationNotifier() public {
        // Deploy a fresh engine with hookRegistry as the notifier
        _deployWithNotifier(address(hookRegistry));
        hookRegistry.registerHook(hookRegistry.DEFAULT_HOOK_TYPE(), address(mockNotifier));

        _borrowAs(borrower, 5_000 * 1e18);
        _makeLiquidatable(21 * 1e18);

        vm.prank(liquidator);
        lendingEngine.liquidate(borrower, type(uint256).max);

        // Verify the mock notifier received the correlationId
        assertEq(mockNotifier.callCount(), 1, "notifier should be called once");
        assertNotEq(mockNotifier.lastCorrelationId(), bytes32(0), "correlationId propagated to notifier");
    }

    function test_CorrelationId_MatchesBetweenEventAndNotifier() public {
        // Deploy a fresh engine with mockNotifier directly as the notifier
        _deployWithNotifier(address(mockNotifier));

        _borrowAs(borrower, 5_000 * 1e18);
        _makeLiquidatable(21 * 1e18);

        vm.recordLogs();
        vm.prank(liquidator);
        lendingEngine.liquidate(borrower, type(uint256).max);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Extract correlationId from Liquidated event
        // Liquidated: (address indexed borrower, address indexed liquidator, uint256, uint256, uint256, bytes32 indexed correlationId)
        // topics[0]=selector, topics[1]=borrower, topics[2]=liquidator, topics[3]=correlationId
        bytes32 eventCorrelationId;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(lendingEngine)
                && logs[i].topics[0] == LendingEngine.Liquidated.selector)
            {
                eventCorrelationId = logs[i].topics[3]; // 3rd indexed = correlationId
            }
        }

        // The correlationId in the event should match what the notifier received
        assertNotEq(eventCorrelationId, bytes32(0));
        assertEq(mockNotifier.lastCorrelationId(), eventCorrelationId, "correlationId must match between event and notifier");
    }

    function test_CorrelationId_InHookRegistryForwardedToHandler() public {
        // Deploy engine with hookRegistry as notifier, hookRegistry forwards to mockNotifier
        _deployWithNotifier(address(hookRegistry));
        hookRegistry.registerHook(hookRegistry.DEFAULT_HOOK_TYPE(), address(mockNotifier));

        _borrowAs(borrower, 5_000 * 1e18);
        _makeLiquidatable(21 * 1e18);

        vm.recordLogs();
        vm.prank(liquidator);
        lendingEngine.liquidate(borrower, type(uint256).max);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Extract correlationId from Liquidated event
        // topics[0]=selector, topics[1]=borrower, topics[2]=liquidator, topics[3]=correlationId
        bytes32 eventCorrelationId;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(lendingEngine)
                && logs[i].topics[0] == LendingEngine.Liquidated.selector)
            {
                eventCorrelationId = logs[i].topics[3];
            }
        }

        // mockNotifier should have received the same correlationId through hookRegistry
        assertEq(mockNotifier.callCount(), 1);
        assertEq(mockNotifier.lastCorrelationId(), eventCorrelationId,
            "correlationId forwarded through hookRegistry to handler");
    }
}
