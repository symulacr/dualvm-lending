// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "../interfaces/IRiskEngine.sol";
import {DualVmProbeLib} from "./DualVmProbeLib.sol";
import {IVmQuoteAdapterProbe} from "./interfaces/IVmQuoteAdapterProbe.sol";

contract RevmRoundTripSettlementProbe {
    uint256 private constant BPS = 10_000;

    IVmQuoteAdapterProbe public immutable quoteAdapter;

    uint256 public principalDebt;
    uint256 public lastBorrowRateBps;
    uint256 public lastMaxLtvBps;
    uint256 public lastLiquidationThresholdBps;
    bytes32 public lastQuoteHash;
    uint256 public settlementCount;

    error InvalidQuoteAdapter();

    event RoundTripSettled(
        bytes32 indexed action,
        bytes32 indexed quoteHash,
        bytes32 indexed pvmTargetId,
        uint256 principalDebt,
        uint256 debtDeltaApplied,
        uint256 borrowRateBps,
        uint256 maxLtvBps,
        uint256 liquidationThresholdBps,
        IVmQuoteAdapterProbe.TransportMode transportMode
    );

    constructor(IVmQuoteAdapterProbe quoteAdapter_) {
        if (address(quoteAdapter_) == address(0)) revert InvalidQuoteAdapter();
        quoteAdapter = quoteAdapter_;
    }

    function settleBorrow(IRiskEngine.QuoteInput calldata input, uint256 debtDelta) external {
        IRiskEngine.QuoteOutput memory output = quoteAdapter.quoteViaPvm(input);
        uint256 debtDeltaApplied = debtDelta + (debtDelta * output.borrowRateBps) / BPS;
        principalDebt += debtDeltaApplied;
        _recordSettlement(keccak256("BORROW"), output, debtDeltaApplied);
    }

    function settleLiquidationCheck(IRiskEngine.QuoteInput calldata input) external {
        IRiskEngine.QuoteOutput memory output = quoteAdapter.quoteViaPvm(input);
        _recordSettlement(keccak256("LIQUIDATION_CHECK"), output, 0);
    }

    function _recordSettlement(bytes32 action, IRiskEngine.QuoteOutput memory output, uint256 debtDeltaApplied)
        private
    {
        lastBorrowRateBps = output.borrowRateBps;
        lastMaxLtvBps = output.maxLtvBps;
        lastLiquidationThresholdBps = output.liquidationThresholdBps;
        lastQuoteHash = DualVmProbeLib.hashQuoteOutput(output);
        settlementCount += 1;

        emit RoundTripSettled(
            action,
            lastQuoteHash,
            quoteAdapter.pvmTargetId(),
            principalDebt,
            debtDeltaApplied,
            output.borrowRateBps,
            output.maxLtvBps,
            output.liquidationThresholdBps,
            quoteAdapter.transportMode()
        );
    }
}
