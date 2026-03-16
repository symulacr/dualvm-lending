// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {IMarketVersionRegistry} from "./interfaces/IMarketVersionRegistry.sol";
import {IRiskAdapter} from "./interfaces/IRiskAdapter.sol";

interface IMarketKernelMetadata {
    function debtPool() external view returns (address);
    function oracle() external view returns (address);
    function riskEngine() external view returns (address);
    function collateralAsset() external view returns (address);
    function debtAsset() external view returns (address);
    function currentRiskConfigHash() external view returns (bytes32);
}

interface IDebtPoolMetadata {
    function lendingCore() external view returns (address);

    function asset() external view returns (address);
}

contract MarketVersionRegistry is AccessManaged, IMarketVersionRegistry {
    uint256 public latestVersionId;
    uint256 public activeVersionId;

    mapping(uint256 versionId => MarketVersion version) private versions;

    error InvalidVersionConfiguration();
    error UnknownVersion(uint256 versionId);
    error VersionAlreadyActive(uint256 versionId);

    constructor(address authority) AccessManaged(authority) {}

    function registerVersion(address lendingCore, address debtPool, address oracle, address riskEngine)
        external
        restricted
        returns (uint256 versionId)
    {
        if (lendingCore == address(0) || debtPool == address(0) || oracle == address(0) || riskEngine == address(0)) {
            revert InvalidVersionConfiguration();
        }

        IMarketKernelMetadata kernel = IMarketKernelMetadata(lendingCore);
        if (kernel.debtPool() != debtPool || kernel.oracle() != oracle || kernel.riskEngine() != riskEngine) {
            revert InvalidVersionConfiguration();
        }

        IDebtPoolMetadata pool = IDebtPoolMetadata(debtPool);
        if (pool.lendingCore() != lendingCore || pool.asset() != kernel.debtAsset()) {
            revert InvalidVersionConfiguration();
        }

        address quoteEngine = address(IRiskAdapter(riskEngine).quoteEngine());
        if (quoteEngine == address(0) || kernel.collateralAsset() == address(0) || kernel.debtAsset() == address(0)) {
            revert InvalidVersionConfiguration();
        }

        versionId = latestVersionId + 1;
        latestVersionId = versionId;
        bytes32 configHash = kernel.currentRiskConfigHash();
        versions[versionId] = MarketVersion({
            lendingCore: lendingCore,
            debtPool: debtPool,
            oracle: oracle,
            riskEngine: riskEngine,
            quoteEngine: quoteEngine,
            collateralAsset: kernel.collateralAsset(),
            debtAsset: kernel.debtAsset(),
            configHash: configHash,
            registeredAt: block.timestamp
        });

        emit MarketVersionRegistered(versionId, configHash, lendingCore, debtPool, oracle, riskEngine, quoteEngine);
    }

    function activateVersion(uint256 versionId) external restricted {
        if (versions[versionId].lendingCore == address(0)) revert UnknownVersion(versionId);
        if (activeVersionId == versionId) revert VersionAlreadyActive(versionId);

        uint256 previousVersionId = activeVersionId;
        activeVersionId = versionId;
        emit MarketVersionActivated(previousVersionId, versionId);
    }

    function getVersion(uint256 versionId) external view returns (MarketVersion memory) {
        MarketVersion memory version = versions[versionId];
        if (version.lendingCore == address(0)) revert UnknownVersion(versionId);
        return version;
    }

    function activeVersion() external view returns (MarketVersion memory) {
        uint256 versionId = activeVersionId;
        if (versionId == 0) revert UnknownVersion(versionId);
        return versions[versionId];
    }
}
