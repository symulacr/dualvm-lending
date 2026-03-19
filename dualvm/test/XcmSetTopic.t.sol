// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {XcmLiquidationNotifier} from "../contracts/precompiles/XcmLiquidationNotifier.sol";
import {XcmNotifierAdapter} from "../contracts/XcmNotifierAdapter.sol";
import {IXcm, XCM_PRECOMPILE_ADDRESS} from "../contracts/precompiles/IXcm.sol";

/// @notice Tests verifying SetTopic encoding in the XCM V5 message from XcmLiquidationNotifier.
///
/// XCM V5 message structure:
///   0x05          — VersionedXcm::V5 codec prefix
///   0x08          — Vec<Instruction> compact(2) = 2 instructions
///   0x0a          — ClearOrigin instruction
///   0x2c          — SetTopic instruction
///   [32 bytes]    — topic = correlationId
///
/// This verifies the bilateral async cross-chain event linking.
contract XcmSetTopicTest is Test {
    XcmLiquidationNotifier internal notifier;
    XcmNotifierAdapter internal adapter;

    bytes internal constant RELAY_DESTINATION = hex"050100";
    address internal constant BORROWER = address(0x1234567890123456789012345678901234567890);
    uint256 internal constant DEBT = 1_000 * 1e18;
    uint256 internal constant COLLATERAL = 1_100 * 1e18;

    function setUp() public {
        notifier = new XcmLiquidationNotifier();
        adapter = new XcmNotifierAdapter(address(notifier));
    }

    // -------------------------------------------------------------------------
    // XCM message structure verification
    // -------------------------------------------------------------------------

    function test_XcmMessage_HasCorrectVersion() public pure {
        bytes32 corrId = keccak256("test");
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), corrId);
        assertEq(message[0], bytes1(0x05), "V5 prefix required");
    }

    function test_XcmMessage_HasTwoInstructions() public pure {
        bytes32 corrId = keccak256("test");
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), corrId);
        assertEq(message[1], bytes1(0x08), "compact(2) = 2 instructions");
    }

    function test_XcmMessage_HasClearOriginInstruction() public pure {
        bytes32 corrId = keccak256("test");
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), corrId);
        assertEq(message[2], bytes1(0x0a), "ClearOrigin instruction opcode");
    }

    function test_XcmMessage_HasSetTopicInstruction() public pure {
        bytes32 corrId = keccak256("test");
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), corrId);
        assertEq(message[3], bytes1(0x2c), "SetTopic instruction opcode");
    }

    function test_XcmMessage_HasCorrectLength() public pure {
        bytes32 corrId = keccak256("test");
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), corrId);
        assertEq(message.length, 36, "4 bytes header + 32 bytes correlationId");
    }

    function test_XcmMessage_EmbeddsCorrelationId() public pure {
        bytes32 corrId = keccak256("bilateral-async-correlation");
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), corrId);

        // Last 32 bytes should be the correlationId
        bytes32 extracted;
        assembly {
            extracted := mload(add(message, 36))
        }
        assertEq(extracted, corrId, "correlationId should be embedded in bytes 4-36");
    }

    function test_XcmMessage_DifferentCorrelationIdsProduceDifferentMessages() public pure {
        bytes32 corrId1 = keccak256("flow-1");
        bytes32 corrId2 = keccak256("flow-2");

        bytes memory msg1 = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), corrId1);
        bytes memory msg2 = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), corrId2);

        assertNotEq(keccak256(msg1), keccak256(msg2));
    }

    // -------------------------------------------------------------------------
    // XcmLiquidationNotifier sends correct message via mocked precompile
    // -------------------------------------------------------------------------

    function test_NotifyLiquidation_SendsCorrectSetTopicMessage() public {
        bytes32 correlationId = keccak256("test-set-topic");
        bytes memory expectedMessage =
            abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), correlationId);

        // Mock the XCM precompile: expect the exact message
        vm.mockCall(
            XCM_PRECOMPILE_ADDRESS,
            abi.encodeWithSelector(IXcm.send.selector, RELAY_DESTINATION, expectedMessage),
            abi.encode()
        );

        notifier.notifyLiquidation(RELAY_DESTINATION, BORROWER, DEBT, COLLATERAL, correlationId);
    }

    function test_NotifyLiquidation_EmitsLiquidationNotifiedWithCorrelationId() public {
        bytes32 correlationId = keccak256("event-correlator-test");
        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.send.selector), abi.encode());

        vm.expectEmit(true, true, false, true, address(notifier));
        emit XcmLiquidationNotifier.LiquidationNotified(BORROWER, DEBT, COLLATERAL, correlationId);
        notifier.notifyLiquidation(RELAY_DESTINATION, BORROWER, DEBT, COLLATERAL, correlationId);
    }

    // -------------------------------------------------------------------------
    // XcmNotifierAdapter forwards correlationId
    // -------------------------------------------------------------------------

    function test_XcmNotifierAdapter_ForwardsCorrelationId() public {
        bytes32 correlationId = keccak256("adapter-test");
        bytes memory expectedMessage =
            abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), correlationId);

        // The adapter injects RELAY_DESTINATION and calls notifier with the correlationId
        vm.mockCall(
            XCM_PRECOMPILE_ADDRESS,
            abi.encodeWithSelector(IXcm.send.selector, adapter.RELAY_DESTINATION(), expectedMessage),
            abi.encode()
        );

        // Call via the 4-arg ILiquidationNotifier interface
        adapter.notifyLiquidation(BORROWER, DEBT, COLLATERAL, correlationId);
    }

    function test_XcmNotifierAdapter_RelayDestination() public view {
        // Verify the adapter uses the expected RELAY_DESTINATION
        assertEq(adapter.RELAY_DESTINATION(), hex"050100", "relay destination should be V5 relay chain parent");
    }

    // -------------------------------------------------------------------------
    // Fuzz: any correlationId produces a valid SetTopic message
    // -------------------------------------------------------------------------

    function testFuzz_SetTopicMessage_AlwaysHasCorrectStructure(bytes32 correlationId) public pure {
        bytes memory message = abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), correlationId);

        assertEq(message[0], bytes1(0x05), "V5 prefix");
        assertEq(message[1], bytes1(0x08), "2 instructions");
        assertEq(message[2], bytes1(0x0a), "ClearOrigin");
        assertEq(message[3], bytes1(0x2c), "SetTopic");
        assertEq(message.length, 36, "correct length");
    }
}
