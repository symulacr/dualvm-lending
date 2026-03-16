// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IXcm, XCM_PRECOMPILE_ADDRESS} from "./IXcm.sol";

/// @title CrossChainQuoteEstimator
/// @notice Demonstrates Polkadot-native XCM precompile access for Track 2.
/// Estimates the execution cost of a cross-chain XCM message by calling the
/// XCM precompile's `weighMessage` function.
/// @dev The XCM precompile lives at a fixed address on Polkadot Hub and is only
/// available on-chain. On local Hardhat networks this contract will compile but
/// calls to `estimateCrossChainQuoteCost` will revert because the precompile is
/// not present.
contract CrossChainQuoteEstimator {
    /// @notice The XCM precompile instance bound at the canonical address.
    IXcm public constant XCM = IXcm(XCM_PRECOMPILE_ADDRESS);

    /// @notice Emitted after a successful weight estimation.
    /// @param caller The address that requested the estimation.
    /// @param refTime The estimated computational time.
    /// @param proofSize The estimated proof size.
    event QuoteCostEstimated(address indexed caller, uint64 refTime, uint64 proofSize);

    /// @notice The provided XCM message was empty.
    error EmptyXcmMessage();

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
}
