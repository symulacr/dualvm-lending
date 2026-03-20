// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// Minimal test contract
contract TestMinimal {
    address public owner;
    constructor() {
        owner = msg.sender;
    }
}

contract TestDeploy is Script {
    function run() external {
        vm.startBroadcast();
        TestMinimal t = new TestMinimal();
        console.log("TestMinimal:", address(t));
        vm.stopBroadcast();
    }
}
