// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
import {ManualOracle} from "../contracts/ManualOracle.sol";
import {DebtPool} from "../contracts/DebtPool.sol";
import {DualVMAccessManager} from "../contracts/DualVMAccessManager.sol";

/// @title ManagedAccessTest
/// @notice Forge tests for AccessManager role enforcement across all protocol contracts
///         Migrated from managedAccess.ts and expanded for Solidity-based testing
contract ManagedAccessTest is BaseTest {
    // =========================================================================
    // Oracle access control
    // =========================================================================

    function test_Oracle_SetPrice_RequiresRiskAdmin() public {
        // outsider has no RISK_ADMIN role
        vm.prank(outsider);
        vm.expectRevert(); // AccessManagedUnauthorized
        oracle.setPrice(900 * WAD);
    }

    function test_Oracle_SetPrice_RiskAdminCanUpdate() public {
        // deployer (address(this)) has RISK_ADMIN role
        oracle.setPrice(900 * WAD); // within 25% delta
        assertEq(oracle.priceWad(), 900 * WAD, "price should be updated by RISK_ADMIN");
    }

    function test_Oracle_SetMaxAge_RequiresRiskAdmin() public {
        vm.prank(outsider);
        vm.expectRevert();
        oracle.setMaxAge(1 hours);
    }

    function test_Oracle_SetMaxAge_RiskAdminCanUpdate() public {
        oracle.setMaxAge(1 hours);
        assertEq(oracle.maxAge(), 1 hours, "max age should be updated");
    }

    function test_Oracle_SetCircuitBreaker_RequiresRiskAdmin() public {
        vm.prank(outsider);
        vm.expectRevert();
        oracle.setCircuitBreaker(ORACLE_MIN_PRICE_WAD, ORACLE_MAX_PRICE_WAD, 10_000);
    }

    function test_Oracle_SetCircuitBreaker_RiskAdminCanUpdate() public {
        oracle.setCircuitBreaker(ORACLE_MIN_PRICE_WAD, ORACLE_MAX_PRICE_WAD, 10_000);
        assertEq(oracle.maxPriceChangeBps(), 10_000, "max price change should be updated");
    }

    function test_Oracle_Pause_RequiresEmergency() public {
        vm.prank(outsider);
        vm.expectRevert();
        oracle.pause();
    }

    function test_Oracle_Pause_EmergencyCanPause() public {
        oracle.pause();
        assertTrue(oracle.paused(), "oracle should be paused");
        oracle.unpause();
        assertFalse(oracle.paused(), "oracle should be unpaused");
    }

    // =========================================================================
    // LendingEngine access control
    // =========================================================================

    function test_LendingEngine_Pause_RequiresEmergency() public {
        vm.prank(outsider);
        vm.expectRevert();
        lendingEngine.pause();
    }

    function test_LendingEngine_Pause_EmergencyCanPause() public {
        lendingEngine.pause();
        assertTrue(lendingEngine.paused(), "lendingEngine should be paused");
        lendingEngine.unpause();
    }

    function test_LendingEngine_FreezeNewDebt_RequiresAdmin() public {
        // freezeNewDebt has no explicit role mapping → defaults to ADMIN_ROLE
        // outsider is not admin
        vm.prank(outsider);
        vm.expectRevert();
        lendingEngine.freezeNewDebt();
    }

    function test_LendingEngine_FreezeNewDebt_AdminCanFreeze() public {
        lendingEngine.freezeNewDebt();
        assertTrue(lendingEngine.newDebtFrozen(), "debt should be frozen");
    }

    // =========================================================================
    // DebtPool access control
    // =========================================================================

    function test_DebtPool_ClaimReserves_RequiresTreasury() public {
        // First create some reserves
        _borrowAs(borrower, 1_000 * WAD);
        vm.warp(block.timestamp + 30 days);
        vm.prank(borrower);
        lendingEngine.repay(200 * WAD);

        uint256 reserves = debtPool.reserveBalance();
        assertGt(reserves, 0, "should have reserves");

        vm.prank(outsider);
        vm.expectRevert(); // AccessManagedUnauthorized
        debtPool.claimReserves(outsider, reserves);
    }

    function test_DebtPool_ClaimReserves_TreasuryCanClaim() public {
        // Create reserves
        _borrowAs(borrower, 1_000 * WAD);
        vm.warp(block.timestamp + 30 days);
        vm.prank(borrower);
        lendingEngine.repay(200 * WAD);

        uint256 reserves = debtPool.reserveBalance();
        assertGt(reserves, 0, "should have reserves");

        uint256 balBefore = usdc.balanceOf(deployer);
        debtPool.claimReserves(deployer, reserves);
        assertEq(usdc.balanceOf(deployer) - balBefore, reserves, "treasury should claim reserves");
        assertEq(debtPool.reserveBalance(), 0, "reserves should be zero after claim");
    }

    function test_DebtPool_Pause_RequiresEmergency() public {
        vm.prank(outsider);
        vm.expectRevert();
        debtPool.pause();
    }

    function test_DebtPool_Pause_EmergencyCanPause() public {
        debtPool.pause();
        assertTrue(debtPool.paused(), "pool should be paused");
        debtPool.unpause();
    }

    function test_DebtPool_SetLendingCore_RequiresAdmin() public {
        // setLendingCore: defaults to ADMIN role in AccessManager
        // lendingCore is already set; calling again would revert with LendingCoreAlreadySet
        vm.prank(outsider);
        vm.expectRevert(); // AccessManagedUnauthorized
        debtPool.setLendingCore(makeAddr("newcore"));
    }

    // =========================================================================
    // USDCMock mint access control
    // =========================================================================

    function test_USDCMock_Mint_RequiresMinter() public {
        vm.prank(outsider);
        vm.expectRevert();
        usdc.mint(outsider, 1_000 * WAD);
    }

    function test_USDCMock_Mint_MinterCanMint() public {
        uint256 amount = 1_000 * WAD;
        uint256 balBefore = usdc.balanceOf(lender);
        usdc.mint(lender, amount);
        assertEq(usdc.balanceOf(lender) - balBefore, amount, "minter should be able to mint");
    }

    // =========================================================================
    // Role management: grant, revoke, verify
    // =========================================================================

    function test_GrantRole_AllowsCallerToInvokeRestrictedFunction() public {
        address newRiskAdmin = makeAddr("newRiskAdmin");

        // Grant RISK_ADMIN to newRiskAdmin
        accessManager.grantRole(ROLE_RISK_ADMIN, newRiskAdmin, 0);

        // Now newRiskAdmin should be able to set oracle price
        vm.prank(newRiskAdmin);
        oracle.setPrice(1_100 * WAD); // within 25% delta
        assertEq(oracle.priceWad(), 1_100 * WAD, "new risk admin should be able to update price");
    }

    function test_RevokeRole_BlocksCallerFromRestrictedFunction() public {
        address tempAdmin = makeAddr("tempAdmin");

        // Grant and then revoke
        accessManager.grantRole(ROLE_RISK_ADMIN, tempAdmin, 0);
        accessManager.revokeRole(ROLE_RISK_ADMIN, tempAdmin);

        vm.prank(tempAdmin);
        vm.expectRevert(); // AccessManagedUnauthorized after revocation
        oracle.setPrice(1_100 * WAD);
    }

    function test_HasRole_ReturnsCorrectMembership() public view {
        (bool isDeployerEmergency,) = accessManager.hasRole(ROLE_EMERGENCY, deployer);
        assertTrue(isDeployerEmergency, "deployer should have EMERGENCY role");

        (bool isOutsiderEmergency,) = accessManager.hasRole(ROLE_EMERGENCY, outsider);
        assertFalse(isOutsiderEmergency, "outsider should not have EMERGENCY role");
    }

    function test_PublicRole_AnyoneCanCall() public {
        // depositCollateral is a public function (no role restriction on lendingEngine.depositCollateral)
        // So outsider (with WPAS) can call it
        vm.deal(outsider, 10 ether);
        vm.startPrank(outsider);
        wpas.deposit{value: 1 ether}();
        wpas.approve(address(lendingEngine), type(uint256).max);
        lendingEngine.depositCollateral(1 ether); // no role restriction
        vm.stopPrank();

        (uint256 col,,,,) = lendingEngine.positions(outsider);
        assertEq(col, 1 ether, "outsider should be able to deposit collateral (public function)");
    }
}
