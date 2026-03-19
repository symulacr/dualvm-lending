// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title XcmInbox
 * @notice Receives and de-duplicates asynchronous XCM receipts identified by a
 *         correlation ID.  Each receipt carries an opaque `data` payload that
 *         callers can interpret (e.g. serialised liquidation confirmation).
 *
 * @dev Designed to be called by an XCM origin (or a relay contract) after a
 *      cross-chain operation completes.  Duplicate delivery — which is possible
 *      under at-least-once XCM semantics — is rejected idempotently via the
 *      `processed` mapping.
 */
contract XcmInbox {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice True when a correlationId has already been processed.
    mapping(bytes32 => bool) public processed;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /**
     * @notice Emitted once per unique correlationId when a receipt is accepted.
     * @param correlationId Unique identifier linking the receipt to its origin.
     * @param sender        msg.sender that delivered the receipt.
     * @param data          Opaque payload attached to the receipt.
     */
    event ReceiptReceived(bytes32 indexed correlationId, address indexed sender, bytes data);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice Raised when `receiveReceipt` is called with an already-processed ID.
    error DuplicateCorrelationId(bytes32 correlationId);

    // -------------------------------------------------------------------------
    // External functions
    // -------------------------------------------------------------------------

    /**
     * @notice Record an incoming XCM receipt.
     * @dev    Reverts with `DuplicateCorrelationId` if `correlationId` was already
     *         received.  Marks the ID as processed before emitting to prevent
     *         re-entrancy from causing double-processing.
     * @param correlationId Unique identifier for this receipt.
     * @param data          Arbitrary payload delivered with the receipt.
     */
    function receiveReceipt(bytes32 correlationId, bytes calldata data) external {
        if (processed[correlationId]) revert DuplicateCorrelationId(correlationId);

        processed[correlationId] = true;

        emit ReceiptReceived(correlationId, msg.sender, data);
    }

    /**
     * @notice Returns whether a correlationId has already been processed.
     * @param correlationId The ID to query.
     * @return True if the receipt was already accepted; false otherwise.
     */
    function hasProcessed(bytes32 correlationId) external view returns (bool) {
        return processed[correlationId];
    }
}
