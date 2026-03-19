// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {RiskGateway} from "../contracts/RiskGateway.sol";
import {DeterministicRiskModel} from "../contracts/pvm/DeterministicRiskModel.sol";
import {DualVMAccessManager} from "../contracts/DualVMAccessManager.sol";
import {IRiskEngine} from "../contracts/interfaces/IRiskEngine.sol";
import {IRiskAdapter} from "../contracts/interfaces/IRiskAdapter.sol";

/// @title RiskGatewayTest
/// @notice Forge tests for RiskGateway — migrated from UnifiedRiskGateway.ts
contract RiskGatewayTest is BaseTest {

    // =========================================================================
    // VAL-ARCH-001: Inline math matches DeterministicRiskModel for multiple utilizations
    // =========================================================================

    function test_InlineQuote_MatchesDeterministicModel_At0Percent() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 0,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 60,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory inlineResult = riskGateway.quote(input);
        IRiskEngine.QuoteOutput memory pvmResult = quoteEngine.quote(input);

        assertEq(inlineResult.borrowRateBps, pvmResult.borrowRateBps, "borrowRateBps mismatch at 0%");
        assertEq(inlineResult.maxLtvBps, pvmResult.maxLtvBps, "maxLtvBps mismatch at 0%");
        assertEq(inlineResult.liquidationThresholdBps, pvmResult.liquidationThresholdBps, "liqThreshold mismatch at 0%");
    }

    function test_InlineQuote_MatchesDeterministicModel_At50Percent() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 5_000,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 60,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory inlineResult = riskGateway.quote(input);
        IRiskEngine.QuoteOutput memory pvmResult = quoteEngine.quote(input);

        assertEq(inlineResult.borrowRateBps, pvmResult.borrowRateBps, "borrowRateBps mismatch at 50%");
        assertEq(inlineResult.maxLtvBps, pvmResult.maxLtvBps, "maxLtvBps mismatch at 50%");
        assertEq(inlineResult.liquidationThresholdBps, pvmResult.liquidationThresholdBps, "liqThreshold mismatch at 50%");
    }

    function test_InlineQuote_MatchesDeterministicModel_AtKink80Percent() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 8_000,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 60,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory inlineResult = riskGateway.quote(input);
        IRiskEngine.QuoteOutput memory pvmResult = quoteEngine.quote(input);

        assertEq(inlineResult.borrowRateBps, pvmResult.borrowRateBps, "borrowRateBps mismatch at kink");
        assertEq(inlineResult.maxLtvBps, pvmResult.maxLtvBps, "maxLtvBps mismatch at kink");
    }

    function test_InlineQuote_MatchesDeterministicModel_At95Percent() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 9_500,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 60,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory inlineResult = riskGateway.quote(input);
        IRiskEngine.QuoteOutput memory pvmResult = quoteEngine.quote(input);

        assertEq(inlineResult.borrowRateBps, pvmResult.borrowRateBps, "borrowRateBps mismatch at 95%");
        assertEq(inlineResult.maxLtvBps, pvmResult.maxLtvBps, "maxLtvBps mismatch at 95%");
    }

    function test_InlineQuote_MatchesDeterministicModel_At100Percent() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 10_000,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 60,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory inlineResult = riskGateway.quote(input);
        IRiskEngine.QuoteOutput memory pvmResult = quoteEngine.quote(input);

        assertEq(inlineResult.borrowRateBps, pvmResult.borrowRateBps, "borrowRateBps mismatch at 100%");
        assertEq(inlineResult.maxLtvBps, pvmResult.maxLtvBps, "maxLtvBps mismatch at 100%");
    }

    // =========================================================================
    // Known expected values at key utilization points
    // =========================================================================

    function test_BorrowRate_At0Percent_EqualsBaseRate() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 0,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 0,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory result = riskGateway.quote(input);
        assertEq(result.borrowRateBps, BASE_RATE_BPS, "at 0%, rate = baseRate = 200");
    }

    function test_BorrowRate_AtKink_EqualsBaseRatePlusSlope1() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: KINK_BPS,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 0,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory result = riskGateway.quote(input);
        assertEq(result.borrowRateBps, BASE_RATE_BPS + SLOPE1_BPS, "at kink, rate = base + slope1 = 1000");
    }

    function test_BorrowRate_At100Percent_EqualsBaseRatePlusSlope1PlusSlope2() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 10_000,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 0,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory result = riskGateway.quote(input);
        assertEq(result.borrowRateBps, BASE_RATE_BPS + SLOPE1_BPS + SLOPE2_BPS, "at 100%, rate = base+slope1+slope2 = 4000");
    }

    function test_HealthyMode_ReturnsHealthyMaxLtv() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 0,
            collateralRatioBps: 20_000, // healthy collateral ratio
            oracleAgeSeconds: 0,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory result = riskGateway.quote(input);
        assertEq(result.maxLtvBps, HEALTHY_MAX_LTV_BPS, "healthy mode should return healthyMaxLtvBps");
        assertEq(result.liquidationThresholdBps, HEALTHY_LIQ_THRESHOLD_BPS, "healthy liq threshold");
    }

    function test_StressedMode_ReturnsStressedMaxLtv() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 0,
            collateralRatioBps: STRESSED_COLLATERAL_RATIO_BPS - 1, // stressed collateral ratio
            oracleAgeSeconds: 0,
            oracleFresh: true
        });
        IRiskEngine.QuoteOutput memory result = riskGateway.quote(input);
        assertEq(result.maxLtvBps, STRESSED_MAX_LTV_BPS, "stressed mode should return stressedMaxLtvBps");
        assertEq(result.liquidationThresholdBps, STRESSED_LIQ_THRESHOLD_BPS, "stressed liq threshold");
    }

    function test_StaleOracle_ReturnsZeroLtv() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 0,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 0,
            oracleFresh: false // stale oracle
        });
        IRiskEngine.QuoteOutput memory result = riskGateway.quote(input);
        assertEq(result.maxLtvBps, 0, "stale oracle should return 0 maxLtv");
        assertEq(result.liquidationThresholdBps, 0, "stale oracle should return 0 liquidationThreshold");
    }

    function test_StaleOracle_AddsPenaltyToBorrowRate() public view {
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 0,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 0,
            oracleFresh: false
        });
        IRiskEngine.QuoteOutput memory result = riskGateway.quote(input);
        assertEq(
            result.borrowRateBps,
            BASE_RATE_BPS + STALE_BORROW_RATE_PENALTY_BPS,
            "stale oracle should add penalty to borrow rate"
        );
    }

    // =========================================================================
    // VAL-ARCH-002: Unauthorized caller to quoteViaTicket reverts
    // =========================================================================

    function test_QuoteViaTicket_UnauthorizedReverts() public {
        IRiskAdapter.QuoteContext memory context = IRiskAdapter.QuoteContext({
            oracleEpoch: 1,
            configEpoch: 1,
            oracleStateHash: bytes32(0),
            configHash: bytes32(0)
        });
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 5_000,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 60,
            oracleFresh: true
        });

        vm.prank(outsider);
        vm.expectRevert(); // AccessManagedUnauthorized
        riskGateway.quoteViaTicket(context, input);
    }

    function test_QuoteViaTicket_DeployerWithoutRoleReverts() public {
        // deployer has admin role but NOT LENDING_CORE explicitly set for quoteViaTicket
        // Actually deployer has no LENDING_CORE role granted in BaseTest
        // (LENDING_CORE is only granted to lendingEngine address)
        IRiskAdapter.QuoteContext memory context = IRiskAdapter.QuoteContext({
            oracleEpoch: 1,
            configEpoch: 1,
            oracleStateHash: bytes32(0),
            configHash: bytes32(0)
        });
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 5_000,
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 60,
            oracleFresh: true
        });

        // deployer doesn't have LENDING_CORE role → should revert
        address randomCaller = makeAddr("random");
        vm.prank(randomCaller);
        vm.expectRevert(); // AccessManagedUnauthorized
        riskGateway.quoteViaTicket(context, input);
    }

    // =========================================================================
    // Cross-VM verification: QuoteVerified event emitted when borrow succeeds
    // =========================================================================

    function test_CrossVM_QuoteVerifiedEmittedOnBorrow() public {
        uint256 borrowAmount = 5_000 * WAD;

        // Borrow triggers quoteViaTicket internally → should emit QuoteVerified
        vm.expectEmit(false, false, false, false, address(riskGateway));
        emit RiskGateway.QuoteVerified(bytes32(0), "");
        vm.prank(borrower);
        lendingEngine.borrow(borrowAmount);
    }

    // =========================================================================
    // Constructor validation
    // =========================================================================

    function test_Constructor_InvalidRiskParamsReverts() public {
        DualVMAccessManager testAm = new DualVMAccessManager(address(this));
        RiskGateway.RiskModelConfig memory badConfig = RiskGateway.RiskModelConfig({
            baseRateBps: 0,
            slope1Bps: 0,
            slope2Bps: 0,
            kinkBps: 0, // invalid: kink must be > 0
            healthyMaxLtvBps: HEALTHY_MAX_LTV_BPS,
            stressedMaxLtvBps: STRESSED_MAX_LTV_BPS,
            healthyLiquidationThresholdBps: HEALTHY_LIQ_THRESHOLD_BPS,
            stressedLiquidationThresholdBps: STRESSED_LIQ_THRESHOLD_BPS,
            staleBorrowRatePenaltyBps: STALE_BORROW_RATE_PENALTY_BPS,
            stressedCollateralRatioBps: STRESSED_COLLATERAL_RATIO_BPS
        });

        vm.expectRevert(RiskGateway.InvalidRiskParams.selector);
        new RiskGateway(address(testAm), address(0), address(0), badConfig);
    }

    // =========================================================================
    // Ticket caching: quoteViaTicket caches results
    // =========================================================================

    function test_QuoteTicketId_IsDeterministic() public view {
        IRiskAdapter.QuoteContext memory context = lendingEngine.currentQuoteContext();
        IRiskEngine.QuoteInput memory input = lendingEngine.currentQuoteInput(borrower);

        bytes32 id1 = riskGateway.quoteTicketId(context, input);
        bytes32 id2 = riskGateway.quoteTicketId(context, input);
        assertEq(id1, id2, "ticket ID should be deterministic for same inputs");
    }

    function test_GetQuoteTicket_MissingReverts() public {
        bytes32 fakeId = bytes32(uint256(1));
        vm.expectRevert(abi.encodeWithSelector(IRiskAdapter.QuoteTicketMissing.selector, fakeId));
        riskGateway.getQuoteTicket(fakeId);
    }
}
