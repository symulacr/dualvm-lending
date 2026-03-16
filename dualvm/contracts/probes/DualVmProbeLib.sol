// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "../interfaces/IRiskEngine.sol";

/// @notice Shared deterministic logic and hashing helpers for REVM/PVM interoperability probes.
library DualVmProbeLib {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant BASE_RATE_BPS = 200;
    uint256 internal constant SLOPE1_BPS = 800;
    uint256 internal constant SLOPE2_BPS = 3_000;
    uint256 internal constant KINK_BPS = 8_000;
    uint256 internal constant HEALTHY_MAX_LTV_BPS = 7_500;
    uint256 internal constant STRESSED_MAX_LTV_BPS = 6_500;
    uint256 internal constant HEALTHY_LIQUIDATION_THRESHOLD_BPS = 8_500;
    uint256 internal constant STRESSED_LIQUIDATION_THRESHOLD_BPS = 7_800;
    uint256 internal constant STALE_BORROW_RATE_PENALTY_BPS = 1_000;
    uint256 internal constant STRESSED_COLLATERAL_RATIO_BPS = 14_000;

    bytes32 internal constant PVM_FINGERPRINT = keccak256("DUALVM_PVM_QUOTE_PROBE_V1");
    bytes32 internal constant CALLBACK_FINGERPRINT_NAMESPACE = keccak256("DUALVM_PVM_CALLBACK_PROBE_V1");

    function fingerprint() internal pure returns (bytes32) {
        return PVM_FINGERPRINT;
    }

    function callbackFingerprint(address receiver, bytes32 callId) internal pure returns (bytes32) {
        return keccak256(abi.encode(CALLBACK_FINGERPRINT_NAMESPACE, receiver, callId));
    }

    function hashQuoteInput(IRiskEngine.QuoteInput calldata input) internal pure returns (bytes32) {
        return keccak256(abi.encode(input.utilizationBps, input.collateralRatioBps, input.oracleAgeSeconds, input.oracleFresh));
    }

    function hashQuoteOutput(IRiskEngine.QuoteOutput memory output) internal pure returns (bytes32) {
        return keccak256(abi.encode(output.borrowRateBps, output.maxLtvBps, output.liquidationThresholdBps));
    }

    /// @dev Mirrors the deployed DualVM default risk parameters so deterministic probe runs can compare
    /// honest PVM execution against the currently live REVM-centered configuration.
    function quote(IRiskEngine.QuoteInput calldata input) internal pure returns (IRiskEngine.QuoteOutput memory output) {
        output.borrowRateBps = _borrowRate(input.utilizationBps);

        if (!input.oracleFresh) {
            output.borrowRateBps += STALE_BORROW_RATE_PENALTY_BPS;
            return output;
        }

        bool stressed = input.collateralRatioBps < STRESSED_COLLATERAL_RATIO_BPS || input.oracleAgeSeconds > 30 minutes;
        if (stressed) {
            output.maxLtvBps = STRESSED_MAX_LTV_BPS;
            output.liquidationThresholdBps = STRESSED_LIQUIDATION_THRESHOLD_BPS;
        } else {
            output.maxLtvBps = HEALTHY_MAX_LTV_BPS;
            output.liquidationThresholdBps = HEALTHY_LIQUIDATION_THRESHOLD_BPS;
        }
    }

    function _borrowRate(uint256 utilizationBps) private pure returns (uint256) {
        uint256 cappedUtilization = utilizationBps > BPS ? BPS : utilizationBps;
        if (cappedUtilization <= KINK_BPS) {
            return BASE_RATE_BPS + (cappedUtilization * SLOPE1_BPS) / KINK_BPS;
        }

        uint256 excessUtilization = cappedUtilization - KINK_BPS;
        return BASE_RATE_BPS + SLOPE1_BPS + (excessUtilization * SLOPE2_BPS) / (BPS - KINK_BPS);
    }
}
