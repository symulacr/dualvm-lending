// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IXcm, XCM_PRECOMPILE_ADDRESS} from "./IXcm.sol";

/// @title CrossChainQuoteEstimator
/// @notice Demonstrates Polkadot-native XCM precompile access for Track 2.
/// Provides three XCM precompile interactions:
///   1. `estimateCrossChainQuoteCost` — weighMessage() to estimate execution cost
///   2. `executeLocalXcm` — execute() to run an XCM message locally with the contract's origin
///   3. `sendCrossChainNotification` — send() to dispatch an XCM message to a remote chain
/// @dev The XCM precompile lives at a fixed address on Polkadot Hub and is only
/// available on-chain. On local Hardhat networks this contract will compile but
/// calls that reach the precompile will revert because the precompile is not present.
contract CrossChainQuoteEstimator {
    /// @notice The XCM precompile instance bound at the canonical address.
    IXcm public constant XCM = IXcm(XCM_PRECOMPILE_ADDRESS);

    /// @notice Emitted after a successful weight estimation.
    /// @param caller The address that requested the estimation.
    /// @param refTime The estimated computational time.
    /// @param proofSize The estimated proof size.
    event QuoteCostEstimated(address indexed caller, uint64 refTime, uint64 proofSize);

    /// @notice Emitted after a local XCM execution is dispatched.
    /// @param caller The address that triggered execution.
    /// @param refTime The refTime weight limit provided.
    /// @param proofSize The proofSize weight limit provided.
    event XcmExecuted(address indexed caller, uint64 refTime, uint64 proofSize);

    /// @notice Emitted after a cross-chain XCM notification is sent.
    /// @param caller The address that triggered the send.
    /// @param destination The SCALE-encoded destination MultiLocation.
    event XcmSent(address indexed caller, bytes destination);

    /// @notice The provided XCM message was empty.
    error EmptyXcmMessage();

    /// @notice The provided destination was empty.
    error EmptyDestination();

    /// @notice Allow the contract to receive native PAS (required for XCM execute calls
    /// that withdraw from this contract's account via WithdrawAsset instructions).
    receive() external payable {}

    /// @notice Estimates the execution cost of a SCALE-encoded XCM message.
    /// @param xcmMessage A SCALE-encoded Versioned XCM message.
    /// @return refTime The computational time on reference hardware.
    /// @return proofSize The proof size required for execution.
    function estimateCrossChainQuoteCost(bytes calldata xcmMessage)
        external
        view
        returns (uint64 refTime, uint64 proofSize)
    {
        if (xcmMessage.length == 0) revert EmptyXcmMessage();

        IXcm.Weight memory weight = XCM.weighMessage(xcmMessage);
        return (weight.refTime, weight.proofSize);
    }

    /// @notice Executes a SCALE-encoded XCM message locally on the current chain
    /// using this contract as the origin, with an explicit weight limit.
    /// @dev Calls `pallet_xcm::execute` via the XCM precompile. The call may
    /// revert with insufficient balance or invalid message on live networks.
    /// @param message A SCALE-encoded Versioned XCM message.
    /// @param refTime The maximum allowed computational time weight.
    /// @param proofSize The maximum allowed proof size weight.
    function executeLocalXcm(bytes calldata message, uint64 refTime, uint64 proofSize) external {
        if (message.length == 0) revert EmptyXcmMessage();

        IXcm(XCM_PRECOMPILE_ADDRESS).execute(message, IXcm.Weight(refTime, proofSize));
        emit XcmExecuted(msg.sender, refTime, proofSize);
    }

    /// @notice Sends a SCALE-encoded XCM message to a remote consensus system.
    /// @dev Calls `pallet_xcm::send` via the XCM precompile. The destination
    /// chain does not need to process the message for this demonstration.
    /// @param destination SCALE-encoded destination MultiLocation.
    /// @param message SCALE-encoded Versioned XCM message.
    function sendCrossChainNotification(bytes calldata destination, bytes calldata message) external {
        if (destination.length == 0) revert EmptyDestination();
        if (message.length == 0) revert EmptyXcmMessage();

        IXcm(XCM_PRECOMPILE_ADDRESS).send(destination, message);
        emit XcmSent(msg.sender, destination);
    }
}
