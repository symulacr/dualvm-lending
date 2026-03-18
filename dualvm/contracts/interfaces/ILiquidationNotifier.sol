// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ILiquidationNotifier
/// @notice Interface for post-liquidation hooks.  Any contract that implements this
/// interface can be registered as the `liquidationNotifier` on LendingCoreV2.
/// The call is wrapped in try/catch so a reverting notifier never blocks a liquidation.
interface ILiquidationNotifier {
    /// @notice Called after a successful liquidation.
    /// @param borrower The liquidated borrower's address.
    /// @param debtRepaid The amount of debt repaid by the liquidator.
    /// @param collateralSeized The amount of collateral transferred to the liquidator.
    function notifyLiquidation(address borrower, uint256 debtRepaid, uint256 collateralSeized) external;
}
