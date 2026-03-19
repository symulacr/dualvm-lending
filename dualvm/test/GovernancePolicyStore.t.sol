// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {GovernancePolicyStore} from "../contracts/GovernancePolicyStore.sol";
import {RiskGateway} from "../contracts/RiskGateway.sol";
import {DeterministicRiskModel} from "../contracts/pvm/DeterministicRiskModel.sol";
import {IRiskAdapter} from "../contracts/interfaces/IRiskAdapter.sol";
import {IRiskEngine} from "../contracts/interfaces/IRiskEngine.sol";

/// @notice Tests for GovernancePolicyStore and its integration with RiskGateway.
contract GovernancePolicyStoreTest is BaseTest {
    GovernancePolicyStore internal policyStore;

    bytes32 internal constant KEY_MAX_LTV = keccak256("RISK_MAX_LTV_BPS");
    bytes32 internal constant KEY_LIQ_THRESHOLD = keccak256("RISK_LIQ_THRESHOLD_BPS");
    bytes32 internal constant KEY_BORROW_RATE_FLOOR = keccak256("RISK_BORROW_RATE_FLOOR_BPS");
    bytes32 internal constant KEY_CUSTOM = keccak256("CUSTOM_POLICY");

    uint64 internal constant ROLE_POLICY_ADMIN = 10;

    function setUp() public override {
        super.setUp();

        // Deploy policy store
        policyStore = new GovernancePolicyStore(address(accessManager));

        // Grant POLICY_ADMIN role to deployer
        accessManager.grantRole(ROLE_POLICY_ADMIN, deployer, 0);
        bytes4[] memory policySelectors = new bytes4[](2);
        policySelectors[0] = policyStore.setPolicy.selector;
        policySelectors[1] = policyStore.removePolicy.selector;
        accessManager.setTargetFunctionRole(address(policyStore), policySelectors, ROLE_POLICY_ADMIN);
    }

    // -------------------------------------------------------------------------
    // setPolicy
    // -------------------------------------------------------------------------

    function test_SetPolicy_StoresValueAndEmits() public {
        uint256 value = 6_000;
        vm.expectEmit(true, false, false, true, address(policyStore));
        emit GovernancePolicyStore.PolicySet(KEY_MAX_LTV, value);
        policyStore.setPolicy(KEY_MAX_LTV, value);

        assertEq(policyStore.getPolicy(KEY_MAX_LTV), value);
        assertTrue(policyStore.policyActive(KEY_MAX_LTV));
    }

    function test_SetPolicy_ZeroValueAllowed() public {
        policyStore.setPolicy(KEY_MAX_LTV, 0);
        assertEq(policyStore.getPolicy(KEY_MAX_LTV), 0);
        assertTrue(policyStore.policyActive(KEY_MAX_LTV));
    }

    function test_SetPolicy_OverwritesPreviousValue() public {
        policyStore.setPolicy(KEY_MAX_LTV, 6_000);
        policyStore.setPolicy(KEY_MAX_LTV, 7_000);
        assertEq(policyStore.getPolicy(KEY_MAX_LTV), 7_000);
    }

    function test_SetPolicy_UnauthorizedReverts() public {
        vm.prank(outsider);
        vm.expectRevert();
        policyStore.setPolicy(KEY_MAX_LTV, 6_000);
    }

    // -------------------------------------------------------------------------
    // removePolicy
    // -------------------------------------------------------------------------

    function test_RemovePolicy_ClearsValueAndEmits() public {
        policyStore.setPolicy(KEY_MAX_LTV, 6_000);

        vm.expectEmit(true, false, false, false, address(policyStore));
        emit GovernancePolicyStore.PolicyRemoved(KEY_MAX_LTV);
        policyStore.removePolicy(KEY_MAX_LTV);

        assertEq(policyStore.getPolicy(KEY_MAX_LTV), 0);
        assertFalse(policyStore.policyActive(KEY_MAX_LTV));
    }

    function test_RemovePolicy_UnauthorizedReverts() public {
        policyStore.setPolicy(KEY_MAX_LTV, 6_000);

        vm.prank(outsider);
        vm.expectRevert();
        policyStore.removePolicy(KEY_MAX_LTV);
    }

    // -------------------------------------------------------------------------
    // getPolicy / policyActive
    // -------------------------------------------------------------------------

    function test_GetPolicy_ReturnsZeroForUnsetKey() public view {
        assertEq(policyStore.getPolicy(KEY_CUSTOM), 0);
    }

    function test_PolicyActive_FalseForUnsetKey() public view {
        assertFalse(policyStore.policyActive(KEY_CUSTOM));
    }

    function test_PolicyActive_TrueAfterSetPolicy() public {
        policyStore.setPolicy(KEY_CUSTOM, 999);
        assertTrue(policyStore.policyActive(KEY_CUSTOM));
    }

    function test_PolicyActive_FalseAfterRemovePolicy() public {
        policyStore.setPolicy(KEY_CUSTOM, 999);
        policyStore.removePolicy(KEY_CUSTOM);
        assertFalse(policyStore.policyActive(KEY_CUSTOM));
    }

    // -------------------------------------------------------------------------
    // Multiple independent policies
    // -------------------------------------------------------------------------

    function test_MultiplePolicies_IndependentlyTracked() public {
        policyStore.setPolicy(KEY_MAX_LTV, 6_000);
        policyStore.setPolicy(KEY_LIQ_THRESHOLD, 8_000);
        policyStore.setPolicy(KEY_BORROW_RATE_FLOOR, 300);

        assertEq(policyStore.getPolicy(KEY_MAX_LTV), 6_000);
        assertEq(policyStore.getPolicy(KEY_LIQ_THRESHOLD), 8_000);
        assertEq(policyStore.getPolicy(KEY_BORROW_RATE_FLOOR), 300);

        assertTrue(policyStore.policyActive(KEY_MAX_LTV));
        assertTrue(policyStore.policyActive(KEY_LIQ_THRESHOLD));
        assertTrue(policyStore.policyActive(KEY_BORROW_RATE_FLOOR));

        policyStore.removePolicy(KEY_MAX_LTV);
        assertFalse(policyStore.policyActive(KEY_MAX_LTV));
        assertTrue(policyStore.policyActive(KEY_LIQ_THRESHOLD));
    }

    // -------------------------------------------------------------------------
    // RiskGateway integration
    // -------------------------------------------------------------------------

    function test_RiskGateway_NoPolicyStoreHasNoOverrides() public view {
        // Default riskGateway from BaseTest uses address(0) for policyStore
        assertEq(address(riskGateway.policyStore()), address(0));
    }

    function test_RiskGateway_WithPolicyStore_OverridesMaxLtv() public {
        // Deploy a new RiskGateway with the policyStore wired
        RiskGateway.RiskModelConfig memory riskConfig = RiskGateway.RiskModelConfig({
            baseRateBps: BASE_RATE_BPS,
            slope1Bps: SLOPE1_BPS,
            slope2Bps: SLOPE2_BPS,
            kinkBps: KINK_BPS,
            healthyMaxLtvBps: HEALTHY_MAX_LTV_BPS, // 75%
            stressedMaxLtvBps: STRESSED_MAX_LTV_BPS, // 65%
            healthyLiquidationThresholdBps: HEALTHY_LIQ_THRESHOLD_BPS,
            stressedLiquidationThresholdBps: STRESSED_LIQ_THRESHOLD_BPS,
            staleBorrowRatePenaltyBps: STALE_BORROW_RATE_PENALTY_BPS,
            stressedCollateralRatioBps: STRESSED_COLLATERAL_RATIO_BPS
        });
        RiskGateway gatewayWithPolicy =
            new RiskGateway(address(accessManager), address(quoteEngine), address(policyStore), riskConfig);

        // Without override: should return healthyMaxLtvBps (75%)
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 5_000, // 50% utilization
            collateralRatioBps: 20_000, // healthy
            oracleAgeSeconds: 0,
            oracleFresh: true
        });

        IRiskAdapter.QuoteOutput memory outputBefore = gatewayWithPolicy.quote(input);
        assertEq(outputBefore.maxLtvBps, HEALTHY_MAX_LTV_BPS, "should use healthy max LTV without override");

        // Set a policy override for MAX_LTV (60%)
        policyStore.setPolicy(KEY_MAX_LTV, 6_000);

        IRiskAdapter.QuoteOutput memory outputAfter = gatewayWithPolicy.quote(input);
        assertEq(outputAfter.maxLtvBps, 6_000, "should use policy override for maxLtvBps");
    }

    function test_RiskGateway_WithPolicyStore_OverridesLiquidationThreshold() public {
        RiskGateway.RiskModelConfig memory riskConfig = RiskGateway.RiskModelConfig({
            baseRateBps: BASE_RATE_BPS,
            slope1Bps: SLOPE1_BPS,
            slope2Bps: SLOPE2_BPS,
            kinkBps: KINK_BPS,
            healthyMaxLtvBps: HEALTHY_MAX_LTV_BPS,
            stressedMaxLtvBps: STRESSED_MAX_LTV_BPS,
            healthyLiquidationThresholdBps: HEALTHY_LIQ_THRESHOLD_BPS, // 85%
            stressedLiquidationThresholdBps: STRESSED_LIQ_THRESHOLD_BPS,
            staleBorrowRatePenaltyBps: STALE_BORROW_RATE_PENALTY_BPS,
            stressedCollateralRatioBps: STRESSED_COLLATERAL_RATIO_BPS
        });
        RiskGateway gatewayWithPolicy =
            new RiskGateway(address(accessManager), address(quoteEngine), address(policyStore), riskConfig);

        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 5_000, collateralRatioBps: 20_000, oracleAgeSeconds: 0, oracleFresh: true
        });

        // Set policy override: maxLtv=60%, liqThreshold=82% (must be > maxLtv)
        policyStore.setPolicy(KEY_MAX_LTV, 6_000);
        policyStore.setPolicy(KEY_LIQ_THRESHOLD, 8_200);

        IRiskAdapter.QuoteOutput memory output = gatewayWithPolicy.quote(input);
        assertEq(output.maxLtvBps, 6_000);
        assertEq(output.liquidationThresholdBps, 8_200);
    }

    function test_RiskGateway_WithPolicyStore_OverridesBorrowRateFloor() public {
        RiskGateway.RiskModelConfig memory riskConfig = RiskGateway.RiskModelConfig({
            baseRateBps: BASE_RATE_BPS, // 200 bps = 2%
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
        RiskGateway gatewayWithPolicy =
            new RiskGateway(address(accessManager), address(quoteEngine), address(policyStore), riskConfig);

        // Very low utilization → very low borrow rate
        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 0, // 0% utilization → baseRate = 200bps
            collateralRatioBps: 20_000,
            oracleAgeSeconds: 0,
            oracleFresh: true
        });

        // Without floor: borrow rate = base (200bps)
        IRiskAdapter.QuoteOutput memory outputBefore = gatewayWithPolicy.quote(input);
        assertEq(outputBefore.borrowRateBps, BASE_RATE_BPS);

        // Set a borrow rate floor of 500bps
        policyStore.setPolicy(KEY_BORROW_RATE_FLOOR, 500);

        IRiskAdapter.QuoteOutput memory outputAfter = gatewayWithPolicy.quote(input);
        assertEq(outputAfter.borrowRateBps, 500, "borrow rate should be at floor");
    }

    function test_RiskGateway_WithPolicyStore_RemovePolicyClearsOverride() public {
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
        RiskGateway gatewayWithPolicy =
            new RiskGateway(address(accessManager), address(quoteEngine), address(policyStore), riskConfig);

        IRiskEngine.QuoteInput memory input = IRiskEngine.QuoteInput({
            utilizationBps: 5_000, collateralRatioBps: 20_000, oracleAgeSeconds: 0, oracleFresh: true
        });

        // Set override
        policyStore.setPolicy(KEY_MAX_LTV, 6_000);
        assertEq(gatewayWithPolicy.quote(input).maxLtvBps, 6_000);

        // Remove override
        policyStore.removePolicy(KEY_MAX_LTV);
        assertEq(gatewayWithPolicy.quote(input).maxLtvBps, HEALTHY_MAX_LTV_BPS, "override should be gone");
    }
}
