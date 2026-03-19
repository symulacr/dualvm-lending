// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMigratableLendingCore {
    struct MigratedPosition {
        uint256 collateralAmount;
        uint256 principalDebt;
        uint256 accruedInterest;
    }

    function freezeNewDebt() external;

    function newDebtFrozen() external view returns (bool);

    function exportPositionForMigration(address borrower) external returns (MigratedPosition memory);

    function importMigratedPosition(address borrower, MigratedPosition calldata position) external;

    function currentDebt(address borrower) external view returns (uint256);
}
