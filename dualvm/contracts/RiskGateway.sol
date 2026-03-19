// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {IRiskAdapter} from "./interfaces/IRiskAdapter.sol";
import {IRiskEngine} from "./interfaces/IRiskEngine.sol";
import {GovernancePolicyStore} from "./GovernancePolicyStore.sol";

/// @notice Unified cross-VM risk gateway. Computes the canonical deterministic kinked-curve
/// result inline, and optionally verifies against a PVM-deployed quoteEngine.
/// Optionally reads governance risk policy overrides from GovernancePolicyStore.
contract RiskGateway is IRiskAdapter, AccessManaged {
    uint256 private constant BPS = 10_000;

    // --- Well-known policy keys for GovernancePolicyStore overrides ---
    bytes32 public constant POLICY_MAX_LTV = keccak256("RISK_MAX_LTV_BPS");
    bytes32 public constant POLICY_LIQ_THRESHOLD = keccak256("RISK_LIQ_THRESHOLD_BPS");
    bytes32 public constant POLICY_BORROW_RATE_FLOOR = keccak256("RISK_BORROW_RATE_FLOOR_BPS");

    // --- Inline risk model parameters (immutable) ---
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

    // --- Optional PVM cross-VM verification ---
    IRiskEngine public immutable quoteEngine;

    // --- Optional governance policy overrides ---
    /// @notice Governance-managed policy override store. address(0) disables overrides.
    GovernancePolicyStore public immutable policyStore;

    mapping(bytes32 => QuoteTicket) private quoteTickets;

    error InvalidRiskParams();

    event QuoteVerified(bytes32 indexed ticketId, string reason);
    event CrossVMDivergence(
        uint256 expectedBorrowRateBps,
        uint256 actualBorrowRateBps,
        uint256 expectedMaxLtvBps,
        uint256 actualMaxLtvBps,
        uint256 expectedLiquidationThresholdBps,
        uint256 actualLiquidationThresholdBps
    );

    struct RiskModelConfig {
        uint256 baseRateBps;
        uint256 slope1Bps;
        uint256 slope2Bps;
        uint256 kinkBps;
        uint256 healthyMaxLtvBps;
        uint256 stressedMaxLtvBps;
        uint256 healthyLiquidationThresholdBps;
        uint256 stressedLiquidationThresholdBps;
        uint256 staleBorrowRatePenaltyBps;
        uint256 stressedCollateralRatioBps;
    }

    /// @param authority_    AccessManager address.
    /// @param quoteEngine_  Optional PVM quote engine for cross-VM verification (address(0) = disabled).
    /// @param policyStore_  Optional governance policy override store (address(0) = disabled).
    /// @param config_       Immutable risk model parameters.
    constructor(address authority_, address quoteEngine_, address policyStore_, RiskModelConfig memory config_)
        AccessManaged(authority_)
    {
        if (
            config_.kinkBps == 0 || config_.kinkBps >= BPS || config_.healthyMaxLtvBps == 0
                || config_.healthyMaxLtvBps >= BPS || config_.stressedMaxLtvBps == 0
                || config_.stressedMaxLtvBps > config_.healthyMaxLtvBps
                || config_.healthyLiquidationThresholdBps <= config_.healthyMaxLtvBps
                || config_.healthyLiquidationThresholdBps > BPS
                || config_.stressedLiquidationThresholdBps <= config_.stressedMaxLtvBps
                || config_.stressedLiquidationThresholdBps > config_.healthyLiquidationThresholdBps
                || config_.stressedCollateralRatioBps < BPS
        ) revert InvalidRiskParams();

        baseRateBps = config_.baseRateBps;
        slope1Bps = config_.slope1Bps;
        slope2Bps = config_.slope2Bps;
        kinkBps = config_.kinkBps;
        healthyMaxLtvBps = config_.healthyMaxLtvBps;
        stressedMaxLtvBps = config_.stressedMaxLtvBps;
        healthyLiquidationThresholdBps = config_.healthyLiquidationThresholdBps;
        stressedLiquidationThresholdBps = config_.stressedLiquidationThresholdBps;
        staleBorrowRatePenaltyBps = config_.staleBorrowRatePenaltyBps;
        stressedCollateralRatioBps = config_.stressedCollateralRatioBps;

        // quoteEngine can be address(0) — means no PVM cross-VM verification
        quoteEngine = IRiskEngine(quoteEngine_);

        // policyStore can be address(0) — no overrides
        policyStore = GovernancePolicyStore(policyStore_);
    }

    // --- Public view: inline deterministic computation ---

    function quote(QuoteInput calldata input) external view returns (QuoteOutput memory) {
        return _inlineQuote(input);
    }

    function quoteTicketId(QuoteContext calldata context, QuoteInput calldata input) external pure returns (bytes32) {
        return _quoteTicketId(context, input);
    }

    // --- Restricted: only LendingCore can call ---

    function quoteViaTicket(QuoteContext calldata context, QuoteInput calldata input)
        external
        restricted
        returns (QuoteOutput memory output)
    {
        bytes32 ticketId = _quoteTicketId(context, input);
        QuoteTicket storage ticket = quoteTickets[ticketId];
        if (ticket.publishedAt != 0) {
            return _outputFromTicket(ticket);
        }

        // Compute inline deterministic result (canonical path)
        output = _inlineQuote(input);

        // If PVM quoteEngine is set, verify cross-VM match
        if (address(quoteEngine) != address(0)) {
            _verifyCrossVM(ticketId, input, output);
        }

        // Cache as ticket
        _storeTicket(ticketId, context, input, output);
    }

    function getQuoteTicket(bytes32 ticketId) external view returns (QuoteTicket memory) {
        QuoteTicket memory ticket = quoteTickets[ticketId];
        if (ticket.publishedAt == 0) revert QuoteTicketMissing(ticketId);
        return ticket;
    }

    // --- Inline kinked-curve math (same as DeterministicRiskModel) ---

    function _inlineQuote(QuoteInput calldata input) private view returns (QuoteOutput memory output) {
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

        // Apply governance policy overrides if policyStore is configured
        if (address(policyStore) != address(0)) {
            _applyPolicyOverrides(output);
        }
    }

    /// @dev Apply active policy overrides from GovernancePolicyStore to the quote output.
    function _applyPolicyOverrides(QuoteOutput memory output) private view {
        // Override maxLtvBps if policy is active and valid
        if (policyStore.policyActive(POLICY_MAX_LTV)) {
            uint256 overrideLtv = policyStore.getPolicy(POLICY_MAX_LTV);
            if (overrideLtv > 0 && overrideLtv < BPS) {
                output.maxLtvBps = overrideLtv;
            }
        }

        // Override liquidationThresholdBps if policy is active and valid
        if (policyStore.policyActive(POLICY_LIQ_THRESHOLD)) {
            uint256 overrideThreshold = policyStore.getPolicy(POLICY_LIQ_THRESHOLD);
            if (overrideThreshold > output.maxLtvBps && overrideThreshold <= BPS) {
                output.liquidationThresholdBps = overrideThreshold;
            }
        }

        // Apply borrow rate floor if active
        if (policyStore.policyActive(POLICY_BORROW_RATE_FLOOR)) {
            uint256 floor = policyStore.getPolicy(POLICY_BORROW_RATE_FLOOR);
            if (output.borrowRateBps < floor) {
                output.borrowRateBps = floor;
            }
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

    // --- Cross-VM verification ---

    function _verifyCrossVM(bytes32 ticketId, QuoteInput calldata input, QuoteOutput memory expected) private {
        try quoteEngine.quote(input) returns (QuoteOutput memory actual) {
            if (
                actual.borrowRateBps == expected.borrowRateBps && actual.maxLtvBps == expected.maxLtvBps
                    && actual.liquidationThresholdBps == expected.liquidationThresholdBps
            ) {
                emit QuoteVerified(ticketId, "cross-vm-match");
            } else {
                emit CrossVMDivergence(
                    expected.borrowRateBps,
                    actual.borrowRateBps,
                    expected.maxLtvBps,
                    actual.maxLtvBps,
                    expected.liquidationThresholdBps,
                    actual.liquidationThresholdBps
                );
            }
        } catch {
            // PVM call failed — log but do not revert; inline result is canonical
            emit CrossVMDivergence(
                expected.borrowRateBps, 0, expected.maxLtvBps, 0, expected.liquidationThresholdBps, 0
            );
        }
    }

    // --- Ticket storage ---

    function _storeTicket(
        bytes32 ticketId,
        QuoteContext calldata context,
        QuoteInput calldata input,
        QuoteOutput memory output
    ) private {
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
        return keccak256(
            abi.encode(input.utilizationBps, input.collateralRatioBps, input.oracleAgeSeconds, input.oracleFresh)
        );
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
