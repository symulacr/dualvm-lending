// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDCMock is ERC20, AccessManaged {
    constructor(address authority) ERC20("USDC-test", "USDCt") AccessManaged(authority) {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external restricted {
        _mint(to, amount);
    }
}
