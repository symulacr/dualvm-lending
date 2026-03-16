// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IDebtPoolDeposit {
    function deposit(uint256 assets, address receiver) external returns (uint256);
}

/**
 * @title MaliciousERC20
 * @notice An ERC20 that re-enters DebtPool.deposit() during transferFrom(),
 * used to prove that ReentrancyGuard on DebtPool prevents reentrancy attacks.
 */
contract MaliciousERC20 is ERC20 {
    address public attackTarget;
    bool public attackOnTransfer;
    uint256 public attackAmount;
    bool private _reentering;

    constructor() ERC20("Malicious Token", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm the attack: next transferFrom into `target_` will re-enter deposit()
    function armAttack(address target_, uint256 amount_) external {
        attackTarget = target_;
        attackAmount = amount_;
        attackOnTransfer = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        // When tokens flow INTO the DebtPool during a deposit() call,
        // attempt to re-enter deposit(). ReentrancyGuard should block this.
        if (attackOnTransfer && !_reentering && to == attackTarget && from != address(0)) {
            _reentering = true;
            attackOnTransfer = false;
            // Attempt reentrant deposit — should revert with ReentrancyGuardReentrantCall
            IDebtPoolDeposit(attackTarget).deposit(attackAmount, from);
            // If we reach here, reentrancy guard is broken
            _reentering = false;
        }
    }
}
