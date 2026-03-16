// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMarketVersionRegistry {
    struct MarketVersion {
        address lendingCore;
        address debtPool;
        address oracle;
        address riskEngine;
        address quoteEngine;
        address collateralAsset;
        address debtAsset;
        bytes32 configHash;
        uint256 registeredAt;
    }

    event MarketVersionRegistered(
        uint256 indexed versionId,
        bytes32 indexed configHash,
        address indexed lendingCore,
        address debtPool,
        address oracle,
        address riskEngine,
        address quoteEngine
    );

    event MarketVersionActivated(uint256 indexed previousVersionId, uint256 indexed versionId);

    function latestVersionId() external view returns (uint256);

    function activeVersionId() external view returns (uint256);

    function registerVersion(address lendingCore, address debtPool, address oracle, address riskEngine)
        external
        returns (uint256 versionId);

    function activateVersion(uint256 versionId) external;

    function getVersion(uint256 versionId) external view returns (MarketVersion memory);

    function activeVersion() external view returns (MarketVersion memory);
}
