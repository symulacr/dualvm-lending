// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {LendingRouter} from "../contracts/LendingRouter.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";

/// @title LendingRouterTest
/// @notice Forge tests for LendingRouter (V2 logic) — migrated from LendingRouter.ts + LendingRouterV2.ts
///
/// The new LendingRouter uses LendingEngine.depositCollateralFor so position is credited
/// to the CALLER (msg.sender), not the router address. This is the correct production behavior.
contract LendingRouterTest is BaseTest {
    LendingRouter internal router;
    address internal user;
    address internal secondUser;

    function setUp() public override {
        super.setUp();

        user = makeAddr("user");
        secondUser = makeAddr("secondUser");
        vm.deal(user, 100 ether);
        vm.deal(secondUser, 100 ether);

        // Deploy the new LendingRouter
        router = new LendingRouter(address(wpas), address(lendingEngine));

        // Wire ROUTER role so router can call depositCollateralFor on lendingEngine
        bytes4[] memory routerSelectors = new bytes4[](1);
        routerSelectors[0] = lendingEngine.depositCollateralFor.selector;
        accessManager.setTargetFunctionRole(address(lendingEngine), routerSelectors, ROLE_ROUTER);
        accessManager.grantRole(ROLE_ROUTER, address(router), 0);
    }

    // =========================================================================
    // LendingRouter (V2 — credits caller, not router)
    // =========================================================================

    function test_Router_CreditsCaller_NotRouter() public {
        uint256 depositAmount = 1 ether;
        address routerAddr = address(router);

        (uint256 userPosBefore,,,,) = lendingEngine.positions(user);
        (uint256 routerPosBefore,,,,) = lendingEngine.positions(routerAddr);

        vm.prank(user);
        vm.expectEmit(true, false, false, true, address(router));
        emit LendingRouter.DepositedCollateralFromPAS(user, depositAmount);
        router.depositCollateralFromPAS{value: depositAmount}();

        (uint256 userPosAfter,,,,) = lendingEngine.positions(user);
        (uint256 routerPosAfter,,,,) = lendingEngine.positions(routerAddr);

        assertEq(userPosAfter, userPosBefore + depositAmount, "user position should be credited");
        assertEq(routerPosAfter, routerPosBefore, "router position should be unchanged (zero)");
    }

    function test_Router_ZeroValue_Reverts() public {
        vm.prank(user);
        vm.expectRevert(LendingRouter.ZeroAmount.selector);
        router.depositCollateralFromPAS{value: 0}();
    }

    function test_Router_MultipleUsers_IndividualPositions() public {
        uint256 depositAmount = 2 ether;
        address routerAddr = address(router);

        vm.prank(user);
        router.depositCollateralFromPAS{value: depositAmount}();

        vm.prank(secondUser);
        router.depositCollateralFromPAS{value: depositAmount}();

        (uint256 userPos,,,,) = lendingEngine.positions(user);
        (uint256 secondPos,,,,) = lendingEngine.positions(secondUser);
        (uint256 routerPos,,,,) = lendingEngine.positions(routerAddr);

        assertEq(userPos, depositAmount, "user should have their deposit credited");
        assertEq(secondPos, depositAmount, "secondUser should have their deposit credited");
        assertEq(routerPos, 0, "router position should always be zero");
    }

    function test_Router_MultipleCallsSameUser_Accumulate() public {
        uint256 depositAmount = 1 ether;

        vm.prank(user);
        router.depositCollateralFromPAS{value: depositAmount}();
        vm.prank(user);
        router.depositCollateralFromPAS{value: depositAmount}();

        (uint256 userPos,,,,) = lendingEngine.positions(user);
        assertEq(userPos, depositAmount * 2, "multiple deposits should accumulate for user");
    }

    function test_Router_EmitsDepositedCollateralFromPAS() public {
        uint256 depositAmount = 0.5 ether;
        vm.prank(user);
        vm.expectEmit(true, false, false, true, address(router));
        emit LendingRouter.DepositedCollateralFromPAS(user, depositAmount);
        router.depositCollateralFromPAS{value: depositAmount}();
    }

    function test_Router_ConstructorSetsWPASAndLendingCore() public view {
        assertEq(address(router.wpas()), address(wpas), "router wpas should match");
        assertEq(address(router.lendingCore()), address(lendingEngine), "router lendingCore should match");
    }

    function test_Router_RouterAddressHasZeroCollateralAfterMultipleOps() public {
        vm.prank(user);
        router.depositCollateralFromPAS{value: 2 ether}();
        vm.prank(secondUser);
        router.depositCollateralFromPAS{value: 3 ether}();

        (uint256 routerPos,,,,) = lendingEngine.positions(address(router));
        assertEq(routerPos, 0, "router should never accumulate collateral");
    }

    // =========================================================================
    // Without ROUTER role: depositCollateralFor reverts (security check)
    // =========================================================================

    function test_DepositCollateralFor_WithoutRole_Reverts() public {
        // Deploy an unauthorized router (no ROUTER role)
        LendingRouter unauthorizedRouter = new LendingRouter(address(wpas), address(lendingEngine));

        vm.deal(user, 10 ether);
        vm.prank(user);
        vm.expectRevert(); // AccessManagedUnauthorized since unauthorizedRouter has no ROUTER role
        unauthorizedRouter.depositCollateralFromPAS{value: 1 ether}();
    }

    // =========================================================================
    // Router canary: correct WPAS wrapping and approval
    // =========================================================================

    function test_Router_WPASBalanceIsZeroAfterDeposit() public {
        vm.prank(user);
        router.depositCollateralFromPAS{value: 1 ether}();

        // Router should not hold any WPAS after the operation
        assertEq(wpas.balanceOf(address(router)), 0, "router should not hold WPAS after deposit");
    }

    // =========================================================================
    // Integration: user can borrow after router deposit
    // =========================================================================

    function test_Router_UserCanBorrowAfterDeposit() public {
        uint256 depositAmount = 20 ether;
        vm.prank(user);
        router.depositCollateralFromPAS{value: depositAmount}();

        uint256 borrowAmount = 5_000 * WAD;
        usdc.approve(address(lendingEngine), type(uint256).max);

        vm.prank(user);
        lendingEngine.borrow(borrowAmount);

        assertEq(usdc.balanceOf(user), borrowAmount, "user should have borrowed USDC");
    }

    function test_Router_UserPositionCorrectAfterDeposit() public {
        uint256 depositAmount = 10 ether;
        vm.prank(user);
        router.depositCollateralFromPAS{value: depositAmount}();

        (uint256 collateral,,,,) = lendingEngine.positions(user);
        assertEq(collateral, depositAmount, "user's collateral position should match deposited amount");
    }
}
