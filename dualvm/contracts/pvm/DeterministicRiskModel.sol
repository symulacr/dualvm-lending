// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "../interfaces/IRiskEngine.sol";

/// @notice Stateless deterministic risk model. Compiles for both EVM tests and PVM artifact generation.
/// Previously named PvmRiskEngine — renamed for honest naming.
contract DeterministicRiskModel is IRiskEngine {
    uint256 private constant BPS = 10_000;

    uint256 public immutable baseRateBps;
    uint256 public immutable slope1Bps;
    uint256 public immutable slope2Bps;
    uint256 public immutable kinkBps;
    uint256 public immutable healthyMaxLtvBps;
    uint256 public immutable stressedMaxLtvBps;
    uint256 public immutable healthyLiquidationThresholdBps;
    uint256 public immutable stressedLiquidationThresholdBps;
    uint256 public immutable staleBorrowRatePenaltyBps;
    uint256 public immutable stressedCollateralRatioBps;

    error InvalidBasisPoints();

    constructor(
        uint256 baseRateBps_,
        uint256 slope1Bps_,
        uint256 slope2Bps_,
        uint256 kinkBps_,
        uint256 healthyMaxLtvBps_,
        uint256 stressedMaxLtvBps_,
        uint256 healthyLiquidationThresholdBps_,
        uint256 stressedLiquidationThresholdBps_,
        uint256 staleBorrowRatePenaltyBps_,
        uint256 stressedCollateralRatioBps_
    ) {
        if (
            kinkBps_ == 0 || kinkBps_ >= BPS || healthyMaxLtvBps_ == 0 || healthyMaxLtvBps_ >= BPS
                || stressedMaxLtvBps_ == 0 || stressedMaxLtvBps_ > healthyMaxLtvBps_
                || healthyLiquidationThresholdBps_ <= healthyMaxLtvBps_ || healthyLiquidationThresholdBps_ > BPS
                || stressedLiquidationThresholdBps_ <= stressedMaxLtvBps_
                || stressedLiquidationThresholdBps_ > healthyLiquidationThresholdBps_
                || stressedCollateralRatioBps_ < BPS
        ) revert InvalidBasisPoints();

        baseRateBps = baseRateBps_;
        slope1Bps = slope1Bps_;
        slope2Bps = slope2Bps_;
        kinkBps = kinkBps_;
        healthyMaxLtvBps = healthyMaxLtvBps_;
        stressedMaxLtvBps = stressedMaxLtvBps_;
        healthyLiquidationThresholdBps = healthyLiquidationThresholdBps_;
        stressedLiquidationThresholdBps = stressedLiquidationThresholdBps_;
        staleBorrowRatePenaltyBps = staleBorrowRatePenaltyBps_;
        stressedCollateralRatioBps = stressedCollateralRatioBps_;
    }

    function quote(QuoteInput calldata input) external view returns (QuoteOutput memory output) {
        output.borrowRateBps = _borrowRate(input.utilizationBps);

        if (!input.oracleFresh) {
            output.borrowRateBps += staleBorrowRatePenaltyBps;
            output.maxLtvBps = 0;
            output.liquidationThresholdBps = 0;
            return output;
        }

        bool stressed = input.collateralRatioBps < stressedCollateralRatioBps || input.oracleAgeSeconds > 30 minutes;
        if (stressed) {
            output.maxLtvBps = stressedMaxLtvBps;
            output.liquidationThresholdBps = stressedLiquidationThresholdBps;
        } else {
            output.maxLtvBps = healthyMaxLtvBps;
            output.liquidationThresholdBps = healthyLiquidationThresholdBps;
        }

        // Apply governance policy overrides passed from RiskGateway
        _applyInputPolicyOverrides(input, output);
    }

    function _applyInputPolicyOverrides(QuoteInput calldata input, QuoteOutput memory output) private pure {
        if (input.policyMaxLtvBps > 0 && input.policyMaxLtvBps < 10_000) {
            output.maxLtvBps = input.policyMaxLtvBps;
        }
        if (input.policyLiqThresholdBps > output.maxLtvBps && input.policyLiqThresholdBps <= 10_000) {
            output.liquidationThresholdBps = input.policyLiqThresholdBps;
        }
        if (input.policyBorrowRateFloorBps > 0 && output.borrowRateBps < input.policyBorrowRateFloorBps) {
            output.borrowRateBps = input.policyBorrowRateFloorBps;
        }
    }

    function _borrowRate(uint256 utilizationBps_) private view returns (uint256) {
        uint256 cappedUtilization = utilizationBps_ > BPS ? BPS : utilizationBps_;
        if (cappedUtilization <= kinkBps) {
            return baseRateBps + (cappedUtilization * slope1Bps) / kinkBps;
        }

        uint256 excessUtilization = cappedUtilization - kinkBps;
        uint256 postKinkRange = BPS - kinkBps;
        return baseRateBps + slope1Bps + (excessUtilization * slope2Bps) / postKinkRange;
    }
}
