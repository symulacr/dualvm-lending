// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ILiquidationNotifier} from "./interfaces/ILiquidationNotifier.sol";
import {XcmLiquidationNotifier} from "./precompiles/XcmLiquidationNotifier.sol";

/// @title XcmNotifierAdapter
/// @notice Bridges the 3-arg ILiquidationNotifier interface expected by
///         LiquidationHookRegistry (and LendingCoreV2) to the 4-arg
///         XcmLiquidationNotifier.notifyLiquidation by injecting a hardcoded
///         relay-chain destination.
///
/// The ABI mismatch between ILiquidationNotifier (address, uint256, uint256) and
/// XcmLiquidationNotifier (bytes, address, uint256, uint256) caused silent hook
/// failures in the v2-integration-test.  This adapter fixes that by acting as the
/// registered hook handler in LiquidationHookRegistry while forwarding calls to the
/// real XcmLiquidationNotifier with the correct 4-arg signature.
///
/// @dev The relay-chain destination is SCALE-encoded as a VersionedLocation V5:
///   0x05 = VersionedXcm::V5
///   0x01 = 1 parent (relay chain)
///   0x00 = Here interior
/// (0x050100 = V5 Location { parents: 1, interior: Here })
contract XcmNotifierAdapter is ILiquidationNotifier {
    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice SCALE-encoded VersionedLocation V5 for the relay chain parent.
    /// @dev 0x05 = V5 prefix, 0x01 = parents: 1, 0x00 = Here interior.
    bytes public constant RELAY_DESTINATION = hex"050100";

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice The XCM notifier this adapter forwards calls to.
    XcmLiquidationNotifier public immutable xcmNotifier;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param xcmNotifier_ Address of the deployed XcmLiquidationNotifier contract.
    constructor(address xcmNotifier_) {
        xcmNotifier = XcmLiquidationNotifier(payable(xcmNotifier_));
    }

    // -------------------------------------------------------------------------
    // ILiquidationNotifier
    // -------------------------------------------------------------------------

    /// @inheritdoc ILiquidationNotifier
    /// @dev Injects RELAY_DESTINATION and forwards to the 5-arg XcmLiquidationNotifier.
    function notifyLiquidation(address borrower, uint256 debtRepaid, uint256 collateralSeized, bytes32 correlationId)
        external
        override
    {
        xcmNotifier.notifyLiquidation(RELAY_DESTINATION, borrower, debtRepaid, collateralSeized, correlationId);
    }

    /// @notice Allow the adapter to receive PAS (may be needed for XCM fee forwarding).
    receive() external payable {}
}
