// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "../../interfaces/IRiskEngine.sol";

interface IVmQuoteAdapterProbe {
    enum TransportMode {
        Unknown,
        DirectSync,
        AsyncOnchain,
        OffchainRelay
    }

    function transportMode() external view returns (TransportMode);

    function pvmTargetId() external view returns (bytes32);

    function quoteViaPvm(IRiskEngine.QuoteInput calldata input) external returns (IRiskEngine.QuoteOutput memory);
}
