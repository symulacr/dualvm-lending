// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ILendingCoreBorrow {
    function borrow(uint256 amount) external;
}

/**
 * @title ReentrantCollateral
 * @notice A malicious ERC20 (acting as collateral) that re-enters LendingCore.borrow()
 * during transferFrom(), used to prove that ReentrancyGuard on LendingCore prevents
 * reentrancy attacks on the deposit→borrow path.
 */
contract ReentrantCollateral is ERC20 {
    address public attackTarget;
    uint256 public attackBorrowAmount;
    bool public armed;
    bool private _reentering;

    constructor() ERC20("Reentrant Collateral", "RCOL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm the attack: next transferFrom into `target_` will re-enter borrow()
    function armAttack(address target_, uint256 borrowAmount_) external {
        attackTarget = target_;
        attackBorrowAmount = borrowAmount_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        // When tokens flow INTO the LendingCore during depositCollateral(),
        // attempt to re-enter borrow(). ReentrancyGuard should block this.
        if (armed && !_reentering && to == attackTarget && from != address(0)) {
            _reentering = true;
            armed = false;
            // Attempt reentrant borrow — should revert with ReentrancyGuardReentrantCall
            ILendingCoreBorrow(attackTarget).borrow(attackBorrowAmount);
            // If we reach here, reentrancy guard is broken
            _reentering = false;
        }
    }
}
