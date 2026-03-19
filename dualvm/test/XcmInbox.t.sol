// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {DualVMAccessManager} from "../contracts/DualVMAccessManager.sol";
import {XcmInbox} from "../contracts/XcmInbox.sol";

/// @notice Unit tests for XcmInbox correlation ID tracking and deduplication.
contract XcmInboxTest is Test {
    DualVMAccessManager internal accessManager;
    XcmInbox internal inbox;

    address internal admin;
    address internal sender;
    address internal other;
    address internal unauthorized;

    uint64 internal constant RELAY_CALLER_ROLE = 99;

    bytes32 internal constant ID_A = keccak256("liquidation-abc-123");
    bytes32 internal constant ID_B = keccak256("liquidation-def-456");
    bytes internal constant SAMPLE_DATA = bytes("proof-payload-v1");

    function setUp() public {
        admin = address(this);
        sender = makeAddr("sender");
        other = makeAddr("other");
        unauthorized = makeAddr("unauthorized");

        accessManager = new DualVMAccessManager(admin);
        inbox = new XcmInbox(address(accessManager));

        // Grant RELAY_CALLER_ROLE to sender and other, but NOT unauthorized
        accessManager.labelRole(RELAY_CALLER_ROLE, "RELAY_CALLER");
        accessManager.grantRole(RELAY_CALLER_ROLE, sender, 0);
        accessManager.grantRole(RELAY_CALLER_ROLE, other, 0);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = inbox.receiveReceipt.selector;
        accessManager.setTargetFunctionRole(address(inbox), selectors, RELAY_CALLER_ROLE);
    }

    // -------------------------------------------------------------------------
    // receiveReceipt — happy path
    // -------------------------------------------------------------------------

    function test_ReceiveReceipt_RecordsCorrelationId() public {
        vm.prank(sender);
        vm.expectEmit(true, true, false, true, address(inbox));
        emit XcmInbox.ReceiptReceived(ID_A, sender, SAMPLE_DATA);
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);

        assertTrue(inbox.processed(ID_A), "ID_A should be processed");
    }

    function test_ReceiveReceipt_SetsProcessedTrue() public {
        assertFalse(inbox.processed(ID_A), "ID_A should not be processed initially");
        vm.prank(sender);
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);
        assertTrue(inbox.processed(ID_A), "ID_A should be processed after receipt");
    }

    function test_ReceiveReceipt_AcceptsEmptyData() public {
        vm.prank(sender);
        vm.expectEmit(true, true, false, true, address(inbox));
        emit XcmInbox.ReceiptReceived(ID_A, sender, bytes(""));
        inbox.receiveReceipt(ID_A, bytes(""));
        assertTrue(inbox.processed(ID_A));
    }

    function test_ReceiveReceipt_TracksMultipleDistinctIds() public {
        vm.prank(sender);
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);
        vm.prank(sender);
        inbox.receiveReceipt(ID_B, SAMPLE_DATA);

        assertTrue(inbox.processed(ID_A));
        assertTrue(inbox.processed(ID_B));
    }

    function test_ReceiveReceipt_ZeroBytes32IsValid() public {
        bytes32 zeroId = bytes32(0);
        assertFalse(inbox.processed(zeroId));
        vm.prank(sender);
        inbox.receiveReceipt(zeroId, SAMPLE_DATA);
        assertTrue(inbox.processed(zeroId));
    }

    function test_ReceiveReceipt_HasProcessedMatchesProcessed() public {
        assertFalse(inbox.hasProcessed(ID_A));
        vm.prank(sender);
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);
        assertTrue(inbox.hasProcessed(ID_A));
    }

    // -------------------------------------------------------------------------
    // Duplicate rejection
    // -------------------------------------------------------------------------

    function test_ReceiveReceipt_DuplicateReverts() public {
        vm.prank(sender);
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);

        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(XcmInbox.DuplicateCorrelationId.selector, ID_A));
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);
    }

    function test_ReceiveReceipt_DuplicateFromDifferentSenderReverts() public {
        vm.prank(sender);
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);

        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(XcmInbox.DuplicateCorrelationId.selector, ID_A));
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);
    }

    // -------------------------------------------------------------------------
    // Access control
    // -------------------------------------------------------------------------

    function test_ReceiveReceipt_UnauthorizedReverts() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);
    }

    function test_ReceiveReceipt_AuthorizedCallerSucceeds() public {
        // Both sender and other have the role
        vm.prank(sender);
        inbox.receiveReceipt(ID_A, SAMPLE_DATA);

        vm.prank(other);
        inbox.receiveReceipt(ID_B, SAMPLE_DATA);

        assertTrue(inbox.processed(ID_A));
        assertTrue(inbox.processed(ID_B));
    }
}
