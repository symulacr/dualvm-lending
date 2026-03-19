// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {RiskGateway} from "../contracts/RiskGateway.sol";
import {IRiskAdapter} from "../contracts/interfaces/IRiskAdapter.sol";
import {IRiskEngine} from "../contracts/interfaces/IRiskEngine.sol";

/// @title QuoteTicketsTest
/// @notice Forge tests for quote ticket and epoch flow — migrated from QuoteTickets.ts
contract QuoteTicketsTest is BaseTest {

    // =========================================================================
    // Publish and reuse tickets
    // =========================================================================

    function test_PublishTicket_StoresAndRetrievesTicket() public {
        uint256 borrowAmount = 5_000 * WAD;

        IRiskAdapter.QuoteContext memory context = lendingEngine.currentQuoteContext();
        IRiskEngine.QuoteInput memory input = lendingEngine.projectedBorrowQuoteInput(borrower, borrowAmount);

        bytes32 ticketId = riskGateway.quoteTicketId(context, input);

        // Publish ticket as admin (test contract)
        vm.expectEmit(true, false, false, false, address(riskGateway));
        emit IRiskAdapter.QuoteTicketPublished(ticketId, bytes32(0), bytes32(0), 0, 0, bytes32(0), bytes32(0), address(0));
        lendingEngine.publishProjectedBorrowQuoteTicket(borrower, borrowAmount);

        // Retrieve and verify
        IRiskAdapter.QuoteTicket memory ticket = riskGateway.getQuoteTicket(ticketId);
        assertEq(ticket.oracleEpoch, context.oracleEpoch, "oracle epoch should match");
        assertEq(ticket.configEpoch, context.configEpoch, "config epoch should match");
        assertEq(ticket.borrowRateBps, 300, "borrow rate at 10% utilization should be 300 bps");
        assertEq(ticket.maxLtvBps, HEALTHY_MAX_LTV_BPS, "should be healthy max LTV");
        assertEq(ticket.liquidationThresholdBps, HEALTHY_LIQ_THRESHOLD_BPS, "should be healthy liq threshold");
    }

    function test_PublishCurrentTicket_Works() public {
        // publishCurrentQuoteTicket is restricted to admin (deployer)
        bytes32 ticketId = lendingEngine.publishCurrentQuoteTicket(borrower);
        assertNotEq(ticketId, bytes32(0), "ticket ID should be non-zero");

        IRiskAdapter.QuoteTicket memory ticket = riskGateway.getQuoteTicket(ticketId);
        assertGt(ticket.publishedAt, 0, "ticket should have a publish timestamp");
    }

    function test_AutoPublish_OnBorrowHotPath() public {
        uint256 borrowAmount = 5_000 * WAD;

        IRiskAdapter.QuoteContext memory contextBefore = lendingEngine.currentQuoteContext();
        IRiskEngine.QuoteInput memory inputBefore = lendingEngine.projectedBorrowQuoteInput(borrower, borrowAmount);
        bytes32 ticketId = riskGateway.quoteTicketId(contextBefore, inputBefore);

        // Borrow should auto-publish a ticket
        vm.expectEmit(true, false, false, false, address(riskGateway));
        emit IRiskAdapter.QuoteTicketPublished(ticketId, bytes32(0), bytes32(0), 0, 0, bytes32(0), bytes32(0), address(0));
        _borrowAs(borrower, borrowAmount);

        IRiskAdapter.QuoteTicket memory ticket = riskGateway.getQuoteTicket(ticketId);
        assertEq(ticket.borrowRateBps, 300, "borrow rate at 10% util should be 300 bps");
    }

    function test_TicketIsReusedOnSecondCall() public {
        // First borrow publishes a ticket
        _borrowAs(borrower, 5_000 * WAD);

        IRiskAdapter.QuoteContext memory context = lendingEngine.currentQuoteContext();
        IRiskEngine.QuoteInput memory input = lendingEngine.currentQuoteInput(borrower);
        bytes32 ticketId = riskGateway.quoteTicketId(context, input);

        // Ticket already exists after borrow
        IRiskAdapter.QuoteTicket memory ticket = riskGateway.getQuoteTicket(ticketId);
        uint256 firstPublishAt = ticket.publishedAt;
        assertGt(firstPublishAt, 0, "ticket should exist");

        // Call publish again — same context/input → same ticket ID, same publishedAt (reused)
        lendingEngine.publishCurrentQuoteTicket(borrower);
        IRiskAdapter.QuoteTicket memory ticketAfter = riskGateway.getQuoteTicket(ticketId);
        assertEq(ticketAfter.publishedAt, firstPublishAt, "ticket should be reused, not overwritten");
    }

    // =========================================================================
    // Oracle epoch changes
    // =========================================================================

    function test_OracleEpoch_IncreasesOnPriceUpdate() public {
        uint256 epochBefore = oracle.oracleEpoch();
        oracle.setPrice(1_200 * WAD); // within 25% delta
        uint256 epochAfter = oracle.oracleEpoch();
        assertGt(epochAfter, epochBefore, "epoch should increase on price update");
    }

    function test_QuoteContext_ChangesAfterOracleUpdate() public {
        IRiskAdapter.QuoteContext memory contextBefore = lendingEngine.currentQuoteContext();

        oracle.setCircuitBreaker(ORACLE_MIN_PRICE_WAD, ORACLE_MAX_PRICE_WAD, 10_000);
        oracle.setPrice(900 * WAD);

        IRiskAdapter.QuoteContext memory contextAfter = lendingEngine.currentQuoteContext();

        assertGt(contextAfter.oracleEpoch, contextBefore.oracleEpoch, "oracle epoch should increase");
        assertNotEq(contextAfter.oracleStateHash, contextBefore.oracleStateHash, "oracle state hash should change");
    }

    function test_ConfigEpoch_StableWithinImmutableMarket() public {
        uint256 configEpochBefore = lendingEngine.configEpoch();
        bytes32 configHashBefore = lendingEngine.currentRiskConfigHash();

        lendingEngine.publishCurrentQuoteTicket(borrower);

        assertEq(lendingEngine.configEpoch(), configEpochBefore, "config epoch should be stable");
        assertEq(lendingEngine.currentRiskConfigHash(), configHashBefore, "config hash should be stable");
    }

    function test_OracleEpoch_IncreasesOnCircuitBreakerUpdate() public {
        uint256 epochBefore = oracle.oracleEpoch();
        oracle.setCircuitBreaker(ORACLE_MIN_PRICE_WAD, ORACLE_MAX_PRICE_WAD, 5_000);
        uint256 epochAfter = oracle.oracleEpoch();
        assertGt(epochAfter, epochBefore, "epoch should increase on circuit breaker update");
    }

    // =========================================================================
    // Ticket ID properties
    // =========================================================================

    function test_TicketId_DifferentForDifferentContext() public {
        IRiskAdapter.QuoteContext memory context1 = lendingEngine.currentQuoteContext();
        IRiskEngine.QuoteInput memory input = lendingEngine.currentQuoteInput(borrower);

        bytes32 id1 = riskGateway.quoteTicketId(context1, input);

        // Update oracle to change context
        oracle.setPrice(1_100 * WAD);

        IRiskAdapter.QuoteContext memory context2 = lendingEngine.currentQuoteContext();
        bytes32 id2 = riskGateway.quoteTicketId(context2, input);

        assertNotEq(id1, id2, "different contexts should produce different ticket IDs");
    }

    function test_TicketId_SameForSameContextAndInput() public view {
        IRiskAdapter.QuoteContext memory context = lendingEngine.currentQuoteContext();
        IRiskEngine.QuoteInput memory input = lendingEngine.currentQuoteInput(borrower);

        bytes32 id1 = riskGateway.quoteTicketId(context, input);
        bytes32 id2 = riskGateway.quoteTicketId(context, input);
        assertEq(id1, id2, "same context+input should always produce same ticket ID");
    }

    function test_PublishedTicket_HasCorrectPublisher() public {
        uint256 borrowAmount = 5_000 * WAD;
        _borrowAs(borrower, borrowAmount);

        IRiskAdapter.QuoteContext memory context = lendingEngine.currentQuoteContext();
        IRiskEngine.QuoteInput memory input = lendingEngine.currentQuoteInput(borrower);
        bytes32 ticketId = riskGateway.quoteTicketId(context, input);

        // Get ticket published during borrow
        IRiskAdapter.QuoteTicket memory ticket = riskGateway.getQuoteTicket(ticketId);
        assertEq(ticket.publisher, address(lendingEngine), "publisher should be the lending engine");
    }

    function test_BorrowRate_At10Percent_Is300Bps() public {
        // 5000 WAD borrow out of 50000 WAD pool = 10% utilization
        // At 10%: baseRate + slope1 * utilization / kink = 200 + 800 * 1000 / 8000 = 200 + 100 = 300
        uint256 borrowAmount = 5_000 * WAD;
        _borrowAs(borrower, borrowAmount);

        IRiskAdapter.QuoteContext memory context = lendingEngine.currentQuoteContext();
        IRiskEngine.QuoteInput memory input = lendingEngine.currentQuoteInput(borrower);
        bytes32 ticketId = riskGateway.quoteTicketId(context, input);
        IRiskAdapter.QuoteTicket memory ticket = riskGateway.getQuoteTicket(ticketId);

        assertEq(ticket.borrowRateBps, 300, "at 10% utilization, borrow rate should be 300 bps");
    }
}
