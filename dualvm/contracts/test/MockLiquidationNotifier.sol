// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ILiquidationNotifier} from "../interfaces/ILiquidationNotifier.sol";

/// @title MockLiquidationNotifier
/// @notice Test helper that implements ILiquidationNotifier.
/// Can be configured to revert in order to exercise the try/catch path in LendingCoreV2.
contract MockLiquidationNotifier is ILiquidationNotifier {
    /// @notice When true, notifyLiquidation reverts — used to test the silent-failure path.
    bool public immutable shouldRevert;

    address public lastBorrower;
    uint256 public lastDebtRepaid;
    uint256 public lastCollateralSeized;
    uint256 public callCount;

    event NotificationReceived(address indexed borrower, uint256 debtRepaid, uint256 collateralSeized);

    constructor(bool shouldRevert_) {
        shouldRevert = shouldRevert_;
    }

    function notifyLiquidation(address borrower, uint256 debtRepaid, uint256 collateralSeized) external override {
        if (shouldRevert) revert("MockLiquidationNotifier: forced revert");
        lastBorrower = borrower;
        lastDebtRepaid = debtRepaid;
        lastCollateralSeized = collateralSeized;
        callCount++;
        emit NotificationReceived(borrower, debtRepaid, collateralSeized);
    }
}
