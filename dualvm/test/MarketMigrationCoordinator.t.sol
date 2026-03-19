// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {MarketVersionRegistry} from "../contracts/MarketVersionRegistry.sol";
import {MarketMigrationCoordinator} from "../contracts/migration/MarketMigrationCoordinator.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
import {DeterministicRiskModel} from "../contracts/pvm/DeterministicRiskModel.sol";
import {RiskGateway} from "../contracts/RiskGateway.sol";
import {DebtPool} from "../contracts/DebtPool.sol";
import {ManualOracle} from "../contracts/ManualOracle.sol";

/// @notice Integration tests for MarketMigrationCoordinator borrower and liquidity migration.
contract MarketMigrationCoordinatorTest is BaseTest {
    MarketVersionRegistry internal marketRegistry;
    MarketMigrationCoordinator internal coordinator;

    LendingEngine internal v2Engine;
    DebtPool internal v2Pool;

    uint256 internal constant BORROW_AMOUNT = 5_000 * 1e18;

    function setUp() public override {
        super.setUp();

        // Deploy registry
        marketRegistry = new MarketVersionRegistry(address(accessManager));

        // Grant GOVERNANCE to deployer for registry operations
        accessManager.grantRole(ROLE_GOVERNANCE, deployer, 0);
        bytes4[] memory registrySelectors = new bytes4[](2);
        registrySelectors[0] = marketRegistry.registerVersion.selector;
        registrySelectors[1] = marketRegistry.activateVersion.selector;
        accessManager.setTargetFunctionRole(address(marketRegistry), registrySelectors, ROLE_GOVERNANCE);

        // Grant LENDING_CORE role to v1 lendingEngine
        accessManager.grantRole(ROLE_LENDING_CORE, address(lendingEngine), 0);
        bytes4[] memory quoteSelectors = new bytes4[](1);
        quoteSelectors[0] = riskGateway.quoteViaTicket.selector;
        accessManager.setTargetFunctionRole(address(riskGateway), quoteSelectors, ROLE_LENDING_CORE);

        // Register v1
        marketRegistry.registerVersion(address(lendingEngine), address(debtPool), address(oracle), address(riskGateway));
        marketRegistry.activateVersion(1);

        // Deploy v2
        (v2Engine, v2Pool) = _deployV2();

        // Register v2 and activate it
        marketRegistry.registerVersion(
            address(v2Engine),
            address(v2Pool),
            address(oracle), // reuse oracle
            address(riskGateway) // reuse riskGateway (both point to same underlying quoteEngine)
        );
        marketRegistry.activateVersion(2);

        // Deploy coordinator
        coordinator = new MarketMigrationCoordinator(address(accessManager), marketRegistry);

        // Grant coordinator MIGRATION role
        accessManager.grantRole(ROLE_MIGRATION, address(coordinator), 0);

        // Wire migration selectors on v1 and v2 engines
        bytes4[] memory migrationSelectors = new bytes4[](2);
        migrationSelectors[0] = lendingEngine.exportPositionForMigration.selector;
        migrationSelectors[1] = lendingEngine.importMigratedPosition.selector;
        accessManager.setTargetFunctionRole(address(lendingEngine), migrationSelectors, ROLE_MIGRATION);

        bytes4[] memory v2MigrationSelectors = new bytes4[](2);
        v2MigrationSelectors[0] = v2Engine.exportPositionForMigration.selector;
        v2MigrationSelectors[1] = v2Engine.importMigratedPosition.selector;
        accessManager.setTargetFunctionRole(address(v2Engine), v2MigrationSelectors, ROLE_MIGRATION);

        // Wire coordinator selectors
        bytes4[] memory coordSelectors = new bytes4[](2);
        coordSelectors[0] = coordinator.openMigrationRoute.selector;
        coordSelectors[1] = coordinator.closeMigrationRoute.selector;
        accessManager.setTargetFunctionRole(address(coordinator), coordSelectors, ROLE_GOVERNANCE);

        // Open migration route v1→v2
        coordinator.openMigrationRoute(1, 2, true, true);

        // Borrow in v1
        _borrowAs(borrower, BORROW_AMOUNT);
        // Freeze v1 new debt (simulate wind-down)
        lendingEngine.freezeNewDebt();
    }

    // -------------------------------------------------------------------------
    // openMigrationRoute
    // -------------------------------------------------------------------------

    function test_OpenMigrationRoute_StoresRoute() public view {
        (bool borrowerEnabled, bool liquidityEnabled) = coordinator.migrationRoutes(1, 2);
        assertTrue(borrowerEnabled);
        assertTrue(liquidityEnabled);
    }

    function test_OpenMigrationRoute_EmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(coordinator));
        emit MarketMigrationCoordinator.MigrationRouteOpened(1, 3, true, false);
        coordinator.openMigrationRoute(1, 3, true, false);
    }

    function test_OpenMigrationRoute_SameVersionReverts() public {
        vm.expectRevert(MarketMigrationCoordinator.InvalidMigrationRoute.selector);
        coordinator.openMigrationRoute(1, 1, true, true);
    }

    // -------------------------------------------------------------------------
    // migrateBorrower
    // -------------------------------------------------------------------------

    function test_MigrateBorrower_ZerosV1Position() public {
        assertGt(lendingEngine.currentDebt(borrower), 0, "v1 should have debt before migration");

        vm.prank(borrower);
        coordinator.migrateBorrower(1, 2);

        assertEq(lendingEngine.currentDebt(borrower), 0, "v1 position should be zeroed");
    }

    function test_MigrateBorrower_CreatesV2Position() public {
        (uint256 v1Collateral,,,,) = lendingEngine.positions(borrower);
        assertGt(v1Collateral, 0);

        vm.prank(borrower);
        coordinator.migrateBorrower(1, 2);

        (uint256 v2Collateral,,,,) = v2Engine.positions(borrower);
        assertGt(v2Collateral, 0, "v2 should have collateral after migration");
    }

    function test_MigrateBorrower_EmitsBorrowerMigratedEvent() public {
        vm.prank(borrower);
        vm.expectEmit(true, true, true, false, address(coordinator));
        emit MarketMigrationCoordinator.BorrowerMigrated(1, 2, borrower);
        coordinator.migrateBorrower(1, 2);
    }

    function test_MigrateBorrower_ClosedRouteReverts() public {
        coordinator.closeMigrationRoute(1, 2);

        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(MarketMigrationCoordinator.MigrationRouteClosed.selector, 1, 2));
        coordinator.migrateBorrower(1, 2);
    }

    // -------------------------------------------------------------------------
    // migrateLiquidity
    // -------------------------------------------------------------------------

    function test_MigrateLiquidity_MovesSharesFromV1ToV2() public {
        // Lender supplied to v1 pool in setUp (via _seedLiquidity in BaseTest).
        // Borrower borrowed BORROW_AMOUNT (5k) from v1, so only (50k - 5k) = 45k is available.
        // We migrate a safe portion (less than available liquidity).
        uint256 lenderV1Shares = debtPool.balanceOf(lender);
        assertGt(lenderV1Shares, 0, "lender should have v1 shares");

        // Migrate 80% of shares — well under available liquidity (90%)
        uint256 sharesToMigrate = lenderV1Shares * 80 / 100;

        vm.startPrank(lender);
        debtPool.approve(address(coordinator), sharesToMigrate);
        coordinator.migrateLiquidity(1, 2, sharesToMigrate);
        vm.stopPrank();

        assertEq(debtPool.balanceOf(lender), lenderV1Shares - sharesToMigrate, "remaining v1 shares correct");
        assertGt(v2Pool.balanceOf(lender), 0, "lender should have v2 shares");
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _deployV2() internal returns (LendingEngine, DebtPool) {
        DebtPool newPool = new DebtPool(usdc, address(accessManager), POOL_SUPPLY_CAP);

        LendingEngine.MarketConfig memory coreConfig = LendingEngine.MarketConfig({
            borrowCap: BORROW_CAP,
            minBorrowAmount: MIN_BORROW_AMOUNT,
            reserveFactorBps: RESERVE_FACTOR_BPS,
            maxLtvBps: MAX_LTV_BPS,
            liquidationThresholdBps: LIQUIDATION_THRESHOLD_BPS,
            liquidationBonusBps: LIQUIDATION_BONUS_BPS
        });

        LendingEngine newEngine =
            new LendingEngine(address(accessManager), wpas, usdc, newPool, oracle, riskGateway, coreConfig, address(0));

        newPool.setLendingCore(address(newEngine));

        // Grant LENDING_CORE role to new engine
        accessManager.grantRole(ROLE_LENDING_CORE, address(newEngine), 0);
        bytes4[] memory quoteSelectors = new bytes4[](1);
        quoteSelectors[0] = riskGateway.quoteViaTicket.selector;
        accessManager.setTargetFunctionRole(address(riskGateway), quoteSelectors, ROLE_LENDING_CORE);

        return (newEngine, newPool);
    }
}
