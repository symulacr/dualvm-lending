// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "./IRiskEngine.sol";

interface IRiskAdapter is IRiskEngine {
    struct QuoteContext {
        uint256 oracleEpoch;
        uint256 configEpoch;
        bytes32 oracleStateHash;
        bytes32 configHash;
    }

    struct QuoteTicket {
        bytes32 inputHash;
        bytes32 outputHash;
        uint256 oracleEpoch;
        uint256 configEpoch;
        bytes32 oracleStateHash;
        bytes32 configHash;
        uint256 borrowRateBps;
        uint256 maxLtvBps;
        uint256 liquidationThresholdBps;
        uint256 publishedAt;
        address publisher;
    }

    error QuoteTicketMissing(bytes32 ticketId);

    event QuoteTicketPublished(
        bytes32 indexed ticketId,
        bytes32 indexed inputHash,
        bytes32 indexed outputHash,
        uint256 oracleEpoch,
        uint256 configEpoch,
        bytes32 oracleStateHash,
        bytes32 configHash,
        address publisher
    );

    function quoteEngine() external view returns (IRiskEngine);

    function quoteTicketId(QuoteContext calldata context, QuoteInput calldata input) external pure returns (bytes32);

    function publishQuoteTicket(QuoteContext calldata context, QuoteInput calldata input)
        external
        returns (bytes32 ticketId, QuoteOutput memory output);

    function quoteViaTicket(QuoteContext calldata context, QuoteInput calldata input) external returns (QuoteOutput memory output);

    function getQuoteTicket(bytes32 ticketId) external view returns (QuoteTicket memory);
}
