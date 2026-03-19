// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {DualVMAccessManager} from "../contracts/DualVMAccessManager.sol";
import {LiquidationHookRegistry} from "../contracts/LiquidationHookRegistry.sol";
import {MockLiquidationNotifier} from "../contracts/test/MockLiquidationNotifier.sol";

/// @notice Unit tests for LiquidationHookRegistry governance-managed hook dispatch.
contract LiquidationHookRegistryTest is Test {
    DualVMAccessManager internal accessManager;
    LiquidationHookRegistry internal registry;
    MockLiquidationNotifier internal goodMock;
    MockLiquidationNotifier internal badMock;

    address internal admin;
    address internal caller;
    address internal outsider;

    bytes32 internal constant HOOK_TYPE_A = keccak256("LIQUIDATION");
    bytes32 internal constant HOOK_TYPE_B = keccak256("OTHER_HOOK");

    uint256 internal constant DEBT_REPAID = 1000 * 1e18;
    uint256 internal constant COLLATERAL_SEIZED = 1100 * 1e18;
    bytes32 internal constant SAMPLE_CORRELATION_ID = keccak256("test-correlation-id");

    function setUp() public {
        admin = address(this);
        caller = makeAddr("caller");
        outsider = makeAddr("outsider");

        accessManager = new DualVMAccessManager(admin);
        registry = new LiquidationHookRegistry(address(accessManager));

        goodMock = new MockLiquidationNotifier(false);
        badMock = new MockLiquidationNotifier(true);
    }

    // -------------------------------------------------------------------------
    // DEFAULT_HOOK_TYPE
    // -------------------------------------------------------------------------

    function test_DefaultHookType_IsLiquidationHash() public view {
        assertEq(registry.DEFAULT_HOOK_TYPE(), keccak256("LIQUIDATION"));
    }

    // -------------------------------------------------------------------------
    // registerHook
    // -------------------------------------------------------------------------

    function test_RegisterHook_StoresHandlerAndEmits() public {
        address handlerAddr = address(goodMock);
        vm.expectEmit(true, true, false, false, address(registry));
        emit LiquidationHookRegistry.HookRegistered(HOOK_TYPE_A, handlerAddr);
        registry.registerHook(HOOK_TYPE_A, handlerAddr);

        assertEq(registry.getHook(HOOK_TYPE_A), handlerAddr);
    }

    function test_RegisterHook_ZeroAddressReverts() public {
        vm.expectRevert(LiquidationHookRegistry.ZeroHandlerAddress.selector);
        registry.registerHook(HOOK_TYPE_A, address(0));
    }

    function test_RegisterHook_ReplacesPreviousHandler() public {
        registry.registerHook(HOOK_TYPE_A, address(goodMock));
        MockLiquidationNotifier newMock = new MockLiquidationNotifier(false);
        registry.registerHook(HOOK_TYPE_A, address(newMock));
        assertEq(registry.getHook(HOOK_TYPE_A), address(newMock));
    }

    function test_RegisterHook_UnauthorizedReverts() public {
        vm.prank(outsider);
        vm.expectRevert();
        registry.registerHook(HOOK_TYPE_A, address(goodMock));
    }

    // -------------------------------------------------------------------------
    // deregisterHook
    // -------------------------------------------------------------------------

    function test_DeregisterHook_RemovesHandlerAndEmits() public {
        registry.registerHook(HOOK_TYPE_A, address(goodMock));

        vm.expectEmit(true, true, false, false, address(registry));
        emit LiquidationHookRegistry.HookDeregistered(HOOK_TYPE_A, address(goodMock));
        registry.deregisterHook(HOOK_TYPE_A);

        assertEq(registry.getHook(HOOK_TYPE_A), address(0));
    }

    function test_DeregisterHook_MissingKeyReverts() public {
        vm.expectRevert(abi.encodeWithSelector(LiquidationHookRegistry.HookNotRegistered.selector, HOOK_TYPE_B));
        registry.deregisterHook(HOOK_TYPE_B);
    }

    // -------------------------------------------------------------------------
    // getHook
    // -------------------------------------------------------------------------

    function test_GetHook_ReturnsZeroForUnregistered() public view {
        assertEq(registry.getHook(HOOK_TYPE_B), address(0));
    }

    function test_GetHook_ReturnsRegisteredHandler() public {
        registry.registerHook(HOOK_TYPE_A, address(goodMock));
        assertEq(registry.getHook(HOOK_TYPE_A), address(goodMock));
    }

    // -------------------------------------------------------------------------
    // executeHooks
    // -------------------------------------------------------------------------

    function test_ExecuteHooks_CallsHandlerAndEmitsExecuted() public {
        registry.registerHook(HOOK_TYPE_A, address(goodMock));
        bytes memory data = abi.encode(makeAddr("borrower"), DEBT_REPAID, COLLATERAL_SEIZED, SAMPLE_CORRELATION_ID);

        vm.expectEmit(true, true, false, false, address(registry));
        emit LiquidationHookRegistry.HookExecuted(HOOK_TYPE_A, address(goodMock));
        registry.executeHooks(HOOK_TYPE_A, data);

        assertEq(goodMock.callCount(), 1);
    }

    function test_ExecuteHooks_NoHandlerIsNoOp() public {
        bytes memory data = abi.encode(makeAddr("borrower"), DEBT_REPAID, COLLATERAL_SEIZED, SAMPLE_CORRELATION_ID);
        // Should not revert — silently returns
        registry.executeHooks(HOOK_TYPE_B, data);
    }

    function test_ExecuteHooks_RevertingHandlerEmitsHookFailed() public {
        registry.registerHook(HOOK_TYPE_A, address(badMock));
        bytes memory data = abi.encode(makeAddr("borrower"), DEBT_REPAID, COLLATERAL_SEIZED, SAMPLE_CORRELATION_ID);

        vm.expectEmit(true, true, false, false, address(registry));
        emit LiquidationHookRegistry.HookFailed(HOOK_TYPE_A, address(badMock), bytes(""));
        registry.executeHooks(HOOK_TYPE_A, data);
    }

    function test_ExecuteHooks_RevertingHandlerDoesNotRevertCaller() public {
        registry.registerHook(HOOK_TYPE_A, address(badMock));
        bytes memory data = abi.encode(makeAddr("borrower"), DEBT_REPAID, COLLATERAL_SEIZED, SAMPLE_CORRELATION_ID);
        // Should not revert
        registry.executeHooks(HOOK_TYPE_A, data);
    }

    // -------------------------------------------------------------------------
    // notifyLiquidation — ILiquidationNotifier dispatch
    // -------------------------------------------------------------------------

    function test_NotifyLiquidation_DispatchesToDefaultHookType() public {
        registry.registerHook(registry.DEFAULT_HOOK_TYPE(), address(goodMock));

        address borrower = makeAddr("borrower");
        registry.notifyLiquidation(borrower, DEBT_REPAID, COLLATERAL_SEIZED, SAMPLE_CORRELATION_ID);

        assertEq(goodMock.callCount(), 1);
        assertEq(goodMock.lastBorrower(), borrower);
        assertEq(goodMock.lastDebtRepaid(), DEBT_REPAID);
        assertEq(goodMock.lastCollateralSeized(), COLLATERAL_SEIZED);
        assertEq(goodMock.lastCorrelationId(), SAMPLE_CORRELATION_ID);
    }

    function test_NotifyLiquidation_NoHandlerIsNoOp() public {
        // No handler registered — should not revert
        registry.notifyLiquidation(makeAddr("borrower"), DEBT_REPAID, COLLATERAL_SEIZED, SAMPLE_CORRELATION_ID);
    }

    // -------------------------------------------------------------------------
    // Full lifecycle: register/execute/deregister
    // -------------------------------------------------------------------------

    function test_FullLifecycle_RegisterExecuteDeregister() public {
        address borrower = makeAddr("borrower");

        // Register
        registry.registerHook(HOOK_TYPE_A, address(goodMock));
        assertEq(registry.getHook(HOOK_TYPE_A), address(goodMock));

        // Execute
        bytes memory data = abi.encode(borrower, DEBT_REPAID, COLLATERAL_SEIZED, SAMPLE_CORRELATION_ID);
        registry.executeHooks(HOOK_TYPE_A, data);
        assertEq(goodMock.callCount(), 1);

        // Deregister
        registry.deregisterHook(HOOK_TYPE_A);
        assertEq(registry.getHook(HOOK_TYPE_A), address(0));

        // Execute after deregister: no-op
        registry.executeHooks(HOOK_TYPE_A, data);
        assertEq(goodMock.callCount(), 1, "no more calls after deregister");
    }
}
