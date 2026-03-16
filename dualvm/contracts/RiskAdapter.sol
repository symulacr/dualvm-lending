// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskAdapter} from "./interfaces/IRiskAdapter.sol";
import {IRiskEngine} from "./interfaces/IRiskEngine.sol";

contract RiskAdapter is IRiskAdapter {
    IRiskEngine public immutable quoteEngine;

    mapping(bytes32 => QuoteTicket) private quoteTickets;

    error InvalidQuoteEngine();

    constructor(IRiskEngine quoteEngine_) {
        if (address(quoteEngine_) == address(0)) revert InvalidQuoteEngine();
        quoteEngine = quoteEngine_;
    }

    function quote(QuoteInput calldata input) external view returns (QuoteOutput memory) {
        return quoteEngine.quote(input);
    }

    function quoteTicketId(QuoteContext calldata context, QuoteInput calldata input) external pure returns (bytes32) {
        return _quoteTicketId(context, input);
    }

    function publishQuoteTicket(QuoteContext calldata context, QuoteInput calldata input)
        public
        returns (bytes32 ticketId, QuoteOutput memory output)
    {
        ticketId = _quoteTicketId(context, input);
        QuoteTicket storage existingTicket = quoteTickets[ticketId];
        if (existingTicket.publishedAt != 0) {
            return (ticketId, _outputFromTicket(existingTicket));
        }

        output = quoteEngine.quote(input);
        QuoteTicket memory ticket = QuoteTicket({
            inputHash: _quoteInputHash(input),
            outputHash: _quoteOutputHash(output),
            oracleEpoch: context.oracleEpoch,
            configEpoch: context.configEpoch,
            oracleStateHash: context.oracleStateHash,
            configHash: context.configHash,
            borrowRateBps: output.borrowRateBps,
            maxLtvBps: output.maxLtvBps,
            liquidationThresholdBps: output.liquidationThresholdBps,
            publishedAt: block.timestamp,
            publisher: msg.sender
        });
        quoteTickets[ticketId] = ticket;

        emit QuoteTicketPublished(
            ticketId,
            ticket.inputHash,
            ticket.outputHash,
            ticket.oracleEpoch,
            ticket.configEpoch,
            ticket.oracleStateHash,
            ticket.configHash,
            ticket.publisher
        );
    }

    function quoteViaTicket(QuoteContext calldata context, QuoteInput calldata input) external returns (QuoteOutput memory output) {
        bytes32 ticketId = _quoteTicketId(context, input);
        QuoteTicket storage ticket = quoteTickets[ticketId];
        if (ticket.publishedAt == 0) {
            (, output) = publishQuoteTicket(context, input);
            return output;
        }

        return _outputFromTicket(ticket);
    }

    function getQuoteTicket(bytes32 ticketId) external view returns (QuoteTicket memory) {
        QuoteTicket memory ticket = quoteTickets[ticketId];
        if (ticket.publishedAt == 0) revert QuoteTicketMissing(ticketId);
        return ticket;
    }

    function _quoteTicketId(QuoteContext calldata context, QuoteInput calldata input) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                context.oracleEpoch,
                context.configEpoch,
                context.oracleStateHash,
                context.configHash,
                input.utilizationBps,
                input.collateralRatioBps,
                input.oracleAgeSeconds,
                input.oracleFresh
            )
        );
    }

    function _quoteInputHash(QuoteInput calldata input) private pure returns (bytes32) {
        return keccak256(abi.encode(input.utilizationBps, input.collateralRatioBps, input.oracleAgeSeconds, input.oracleFresh));
    }

    function _quoteOutputHash(QuoteOutput memory output) private pure returns (bytes32) {
        return keccak256(abi.encode(output.borrowRateBps, output.maxLtvBps, output.liquidationThresholdBps));
    }

    function _outputFromTicket(QuoteTicket storage ticket) private view returns (QuoteOutput memory output) {
        output.borrowRateBps = ticket.borrowRateBps;
        output.maxLtvBps = ticket.maxLtvBps;
        output.liquidationThresholdBps = ticket.liquidationThresholdBps;
    }
}
