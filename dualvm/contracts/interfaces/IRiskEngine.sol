// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRiskEngine {
    struct QuoteInput {
        uint256 utilizationBps;
        uint256 collateralRatioBps;
        uint256 oracleAgeSeconds;
        bool oracleFresh;
    }

    struct QuoteOutput {
        uint256 borrowRateBps;
        uint256 maxLtvBps;
        uint256 liquidationThresholdBps;
    }

    function quote(QuoteInput calldata input) external view returns (QuoteOutput memory);
}
