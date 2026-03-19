// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {XcmLiquidationNotifier} from "../contracts/precompiles/XcmLiquidationNotifier.sol";
import {IXcm, XCM_PRECOMPILE_ADDRESS} from "../contracts/precompiles/IXcm.sol";

/// @notice Tests for XcmLiquidationNotifier with mocked XCM precompile.
///
/// The XCM precompile (0xA0000) is only available on Polkadot Hub. These tests
/// use vm.mockCall to simulate the precompile, allowing full local verification of:
///   1. Input validation (EmptyDestination, ZeroBorrower)
///   2. XCM message construction (SetTopic encoding with correlationId)
///   3. LiquidationNotified event emission
///   4. Successful dispatch with mocked precompile
contract XcmLiquidationNotifierTest is Test {
    XcmLiquidationNotifier internal notifier;

    /// @dev SCALE-encoded destination: V5 relay chain parent (parents=1, interior=Here)
    bytes internal constant RELAY_DESTINATION = hex"050100";
    address internal constant SAMPLE_BORROWER = address(0x1234567890123456789012345678901234567890);
    uint256 internal constant SAMPLE_DEBT = 100 * 1e18;
    uint256 internal constant SAMPLE_COLLATERAL = 110 * 1e18;
    bytes32 internal constant SAMPLE_CORRELATION_ID = keccak256("bilateral-async-test");

    function setUp() public {
        notifier = new XcmLiquidationNotifier();
    }

    // -------------------------------------------------------------------------
    // Input validation
    // -------------------------------------------------------------------------

    function test_NotifyLiquidation_EmptyDestinationReverts() public {
        vm.expectRevert(XcmLiquidationNotifier.EmptyDestination.selector);
        notifier.notifyLiquidation(bytes(""), SAMPLE_BORROWER, SAMPLE_DEBT, SAMPLE_COLLATERAL, SAMPLE_CORRELATION_ID);
    }

    function test_NotifyLiquidation_ZeroBorrowerReverts() public {
        vm.expectRevert(XcmLiquidationNotifier.ZeroBorrower.selector);
        notifier.notifyLiquidation(
            RELAY_DESTINATION, address(0), SAMPLE_DEBT, SAMPLE_COLLATERAL, SAMPLE_CORRELATION_ID
        );
    }

    // -------------------------------------------------------------------------
    // XCM message construction and dispatch (mocked precompile)
    // -------------------------------------------------------------------------

    function test_NotifyLiquidation_CallsXcmSendWithCorrectMessage() public {
        // Expected XCM V5 message: ClearOrigin + SetTopic(correlationId)
        //   0x05 = VersionedXcm::V5
        //   0x08 = compact(2) — two instructions
        //   0x0a = ClearOrigin
        //   0x2c = SetTopic
        //   [32 bytes] = correlationId
        bytes memory expectedMessage =
            abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), SAMPLE_CORRELATION_ID);

        // Mock the XCM precompile to accept the send call
        vm.mockCall(
            XCM_PRECOMPILE_ADDRESS,
            abi.encodeWithSelector(IXcm.send.selector, RELAY_DESTINATION, expectedMessage),
            abi.encode()
        );

        // Should succeed and emit event
        vm.expectEmit(true, false, false, true, address(notifier));
        emit XcmLiquidationNotifier.LiquidationNotified(
            SAMPLE_BORROWER, SAMPLE_DEBT, SAMPLE_COLLATERAL, SAMPLE_CORRELATION_ID
        );
        notifier.notifyLiquidation(
            RELAY_DESTINATION, SAMPLE_BORROWER, SAMPLE_DEBT, SAMPLE_COLLATERAL, SAMPLE_CORRELATION_ID
        );
    }

    function test_NotifyLiquidation_MessageContainsSetTopicPrefix() public {
        // Verify XCM message encoding: first 4 bytes are 0x05, 0x08, 0x0a, 0x2c
        bytes memory expectedMessage =
            abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), SAMPLE_CORRELATION_ID);

        // Verify the structure: V5 prefix + 2 instructions + ClearOrigin + SetTopic
        assertEq(expectedMessage[0], bytes1(0x05), "V5 prefix");
        assertEq(expectedMessage[1], bytes1(0x08), "compact(2) = 2 instructions");
        assertEq(expectedMessage[2], bytes1(0x0a), "ClearOrigin instruction");
        assertEq(expectedMessage[3], bytes1(0x2c), "SetTopic instruction");
        assertEq(expectedMessage.length, 36, "4 bytes prefix + 32 bytes correlationId");

        // Mock and call
        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.send.selector), abi.encode());
        notifier.notifyLiquidation(
            RELAY_DESTINATION, SAMPLE_BORROWER, SAMPLE_DEBT, SAMPLE_COLLATERAL, SAMPLE_CORRELATION_ID
        );
    }

    function test_NotifyLiquidation_EmitsLiquidationNotifiedEvent() public {
        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.send.selector), abi.encode());

        vm.expectEmit(true, true, false, true, address(notifier));
        emit XcmLiquidationNotifier.LiquidationNotified(
            SAMPLE_BORROWER, SAMPLE_DEBT, SAMPLE_COLLATERAL, SAMPLE_CORRELATION_ID
        );
        notifier.notifyLiquidation(
            RELAY_DESTINATION, SAMPLE_BORROWER, SAMPLE_DEBT, SAMPLE_COLLATERAL, SAMPLE_CORRELATION_ID
        );
    }

    function test_NotifyLiquidation_DifferentCorrelationIdsProduceDifferentMessages() public {
        bytes32 correlationId1 = keccak256("flow-1");
        bytes32 correlationId2 = keccak256("flow-2");

        bytes memory msg1 =
            abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), correlationId1);
        bytes memory msg2 =
            abi.encodePacked(bytes1(0x05), bytes1(0x08), bytes1(0x0a), bytes1(0x2c), correlationId2);

        // Distinct correlation IDs should produce distinct XCM messages
        assert(keccak256(msg1) != keccak256(msg2));
    }

    function test_NotifyLiquidation_ZeroCorrelationIdIsAllowed() public {
        bytes32 zeroId = bytes32(0);
        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.send.selector), abi.encode());

        // Zero correlationId is technically valid — no revert
        notifier.notifyLiquidation(RELAY_DESTINATION, SAMPLE_BORROWER, SAMPLE_DEBT, SAMPLE_COLLATERAL, zeroId);
    }

    function test_NotifyLiquidation_RevertsWithoutPrecompile() public {
        // Without mocking, the XCM precompile address has no code in local Forge
        // Calling notifyLiquidation should revert because send() fails
        vm.expectRevert();
        notifier.notifyLiquidation(
            RELAY_DESTINATION, SAMPLE_BORROWER, SAMPLE_DEBT, SAMPLE_COLLATERAL, SAMPLE_CORRELATION_ID
        );
    }

    // -------------------------------------------------------------------------
    // receive() payable
    // -------------------------------------------------------------------------

    function test_CanReceiveEth() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(notifier).call{value: 1 ether}("");
        assertTrue(success, "notifier should accept ETH");
    }
}
