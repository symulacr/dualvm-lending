// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "../../interfaces/IRiskEngine.sol";
import {DualVmProbeLib} from "../DualVmProbeLib.sol";

contract PvmQuoteProbe {
    function fingerprint() external pure returns (bytes32) {
        return DualVmProbeLib.fingerprint();
    }

    function echo(bytes32 x) external pure returns (bytes32) {
        return x;
    }

    function quote(IRiskEngine.QuoteInput calldata input) external pure returns (IRiskEngine.QuoteOutput memory) {
        return DualVmProbeLib.quote(input);
    }
}
