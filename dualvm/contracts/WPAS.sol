// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract WPAS is ERC20, ReentrancyGuard {
    error ZeroAmount();
    error TransferFailed();

    event Wrapped(address indexed account, uint256 amount);
    event Unwrapped(address indexed account, uint256 amount);

    constructor() ERC20("Wrapped PAS", "WPAS") {}

    receive() external payable {
        depositTo(msg.sender);
    }

    function deposit() external payable {
        depositTo(msg.sender);
    }

    function depositTo(address beneficiary) public payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        _mint(beneficiary, msg.value);
        emit Wrapped(beneficiary, msg.value);
    }

    function withdraw(uint256 amount) external {
        withdrawTo(msg.sender, amount);
    }

    function withdrawTo(address recipient, uint256 amount) public nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, amount);
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Unwrapped(recipient, amount);
    }
}
