// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "../interfaces/IRiskEngine.sol";
import {DualVmProbeLib} from "./DualVmProbeLib.sol";
import {IVmQuoteAdapterProbe} from "./interfaces/IVmQuoteAdapterProbe.sol";

interface IPvmQuoteProbe {
    function echo(bytes32 x) external returns (bytes32);

    function quote(IRiskEngine.QuoteInput calldata input) external returns (IRiskEngine.QuoteOutput memory);
}

contract RevmQuoteCallerProbe is IVmQuoteAdapterProbe {
    address public immutable pvmTarget;

    uint256 public callCount;
    bytes32 public lastEchoInput;
    bytes32 public lastEchoOutput;
    bytes32 public lastInputHash;
    bytes32 public lastResultHash;
    uint256 public lastBorrowRateBps;
    uint256 public lastMaxLtvBps;
    uint256 public lastLiquidationThresholdBps;

    TransportMode private immutable _transportMode;
    bytes32 private immutable _pvmTargetId;

    error InvalidProbeTarget();

    event ProbeEchoed(
        bytes32 indexed inputValue,
        bytes32 indexed outputValue,
        bytes32 indexed pvmTargetId,
        TransportMode transportMode
    );

    event ProbeQuoted(
        bytes32 indexed inputHash,
        bytes32 indexed resultHash,
        bytes32 indexed pvmTargetId,
        uint256 borrowRateBps,
        uint256 maxLtvBps,
        uint256 liquidationThresholdBps,
        uint256 callCount,
        TransportMode transportMode
    );

    constructor(address pvmTarget_, bytes32 pvmTargetId_, TransportMode transportMode_) {
        if (pvmTarget_ == address(0) || transportMode_ == TransportMode.Unknown) revert InvalidProbeTarget();

        pvmTarget = pvmTarget_;
        _pvmTargetId = pvmTargetId_;
        _transportMode = transportMode_;
    }

    function transportMode() external view returns (TransportMode) {
        return _transportMode;
    }

    function pvmTargetId() external view returns (bytes32) {
        return _pvmTargetId;
    }

    function quoteViaPvm(IRiskEngine.QuoteInput calldata input) public returns (IRiskEngine.QuoteOutput memory) {
        return IPvmQuoteProbe(pvmTarget).quote(input);
    }

    function runEcho(bytes32 x) external returns (bytes32 output) {
        output = IPvmQuoteProbe(pvmTarget).echo(x);
        lastEchoInput = x;
        lastEchoOutput = output;

        emit ProbeEchoed(x, output, _pvmTargetId, _transportMode);
    }

    function runQuote(IRiskEngine.QuoteInput calldata input) external returns (bytes32 resultHash) {
        IRiskEngine.QuoteOutput memory output = quoteViaPvm(input);

        callCount += 1;
        lastInputHash = DualVmProbeLib.hashQuoteInput(input);
        resultHash = DualVmProbeLib.hashQuoteOutput(output);
        lastResultHash = resultHash;
        lastBorrowRateBps = output.borrowRateBps;
        lastMaxLtvBps = output.maxLtvBps;
        lastLiquidationThresholdBps = output.liquidationThresholdBps;

        emit ProbeQuoted(
            lastInputHash,
            resultHash,
            _pvmTargetId,
            output.borrowRateBps,
            output.maxLtvBps,
            output.liquidationThresholdBps,
            callCount,
            _transportMode
        );
    }
}
