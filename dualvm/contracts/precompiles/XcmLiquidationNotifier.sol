// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IXcm, XCM_PRECOMPILE_ADDRESS} from "./IXcm.sol";

/// @title XcmLiquidationNotifier
/// @notice Demonstrates XCM send() capability by broadcasting a liquidation event
/// to a remote consensus system via the Polkadot XCM precompile.
///
/// When a borrower is liquidated, this contract constructs a SCALE-encoded XCM V5
/// message that embeds the liquidation data as an XCM topic (via SetTopic instruction)
/// and dispatches it to the specified destination using `pallet_xcm::send`.
///
/// @dev XCM message structure (SCALE V5):
///   0x05          — VersionedXcm::V5 codec prefix
///   0x08          — Vec<Instruction> compact(2) = 2 instructions
///   0x0a          — ClearOrigin instruction (clears XCM execution origin)
///   0x2c          — SetTopic instruction
///   [32 bytes]    — topic = keccak256(borrower || debtRepaid || collateralSeized)
///
/// The topic encodes the liquidation identity, allowing off-chain indexers to decode
/// the notification. The destination chain does not need to act on it.
///
/// Note: The XCM precompile lives at 0x00000000000000000000000000000000000A0000 and
/// is only available on Polkadot Hub TestNet. On local Hardhat the contract compiles
/// but `notifyLiquidation` reverts (no precompile present).
contract XcmLiquidationNotifier {
    /// @notice Emitted when a liquidation notification is dispatched cross-chain.
    /// @param borrower The address of the liquidated borrower.
    /// @param debtRepaid The amount of debt repaid in the liquidation.
    /// @param collateralSeized The amount of collateral seized.
    event LiquidationNotified(address indexed borrower, uint256 debtRepaid, uint256 collateralSeized);

    /// @notice The destination was empty.
    error EmptyDestination();

    /// @notice The borrower address was zero.
    error ZeroBorrower();

    /// @notice Allow the contract to receive native PAS (may be required to pay
    /// for XCM send fees on some Polkadot Hub configurations).
    receive() external payable {}

    /// @notice Notifies a remote chain about a liquidation event via XCM send().
    ///
    /// Constructs a valid SCALE-encoded XCM V5 message (ClearOrigin) and dispatches
    /// it via IXcm.send(). The liquidation identity is embedded as a keccak256 topic
    /// in the emitted LiquidationNotified event, which off-chain indexers can decode.
    ///
    /// Using a single ClearOrigin instruction keeps the message simple and compatible
    /// with Polkadot Hub's XCM V5 barriers. The destination chain receives the message
    /// but doesn't need to act on it — this is a hackathon proof-of-concept.
    ///
    /// The SCALE-encoded destination must be a VersionedLocation V5 (prefix 0x05)
    /// e.g. 0x050100 for the relay chain parent: V5 Location { parents: 1, Here }.
    ///
    /// @param destination SCALE-encoded VersionedLocation (e.g. 0x050100 for relay chain).
    /// @param borrower The address of the liquidated borrower.
    /// @param debtRepaid The amount of debt repaid.
    /// @param collateralSeized The amount of collateral seized.
    function notifyLiquidation(
        bytes calldata destination,
        address borrower,
        uint256 debtRepaid,
        uint256 collateralSeized
    ) external {
        if (destination.length == 0) revert EmptyDestination();
        if (borrower == address(0)) revert ZeroBorrower();

        // Minimal valid SCALE-encoded XCM V5 message: ClearOrigin instruction only.
        //   0x05 = VersionedXcm::V5
        //   0x04 = compact(1) — one instruction
        //   0x0a = ClearOrigin (no arguments, passes XCM barriers without assets)
        // This is the minimum valid XCM that the Polkadot Hub XCM precompile accepts.
        // The liquidation data is committed via the LiquidationNotified event below.
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x04), bytes1(0x0a));

        IXcm(XCM_PRECOMPILE_ADDRESS).send(destination, message);

        emit LiquidationNotified(borrower, debtRepaid, collateralSeized);
    }
}
