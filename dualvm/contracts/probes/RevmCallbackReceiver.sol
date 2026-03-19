// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRevmCallbackReceiver} from "./interfaces/IRevmCallbackReceiver.sol";

contract RevmCallbackReceiver is IRevmCallbackReceiver {
    mapping(bytes32 => bool) public seenCallIds;
    bytes32 public lastCallId;
    bytes32 public lastResultHash;
    uint256 public lastA;
    uint256 public lastB;

    error DuplicateCallId(bytes32 callId);

    event CallbackReceived(
        address indexed caller, bytes32 indexed callId, bytes32 indexed resultHash, uint256 a, uint256 b
    );

    function receivePvmResult(bytes32 callId, bytes32 resultHash, uint256 a, uint256 b) external {
        if (seenCallIds[callId]) revert DuplicateCallId(callId);

        seenCallIds[callId] = true;
        lastCallId = callId;
        lastResultHash = resultHash;
        lastA = a;
        lastB = b;

        emit CallbackReceived(msg.sender, callId, resultHash, a, b);
    }
}
