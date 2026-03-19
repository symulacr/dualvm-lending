// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {MarketVersionRegistry} from "../contracts/MarketVersionRegistry.sol";
import {LendingEngine} from "../contracts/LendingEngine.sol";
import {DeterministicRiskModel} from "../contracts/pvm/DeterministicRiskModel.sol";
import {RiskGateway} from "../contracts/RiskGateway.sol";
import {DebtPool} from "../contracts/DebtPool.sol";
import {ManualOracle} from "../contracts/ManualOracle.sol";
import {IMarketVersionRegistry} from "../contracts/interfaces/IMarketVersionRegistry.sol";

/// @notice Unit tests for MarketVersionRegistry — registration and activation.
contract MarketVersionRegistryTest is BaseTest {
    MarketVersionRegistry internal marketRegistry;

    function setUp() public override {
        super.setUp();

        // Deploy registry
        marketRegistry = new MarketVersionRegistry(address(accessManager));

        // Grant GOVERNANCE role to test contract for registry operations
        accessManager.grantRole(ROLE_GOVERNANCE, deployer, 0);
        bytes4[] memory registrySelectors = new bytes4[](2);
        registrySelectors[0] = marketRegistry.registerVersion.selector;
        registrySelectors[1] = marketRegistry.activateVersion.selector;
        accessManager.setTargetFunctionRole(address(marketRegistry), registrySelectors, ROLE_GOVERNANCE);

        // Grant LENDING_CORE role to lendingEngine
        accessManager.grantRole(ROLE_LENDING_CORE, address(lendingEngine), 0);
        bytes4[] memory quoteSelectors = new bytes4[](1);
        quoteSelectors[0] = riskGateway.quoteViaTicket.selector;
        accessManager.setTargetFunctionRole(address(riskGateway), quoteSelectors, ROLE_LENDING_CORE);

        // Register the initial version
        marketRegistry.registerVersion(address(lendingEngine), address(debtPool), address(oracle), address(riskGateway));
        marketRegistry.activateVersion(1);
    }

    function test_InitialVersion_IsRegisteredAndActive() public view {
        assertEq(marketRegistry.latestVersionId(), 1);
        assertEq(marketRegistry.activeVersionId(), 1);
    }

    function test_ActiveVersion_HasCorrectAddresses() public view {
        IMarketVersionRegistry.MarketVersion memory version = marketRegistry.activeVersion();
        assertEq(version.lendingCore, address(lendingEngine));
        assertEq(version.debtPool, address(debtPool));
        assertEq(version.oracle, address(oracle));
        assertEq(version.riskEngine, address(riskGateway));
    }

    function test_ActiveVersion_HasCorrectAssets() public view {
        IMarketVersionRegistry.MarketVersion memory version = marketRegistry.activeVersion();
        assertEq(version.collateralAsset, address(wpas));
        assertEq(version.debtAsset, address(usdc));
    }

    function test_ActiveVersion_HasCorrectConfigHash() public view {
        IMarketVersionRegistry.MarketVersion memory version = marketRegistry.activeVersion();
        assertEq(version.configHash, lendingEngine.currentRiskConfigHash());
    }

    function test_RegisterVersion_IncrementsLatestVersionId() public {
        _deployAndRegisterNewVersion();
        assertEq(marketRegistry.latestVersionId(), 2);
    }

    function test_ActivateVersion_SwitchesActiveVersion() public {
        _deployAndRegisterNewVersion();
        marketRegistry.activateVersion(2);
        assertEq(marketRegistry.activeVersionId(), 2);
    }

    function test_ActivateVersion_ReactivatePreviousVersion() public {
        _deployAndRegisterNewVersion();
        marketRegistry.activateVersion(2);
        assertEq(marketRegistry.activeVersionId(), 2);
        marketRegistry.activateVersion(1);
        assertEq(marketRegistry.activeVersionId(), 1);
    }

    function test_ActivateVersion_ActiveVersionAddressChanges() public {
        address oldLendingCore = marketRegistry.activeVersion().lendingCore;
        (LendingEngine newEngine,) = _deployAndRegisterNewVersion();
        marketRegistry.activateVersion(2);

        address newLendingCore = marketRegistry.activeVersion().lendingCore;
        assertEq(newLendingCore, address(newEngine));
        assertTrue(newLendingCore != oldLendingCore);
    }

    function test_ActivateVersion_AlreadyActiveReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MarketVersionRegistry.VersionAlreadyActive.selector, 1));
        marketRegistry.activateVersion(1);
    }

    function test_ActivateVersion_UnknownVersionReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MarketVersionRegistry.UnknownVersion.selector, 99));
        marketRegistry.activateVersion(99);
    }

    function test_RegisterVersion_ZeroAddressReverts() public {
        vm.expectRevert(MarketVersionRegistry.InvalidVersionConfiguration.selector);
        marketRegistry.registerVersion(address(0), address(debtPool), address(oracle), address(riskGateway));
    }

    function test_RegisterVersion_UnauthorizedReverts() public {
        vm.prank(outsider);
        vm.expectRevert();
        marketRegistry.registerVersion(address(lendingEngine), address(debtPool), address(oracle), address(riskGateway));
    }

    function test_GetVersion_ReturnsCorrectData() public view {
        IMarketVersionRegistry.MarketVersion memory version = marketRegistry.getVersion(1);
        assertEq(version.lendingCore, address(lendingEngine));
    }

    function test_GetVersion_UnknownVersionReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MarketVersionRegistry.UnknownVersion.selector, 42));
        marketRegistry.getVersion(42);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _deployAndRegisterNewVersion() internal returns (LendingEngine newEngine, RiskGateway newRisk) {
        DeterministicRiskModel newQuoteEngine = new DeterministicRiskModel(
            BASE_RATE_BPS,
            SLOPE1_BPS,
            SLOPE2_BPS,
            KINK_BPS,
            HEALTHY_MAX_LTV_BPS,
            STRESSED_MAX_LTV_BPS,
            HEALTHY_LIQ_THRESHOLD_BPS,
            STRESSED_LIQ_THRESHOLD_BPS,
            STALE_BORROW_RATE_PENALTY_BPS,
            STRESSED_COLLATERAL_RATIO_BPS
        );

        RiskGateway.RiskModelConfig memory riskConfig = RiskGateway.RiskModelConfig({
            baseRateBps: BASE_RATE_BPS,
            slope1Bps: SLOPE1_BPS,
            slope2Bps: SLOPE2_BPS,
            kinkBps: KINK_BPS,
            healthyMaxLtvBps: HEALTHY_MAX_LTV_BPS,
            stressedMaxLtvBps: STRESSED_MAX_LTV_BPS,
            healthyLiquidationThresholdBps: HEALTHY_LIQ_THRESHOLD_BPS,
            stressedLiquidationThresholdBps: STRESSED_LIQ_THRESHOLD_BPS,
            staleBorrowRatePenaltyBps: STALE_BORROW_RATE_PENALTY_BPS,
            stressedCollateralRatioBps: STRESSED_COLLATERAL_RATIO_BPS
        });
        newRisk = new RiskGateway(address(accessManager), address(newQuoteEngine), address(0), riskConfig);

        ManualOracle newOracle = new ManualOracle(
            address(accessManager),
            ORACLE_PRICE_WAD,
            ORACLE_MAX_AGE_SECONDS,
            ORACLE_MIN_PRICE_WAD,
            ORACLE_MAX_PRICE_WAD,
            ORACLE_MAX_PRICE_CHANGE_BPS
        );

        DebtPool newPool = new DebtPool(usdc, address(accessManager), POOL_SUPPLY_CAP);

        LendingEngine.MarketConfig memory coreConfig = LendingEngine.MarketConfig({
            borrowCap: BORROW_CAP,
            minBorrowAmount: MIN_BORROW_AMOUNT,
            reserveFactorBps: RESERVE_FACTOR_BPS,
            maxLtvBps: MAX_LTV_BPS,
            liquidationThresholdBps: LIQUIDATION_THRESHOLD_BPS,
            liquidationBonusBps: LIQUIDATION_BONUS_BPS
        });

        newEngine =
            new LendingEngine(address(accessManager), wpas, usdc, newPool, newOracle, newRisk, coreConfig, address(0));

        newPool.setLendingCore(address(newEngine));

        // Grant newEngine LENDING_CORE role for newRisk
        accessManager.grantRole(ROLE_LENDING_CORE, address(newEngine), 0);
        bytes4[] memory quoteSelectors = new bytes4[](1);
        quoteSelectors[0] = newRisk.quoteViaTicket.selector;
        accessManager.setTargetFunctionRole(address(newRisk), quoteSelectors, ROLE_LENDING_CORE);

        marketRegistry.registerVersion(address(newEngine), address(newPool), address(newOracle), address(newRisk));
    }
}
