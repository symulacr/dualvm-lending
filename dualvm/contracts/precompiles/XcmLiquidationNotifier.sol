// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IXcm, XCM_PRECOMPILE_ADDRESS} from "./IXcm.sol";

/// @title XcmLiquidationNotifier
/// @notice Demonstrates XCM send() capability by broadcasting a liquidation event
/// to a remote consensus system via the Polkadot XCM precompile.
///
/// When a borrower is liquidated, this contract constructs a SCALE-encoded XCM V5
/// message that embeds the correlationId as a SetTopic instruction and dispatches it
/// to the specified destination using `pallet_xcm::send`.
///
/// @dev XCM message structure (SCALE V5):
///   0x05          — VersionedXcm::V5 codec prefix
///   0x08          — Vec<Instruction> compact(2) = 2 instructions
///   0x0a          — ClearOrigin instruction (clears XCM execution origin)
///   0x2c          — SetTopic instruction
///   [32 bytes]    — topic = correlationId (the bilateral async correlation ID)
///
/// The correlationId links the on-chain liquidation event to the cross-chain
/// notification, enabling off-chain indexers to correlate the bilateral flow.
/// The destination chain does not need to act on it.
///
/// Note: The XCM precompile lives at 0x00000000000000000000000000000000000A0000 and
/// is only available on Polkadot Hub TestNet. On local Forge the contract compiles
/// but `notifyLiquidation` reverts (no precompile present).
contract XcmLiquidationNotifier {
    /// @notice Emitted when a liquidation notification is dispatched cross-chain.
    /// @param borrower The address of the liquidated borrower.
    /// @param debtRepaid The amount of debt repaid in the liquidation.
    /// @param collateralSeized The amount of collateral seized.
    /// @param correlationId The bilateral async correlation ID embedded in the XCM topic.
    event LiquidationNotified(
        address indexed borrower, uint256 debtRepaid, uint256 collateralSeized, bytes32 indexed correlationId
    );

    /// @notice Emitted when a local XCM execution is completed with a correlation ID.
    event LocalXcmExecuted(bytes32 indexed correlationId, uint64 refTime, uint64 proofSize);

    /// @notice The destination was empty.
    error EmptyDestination();

    /// @notice The borrower address was zero.
    error ZeroBorrower();

    /// @notice Allow the contract to receive native PAS (may be needed for XCM fee forwarding).
    receive() external payable {}

    /// @notice Notifies a remote chain about a liquidation event via XCM send().
    ///
    /// Constructs a SCALE-encoded XCM V5 message with ClearOrigin + SetTopic(correlationId)
    /// and dispatches it via IXcm.send(). The correlationId is embedded as the XCM topic,
    /// enabling off-chain indexers to correlate the bilateral async event trace.
    ///
    /// XCM V5 message encoding:
    ///   0x05 = VersionedXcm::V5
    ///   0x08 = compact(2) — two instructions
    ///   0x0a = ClearOrigin (no arguments)
    ///   0x2c = SetTopic
    ///   [32 bytes] = correlationId (the topic)
    ///
    /// The SCALE-encoded destination must be a VersionedLocation V5 (prefix 0x05)
    /// e.g. 0x050100 for the relay chain parent: V5 Location { parents: 1, Here }.
    ///
    /// @param destination SCALE-encoded VersionedLocation (e.g. 0x050100 for relay chain).
    /// @param borrower The address of the liquidated borrower.
    /// @param debtRepaid The amount of debt repaid.
    /// @param collateralSeized The amount of collateral seized.
    /// @param correlationId The bilateral async correlation ID to embed as SetTopic.
    function notifyLiquidation(
        bytes calldata destination,
        address borrower,
        uint256 debtRepaid,
        uint256 collateralSeized,
        bytes32 correlationId
    ) external {
        if (destination.length == 0) revert EmptyDestination();
        if (borrower == address(0)) revert ZeroBorrower();

        // SCALE-encoded XCM V5 message: ClearOrigin + SetTopic(correlationId)
        //   0x05 = VersionedXcm::V5
        //   0x08 = compact(2) — two instructions
        //   0x0a = ClearOrigin (no arguments, passes XCM barriers without assets)
        //   0x2c = SetTopic instruction
        //   [32 bytes] = correlationId as the XCM topic
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), correlationId);

        IXcm(XCM_PRECOMPILE_ADDRESS).send(destination, message);

        emit LiquidationNotified(borrower, debtRepaid, collateralSeized, correlationId);
    }

    /// @notice Executes an XCM ClearOrigin+SetTopic message locally via the XCM precompile.
    /// @dev Unlike notifyLiquidation which uses send() to dispatch cross-chain,
    /// this function uses execute() for provable local XCM execution.
    /// The correlationId is embedded as the XCM topic, providing on-chain proof
    /// that the XCM precompile processed the bilateral correlation payload.
    /// @param correlationId The bilateral async correlation ID to embed as SetTopic.
    function executeLocalNotification(bytes32 correlationId) external {
        // SCALE-encoded XCM V5: ClearOrigin + SetTopic(correlationId)
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), correlationId);

        IXcm.Weight memory weight = IXcm(XCM_PRECOMPILE_ADDRESS).weighMessage(message);
        IXcm(XCM_PRECOMPILE_ADDRESS).execute(message, weight);

        emit LocalXcmExecuted(correlationId, weight.refTime, weight.proofSize);
    }
}
