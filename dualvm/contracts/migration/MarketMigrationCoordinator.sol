// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMarketVersionRegistry} from "../interfaces/IMarketVersionRegistry.sol";
import {IMigratableLendingCore} from "../interfaces/IMigratableLendingCore.sol";

interface IERC4626MigrationPool is IERC20 {
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    function asset() external view returns (address);
}

contract MarketMigrationCoordinator is AccessManaged {
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC4626MigrationPool;

    struct MigrationRoute {
        bool borrowerEnabled;
        bool liquidityEnabled;
    }

    IMarketVersionRegistry public immutable marketRegistry;

    mapping(uint256 fromVersionId => mapping(uint256 toVersionId => MigrationRoute)) public migrationRoutes;

    error InvalidMigrationRoute();
    error MigrationRouteClosed(uint256 fromVersionId, uint256 toVersionId);
    error UnsupportedAssetPair();

    event MigrationRouteOpened(uint256 indexed fromVersionId, uint256 indexed toVersionId, bool borrowerEnabled, bool liquidityEnabled);
    event MigrationRouteClosedEvent(uint256 indexed fromVersionId, uint256 indexed toVersionId);
    event BorrowerMigrated(uint256 indexed fromVersionId, uint256 indexed toVersionId, address indexed borrower);
    event LiquidityMigrated(uint256 indexed fromVersionId, uint256 indexed toVersionId, address indexed account, uint256 shares);

    constructor(address authority, IMarketVersionRegistry marketRegistry_) AccessManaged(authority) {
        marketRegistry = marketRegistry_;
    }

    function openMigrationRoute(uint256 fromVersionId, uint256 toVersionId, bool borrowerEnabled, bool liquidityEnabled)
        external
        restricted
    {
        if (fromVersionId == 0 || toVersionId == 0 || fromVersionId == toVersionId) revert InvalidMigrationRoute();
        migrationRoutes[fromVersionId][toVersionId] = MigrationRoute({
            borrowerEnabled: borrowerEnabled,
            liquidityEnabled: liquidityEnabled
        });
        emit MigrationRouteOpened(fromVersionId, toVersionId, borrowerEnabled, liquidityEnabled);
    }

    function closeMigrationRoute(uint256 fromVersionId, uint256 toVersionId) external restricted {
        delete migrationRoutes[fromVersionId][toVersionId];
        emit MigrationRouteClosedEvent(fromVersionId, toVersionId);
    }

    function migrateBorrower(uint256 fromVersionId, uint256 toVersionId) external {
        MigrationRoute memory route = migrationRoutes[fromVersionId][toVersionId];
        if (!route.borrowerEnabled) revert MigrationRouteClosed(fromVersionId, toVersionId);
        if (marketRegistry.activeVersionId() != toVersionId) revert InvalidMigrationRoute();

        IMarketVersionRegistry.MarketVersion memory fromVersion = marketRegistry.getVersion(fromVersionId);
        IMarketVersionRegistry.MarketVersion memory toVersion = marketRegistry.getVersion(toVersionId);
        _validateAssetPair(fromVersion, toVersion);

        IMigratableLendingCore oldCore = IMigratableLendingCore(fromVersion.lendingCore);
        IMigratableLendingCore newCore = IMigratableLendingCore(toVersion.lendingCore);

        IMigratableLendingCore.MigratedPosition memory position = oldCore.exportPositionForMigration(msg.sender);
        if (position.collateralAmount > 0) {
            IERC20(fromVersion.collateralAsset).forceApprove(toVersion.lendingCore, position.collateralAmount);
        }
        newCore.importMigratedPosition(msg.sender, position);

        emit BorrowerMigrated(fromVersionId, toVersionId, msg.sender);
    }

    function migrateLiquidity(uint256 fromVersionId, uint256 toVersionId, uint256 shares) external {
        MigrationRoute memory route = migrationRoutes[fromVersionId][toVersionId];
        if (!route.liquidityEnabled) revert MigrationRouteClosed(fromVersionId, toVersionId);
        if (marketRegistry.activeVersionId() != toVersionId) revert InvalidMigrationRoute();

        IMarketVersionRegistry.MarketVersion memory fromVersion = marketRegistry.getVersion(fromVersionId);
        IMarketVersionRegistry.MarketVersion memory toVersion = marketRegistry.getVersion(toVersionId);
        _validateAssetPair(fromVersion, toVersion);

        IERC4626MigrationPool oldPool = IERC4626MigrationPool(fromVersion.debtPool);
        IERC4626MigrationPool newPool = IERC4626MigrationPool(toVersion.debtPool);

        oldPool.safeTransferFrom(msg.sender, address(this), shares);
        uint256 assets = oldPool.redeem(shares, address(this), address(this));
        IERC20(fromVersion.debtAsset).forceApprove(toVersion.debtPool, assets);
        newPool.deposit(assets, msg.sender);

        emit LiquidityMigrated(fromVersionId, toVersionId, msg.sender, shares);
    }

    function _validateAssetPair(IMarketVersionRegistry.MarketVersion memory fromVersion, IMarketVersionRegistry.MarketVersion memory toVersion)
        private
        pure
    {
        if (fromVersion.collateralAsset != toVersion.collateralAsset || fromVersion.debtAsset != toVersion.debtAsset) {
            revert UnsupportedAssetPair();
        }
    }
}
