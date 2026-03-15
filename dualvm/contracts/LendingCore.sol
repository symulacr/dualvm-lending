// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DebtPool} from "./DebtPool.sol";
import {ManualOracle} from "./ManualOracle.sol";
import {IRiskEngine} from "./interfaces/IRiskEngine.sol";

contract LendingCore is AccessManaged, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant WAD = 1e18;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    struct MarketConfig {
        uint256 borrowCap;
        uint256 minBorrowAmount;
        uint256 reserveFactorBps;
        uint256 maxLtvBps;
        uint256 liquidationThresholdBps;
        uint256 liquidationBonusBps;
    }

    struct Position {
        uint256 collateralAmount;
        uint256 principalDebt;
        uint256 accruedInterest;
        uint256 borrowRateBps;
        uint256 maxLtvBpsSnapshot;
        uint256 liquidationThresholdBpsSnapshot;
        uint256 lastAccruedAt;
        uint256 lastRiskUpdateAt;
    }

    IERC20 public immutable collateralAsset;
    IERC20 public immutable debtAsset;
    DebtPool public debtPool;
    ManualOracle public oracle;
    IRiskEngine public riskEngine;
    address public treasury;

    uint256 public borrowCap;
    uint256 public minBorrowAmount;
    uint256 public reserveFactorBps;
    uint256 public maxConfiguredLtvBps;
    uint256 public maxConfiguredLiquidationThresholdBps;
    uint256 public liquidationBonusBps;

    mapping(address => Position) public positions;

    error InvalidConfiguration();
    error ZeroAmount();
    error NoDebt();
    error InsufficientCollateral();
    error BorrowCapExceeded(uint256 attempted, uint256 cap);
    error DebtBelowMinimum(uint256 debt, uint256 minBorrowAmount);
    error PositionHealthy(uint256 healthFactorWad);
    error InvalidLiquidationAmount();

    event CollateralDeposited(address indexed account, uint256 amount);
    event CollateralWithdrawn(address indexed account, uint256 amount);
    event Borrowed(address indexed account, uint256 amount, uint256 borrowRateBps);
    event Repaid(address indexed account, uint256 amount, uint256 principalPaid, uint256 interestPaid);
    event Liquidated(
        address indexed borrower,
        address indexed liquidator,
        uint256 repaid,
        uint256 collateralSeized,
        uint256 badDebtWrittenOff
    );
    event ParametersUpdated(bytes32 indexed parameter, uint256 value);
    event TreasuryUpdated(address indexed treasury);
    event RiskEngineUpdated(address indexed riskEngine);
    event OracleUpdated(address indexed oracle);
    event BadDebtRealized(address indexed borrower, uint256 amount);

    constructor(
        address authority_,
        IERC20 collateralAsset_,
        IERC20 debtAsset_,
        DebtPool debtPool_,
        ManualOracle oracle_,
        IRiskEngine riskEngine_,
        address treasury_,
        MarketConfig memory config_
    ) AccessManaged(authority_) {
        if (
            authority_ == address(0) || address(collateralAsset_) == address(0) || address(debtAsset_) == address(0)
                || address(debtPool_) == address(0) || address(oracle_) == address(0)
                || address(riskEngine_) == address(0) || treasury_ == address(0)
        ) revert InvalidConfiguration();
        if (debtPool_.asset() != address(debtAsset_)) revert InvalidConfiguration();
        if (
            config_.borrowCap == 0 || config_.minBorrowAmount == 0 || config_.reserveFactorBps > BPS
                || config_.maxLtvBps == 0 || config_.maxLtvBps >= BPS
                || config_.liquidationThresholdBps <= config_.maxLtvBps || config_.liquidationThresholdBps > BPS
                || config_.liquidationBonusBps > BPS
        ) revert InvalidConfiguration();

        collateralAsset = collateralAsset_;
        debtAsset = debtAsset_;
        debtPool = debtPool_;
        oracle = oracle_;
        riskEngine = riskEngine_;
        treasury = treasury_;
        borrowCap = config_.borrowCap;
        minBorrowAmount = config_.minBorrowAmount;
        reserveFactorBps = config_.reserveFactorBps;
        maxConfiguredLtvBps = config_.maxLtvBps;
        maxConfiguredLiquidationThresholdBps = config_.liquidationThresholdBps;
        liquidationBonusBps = config_.liquidationBonusBps;
    }

    function pause() external restricted {
        _pause();
    }

    function unpause() external restricted {
        _unpause();
    }

    function setRiskEngine(IRiskEngine newRiskEngine) external restricted {
        if (address(newRiskEngine) == address(0)) revert InvalidConfiguration();
        riskEngine = newRiskEngine;
        emit RiskEngineUpdated(address(newRiskEngine));
    }

    function setOracle(ManualOracle newOracle) external restricted {
        if (address(newOracle) == address(0)) revert InvalidConfiguration();
        oracle = newOracle;
        emit OracleUpdated(address(newOracle));
    }

    function setTreasury(address newTreasury) external restricted {
        if (newTreasury == address(0)) revert InvalidConfiguration();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setBorrowCap(uint256 newBorrowCap) external restricted {
        if (newBorrowCap == 0) revert InvalidConfiguration();
        borrowCap = newBorrowCap;
        emit ParametersUpdated("borrowCap", newBorrowCap);
    }

    function setMinBorrowAmount(uint256 newMinBorrowAmount) external restricted {
        if (newMinBorrowAmount == 0) revert InvalidConfiguration();
        minBorrowAmount = newMinBorrowAmount;
        emit ParametersUpdated("minBorrowAmount", newMinBorrowAmount);
    }

    function setReserveFactorBps(uint256 newReserveFactorBps) external restricted {
        if (newReserveFactorBps > BPS) revert InvalidConfiguration();
        reserveFactorBps = newReserveFactorBps;
        emit ParametersUpdated("reserveFactorBps", newReserveFactorBps);
    }

    function setRiskBounds(uint256 newMaxLtvBps, uint256 newLiquidationThresholdBps) external restricted {
        if (
            newMaxLtvBps == 0 || newMaxLtvBps >= BPS || newLiquidationThresholdBps <= newMaxLtvBps
                || newLiquidationThresholdBps > BPS
        ) revert InvalidConfiguration();
        maxConfiguredLtvBps = newMaxLtvBps;
        maxConfiguredLiquidationThresholdBps = newLiquidationThresholdBps;
        emit ParametersUpdated("maxLtvBps", newMaxLtvBps);
        emit ParametersUpdated("liquidationThresholdBps", newLiquidationThresholdBps);
    }

    function setLiquidationBonusBps(uint256 newLiquidationBonusBps) external restricted {
        if (newLiquidationBonusBps > BPS) revert InvalidConfiguration();
        liquidationBonusBps = newLiquidationBonusBps;
        emit ParametersUpdated("liquidationBonusBps", newLiquidationBonusBps);
    }

    function depositCollateral(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Position storage position = positions[msg.sender];
        collateralAsset.safeTransferFrom(msg.sender, address(this), amount);
        position.collateralAmount += amount;
        if (position.lastAccruedAt == 0) {
            position.lastAccruedAt = block.timestamp;
        }
        if (_currentDebt(position) == 0) {
            position.maxLtvBpsSnapshot = maxConfiguredLtvBps;
            position.liquidationThresholdBpsSnapshot = maxConfiguredLiquidationThresholdBps;
            position.lastRiskUpdateAt = block.timestamp;
        } else {
            (uint256 price, bool fresh) = _oracleSnapshot();
            if (fresh && price != 0) {
                _refreshRiskSnapshot(position, price);
            }
        }
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Position storage position = positions[msg.sender];
        if (position.collateralAmount < amount) revert InsufficientCollateral();

        _accrue(position);
        position.collateralAmount -= amount;
        uint256 price = _latestOraclePrice();
        _refreshRiskSnapshot(position, price);
        _requireBorrowSafe(position, price, position.maxLtvBpsSnapshot);

        collateralAsset.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Position storage position = positions[msg.sender];
        if (position.collateralAmount == 0) revert InsufficientCollateral();

        _accrue(position);
        uint256 price = _latestOraclePrice();
        IRiskEngine.QuoteOutput memory quote = _quoteRisk(position, price, amount);
        uint256 effectiveMaxLtv = _effectiveMaxLtv(quote.maxLtvBps);
        uint256 effectiveLiquidationThreshold = _effectiveLiquidationThreshold(quote.liquidationThresholdBps);
        if (effectiveMaxLtv == 0 || effectiveLiquidationThreshold == 0) revert InvalidConfiguration();

        uint256 projectedOutstandingPrincipal = debtPool.outstandingPrincipal() + amount;
        if (projectedOutstandingPrincipal > borrowCap) {
            revert BorrowCapExceeded(projectedOutstandingPrincipal, borrowCap);
        }

        uint256 projectedDebt = currentDebt(msg.sender) + amount;
        _enforceMinimumDebt(projectedDebt);

        position.principalDebt += amount;
        position.borrowRateBps = quote.borrowRateBps;
        position.maxLtvBpsSnapshot = effectiveMaxLtv;
        position.liquidationThresholdBpsSnapshot = effectiveLiquidationThreshold;
        position.lastRiskUpdateAt = block.timestamp;
        if (position.lastAccruedAt == 0) {
            position.lastAccruedAt = block.timestamp;
        }

        _requireBorrowSafe(position, price, effectiveMaxLtv);

        debtPool.drawDebt(msg.sender, amount);
        emit Borrowed(msg.sender, amount, quote.borrowRateBps);
    }

    function repay(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Position storage position = positions[msg.sender];
        if (currentDebt(msg.sender) == 0) revert NoDebt();

        _accrue(position);
        uint256 debt = _currentDebt(position);
        uint256 payment = amount < debt ? amount : debt;
        debtAsset.safeTransferFrom(msg.sender, address(debtPool), payment);

        uint256 interestPaid = payment < position.accruedInterest ? payment : position.accruedInterest;
        position.accruedInterest -= interestPaid;
        uint256 principalPaid = payment - interestPaid;
        position.principalDebt -= principalPaid;
        debtPool.recordRepayment(principalPaid, interestPaid, reserveFactorBps);

        uint256 remainingDebt = _currentDebt(position);
        if (remainingDebt == 0) {
            _clearDebtState(position);
        } else {
            (uint256 price, bool fresh) = _oracleSnapshot();
            if (fresh && price != 0) {
                _refreshRiskSnapshot(position, price);
            }
        }

        emit Repaid(msg.sender, payment, principalPaid, interestPaid);
    }

    function liquidate(address borrower, uint256 requestedRepayAmount) external nonReentrant {
        if (requestedRepayAmount == 0) revert ZeroAmount();
        Position storage position = positions[borrower];

        _accrue(position);
        uint256 debt = _currentDebt(position);
        if (debt == 0) revert NoDebt();

        uint256 price = _latestOraclePrice();
        _refreshRiskSnapshot(position, price);
        uint256 healthFactorWad = _healthFactor(position, price, position.liquidationThresholdBpsSnapshot);
        if (healthFactorWad >= WAD) revert PositionHealthy(healthFactorWad);

        uint256 collateralValue = _collateralValue(position.collateralAmount, price);
        uint256 maxRepayAgainstCollateral = (collateralValue * BPS) / (BPS + liquidationBonusBps);
        uint256 actualRepay = _min(requestedRepayAmount, _min(debt, maxRepayAgainstCollateral));
        if (actualRepay == 0) revert InvalidLiquidationAmount();

        uint256 collateralSeized = (actualRepay * (BPS + liquidationBonusBps) * WAD) / (price * BPS);
        if (collateralSeized > position.collateralAmount) {
            collateralSeized = position.collateralAmount;
        }

        debtAsset.safeTransferFrom(msg.sender, address(debtPool), actualRepay);
        uint256 interestPaid = actualRepay < position.accruedInterest ? actualRepay : position.accruedInterest;
        position.accruedInterest -= interestPaid;
        uint256 principalPaid = actualRepay - interestPaid;
        position.principalDebt -= principalPaid;
        debtPool.recordRepayment(principalPaid, interestPaid, reserveFactorBps);

        position.collateralAmount -= collateralSeized;
        collateralAsset.safeTransfer(msg.sender, collateralSeized);

        uint256 badDebtWrittenOff;
        uint256 remainingDebt = _currentDebt(position);
        if (position.collateralAmount == 0 && remainingDebt > 0) {
            // The pool only accounts for principal as an asset. Unpaid accrued interest is forgiven with the
            // borrower position, but must not be pushed into principal-loss accounting.
            uint256 remainingPrincipalDebt = position.principalDebt;
            badDebtWrittenOff = remainingDebt;
            if (remainingPrincipalDebt > 0) {
                debtPool.recordLoss(remainingPrincipalDebt);
            }
            _clearDebtState(position);
            emit BadDebtRealized(borrower, remainingDebt);
        } else if (remainingDebt == 0) {
            _clearDebtState(position);
        } else {
            _enforceMinimumDebt(remainingDebt);
            _refreshRiskSnapshot(position, price);
        }

        emit Liquidated(borrower, msg.sender, actualRepay, collateralSeized, badDebtWrittenOff);
    }

    function currentDebt(address borrower) public view returns (uint256) {
        return _currentDebt(positions[borrower]);
    }

    function healthFactor(address borrower) external view returns (uint256) {
        Position storage position = positions[borrower];
        if (_currentDebt(position) == 0) {
            return type(uint256).max;
        }

        (uint256 price, bool fresh) = _oracleSnapshot();
        if (!fresh || price == 0) {
            return 0;
        }

        IRiskEngine.QuoteOutput memory quote = _quoteRisk(position, price, 0);
        return _healthFactor(position, price, _effectiveLiquidationThreshold(quote.liquidationThresholdBps));
    }

    function availableToBorrow(address borrower) external view returns (uint256) {
        Position storage position = positions[borrower];
        (uint256 price, bool fresh) = _oracleSnapshot();
        if (!fresh || price == 0) {
            return 0;
        }

        IRiskEngine.QuoteOutput memory quote = _quoteRisk(position, price, 0);
        uint256 effectiveMaxLtv = _effectiveMaxLtv(quote.maxLtvBps);
        if (effectiveMaxLtv == 0) {
            return 0;
        }

        uint256 borrowable = (_collateralValue(position.collateralAmount, price) * effectiveMaxLtv) / BPS;
        uint256 debt = _currentDebt(position);
        return borrowable > debt ? borrowable - debt : 0;
    }

    function previewBorrow(address borrower, uint256 additionalDebt)
        external
        view
        returns (IRiskEngine.QuoteOutput memory quote, uint256 projectedDebt, uint256 projectedHealthFactor)
    {
        Position storage position = positions[borrower];
        (uint256 price, bool fresh) = _oracleSnapshot();
        if (!fresh || price == 0) {
            return (quote, 0, 0);
        }

        quote = _quoteRisk(position, price, additionalDebt);
        projectedDebt = _currentDebt(position) + additionalDebt;
        uint256 threshold = _effectiveLiquidationThreshold(quote.liquidationThresholdBps);
        if (threshold != 0) {
            projectedHealthFactor = _healthFactor(position, price, threshold, additionalDebt);
        }
    }

    function _latestOraclePrice() private view returns (uint256) {
        return oracle.latestPriceWad();
    }

    function _oracleSnapshot() private view returns (uint256 price, bool fresh) {
        price = oracle.priceWad();
        fresh = oracle.isFresh();
    }

    function _quoteRisk(Position storage position, uint256 price, uint256 additionalDebt)
        private
        view
        returns (IRiskEngine.QuoteOutput memory)
    {
        uint256 projectedDebt = _currentDebt(position) + additionalDebt;
        uint256 collateralValue = _collateralValue(position.collateralAmount, price);
        uint256 collateralRatioBps = projectedDebt == 0 ? type(uint64).max : (collateralValue * BPS) / projectedDebt;
        uint256 totalAssets = debtPool.totalAssets();
        uint256 projectedOutstandingPrincipal = debtPool.outstandingPrincipal() + additionalDebt;
        uint256 utilizationBps = totalAssets == 0 ? 0 : (projectedOutstandingPrincipal * BPS) / totalAssets;

        return riskEngine.quote(
            IRiskEngine.QuoteInput({
                utilizationBps: utilizationBps,
                collateralRatioBps: collateralRatioBps,
                oracleAgeSeconds: block.timestamp - oracle.lastUpdatedAt(),
                oracleFresh: oracle.isFresh()
            })
        );
    }

    function _refreshRiskSnapshot(Position storage position, uint256 price) private {
        if (_currentDebt(position) == 0) {
            position.maxLtvBpsSnapshot = maxConfiguredLtvBps;
            position.liquidationThresholdBpsSnapshot = maxConfiguredLiquidationThresholdBps;
            position.lastRiskUpdateAt = block.timestamp;
            return;
        }

        IRiskEngine.QuoteOutput memory quote = _quoteRisk(position, price, 0);
        position.borrowRateBps = quote.borrowRateBps;
        position.maxLtvBpsSnapshot = _effectiveMaxLtv(quote.maxLtvBps);
        position.liquidationThresholdBpsSnapshot = _effectiveLiquidationThreshold(quote.liquidationThresholdBps);
        position.lastRiskUpdateAt = block.timestamp;
    }

    function _effectiveMaxLtv(uint256 quoteMaxLtv) private view returns (uint256) {
        return quoteMaxLtv < maxConfiguredLtvBps ? quoteMaxLtv : maxConfiguredLtvBps;
    }

    function _effectiveLiquidationThreshold(uint256 quoteLiquidationThreshold) private view returns (uint256) {
        return quoteLiquidationThreshold < maxConfiguredLiquidationThresholdBps
            ? quoteLiquidationThreshold
            : maxConfiguredLiquidationThresholdBps;
    }

    function _requireBorrowSafe(Position storage position, uint256 price, uint256 maxLtvBps) private view {
        uint256 debt = _currentDebt(position);
        if (debt == 0) {
            return;
        }

        uint256 maxDebt = (_collateralValue(position.collateralAmount, price) * maxLtvBps) / BPS;
        if (debt > maxDebt) revert InsufficientCollateral();
    }

    function _healthFactor(Position storage position, uint256 price, uint256 liquidationThresholdBps)
        private
        view
        returns (uint256)
    {
        return _healthFactor(position, price, liquidationThresholdBps, 0);
    }

    function _healthFactor(Position storage position, uint256 price, uint256 liquidationThresholdBps, uint256 additionalDebt)
        private
        view
        returns (uint256)
    {
        uint256 debt = _currentDebt(position) + additionalDebt;
        if (debt == 0) {
            return type(uint256).max;
        }

        uint256 collateralValue = _collateralValue(position.collateralAmount, price);
        return (collateralValue * liquidationThresholdBps * WAD) / (debt * BPS);
    }

    function _collateralValue(uint256 collateralAmount, uint256 price) private pure returns (uint256) {
        return (collateralAmount * price) / WAD;
    }

    function _currentDebt(Position storage position) private view returns (uint256) {
        return position.principalDebt + position.accruedInterest + _pendingInterest(position);
    }

    function _pendingInterest(Position storage position) private view returns (uint256) {
        if (position.principalDebt == 0 && position.accruedInterest == 0) {
            return 0;
        }
        if (position.borrowRateBps == 0 || position.lastAccruedAt == 0) {
            return 0;
        }

        uint256 elapsed = block.timestamp - position.lastAccruedAt;
        if (elapsed == 0) {
            return 0;
        }

        uint256 baseDebt = position.principalDebt + position.accruedInterest;
        return (baseDebt * position.borrowRateBps * elapsed) / (SECONDS_PER_YEAR * BPS);
    }

    function _accrue(Position storage position) private {
        uint256 pendingInterest = _pendingInterest(position);
        if (pendingInterest != 0) {
            position.accruedInterest += pendingInterest;
        }
        if (position.lastAccruedAt == 0) {
            position.lastAccruedAt = block.timestamp;
        } else if (position.principalDebt != 0 || position.accruedInterest != 0) {
            position.lastAccruedAt = block.timestamp;
        }
    }

    function _clearDebtState(Position storage position) private {
        position.principalDebt = 0;
        position.accruedInterest = 0;
        position.borrowRateBps = 0;
        position.maxLtvBpsSnapshot = maxConfiguredLtvBps;
        position.liquidationThresholdBpsSnapshot = maxConfiguredLiquidationThresholdBps;
        position.lastAccruedAt = block.timestamp;
        position.lastRiskUpdateAt = block.timestamp;
    }

    function _enforceMinimumDebt(uint256 debt) private view {
        if (debt != 0 && debt < minBorrowAmount) {
            revert DebtBelowMinimum(debt, minBorrowAmount);
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
