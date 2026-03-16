// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRevmCallbackReceiver {
    function receivePvmResult(bytes32 callId, bytes32 resultHash, uint256 a, uint256 b) external;
}
