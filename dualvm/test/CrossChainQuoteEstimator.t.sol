// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {CrossChainQuoteEstimator} from "../contracts/precompiles/CrossChainQuoteEstimator.sol";
import {IXcm, XCM_PRECOMPILE_ADDRESS} from "../contracts/precompiles/IXcm.sol";

/// @notice Unit tests for CrossChainQuoteEstimator XCM precompile interaction.
///
/// The XCM precompile (0xA0000) is only available on Polkadot Hub. These tests
/// use vm.mockCall to simulate precompile responses for local validation.
contract CrossChainQuoteEstimatorTest is Test {
    CrossChainQuoteEstimator internal estimator;

    /// @dev SCALE-encoded destination: V5 relay chain parent
    bytes internal constant SAMPLE_DESTINATION = hex"050100";
    /// @dev A minimal valid SCALE-encoded XCM V5 message
    bytes internal constant SAMPLE_XCM_MESSAGE =
        hex"05080a2c000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

    function setUp() public {
        estimator = new CrossChainQuoteEstimator();
    }

    // -------------------------------------------------------------------------
    // Deployment
    // -------------------------------------------------------------------------

    function test_Deploys_WithCode() public view {
        assertGt(address(estimator).code.length, 0, "estimator should have code");
    }

    function test_XcmPrecompileAddress() public view {
        assertEq(address(estimator.XCM()), XCM_PRECOMPILE_ADDRESS, "XCM address should be canonical");
    }

    // -------------------------------------------------------------------------
    // Input validation
    // -------------------------------------------------------------------------

    function test_EstimateCrossChainQuoteCost_EmptyMessageReverts() public {
        vm.expectRevert(CrossChainQuoteEstimator.EmptyXcmMessage.selector);
        estimator.estimateCrossChainQuoteCost(bytes(""));
    }

    function test_ExecuteLocalXcm_EmptyMessageReverts() public {
        vm.expectRevert(CrossChainQuoteEstimator.EmptyXcmMessage.selector);
        estimator.executeLocalXcm(bytes(""), 1_000_000, 65_536);
    }

    function test_SendCrossChainNotification_EmptyDestinationReverts() public {
        vm.expectRevert(CrossChainQuoteEstimator.EmptyDestination.selector);
        estimator.sendCrossChainNotification(bytes(""), SAMPLE_XCM_MESSAGE);
    }

    function test_SendCrossChainNotification_EmptyMessageReverts() public {
        vm.expectRevert(CrossChainQuoteEstimator.EmptyXcmMessage.selector);
        estimator.sendCrossChainNotification(SAMPLE_DESTINATION, bytes(""));
    }

    // -------------------------------------------------------------------------
    // weighMessage (mocked precompile)
    // -------------------------------------------------------------------------

    function test_EstimateCrossChainQuoteCost_ReturnsMockedWeight() public {
        uint64 expectedRefTime = 500_000_000;
        uint64 expectedProofSize = 65_536;
        IXcm.Weight memory mockWeight = IXcm.Weight(expectedRefTime, expectedProofSize);

        vm.mockCall(
            XCM_PRECOMPILE_ADDRESS,
            abi.encodeWithSelector(IXcm.weighMessage.selector, SAMPLE_XCM_MESSAGE),
            abi.encode(mockWeight)
        );

        (uint64 refTime, uint64 proofSize) = estimator.estimateCrossChainQuoteCost(SAMPLE_XCM_MESSAGE);
        assertEq(refTime, expectedRefTime);
        assertEq(proofSize, expectedProofSize);
    }

    function test_EstimateCrossChainQuoteCost_ReturnsCorrectWeight() public {
        uint64 mockRefTime = 250_000_000;
        uint64 mockProofSize = 32_768;
        IXcm.Weight memory mockWeight = IXcm.Weight(mockRefTime, mockProofSize);

        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.weighMessage.selector), abi.encode(mockWeight));

        (uint64 refTime, uint64 proofSize) = estimator.estimateCrossChainQuoteCost(SAMPLE_XCM_MESSAGE);
        assertEq(refTime, mockRefTime);
        assertEq(proofSize, mockProofSize);
    }

    // -------------------------------------------------------------------------
    // executeLocalXcm (mocked precompile)
    // -------------------------------------------------------------------------

    function test_ExecuteLocalXcm_EmitsXcmExecutedEvent() public {
        uint64 refTime = 1_000_000;
        uint64 proofSize = 65_536;

        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.execute.selector), abi.encode());

        vm.expectEmit(true, false, false, true, address(estimator));
        emit CrossChainQuoteEstimator.XcmExecuted(address(this), refTime, proofSize);
        estimator.executeLocalXcm(SAMPLE_XCM_MESSAGE, refTime, proofSize);
    }

    // -------------------------------------------------------------------------
    // sendCrossChainNotification (mocked precompile)
    // -------------------------------------------------------------------------

    function test_SendCrossChainNotification_EmitsXcmSentEvent() public {
        vm.mockCall(XCM_PRECOMPILE_ADDRESS, abi.encodeWithSelector(IXcm.send.selector), abi.encode());

        vm.expectEmit(true, false, false, false, address(estimator));
        emit CrossChainQuoteEstimator.XcmSent(address(this), SAMPLE_DESTINATION);
        estimator.sendCrossChainNotification(SAMPLE_DESTINATION, SAMPLE_XCM_MESSAGE);
    }

    // -------------------------------------------------------------------------
    // Without precompile (reverts on local Forge)
    // -------------------------------------------------------------------------

    function test_EstimateCrossChainQuoteCost_RevertsWithoutPrecompile() public {
        vm.expectRevert();
        estimator.estimateCrossChainQuoteCost(SAMPLE_XCM_MESSAGE);
    }

    function test_ExecuteLocalXcm_RevertsWithoutPrecompile() public {
        vm.expectRevert();
        estimator.executeLocalXcm(SAMPLE_XCM_MESSAGE, 1_000_000, 65_536);
    }

    function test_SendCrossChainNotification_RevertsWithoutPrecompile() public {
        vm.expectRevert();
        estimator.sendCrossChainNotification(SAMPLE_DESTINATION, SAMPLE_XCM_MESSAGE);
    }

    // -------------------------------------------------------------------------
    // receive() payable
    // -------------------------------------------------------------------------

    function test_CanReceiveEth() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(estimator).call{value: 1 ether}("");
        assertTrue(success, "estimator should accept ETH");
    }
}
