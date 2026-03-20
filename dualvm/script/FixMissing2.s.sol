// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {GovernancePolicyStore} from "../contracts/GovernancePolicyStore.sol";

contract FixMissing2 is Script {
    function run() external {
        vm.startBroadcast();
        GovernancePolicyStore ps = new GovernancePolicyStore(0xeA22C5713c8f6dcaBC9c8156ccD06fEAA9DEEaA8);
        console.log("GovernancePolicyStore:", address(ps));
        vm.stopBroadcast();
    }
}
