// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRiskEngine {
    struct QuoteInput {
        uint256 utilizationBps;
        uint256 collateralRatioBps;
        uint256 oracleAgeSeconds;
        bool oracleFresh;
        // Governance policy overrides (0 = not active/no override)
        uint256 policyMaxLtvBps;
        uint256 policyLiqThresholdBps;
        uint256 policyBorrowRateFloorBps;
    }

    struct QuoteOutput {
        uint256 borrowRateBps;
        uint256 maxLtvBps;
        uint256 liquidationThresholdBps;
    }

    function quote(QuoteInput calldata input) external view returns (QuoteOutput memory);
}
