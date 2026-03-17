// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessManaged} from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DebtPool} from "./DebtPool.sol";
import {ManualOracle} from "./ManualOracle.sol";
import {IRiskAdapter} from "./interfaces/IRiskAdapter.sol";
import {IRiskEngine} from "./interfaces/IRiskEngine.sol";
import {IMigratableLendingCore} from "./interfaces/IMigratableLendingCore.sol";

contract LendingCore is AccessManaged, Pausable, ReentrancyGuard, IMigratableLendingCore {
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
        uint256 lastAccruedAt;
    }

    struct QuoteState {
        uint256 collateralAmount;
        uint256 debt;
        uint256 outstandingPrincipal;
        uint256 price;
        uint256 oracleAgeSeconds;
        bool oracleFresh;
    }

    IERC20 public immutable collateralAsset;
    IERC20 public immutable debtAsset;
    DebtPool public immutable debtPool;
    ManualOracle public immutable oracle;
    IRiskAdapter public immutable riskEngine;

    uint256 public immutable borrowCap;
    uint256 public immutable minBorrowAmount;
    uint256 public immutable reserveFactorBps;
    uint256 public immutable maxConfiguredLtvBps;
    uint256 public immutable maxConfiguredLiquidationThresholdBps;
    uint256 public immutable liquidationBonusBps;
    uint256 public immutable configEpoch;
    bool public newDebtFrozen;

    mapping(address => Position) public positions;

    error InvalidConfiguration();
    error ZeroAmount();
    error NoDebt();
    error InsufficientCollateral();
    error BorrowCapExceeded(uint256 attempted, uint256 cap);
    error DebtBelowMinimum(uint256 debt, uint256 minBorrowAmount);
    error PositionHealthy(uint256 healthFactorWad);
    error InvalidLiquidationAmount();
    error NewDebtDisabled();
    error NoPosition();
    error ExistingPosition();

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
    event BadDebtRealized(address indexed borrower, uint256 amount);
    event NewDebtFrozen();
    event PositionMigratedOut(
        address indexed borrower,
        address indexed coordinator,
        uint256 collateralAmount,
        uint256 principalDebt,
        uint256 accruedInterest
    );
    event PositionMigratedIn(
        address indexed borrower,
        address indexed coordinator,
        uint256 collateralAmount,
        uint256 principalDebt,
        uint256 accruedInterest
    );

    constructor(
        address authority_,
        IERC20 collateralAsset_,
        IERC20 debtAsset_,
        DebtPool debtPool_,
        ManualOracle oracle_,
        IRiskAdapter riskEngine_,
        MarketConfig memory config_
    ) AccessManaged(authority_) {
        if (
            authority_ == address(0) || address(collateralAsset_) == address(0) || address(debtAsset_) == address(0)
                || address(debtPool_) == address(0) || address(oracle_) == address(0)
                || address(riskEngine_) == address(0)
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
        borrowCap = config_.borrowCap;
        minBorrowAmount = config_.minBorrowAmount;
        reserveFactorBps = config_.reserveFactorBps;
        maxConfiguredLtvBps = config_.maxLtvBps;
        maxConfiguredLiquidationThresholdBps = config_.liquidationThresholdBps;
        liquidationBonusBps = config_.liquidationBonusBps;
        configEpoch = uint256(uint160(address(this)));
    }

    function pause() external restricted {
        _pause();
    }

    function unpause() external restricted {
        _unpause();
    }

    function freezeNewDebt() external restricted {
        newDebtFrozen = true;
        emit NewDebtFrozen();
    }


    function currentRiskConfigHash() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                borrowCap,
                minBorrowAmount,
                reserveFactorBps,
                maxConfiguredLtvBps,
                maxConfiguredLiquidationThresholdBps,
                liquidationBonusBps,
                address(oracle),
                address(riskEngine)
            )
        );
    }

    function currentQuoteContext() public view returns (IRiskAdapter.QuoteContext memory) {
        return IRiskAdapter.QuoteContext({
            oracleEpoch: oracle.oracleEpoch(),
            configEpoch: configEpoch,
            oracleStateHash: oracle.currentStateHash(),
            configHash: currentRiskConfigHash()
        });
    }

    function currentQuoteInput(address borrower) public view returns (IRiskEngine.QuoteInput memory) {
        Position storage position = positions[borrower];
        (uint256 price, bool fresh, uint256 oracleAgeSeconds) = _oracleSnapshot();
        return _buildQuoteInput(
            QuoteState({
                collateralAmount: position.collateralAmount,
                debt: _currentDebt(position),
                outstandingPrincipal: debtPool.outstandingPrincipal(),
                price: price,
                oracleAgeSeconds: oracleAgeSeconds,
                oracleFresh: fresh
            })
        );
    }

    function projectedBorrowQuoteInput(address borrower, uint256 additionalDebt)
        public
        view
        returns (IRiskEngine.QuoteInput memory)
    {
        Position storage position = positions[borrower];
        (uint256 price, bool fresh, uint256 oracleAgeSeconds) = _oracleSnapshot();
        return _buildQuoteInput(
            QuoteState({
                collateralAmount: position.collateralAmount,
                debt: _currentDebt(position) + additionalDebt,
                outstandingPrincipal: debtPool.outstandingPrincipal() + additionalDebt,
                price: price,
                oracleAgeSeconds: oracleAgeSeconds,
                oracleFresh: fresh
            })
        );
    }

    function publishCurrentQuoteTicket(address borrower) external returns (bytes32 ticketId) {
        IRiskEngine.QuoteInput memory input = currentQuoteInput(borrower);
        IRiskAdapter.QuoteContext memory context = currentQuoteContext();
        ticketId = riskEngine.quoteTicketId(context, input);
        riskEngine.quoteViaTicket(context, input);
    }

    function publishProjectedBorrowQuoteTicket(address borrower, uint256 additionalDebt) external returns (bytes32 ticketId) {
        IRiskEngine.QuoteInput memory input = projectedBorrowQuoteInput(borrower, additionalDebt);
        IRiskAdapter.QuoteContext memory context = currentQuoteContext();
        ticketId = riskEngine.quoteTicketId(context, input);
        riskEngine.quoteViaTicket(context, input);
    }

    function exportPositionForMigration(address borrower)
        external
        restricted
        nonReentrant
        returns (IMigratableLendingCore.MigratedPosition memory position)
    {
        Position storage sourcePosition = positions[borrower];
        _accrue(sourcePosition);

        if (sourcePosition.collateralAmount == 0 && _currentDebt(sourcePosition) == 0) revert NoPosition();

        position = IMigratableLendingCore.MigratedPosition({
            collateralAmount: sourcePosition.collateralAmount,
            principalDebt: sourcePosition.principalDebt,
            accruedInterest: sourcePosition.accruedInterest
        });

        if (position.principalDebt != 0) {
            debtPool.migratePrincipalOut(position.principalDebt);
        }

        sourcePosition.collateralAmount = 0;
        _clearDebtState(sourcePosition);
        if (position.collateralAmount != 0) {
            collateralAsset.safeTransfer(msg.sender, position.collateralAmount);
        }

        emit PositionMigratedOut(
            borrower,
            msg.sender,
            position.collateralAmount,
            position.principalDebt,
            position.accruedInterest
        );
    }

    function importMigratedPosition(address borrower, IMigratableLendingCore.MigratedPosition calldata position)
        external
        restricted
        nonReentrant
    {
        Position storage destinationPosition = positions[borrower];
        if (destinationPosition.collateralAmount != 0 || _currentDebt(destinationPosition) != 0) revert ExistingPosition();
        if (position.collateralAmount == 0 && position.principalDebt == 0 && position.accruedInterest == 0) revert NoPosition();

        if (position.collateralAmount != 0) {
            collateralAsset.safeTransferFrom(msg.sender, address(this), position.collateralAmount);
        }
        if (position.principalDebt != 0) {
            debtPool.migratePrincipalIn(position.principalDebt);
        }

        destinationPosition.collateralAmount = position.collateralAmount;
        destinationPosition.principalDebt = position.principalDebt;
        destinationPosition.accruedInterest = position.accruedInterest;
        destinationPosition.lastAccruedAt = block.timestamp;

        uint256 debt = _currentDebt(destinationPosition);
        if (debt != 0) {
            _enforceMinimumDebt(debt);
            uint256 price = _latestOraclePrice();
            uint256 oracleAgeSeconds = block.timestamp - oracle.lastUpdatedAt();
            IRiskEngine.QuoteOutput memory quote = _quoteCached(
                QuoteState({
                    collateralAmount: destinationPosition.collateralAmount,
                    debt: debt,
                    outstandingPrincipal: debtPool.outstandingPrincipal(),
                    price: price,
                    oracleAgeSeconds: oracleAgeSeconds,
                    oracleFresh: true
                })
            );
            uint256 effectiveMaxLtv = _effectiveMaxLtv(quote.maxLtvBps);
            if (effectiveMaxLtv == 0) revert InvalidConfiguration();
            destinationPosition.borrowRateBps = quote.borrowRateBps;
            _requireBorrowSafe(destinationPosition.collateralAmount, debt, price, effectiveMaxLtv);
        }

        emit PositionMigratedIn(
            borrower,
            msg.sender,
            position.collateralAmount,
            position.principalDebt,
            position.accruedInterest
        );
    }

    function depositCollateral(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Position storage position = positions[msg.sender];
        collateralAsset.safeTransferFrom(msg.sender, address(this), amount);
        position.collateralAmount += amount;
        if (position.lastAccruedAt == 0) {
            position.lastAccruedAt = block.timestamp;
        }

        uint256 debt = _currentDebt(position);
        if (debt != 0) {
            (uint256 price, bool fresh, uint256 oracleAgeSeconds) = _oracleSnapshot();
            if (fresh && price != 0) {
                IRiskEngine.QuoteOutput memory quote = _quoteCached(
                    QuoteState({
                        collateralAmount: position.collateralAmount,
                        debt: debt,
                        outstandingPrincipal: debtPool.outstandingPrincipal(),
                        price: price,
                        oracleAgeSeconds: oracleAgeSeconds,
                        oracleFresh: true
                    })
                );
                position.borrowRateBps = quote.borrowRateBps;
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
        uint256 debt = _currentDebt(position);
        if (debt != 0) {
            uint256 oracleAgeSeconds = block.timestamp - oracle.lastUpdatedAt();
            IRiskEngine.QuoteOutput memory quote = _quoteCached(
                QuoteState({
                    collateralAmount: position.collateralAmount,
                    debt: debt,
                    outstandingPrincipal: debtPool.outstandingPrincipal(),
                    price: price,
                    oracleAgeSeconds: oracleAgeSeconds,
                    oracleFresh: true
                })
            );
            uint256 effectiveMaxLtv = _effectiveMaxLtv(quote.maxLtvBps);
            if (effectiveMaxLtv == 0) revert InvalidConfiguration();
            position.borrowRateBps = quote.borrowRateBps;
            _requireBorrowSafe(position.collateralAmount, debt, price, effectiveMaxLtv);
        }

        collateralAsset.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (newDebtFrozen) revert NewDebtDisabled();
        Position storage position = positions[msg.sender];
        if (position.collateralAmount == 0) revert InsufficientCollateral();

        _accrue(position);
        uint256 price = _latestOraclePrice();
        uint256 oracleAgeSeconds = block.timestamp - oracle.lastUpdatedAt();
        uint256 projectedDebt = _currentDebt(position) + amount;
        uint256 projectedOutstandingPrincipal = debtPool.outstandingPrincipal() + amount;
        IRiskEngine.QuoteOutput memory quote = _quoteCached(
            QuoteState({
                collateralAmount: position.collateralAmount,
                debt: projectedDebt,
                outstandingPrincipal: projectedOutstandingPrincipal,
                price: price,
                oracleAgeSeconds: oracleAgeSeconds,
                oracleFresh: true
            })
        );
        uint256 effectiveMaxLtv = _effectiveMaxLtv(quote.maxLtvBps);
        uint256 effectiveLiquidationThreshold = _effectiveLiquidationThreshold(quote.liquidationThresholdBps);
        if (effectiveMaxLtv == 0 || effectiveLiquidationThreshold == 0) revert InvalidConfiguration();

        if (projectedOutstandingPrincipal > borrowCap) {
            revert BorrowCapExceeded(projectedOutstandingPrincipal, borrowCap);
        }

        _enforceMinimumDebt(projectedDebt);

        position.principalDebt += amount;
        position.borrowRateBps = quote.borrowRateBps;
        if (position.lastAccruedAt == 0) {
            position.lastAccruedAt = block.timestamp;
        }

        _requireBorrowSafe(position.collateralAmount, projectedDebt, price, effectiveMaxLtv);

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
            (uint256 price, bool fresh, uint256 oracleAgeSeconds) = _oracleSnapshot();
            if (fresh && price != 0) {
                IRiskEngine.QuoteOutput memory quote = _quoteCached(
                    QuoteState({
                        collateralAmount: position.collateralAmount,
                        debt: remainingDebt,
                        outstandingPrincipal: debtPool.outstandingPrincipal(),
                        price: price,
                        oracleAgeSeconds: oracleAgeSeconds,
                        oracleFresh: true
                    })
                );
                position.borrowRateBps = quote.borrowRateBps;
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
        uint256 oracleAgeSeconds = block.timestamp - oracle.lastUpdatedAt();
        {
            IRiskEngine.QuoteOutput memory currentQuote = _quoteCached(
                QuoteState({
                    collateralAmount: position.collateralAmount,
                    debt: debt,
                    outstandingPrincipal: debtPool.outstandingPrincipal(),
                    price: price,
                    oracleAgeSeconds: oracleAgeSeconds,
                    oracleFresh: true
                })
            );
            uint256 currentThreshold = _effectiveLiquidationThreshold(currentQuote.liquidationThresholdBps);
            if (currentThreshold == 0) revert InvalidConfiguration();

            uint256 healthFactorWad = _healthFactor(position.collateralAmount, debt, price, currentThreshold);
            if (healthFactorWad >= WAD) revert PositionHealthy(healthFactorWad);
        }

        uint256 collateralValue = _collateralValue(position.collateralAmount, price);
        uint256 actualRepay = _min(
            requestedRepayAmount,
            _min(debt, (collateralValue * BPS) / (BPS + liquidationBonusBps))
        );
        if (actualRepay == 0) revert InvalidLiquidationAmount();

        uint256 collateralSeized = (actualRepay * (BPS + liquidationBonusBps) * WAD) / (price * BPS);
        if (collateralSeized > position.collateralAmount) {
            collateralSeized = position.collateralAmount;
        }

        debtAsset.safeTransferFrom(msg.sender, address(debtPool), actualRepay);
        {
            uint256 interestPaid = actualRepay < position.accruedInterest ? actualRepay : position.accruedInterest;
            position.accruedInterest -= interestPaid;
            uint256 principalPaid = actualRepay - interestPaid;
            position.principalDebt -= principalPaid;
            debtPool.recordRepayment(principalPaid, interestPaid, reserveFactorBps);
        }

        position.collateralAmount -= collateralSeized;
        collateralAsset.safeTransfer(msg.sender, collateralSeized);

        uint256 badDebtWrittenOff;
        uint256 remainingDebt = _currentDebt(position);
        if (position.collateralAmount == 0 && remainingDebt > 0) {
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
            IRiskEngine.QuoteOutput memory postQuote = _quoteCached(
                QuoteState({
                    collateralAmount: position.collateralAmount,
                    debt: remainingDebt,
                    outstandingPrincipal: debtPool.outstandingPrincipal(),
                    price: price,
                    oracleAgeSeconds: oracleAgeSeconds,
                    oracleFresh: true
                })
            );
            position.borrowRateBps = postQuote.borrowRateBps;
        }

        emit Liquidated(borrower, msg.sender, actualRepay, collateralSeized, badDebtWrittenOff);
    }

    function currentDebt(address borrower) public view returns (uint256) {
        return _currentDebt(positions[borrower]);
    }

    function healthFactor(address borrower) external view returns (uint256) {
        Position storage position = positions[borrower];
        uint256 debt = _currentDebt(position);
        if (debt == 0) {
            return type(uint256).max;
        }

        (uint256 price, bool fresh, uint256 oracleAgeSeconds) = _oracleSnapshot();
        if (!fresh || price == 0) {
            return 0;
        }

        IRiskEngine.QuoteOutput memory quote = _quoteView(
            QuoteState({
                collateralAmount: position.collateralAmount,
                debt: debt,
                outstandingPrincipal: debtPool.outstandingPrincipal(),
                price: price,
                oracleAgeSeconds: oracleAgeSeconds,
                oracleFresh: true
            })
        );
        return _healthFactor(position.collateralAmount, debt, price, _effectiveLiquidationThreshold(quote.liquidationThresholdBps));
    }

    function availableToBorrow(address borrower) external view returns (uint256) {
        Position storage position = positions[borrower];
        (uint256 price, bool fresh, uint256 oracleAgeSeconds) = _oracleSnapshot();
        if (!fresh || price == 0) {
            return 0;
        }

        uint256 debt = _currentDebt(position);
        IRiskEngine.QuoteOutput memory quote = _quoteView(
            QuoteState({
                collateralAmount: position.collateralAmount,
                debt: debt,
                outstandingPrincipal: debtPool.outstandingPrincipal(),
                price: price,
                oracleAgeSeconds: oracleAgeSeconds,
                oracleFresh: true
            })
        );
        uint256 effectiveMaxLtv = _effectiveMaxLtv(quote.maxLtvBps);
        if (effectiveMaxLtv == 0) {
            return 0;
        }

        uint256 borrowable = (_collateralValue(position.collateralAmount, price) * effectiveMaxLtv) / BPS;
        return borrowable > debt ? borrowable - debt : 0;
    }

    function previewBorrow(address borrower, uint256 additionalDebt)
        external
        view
        returns (IRiskEngine.QuoteOutput memory quote, uint256 projectedDebt, uint256 projectedHealthFactor)
    {
        Position storage position = positions[borrower];
        (uint256 price, bool fresh, uint256 oracleAgeSeconds) = _oracleSnapshot();
        if (!fresh || price == 0) {
            return (quote, 0, 0);
        }

        projectedDebt = _currentDebt(position) + additionalDebt;
        quote = _quoteView(
            QuoteState({
                collateralAmount: position.collateralAmount,
                debt: projectedDebt,
                outstandingPrincipal: debtPool.outstandingPrincipal() + additionalDebt,
                price: price,
                oracleAgeSeconds: oracleAgeSeconds,
                oracleFresh: true
            })
        );
        uint256 threshold = _effectiveLiquidationThreshold(quote.liquidationThresholdBps);
        if (threshold != 0) {
            projectedHealthFactor = _healthFactor(position.collateralAmount, projectedDebt, price, threshold);
        }
    }

    function _latestOraclePrice() private view returns (uint256) {
        return oracle.latestPriceWad();
    }

    function _oracleSnapshot() private view returns (uint256 price, bool fresh, uint256 oracleAgeSeconds) {
        price = oracle.priceWad();
        fresh = oracle.isFresh();
        oracleAgeSeconds = block.timestamp - oracle.lastUpdatedAt();
    }

    function _quoteView(QuoteState memory state) private view returns (IRiskEngine.QuoteOutput memory) {
        return riskEngine.quote(_buildQuoteInput(state));
    }

    function _quoteCached(QuoteState memory state) private returns (IRiskEngine.QuoteOutput memory) {
        return riskEngine.quoteViaTicket(currentQuoteContext(), _buildQuoteInput(state));
    }

    function _buildQuoteInput(QuoteState memory state) private view returns (IRiskEngine.QuoteInput memory) {
        uint256 collateralValue = _collateralValue(state.collateralAmount, state.price);
        uint256 collateralRatioBps = state.debt == 0 ? type(uint64).max : (collateralValue * BPS) / state.debt;
        uint256 totalAssets = debtPool.totalAssets();
        uint256 utilizationBps = totalAssets == 0 ? 0 : (state.outstandingPrincipal * BPS) / totalAssets;
        uint256 normalizedOracleAgeSeconds = 0;
        if (state.oracleFresh && state.oracleAgeSeconds > 30 minutes) {
            normalizedOracleAgeSeconds = 30 minutes + 1;
        }
        return IRiskEngine.QuoteInput({
            utilizationBps: utilizationBps,
            collateralRatioBps: collateralRatioBps,
            oracleAgeSeconds: normalizedOracleAgeSeconds,
            oracleFresh: state.oracleFresh
        });
    }

    function _effectiveMaxLtv(uint256 quoteMaxLtv) private view returns (uint256) {
        return quoteMaxLtv < maxConfiguredLtvBps ? quoteMaxLtv : maxConfiguredLtvBps;
    }

    function _effectiveLiquidationThreshold(uint256 quoteLiquidationThreshold) private view returns (uint256) {
        return quoteLiquidationThreshold < maxConfiguredLiquidationThresholdBps
            ? quoteLiquidationThreshold
            : maxConfiguredLiquidationThresholdBps;
    }

    function _requireBorrowSafe(uint256 collateralAmount, uint256 debt, uint256 price, uint256 maxLtvBps) private pure {
        if (debt == 0) {
            return;
        }

        uint256 maxDebt = (_collateralValue(collateralAmount, price) * maxLtvBps) / BPS;
        if (debt > maxDebt) revert InsufficientCollateral();
    }

    function _healthFactor(uint256 collateralAmount, uint256 debt, uint256 price, uint256 liquidationThresholdBps)
        private
        pure
        returns (uint256)
    {
        if (debt == 0) {
            return type(uint256).max;
        }

        uint256 collateralValue = _collateralValue(collateralAmount, price);
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
        position.lastAccruedAt = block.timestamp;
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
