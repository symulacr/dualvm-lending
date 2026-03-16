// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "../../interfaces/IRiskEngine.sol";
import {IRevmCallbackReceiver} from "../interfaces/IRevmCallbackReceiver.sol";
import {DualVmProbeLib} from "../DualVmProbeLib.sol";

contract PvmCallbackProbe {
    error InvalidReceiver();

    function callbackFingerprint(address receiver, bytes32 callId) external {
        if (receiver == address(0)) revert InvalidReceiver();

        IRevmCallbackReceiver(receiver).receivePvmResult(
            callId,
            DualVmProbeLib.callbackFingerprint(receiver, callId),
            1,
            2
        );
    }

    function callbackQuote(address receiver, bytes32 callId, IRiskEngine.QuoteInput calldata input) external {
        if (receiver == address(0)) revert InvalidReceiver();

        IRiskEngine.QuoteOutput memory output = DualVmProbeLib.quote(input);
        IRevmCallbackReceiver(receiver).receivePvmResult(
            callId,
            DualVmProbeLib.hashQuoteOutput(output),
            output.borrowRateBps,
            output.maxLtvBps
        );
    }
}
